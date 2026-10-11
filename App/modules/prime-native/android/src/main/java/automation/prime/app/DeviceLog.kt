package automation.prime.app

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Device-side error log.
 *
 * Every error that happens ON the device — a flow step that failed, an order
 * that could not be sent, the accessibility service stopping, a crash — is
 * recorded here with the engine log lines that led up to it and a text dump of
 * the screen at that moment, then uploaded to the backend's
 * POST /api/device-logs/ so it can be read on the dashboard's developer page.
 *
 * It lives in Kotlin, not JS, because the engine keeps running while Prime is
 * backgrounded and the JS thread is not: an error at 3 a.m. must still be
 * captured. Reports are appended to a file first and uploaded from there, so
 * one made while offline (or before login) is sent later instead of lost.
 *
 * A failing flow retries every couple of seconds, so the same error is
 * throttled: reported once, then again after [THROTTLE_MS] carrying the number
 * of repeats in between.
 */
object DeviceLog {
  private const val QUEUE_FILE = "device-log-queue.jsonl"
  private const val MAX_QUEUE = 200          // reports kept while offline
  private const val TRAIL_SIZE = 40          // engine log lines kept per task
  private const val MAX_SCREEN_TEXTS = 300
  private const val MAX_TEXT = 300
  private const val BATCH = 20
  private const val THROTTLE_MS = 10 * 60 * 1000L

  private val lock = Any()
  private val io = Executors.newSingleThreadExecutor()
  private val trails = HashMap<String, ArrayDeque<String>>()
  /** key -> [last report time, repeats swallowed since]. */
  private val throttle = HashMap<String, LongArray>()

  @Volatile private var appContext: Context? = null
  @Volatile private var baseUrl: String? = null
  @Volatile private var token: String? = null
  @Volatile private var crashHandlerInstalled = false

  /** Bind to the app; safe to call repeatedly. Installs the crash recorder. */
  fun init(context: Context) {
    appContext = context.applicationContext
    if (crashHandlerInstalled) return
    crashHandlerInstalled = true
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        // Written straight to disk — the process is about to die, so the
        // upload happens on the next launch.
        enqueue(entry("", "crash", "${error.javaClass.simpleName}: ${error.message}",
          error.stackTraceToString().lines().take(TRAIL_SIZE), null, 1))
      } catch (_: Throwable) {
      }
      previous?.uncaughtException(thread, error)
    }
  }

  /** Set (or clear, with nulls) where reports go. Called from JS on login/logout. */
  fun configure(context: Context?, baseUrl: String?, token: String?) {
    context?.let { init(it) }
    this.baseUrl = baseUrl?.trimEnd('/')?.takeIf { it.isNotEmpty() }
    this.token = token?.takeIf { it.isNotEmpty() }
    flushAsync()
  }

  /** Remember one engine log line so a later error can show what led to it. */
  fun trail(slug: String, level: String, message: String, depth: Int) {
    val line = "${clock()} [$level] ${"  ".repeat(depth.coerceIn(0, 8))}${message.take(MAX_TEXT)}"
    synchronized(lock) {
      val buf = trails.getOrPut(slug) { ArrayDeque() }
      buf.addLast(line)
      while (buf.size > TRAIL_SIZE) buf.removeFirst()
    }
  }

  /**
   * Record an error. Call it at the moment of failure — the screen is captured
   * here, synchronously, before any recovery step changes what is on it.
   */
  fun report(slug: String, kind: String, message: String, captureScreen: Boolean = true) {
    try {
      val now = System.currentTimeMillis()
      val key = "$slug|$kind|$message"
      // null = the same error was reported recently; just count the repeat.
      val due: Pair<Int, List<String>>? = synchronized(lock) {
        val seen = throttle[key]
        if (seen != null && now - seen[0] < THROTTLE_MS) {
          seen[1] = seen[1] + 1L
          null
        } else {
          val repeats = (seen?.get(1) ?: 0L).toInt() + 1
          if (throttle.size > 500) throttle.clear()
          throttle[key] = longArrayOf(now, 0L)
          Pair(repeats, trails[slug]?.toList() ?: emptyList())
        }
      }
      if (due == null) return
      val (repeats, context) = due
      val screen = if (captureScreen) snapshot() else null
      val item = entry(slug, kind, message, context, screen, repeats)
      io.execute {
        enqueue(item)
        flush()
      }
    } catch (_: Throwable) {
      // Logging must never break the engine.
    }
  }

  fun flushAsync() {
    io.execute { flush() }
  }

  // ---- internals ------------------------------------------------------------

  private fun clock(): String = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())

  private fun entry(
    slug: String, kind: String, message: String,
    context: List<String>, screen: JSONObject?, count: Int,
  ): JSONObject = JSONObject().apply {
    put("platform", slug)
    put("kind", kind)
    put("message", message.take(2000))
    put("occurred_at", System.currentTimeMillis())
    put("count", count)
    put("context", JSONArray(context))
    if (screen != null) put("screen", screen)
  }

  /** Foreground package + visible texts, or null when the service is down. */
  private fun snapshot(): JSONObject? = try {
    val service = PrimeAccessibilityService.instance
    if (service == null) null else {
      val snap = service.readScreen()
      val texts = (snap["texts"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
      JSONObject().apply {
        put("package", snap["package"] as? String ?: "")
        put("texts", JSONArray(texts.take(MAX_SCREEN_TEXTS).map { it.take(MAX_TEXT) }))
      }
    }
  } catch (_: Throwable) {
    null
  }

  private fun queueFile(): File? = appContext?.let { File(it.filesDir, QUEUE_FILE) }

  private fun enqueue(item: JSONObject) {
    val file = queueFile() ?: return
    synchronized(file.path.intern()) {
      val lines = if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()
      // Oldest reports are dropped first when a device stays offline for long.
      val kept = (lines + item.toString()).takeLast(MAX_QUEUE)
      file.writeText(kept.joinToString("\n") + "\n")
    }
  }

  /** Upload queued reports. Runs on [io]; a failed batch stays queued. */
  private fun flush() {
    val url = baseUrl ?: return
    val auth = token ?: return
    val file = queueFile() ?: return
    try {
      while (true) {
        val lines = synchronized(file.path.intern()) {
          if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()
        }
        if (lines.isEmpty()) return
        val batch = lines.take(BATCH)
        val entries = JSONArray()
        for (line in batch) {
          try { entries.put(JSONObject(line)) } catch (_: Exception) { /* skip a corrupt line */ }
        }
        val body = JSONObject().apply {
          put("source", "app")
          put("device", deviceInfo())
          put("entries", entries)
        }
        val code = post("$url/api/device-logs/", auth, body.toString())
        // 2xx: stored. 400/413: the server will never accept this batch, so
        // drop it rather than block the queue forever. Anything else (offline,
        // 401 after logout, 5xx): keep it and try again later.
        if (code !in 200..299 && code != 400 && code != 413) return
        synchronized(file.path.intern()) {
          val current = if (file.exists()) file.readLines().filter { it.isNotBlank() } else emptyList()
          val rest = current.drop(batch.size)
          if (rest.isEmpty()) file.delete() else file.writeText(rest.joinToString("\n") + "\n")
        }
      }
    } catch (_: Throwable) {
      // Offline or the server is down — the queue is kept for the next flush.
    }
  }

  private fun post(url: String, auth: String, json: String): Int {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Authorization", "Token $auth")
      connection.doOutput = true
      connection.connectTimeout = 10_000
      connection.readTimeout = 15_000
      connection.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
      return connection.responseCode
    } finally {
      connection.disconnect()
    }
  }

  private fun deviceInfo(): JSONObject = JSONObject().apply {
    val context = appContext
    put("model", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
    put("os", Build.VERSION.RELEASE ?: "")
    if (context != null) {
      try {
        put("id", Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "")
      } catch (_: Throwable) {
      }
      try {
        put("app_version", context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "")
      } catch (_: Throwable) {
      }
    }
  }
}
