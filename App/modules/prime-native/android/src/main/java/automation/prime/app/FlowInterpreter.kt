package automation.prime.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The native engine — Kotlin twin of the TypeScript interpreter.
 *
 * Runs entirely off the JS thread, so it keeps polling/tapping/scrolling
 * reliably while Prime Automation is backgrounded — which is what "tasks
 * shouldn't die" actually requires on Android.
 *
 * It is configuration-driven: the same JSON shape the TS interpreter consumes
 * (see App/src/automation/config.types.ts) is passed in as a Map. The shape
 * stays the single source of truth; the language is just whichever side runs
 * the loop.
 *
 * Steps it implements: launchApp, waitForApp, waitFor, watchFor, wait, tap,
 * scroll, readField, readScreen, extractList, back, if, sendRequest.
 */
class FlowInterpreter(
  private val config: Map<String, Any?>,
  private val onLog: (level: String, message: String, depth: Int) -> Unit,
  private val onIteration: (Int) -> Unit,
  /** Polled between iterations; while true the loop pauses (never mid-order). */
  private val isPaused: () -> Boolean = { false },
) {
  private val label: String = config["label"] as? String ?: (config["platform"] as? String ?: "?")
  private val runMode: String = config["runMode"] as? String ?: "once"
  private val targetPackage: String = config["targetPackage"] as? String ?: ""
  private val parameters: Map<String, Any?> = asMap(config["parameters"])
  private val selectorDefs: Map<String, Map<String, Any?>> = asMap(config["selectors"]).mapValues { asMap(it.value) }
  private val flow: List<Map<String, Any?>> = asList(config["flow"]).map { asMap(it) }
  private val priority: Int = (config["priority"] as? Number)?.toInt() ?: 0
  private val token: String = config["platform"] as? String ?: "task"
  private val backend: Map<String, Any?> = asMap(config["backend"])
  /** Initial variables seeded into every iteration's scope (e.g. pushed items). */
  private val vars: Map<String, Any?> = asMap(config["vars"])
  private var lockHeld = false

  private val scope = LinkedHashMap<String, Any?>()
  private val orders = mutableListOf<Map<String, String>>()

  /** Runs one or many iterations depending on `runMode`. Cancellable via the parent job. */
  suspend fun runLoop() = coroutineScope {
    val scanInterval = (parameters["scanIntervalSec"] as? Number)?.toLong() ?: 5L
    val intervalMs = scanInterval * 1000L
    val retryDelayMs = 2_000L
    var iteration = 0

    while (isActive) {
      // Honor an explicit pause between iterations (never mid-order, never
      // while holding the screen lock).
      while (isPaused() && isActive) delay(PAUSE_POLL_MS)
      if (!isActive) return@coroutineScope
      val ok = try {
        runFlowOnce()
        true
      } catch (e: CancellationException) {
        throw e
      } catch (e: StepFailure) {
        onLog("error", "فشل التدفق · ${e.message}", 0)
        recoverToMain()
        false
      } catch (e: Exception) {
        onLog("error", "خطأ غير متوقّع · ${e.message}", 0)
        recoverToMain()
        false
      }

      if (!isActive) return@coroutineScope
      if (runMode != "continuous") return@coroutineScope

      iteration += 1
      onIteration(iteration)
      delay(if (ok) intervalMs else retryDelayMs)
    }
  }

  /**
   * Best-effort recovery after a failed flow: press back a few times to dismiss
   * any dialog/sheet left open and return toward the app's main screen, so the
   * next run (or next queued item) starts clean instead of stranded mid-screen.
   * e.g. turning an item ON that's already ON leaves the availability sheet open
   * with no on-option to tap — this backs out of it.
   */
  private suspend fun recoverToMain() = coroutineScope {
    val service = PrimeAccessibilityService.instance ?: return@coroutineScope
    onLog("info", "تعذّر — محاولة العودة للشاشة الرئيسية", 0)
    repeat(3) {
      if (!isActive) return@coroutineScope
      withContext(Dispatchers.IO) { service.pressBack() }
      delay(500)
    }
  }

  private suspend fun runFlowOnce() = coroutineScope {
    // Fresh scope per iteration so old values don't bleed across runs.
    scope.clear()
    scope["scanIntervalSec"] = (parameters["scanIntervalSec"] as? Number)?.toLong() ?: 5L
    scope["autoConfirm"] = parameters["autoConfirm"] as? Boolean ?: false
    // Seed injected variables (e.g. the menu items pushed via FCM) so `forEach`
    // and {{interpolation}} can read them.
    for ((k, v) in vars) scope[k] = v
    orders.clear()

    onLog("info", "بدء تدفق \"$label\" · ${flow.size} خطوة", 0)
    try {
      for (step in flow) {
        ensureActive()
        runStep(step, 0)
      }
      onLog("success", "اكتمل التدفق · ${orders.size} طلب", 0)
    } finally {
      // Always release the screen at the iteration boundary so other tasks
      // (and higher-priority pushes) can take their turn.
      if (lockHeld) {
        ScreenLock.release(token)
        lockHeld = false
      }
    }
  }

  private suspend fun runStep(step: Map<String, Any?>, depth: Int): Unit = coroutineScope {
    val type = step["type"] as? String ?: throw StepFailure("نوع خطوة غير محدّد")
    val service = PrimeAccessibilityService.instance
      ?: throw StepFailure("خدمة الوصول غير متّصلة")

    // Acquire the shared screen before the first action step of this iteration.
    // Held until the iteration ends — so we finish the current order, then yield.
    if (!lockHeld && type in ACTION_STEPS) {
      onLog("info", "بانتظار الشاشة…", depth)
      ScreenLock.acquire(token, priority) { false }
      lockHeld = true
    }

    when (type) {
      "launchApp" -> {
        val sel = resolveSelector(step["selector"] as String)
        onLog("step", "تشغيل التطبيق · ${sel.value}", depth)
        val ok = withContext(Dispatchers.IO) { service.launchApp(sel.value) }
        if (!ok) throw StepFailure(
          "تعذّر تشغيل التطبيق: ${sel.value} — تحقّق من اسم الحزمة وأنّ التطبيق مُثبَّت."
        )
      }
      "waitForApp" -> {
        val sel = resolveSelector(step["selector"] as String)
        val timeoutMs = (step["timeoutMs"] as? Number)?.toLong() ?: 8_000L
        onLog("step", "انتظار التطبيق · ${sel.value}", depth)
        val deadline = System.currentTimeMillis() + timeoutMs
        var arrived = false
        while (isActive && System.currentTimeMillis() < deadline) {
          if (service.currentForegroundPackage() == sel.value) {
            arrived = true
            break
          }
          delay(200)
        }
        if (!arrived) throw StepFailure("لم يصبح التطبيق في المقدّمة: ${sel.value}")
      }
      "waitFor" -> {
        val key = step["selector"] as String
        val sel = resolveSelector(key)
        val timeoutMs = (step["timeoutMs"] as? Number)?.toLong() ?: 5_000L
        val scopeLabel = if (sel.packageScope.isNotEmpty()) " (في ${sel.packageScope})" else ""
        onLog("step", "انتظار ظهور · $key$scopeLabel", depth)
        val deadline = System.currentTimeMillis() + timeoutMs
        var found = false
        while (isActive && System.currentTimeMillis() < deadline) {
          val poll = (deadline - System.currentTimeMillis()).coerceAtMost(200L)
          if (poll <= 0L) break
          val ok = withContext(Dispatchers.IO) { service.waitForElement(sel, poll) }
          if (ok) { found = true; break }
        }
        if (!found) throw StepFailure("لم يظهر العنصر: $key")
      }
      "watchFor" -> {
        val key = step["selector"] as String
        val sel = resolveSelector(key)
        val intervalMs = (step["intervalMs"] as? Number)?.toLong() ?: 500L
        val scopeLabel = if (sel.packageScope.isNotEmpty()) " (في ${sel.packageScope})" else ""
        onLog("step", "مراقبة الشاشة لـ · $key$scopeLabel", depth)
        // Heartbeat so a forever-watch is visible in the log instead of silent.
        val heartbeat = launch {
          var elapsed = 0
          while (isActive) {
            delay(5_000)
            elapsed += 5
            onLog("info", "لا يزال يراقب · ${elapsed}ث", depth)
          }
        }
        try {
          var found = false
          while (isActive && !found) {
            found = withContext(Dispatchers.IO) { service.waitForElement(sel, intervalMs) }
            if (!found) delay(50)
          }
          if (found) onLog("success", "ظهر · $key", depth)
        } finally {
          heartbeat.cancel()
        }
      }
      "wait" -> {
        val duration = (step["durationMs"] as? Number)?.toLong() ?: 0L
        onLog("step", "تأخير · $duration ملّي", depth)
        delay(duration)
      }
      "tap" -> {
        val key = step["selector"] as String
        val sel = resolveSelector(key)
        onLog("step", "نقر · $key", depth)
        val ok = withContext(Dispatchers.IO) { service.tapElement(sel) }
        if (!ok) onLog("info", "تعذّر العثور على $key للنقر", depth)
      }
      "tapInRow" -> {
        val anchorKey = step["anchor"] as String
        val targetKey = step["target"] as String
        onLog("step", "نقر في صف · $anchorKey ← $targetKey", depth)
        val ok = withContext(Dispatchers.IO) {
          service.tapInRow(resolveSelector(anchorKey), resolveSelector(targetKey))
        }
        if (!ok) onLog("info", "تعذّر إيجاد صف · $anchorKey", depth)
      }
      "tapAt" -> {
        val x = (step["x"] as? Number)?.toDouble() ?: 0.0
        val y = (step["y"] as? Number)?.toDouble() ?: 0.0
        onLog("step", "نقر عند · $x,$y", depth)
        withContext(Dispatchers.IO) { service.tapAt(x, y) }
      }
      "longPress" -> {
        val key = step["selector"] as String
        onLog("step", "ضغط مطوّل · $key", depth)
        withContext(Dispatchers.IO) { service.longPress(resolveSelector(key)) }
      }
      "doubleTap" -> {
        val key = step["selector"] as String
        onLog("step", "نقر مزدوج · $key", depth)
        withContext(Dispatchers.IO) { service.doubleTap(resolveSelector(key)) }
      }
      "swipe" -> {
        val direction = step["direction"] as? String ?: "down"
        val key = step["selector"] as? String
        val sel = key?.let { resolveSelector(it) }
        onLog("step", "سحب · $direction", depth)
        withContext(Dispatchers.IO) { service.swipe(direction, sel) }
      }
      "setText" -> {
        val key = step["selector"] as String
        val rawText = step["text"] as? String ?: ""
        val text = if (rawText.contains("{{")) interpolate(rawText) else rawText
        onLog("step", "إدخال نص · $key", depth)
        withContext(Dispatchers.IO) { service.setText(resolveSelector(key), text) }
      }
      "clearText" -> {
        val key = step["selector"] as String
        onLog("step", "مسح النص · $key", depth)
        withContext(Dispatchers.IO) { service.clearText(resolveSelector(key)) }
      }
      "exists" -> {
        val key = step["selector"] as String
        val saveAs = step["saveAs"] as String
        val found = withContext(Dispatchers.IO) { service.exists(resolveSelector(key)) }
        scope[saveAs] = found
        onLog("step", "موجود؟ · $key = $found", depth)
      }
      "home" -> {
        onLog("step", "زر الرئيسية", depth)
        withContext(Dispatchers.IO) { service.pressHome() }
      }
      "recents" -> {
        onLog("step", "قائمة التطبيقات", depth)
        withContext(Dispatchers.IO) { service.pressRecents() }
      }
      "openNotifications" -> {
        onLog("step", "فتح الإشعارات", depth)
        withContext(Dispatchers.IO) { service.openNotifications() }
      }
      "forEach" -> {
        val itemsPath = step["items"] as? String ?: ""
        val asName = step["as"] as? String ?: "item"
        val list = readPath(scope, itemsPath) as? List<*> ?: emptyList<Any?>()
        val body = asList(step["do"]).map { asMap(it) }
        onLog("step", "تكرار · $itemsPath (${list.size})", depth)
        val had = scope.containsKey(asName)
        val prev = scope[asName]
        try {
          list.forEachIndexed { i, element ->
            ensureActive()
            scope[asName] = element
            onLog("info", "عنصر ${i + 1}/${list.size}", depth)
            for (child in body) runStep(child, depth + 1)
          }
        } finally {
          if (had) scope[asName] = prev else scope.remove(asName)
        }
      }
      "scroll" -> {
        val key = step["selector"] as String
        val sel = resolveSelector(key)
        val direction = step["direction"] as? String ?: "down"
        onLog("step", "تمرير · ${if (direction == "down") "لأسفل" else "لأعلى"}", depth)
        withContext(Dispatchers.IO) { service.scrollElement(sel, direction) }
      }
      "scrollUntil" -> {
        val untilKey = step["until"] as String
        val until = resolveSelector(untilKey)
        val containerKey = step["selector"] as? String
        val container = containerKey?.let { resolveSelector(it) }
        val direction = step["direction"] as? String ?: "down"
        val maxPasses = (step["maxScrollPasses"] as? Number)?.toInt() ?: 10
        onLog("step", "تمرير حتى يظهر · $untilKey", depth)
        val found = withContext(Dispatchers.IO) {
          service.scrollUntilElement(until, container, direction, maxPasses)
        }
        if (!found) throw StepFailure("لم يظهر العنصر بعد التمرير: $untilKey")
        onLog("success", "ظهر بعد التمرير · $untilKey", depth)
      }
      "readField" -> {
        val key = step["selector"] as String
        val saveAs = step["saveAs"] as String
        val sel = resolveSelector(key)
        val text = withContext(Dispatchers.IO) { service.readElementText(sel) } ?: ""
        scope[saveAs] = text
        onLog("step", "قراءة · $saveAs = \"$text\"", depth)
      }
      "readScreen" -> {
        val saveAs = step["saveAs"] as String
        onLog("step", "قراءة الشاشة الكاملة → $saveAs", depth)
        val snapshot = withContext(Dispatchers.IO) { service.readScreen() }
        scope[saveAs] = snapshot
        val texts = (snapshot["texts"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
        val nodes = (snapshot["nodes"] as? List<*>)?.size ?: 0
        onLog("success", "$nodes عنصر · ${texts.size} نص", depth)
        if (texts.isNotEmpty()) {
          onLog("info", "النصوص: ${truncate(texts.joinToString(" · "), 400)}", depth)
        }
      }
      "readScreenScrolling" -> {
        val saveAs = step["saveAs"] as String
        val untilKey = step["until"] as? String
        val until = untilKey?.let { resolveSelector(it) }
        val maxPasses = (step["maxScrollPasses"] as? Number)?.toInt() ?: 12
        onLog("step", "قراءة الشاشة مع التمرير → $saveAs", depth)
        val snapshot = withContext(Dispatchers.IO) { service.readScreenScrolling(until, maxPasses) }
        scope[saveAs] = snapshot
        val texts = (snapshot["texts"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
        val nodes = (snapshot["nodes"] as? List<*>)?.size ?: 0
        onLog("success", "$nodes عنصر · ${texts.size} نص (مع التمرير)", depth)
        if (texts.isNotEmpty()) {
          onLog("info", "النصوص: ${truncate(texts.joinToString(" · "), 400)}", depth)
        }
      }
      "extractList" -> {
        val listKey = step["listSelector"] as String
        val itemKey = step["itemSelector"] as String
        val maxScrollPasses = (step["maxScrollPasses"] as? Number)?.toInt() ?: 8
        val fieldsRaw = asMap(step["fields"])
        val fields = fieldsRaw.entries.associate { (k, v) ->
          k.toString() to resolveSelector(v.toString())
        }
        onLog("step", "استخراج قائمة · $itemKey", depth)
        val rows = withContext(Dispatchers.IO) {
          service.extractList(resolveSelector(listKey), resolveSelector(itemKey), fields, maxScrollPasses)
        }
        orders.addAll(rows)
        onLog("success", "استُخرج ${rows.size} عنصر", depth)
      }
      "back" -> {
        onLog("step", "زر الرجوع", depth)
        withContext(Dispatchers.IO) { service.pressBack() }
      }
      "if" -> {
        val condition = asMap(step["condition"])
        val varPath = condition["var"] as? String ?: ""
        val op = condition["op"] as? String ?: ""
        val expected = condition["value"]
        val passed = evalCondition(readPath(scope, varPath), op, expected)
        onLog("step", "شرط · $varPath ← ${if (passed) "تحقّق" else "لم يتحقّق"}", depth)
        val branch = if (passed) asList(step["then"]) else asList(step["else"])
        for (child in branch) runStep(asMap(child), depth + 1)
      }
      "sendRequest" -> {
        val endpoint = step["endpoint"] as? String ?: ""
        val bodyVar = step["body"] as? String
        val saveAs = step["saveAs"] as? String
        val fields = (step["fields"] as? List<*>)?.mapNotNull { it as? String }
        val body: Any? = if (bodyVar != null) {
          scope[bodyVar]
        } else {
          val orderPayload = if (fields != null) {
            orders.map { o -> fields.filter { o.containsKey(it) }.associateWith { o[it]!! } }
          } else orders
          mapOf("orders" to orderPayload, "vars" to scope)
        }
        onLog("step", "إرسال طلب · $endpoint${saveAs?.let { " → $it" } ?: ""}", depth)
        onLog("info", "البيانات: ${truncate(toJsonString(body), 300)}", depth)
        val response = postJson(endpoint, body)
        if (saveAs != null) scope[saveAs] = response
        onLog("info", "الردّ: ${truncate(toJsonString(response), 200)}", depth)
      }
      else -> onLog("error", "خطوة غير معروفة: $type", depth)
    }
  }

  /** Look up a selector by key; interpolate {{var}} then auto-scope to package. */
  private fun resolveSelector(key: String): PrimeAccessibilityService.Sel {
    val raw = selectorDefs[key] ?: throw StepFailure("المُحدِّد غير موجود: $key")
    val strategy = raw["strategy"] as? String ?: ""
    val rawValue = raw["value"] as? String ?: ""
    val value = if (rawValue.contains("{{")) interpolate(rawValue) else rawValue
    val match = raw["match"] as? String ?: "exact"
    var packageScope = raw["packageScope"] as? String ?: ""
    if (packageScope.isEmpty() && targetPackage.isNotEmpty() && strategy != "package") {
      packageScope = targetPackage
    }
    return PrimeAccessibilityService.Sel(strategy, value, match, packageScope)
  }

  /** Replace {{path}} tokens against the live scope (for forEach loops). */
  private fun interpolate(template: String): String =
    INTERP_REGEX.replace(template) { m -> readPath(scope, m.groupValues[1].trim())?.toString() ?: "" }

  /** Read `a.b.c` style paths. Returns null when any segment is missing. */
  private fun readPath(root: Map<String, Any?>, path: String): Any? {
    if (path.isEmpty()) return null
    val parts = path.split(".")
    var cursor: Any? = root[parts[0]]
    for (i in 1 until parts.size) {
      val map = cursor as? Map<*, *> ?: return null
      cursor = map[parts[i]]
    }
    return cursor
  }

  private fun evalCondition(value: Any?, op: String, expected: Any?): Boolean = when (op) {
    "isEmpty" -> value == null || value == "" || (value is List<*> && value.isEmpty())
    "notEmpty" -> !(value == null || value == "" || (value is List<*> && value.isEmpty()))
    "equals" -> value == expected
    "notEquals" -> value != expected
    else -> false
  }

  private suspend fun postJson(endpoint: String, body: Any?): Any? = withContext(Dispatchers.IO) {
    val request = resolveRequest(endpoint, body)
      ?: return@withContext mapOf(
        "status" to "received", "confirm" to false,
        "message" to "no-op (no endpoint/backend mapped)",
      )
    val (url, payload) = request
    try {
      val connection = URL(url).openConnection() as HttpURLConnection
      try {
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/json")
        connection.doOutput = true
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        connection.outputStream.use { it.write(toJsonString(payload).toByteArray(Charsets.UTF_8)) }
        val text = if (connection.responseCode in 200..299) {
          connection.inputStream.bufferedReader().use { it.readText() }
        } else {
          "{\"ok\":false,\"status\":${connection.responseCode}}"
        }
        parseJson(text)
      } finally {
        connection.disconnect()
      }
    } catch (e: Exception) {
      mapOf("ok" to false, "error" to (e.message ?: "unknown"))
    }
  }

  /**
   * Resolve a logical endpoint to a concrete (url, jsonBody) using the
   * backend config. Returns null when there's no backend or no mapping, so the
   * caller can fall back to a harmless no-op.
   */
  private fun resolveRequest(endpoint: String, body: Any?): Pair<String, Map<String, Any?>>? {
    val baseUrl = (backend["baseUrl"] as? String)?.trimEnd('/') ?: return null
    return when (endpoint) {
      "tayf.orders.create" -> {
        // The order webhook wants { platform, restaurant, raw_text } where
        // raw_text is the captured screen's text tokens joined by commas —
        // exactly the "Format B" the backend's Toters parser expects.
        val payload = mapOf(
          "platform" to (config["platform"] as? String ?: ""),
          "restaurant" to (backend["restaurant"] as? String ?: ""),
          "raw_text" to extractRawText(body),
        )
        Pair("$baseUrl/api/webhooks/", payload)
      }
      else -> null
    }
  }

  /** Build raw_text from a readScreen snapshot: comma-join its `texts`. */
  private fun extractRawText(body: Any?): String {
    if (body is Map<*, *>) {
      val texts = body["texts"] as? List<*>
      if (texts != null) return texts.filterIsInstance<String>().joinToString(",")
    }
    return body?.toString() ?: ""
  }

  // ---- JSON helpers (org.json is built into Android, no dependency needed) ----

  private fun toJsonString(value: Any?): String = toJsonNode(value).toString()

  private fun truncate(s: String, max: Int): String =
    if (s.length > max) s.substring(0, max) + "…" else s

  private fun toJsonNode(value: Any?): Any = when (value) {
    null -> JSONObject.NULL
    is Map<*, *> -> {
      val obj = JSONObject()
      for ((k, v) in value) obj.put(k.toString(), toJsonNode(v))
      obj
    }
    is List<*> -> {
      val arr = JSONArray()
      for (v in value) arr.put(toJsonNode(v))
      arr
    }
    is Number, is Boolean, is String -> value
    else -> value.toString()
  }

  private fun parseJson(text: String): Any? {
    val trimmed = text.trim()
    return try {
      when {
        trimmed.startsWith("{") -> jsonObjectToMap(JSONObject(trimmed))
        trimmed.startsWith("[") -> jsonArrayToList(JSONArray(trimmed))
        else -> trimmed
      }
    } catch (e: Exception) {
      text
    }
  }

  private fun jsonObjectToMap(obj: JSONObject): Map<String, Any?> {
    val result = LinkedHashMap<String, Any?>()
    val keys = obj.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      result[key] = jsonValueToKotlin(obj.get(key))
    }
    return result
  }

  private fun jsonArrayToList(arr: JSONArray): List<Any?> {
    val result = ArrayList<Any?>(arr.length())
    for (i in 0 until arr.length()) result.add(jsonValueToKotlin(arr.get(i)))
    return result
  }

  private fun jsonValueToKotlin(v: Any?): Any? = when (v) {
    is JSONObject -> jsonObjectToMap(v)
    is JSONArray -> jsonArrayToList(v)
    JSONObject.NULL -> null
    else -> v
  }

  @Suppress("UNCHECKED_CAST")
  private fun asMap(value: Any?): Map<String, Any?> = (value as? Map<String, Any?>) ?: emptyMap()

  private fun asList(value: Any?): List<Any?> = (value as? List<*>) ?: emptyList<Any?>()

  /** Thrown when a step cannot complete (missing selector, element not found). */
  class StepFailure(message: String) : Exception(message)

  companion object {
    private val INTERP_REGEX = Regex("""\{\{\s*([^}]+?)\s*\}\}""")

    private const val PAUSE_POLL_MS = 300L

    /** Steps that change the screen and therefore need the exclusive screen lock. */
    private val ACTION_STEPS = setOf(
      "launchApp", "tap", "tapInRow", "tapAt", "longPress", "doubleTap",
      "scroll", "scrollUntil", "readScreenScrolling", "swipe", "setText", "clearText",
      "back", "home", "recents", "openNotifications",
    )
  }
}
