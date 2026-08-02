package automation.prime.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Owns one [FlowInterpreter] coroutine per platform.
 *
 * It is the top of the native engine — JS calls in via PrimeNativeModule's
 * startEngine / stopEngine, and this dispatches to the right per-platform job.
 *
 * Each job emits log + state updates through the callbacks provided at
 * construction; the module forwards them to JS as `onEngineLog` /
 * `onEngineState` events. The runs are coroutines, not threads, so cancelling
 * a job propagates cleanly to every `delay` and `withContext` inside the
 * interpreter.
 */
class EngineRunner(
  private val onLog: (slug: String, level: String, message: String, depth: Int) -> Unit,
  private val onState: (slug: String, status: String, iteration: Int?, error: String?) -> Unit,
) {
  private val supervisor = SupervisorJob()
  private val scope = CoroutineScope(Dispatchers.Default + supervisor)
  private val jobs = mutableMapOf<String, Job>()
  /** Slugs currently paused — the interpreter idles between iterations while present. */
  private val pausedSlugs = ConcurrentHashMap.newKeySet<String>()

  /** Launch (or relaunch) the engine for the given platform config. */
  fun start(config: Map<String, Any?>) {
    val slug = config["platform"] as? String ?: return
    synchronized(jobs) {
      jobs[slug]?.cancel()
    }
    val job = scope.launch {
      onState(slug, "running", 0, null)
      try {
        val interpreter = FlowInterpreter(
          config,
          { level, message, depth -> onLog(slug, level, message, depth) },
          { iter -> onState(slug, "running", iter, null) },
          { pausedSlugs.contains(slug) },
        )
        interpreter.runLoop()
        onState(slug, "idle", null, null)
      } catch (e: CancellationException) {
        // Normal stop — the controller cancelled us.
        onState(slug, "idle", null, null)
      } catch (e: Exception) {
        onLog(slug, "error", "خطأ في المحرّك · ${e.message}", 0)
        onState(slug, "error", null, e.message)
      } finally {
        synchronized(jobs) { jobs.remove(slug) }
      }
    }
    synchronized(jobs) { jobs[slug] = job }
  }

  /** Cancel one platform's run. Idempotent. */
  fun stop(slug: String) {
    pausedSlugs.remove(slug)
    synchronized(jobs) { jobs[slug] }?.cancel()
  }

  /** Cancel every running platform. */
  fun stopAll() {
    pausedSlugs.clear()
    val toCancel = synchronized(jobs) { jobs.values.toList() }
    toCancel.forEach { it.cancel() }
  }

  /** Pause a running task between iterations (keeps the job alive). */
  fun pause(slug: String) {
    if (synchronized(jobs) { jobs.containsKey(slug) }) {
      pausedSlugs.add(slug)
      onState(slug, "paused", null, null)
    }
  }

  /** Resume a paused task. */
  fun resume(slug: String) {
    if (pausedSlugs.remove(slug)) {
      onState(slug, "running", null, null)
    }
  }

  /** Any platform currently running? */
  fun anyRunning(): Boolean = synchronized(jobs) { jobs.values.any { it.isActive } }
}
