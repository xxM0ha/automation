package automation.prime.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS <-> Kotlin bridge. Exposes:
 *   - ping / startDemoTicker / stopDemoTicker — bridge sanity checks.
 *   - isAccessibilityEnabled / openAccessibilitySettings — service setup.
 *   - launchApp / waitForApp / waitForElement / tapElement / scrollElement /
 *     readElementText / readScreen / pressBack / extractList — primitives the
 *     JS dry-run executor calls one-by-one. Used by tests + diagnostics.
 *   - startEngine / stopEngine / stopAllEngines — control the Kotlin engine
 *     for production runs. The whole flow loop runs natively, so it survives
 *     Prime being backgrounded.
 *   - startEngineService / stopEngineService — the foreground notification
 *     that keeps the process from being killed.
 *   - configureDeviceLog / reportDeviceError — the device-side error log
 *     (see [DeviceLog]).
 *
 * Also relays:
 *   - onAccessibilityState  — accessibility service connect/disconnect
 *   - onEngineLog           — one log line from the native engine
 *   - onEngineState         — engine status changes (running / idle / error)
 */
class PrimeNativeModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var tickCount = 0
  private val ticker = object : Runnable {
    override fun run() {
      tickCount += 1
      sendEvent("onDemo", mapOf(
        "count" to tickCount,
        "timestamp" to System.currentTimeMillis()
      ))
      handler.postDelayed(this, INTERVAL_MS)
    }
  }

  /** The native engine, lazily created on module init. */
  private var engineRunner: EngineRunner? = null

  /** Emits the accessibility service state to JS. Called via the companion. */
  fun emitAccessibilityState(running: Boolean) {
    sendEvent("onAccessibilityState", mapOf("running" to running))
  }

  override fun definition() = ModuleDefinition {
    Name("PrimeNative")
    Events(
      "onDemo",
      "onAccessibilityState",
      "onEngineLog",
      "onEngineState",
    )

    OnCreate {
      current = this@PrimeNativeModule
      appContext.reactContext?.let { DeviceLog.init(it) }
      engineRunner = EngineRunner(
        onLog = { slug, level, message, depth ->
          // Every engine line feeds the device error log; an error line is
          // reported (with this trail + the screen) even if JS is asleep.
          DeviceLog.trail(slug, level, message, depth)
          if (level == "error") DeviceLog.report(slug, "flow", message)
          sendEvent("onEngineLog", mapOf(
            "platform" to slug,
            "level" to level,
            "message" to message,
            "depth" to depth,
            "timestamp" to System.currentTimeMillis(),
          ))
        },
        onState = { slug, status, iteration, error ->
          val payload = mutableMapOf<String, Any?>(
            "platform" to slug,
            "status" to status,
          )
          if (iteration != null) payload["iteration"] = iteration
          if (error != null) payload["error"] = error
          sendEvent("onEngineState", payload)
        },
      )
    }

    AsyncFunction("ping") {
      "pong from kotlin"
    }

    AsyncFunction("startDemoTicker") {
      handler.removeCallbacks(ticker)
      tickCount = 0
      handler.post(ticker)
    }

    AsyncFunction("stopDemoTicker") {
      handler.removeCallbacks(ticker)
    }

    AsyncFunction("isAccessibilityEnabled") {
      isServiceEnabled(appContext.reactContext)
    }

    AsyncFunction("openAccessibilitySettings") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // ---- engine primitives (used by the JS dry executor) ------------------

    AsyncFunction("launchApp") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.launchApp(PrimeAccessibilityService.Sel.from(selector).value)
    }

    AsyncFunction("waitForApp") { packageName: String, timeoutMs: Int ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.waitForApp(packageName, timeoutMs.toLong())
    }

    AsyncFunction("waitForElement") { selector: Map<String, Any?>, timeoutMs: Int ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.waitForElement(PrimeAccessibilityService.Sel.from(selector), timeoutMs.toLong())
    }

    AsyncFunction("tapElement") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.tapElement(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("scrollElement") { selector: Map<String, Any?>, direction: String ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.scrollElement(PrimeAccessibilityService.Sel.from(selector), direction)
    }

    AsyncFunction("scrollUntil") { params: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      val until = PrimeAccessibilityService.Sel.from(asMap(params["until"]))
      val containerRaw = params["container"]
      val container = if (containerRaw != null) {
        PrimeAccessibilityService.Sel.from(asMap(containerRaw))
      } else null
      val direction = params["direction"] as? String ?: "down"
      val maxPasses = (params["maxScrollPasses"] as? Number)?.toInt() ?: 10
      service.scrollUntilElement(until, container, direction, maxPasses)
    }

    AsyncFunction("readElementText") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction null
      service.readElementText(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("readScreen") {
      val service = PrimeAccessibilityService.instance
        ?: return@AsyncFunction mapOf<String, Any?>(
          "package" to null,
          "texts" to emptyList<String>(),
          "nodes" to emptyList<Map<String, Any?>>(),
        )
      service.readScreen()
    }

    AsyncFunction("pressBack") {
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.pressBack()
    }

    // Diagnostic: wait `delayMs` on a background thread (survives Prime being
    // backgrounded, unlike a JS timer), then snapshot whatever app is now in
    // the foreground. Lets you switch to a target screen and capture it.
    AsyncFunction("dumpForegroundAfter") { delayMs: Int ->
      Thread.sleep(delayMs.toLong())
      val service = PrimeAccessibilityService.instance
        ?: return@AsyncFunction mapOf<String, Any?>(
          "package" to null,
          "texts" to emptyList<String>(),
          "nodes" to emptyList<Map<String, Any?>>(),
        )
      service.readScreen()
    }

    AsyncFunction("extractList") { params: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance
        ?: return@AsyncFunction emptyList<Map<String, String>>()
      val listSel = PrimeAccessibilityService.Sel.from(asMap(params["list"]))
      val itemSel = PrimeAccessibilityService.Sel.from(asMap(params["item"]))
      val fields = asMap(params["fields"]).mapValues { (_, value) ->
        PrimeAccessibilityService.Sel.from(asMap(value))
      }
      val maxScrollPasses = (params["maxScrollPasses"] as? Number)?.toInt() ?: 8
      service.extractList(listSel, itemSel, fields, maxScrollPasses)
    }

    AsyncFunction("tapInRow") { params: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      val anchor = PrimeAccessibilityService.Sel.from(asMap(params["anchor"]))
      val target = PrimeAccessibilityService.Sel.from(asMap(params["target"]))
      service.tapInRow(anchor, target)
    }

    AsyncFunction("tapAt") { x: Double, y: Double ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.tapAt(x, y)
    }

    AsyncFunction("longPress") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.longPress(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("doubleTap") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.doubleTap(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("swipe") { params: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      val direction = params["direction"] as? String ?: "down"
      val selRaw = params["selector"]
      val sel = if (selRaw != null) PrimeAccessibilityService.Sel.from(asMap(selRaw)) else null
      service.swipe(direction, sel)
    }

    AsyncFunction("setText") { selector: Map<String, Any?>, text: String ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.setText(PrimeAccessibilityService.Sel.from(selector), text)
    }

    AsyncFunction("clearText") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.clearText(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("exists") { selector: Map<String, Any?> ->
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.exists(PrimeAccessibilityService.Sel.from(selector))
    }

    AsyncFunction("pressHome") {
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.pressHome()
    }

    AsyncFunction("pressRecents") {
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.pressRecents()
    }

    AsyncFunction("openNotifications") {
      val service = PrimeAccessibilityService.instance ?: return@AsyncFunction false
      service.openNotifications()
    }

    // ---- native engine (the production runner) ----------------------------

    AsyncFunction("startEngine") { config: Map<String, Any?> ->
      // Re-enable accessibility if it was killed (watchdog) and record running
      // state so BootReceiver resumes the keep-alive service after a reboot.
      appContext.reactContext?.let {
        Watchdog.ensureAccessibilityEnabled(it)
        BootReceiver.setWasRunning(it, true)
      }
      engineRunner?.start(config)
    }

    AsyncFunction("stopEngine") { platform: String ->
      engineRunner?.stop(platform)
      if (engineRunner?.anyRunning() != true) {
        appContext.reactContext?.let { BootReceiver.setWasRunning(it, false) }
      }
    }

    AsyncFunction("stopAllEngines") {
      engineRunner?.stopAll()
      appContext.reactContext?.let { BootReceiver.setWasRunning(it, false) }
    }

    AsyncFunction("pauseEngine") { platform: String ->
      engineRunner?.pause(platform)
    }

    AsyncFunction("resumeEngine") { platform: String ->
      engineRunner?.resume(platform)
    }

    // ---- device error log --------------------------------------------------

    // Where device-side errors are uploaded. Called on login (and with nulls
    // on logout); queued reports are flushed as soon as it is set.
    AsyncFunction("configureDeviceLog") { baseUrl: String?, token: String? ->
      DeviceLog.configure(appContext.reactContext, baseUrl, token)
    }

    // Report an error that happened in JS (FCM, config fetch, an uncaught
    // exception) through the same queue as the native engine's errors.
    AsyncFunction("reportDeviceError") { platform: String, kind: String, message: String ->
      appContext.reactContext?.let { DeviceLog.init(it) }
      DeviceLog.report(platform, kind, message, captureScreen = false)
    }

    // ---- foreground service (keep the engine process alive) ---------------

    AsyncFunction("startEngineService") { label: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val intent = Intent(context, EngineForegroundService::class.java).apply {
        action = EngineForegroundService.ACTION_START
        putExtra(EngineForegroundService.EXTRA_LABEL, label)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    AsyncFunction("stopEngineService") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val intent = Intent(context, EngineForegroundService::class.java).apply {
        action = EngineForegroundService.ACTION_STOP
      }
      context.startService(intent)
    }

    OnDestroy {
      handler.removeCallbacks(ticker)
      engineRunner?.stopAll()
      engineRunner = null
      if (current === this@PrimeNativeModule) current = null
    }
  }

  companion object {
    private const val INTERVAL_MS = 2000L

    /** The live module instance, used to relay events from the service. */
    @Volatile
    private var current: PrimeNativeModule? = null

    /** Called by [PrimeAccessibilityService] when it connects or disconnects. */
    fun notifyAccessibilityState(running: Boolean) {
      current?.emitAccessibilityState(running)
    }

    /** True if our accessibility service is enabled in Settings.Secure. */
    private fun isServiceEnabled(context: Context?): Boolean {
      context ?: return false
      val component = ComponentName(context, PrimeAccessibilityService::class.java)
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == component }
    }
  }
}

@Suppress("UNCHECKED_CAST")
private fun asMap(value: Any?): Map<String, Any?> =
  (value as? Map<String, Any?>) ?: emptyMap()
