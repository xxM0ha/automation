package automation.prime.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Restarts the engine's keep-alive foreground service after the device boots.
 *
 * Android kills app processes on shutdown, so once the phone reboots our
 * automation would silently stop until the user opens the app again. This
 * receiver listens for boot events and, *if the engine was running before the
 * reboot*, brings the [EngineForegroundService] back up so the keep-alive
 * notification (and the process that hosts it) is alive again.
 *
 * Important scope note: this receiver only revives the keep-alive service. It
 * does **not** itself re-run any per-platform automation flow. The actual
 * engine restart — picking up the persisted step-script config and resuming
 * each platform — is driven separately (by the JS layer once the app/headless
 * task spins up, or by a persisted-config restarter). Keeping that logic out of
 * here keeps the receiver dumb, fast, and safe to run in the BOOT_COMPLETED
 * window.
 *
 * Registration (manifest + RECEIVE_BOOT_COMPLETED permission) is handled by the
 * caller; this file intentionally does not touch the manifest.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        // QUICKBOOT_POWERON is emitted by some OEM "fast boot" implementations
        // that skip the standard BOOT_COMPLETED broadcast.
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        // Only resume if the engine was running when the device went down.
        if (!wasRunning(context)) return

        val serviceIntent = Intent(context, EngineForegroundService::class.java).apply {
            this.action = EngineForegroundService.ACTION_START
            putExtra(EngineForegroundService.EXTRA_LABEL, "محرّك الأتمتة يعمل")
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }

    private fun wasRunning(context: Context): Boolean {
        return context
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_ENGINE_WAS_RUNNING, false)
    }

    companion object {
        private const val PREFS_NAME = "prime_engine_prefs"
        private const val KEY_ENGINE_WAS_RUNNING = "engine_was_running"

        /**
         * Records whether the engine is currently running so that [BootReceiver]
         * knows whether to revive the keep-alive service after a reboot. Call
         * this from wherever the engine is started/stopped.
         */
        fun setWasRunning(context: Context, running: Boolean) {
            context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENGINE_WAS_RUNNING, running)
                .apply()
        }
    }
}
