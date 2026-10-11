package automation.prime.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.util.concurrent.ConcurrentHashMap

/**
 * A priority-aware lock over the single shared screen.
 *
 * Only ONE task may *act* (tap / scroll / type) at a time, because there is
 * one screen. Watching/reading never acquires the lock, so any number of tasks
 * can observe concurrently — they only serialize during their brief action
 * phases.
 *
 * Acquisition is cooperative and priority-ordered: a waiter only takes the lock
 * when it is free AND no higher-priority task is waiting. Combined with the
 * interpreter releasing the lock at each iteration boundary, this yields
 * "finish the current order, then yield to the higher-priority task."
 */
object ScreenLock {
  private val gate = Any()

  @Volatile
  private var holder: String? = null

  /** token -> priority, for everyone currently waiting to acquire. */
  private val waiters = ConcurrentHashMap<String, Int>()

  /**
   * Counts every successful [acquire], by any task. A task that gave the screen
   * up to watch compares this with the value it saw then: if it moved, some
   * other task used the screen in between.
   */
  @Volatile
  var acquisitions: Long = 0L
    private set

  /** True while some task holds the screen for an action phase. */
  val isHeld: Boolean
    get() = holder != null

  /**
   * Suspends until this token may hold the lock. `shouldAbort` is polled so a
   * cancelled/stopped task stops waiting promptly.
   */
  suspend fun acquire(token: String, priority: Int, shouldAbort: () -> Boolean) {
    waiters[token] = priority
    try {
      while (true) {
        if (shouldAbort()) throw CancellationException("screen lock wait aborted")
        var acquired = false
        synchronized(gate) {
          val highestWaiting = waiters.values.maxOrNull() ?: priority
          if (holder == null && priority >= highestWaiting) {
            holder = token
            acquisitions += 1
            waiters.remove(token)
            acquired = true
          }
        }
        if (acquired) return
        delay(POLL_MS)
      }
    } catch (t: Throwable) {
      waiters.remove(token)
      throw t
    }
  }

  /** Release the lock if this token holds it. Safe to call unconditionally. */
  fun release(token: String) {
    synchronized(gate) {
      if (holder == token) holder = null
    }
  }

  private const val POLL_MS = 100L
}
