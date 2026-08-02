package automation.prime.app

import android.content.ComponentName
import android.content.Context
import android.provider.Settings

/**
 * Self-heals our accessibility service when Android disables it.
 *
 * Android occasionally turns off accessibility services (after updates, OEM
 * battery optimizations, or "security" sweeps), which silently breaks our
 * automation. [Watchdog] can flip the service back on by editing the secure
 * settings list of enabled accessibility services directly.
 *
 * That write requires [android.Manifest.permission.WRITE_SECURE_SETTINGS],
 * which is a signature/system permission a normal app cannot request at
 * runtime. It must be granted once, manually, over ADB:
 *
 * ```
 * adb shell pm grant automation.prime.app android.permission.WRITE_SECURE_SETTINGS
 * ```
 *
 * If that grant is absent the write throws [SecurityException]; every operation
 * here is wrapped in try/catch so the watchdog degrades to a harmless no-op
 * (returns false) rather than crashing.
 */
object Watchdog {

    /**
     * Ensures our accessibility service is enabled.
     *
     * - If the service is already connected, returns true immediately.
     * - Otherwise it appends our component to the system's list of enabled
     *   accessibility services and flips the global accessibility flag on.
     *
     * @return true if our service is (or is now) present in the enabled list,
     *         false if the permission is missing or any error occurs.
     */
    fun ensureAccessibilityEnabled(context: Context): Boolean {
        // Fast path: the service is live, nothing to do.
        if (PrimeAccessibilityService.isConnected) return true

        return try {
            val cr = context.contentResolver
            val ourComponent = ComponentName(
                context,
                PrimeAccessibilityService::class.java
            ).flattenToString()

            val enabled = Settings.Secure.getString(
                cr,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""

            // Settings stores enabled services as a colon-separated list.
            val components = enabled
                .split(':')
                .filter { it.isNotEmpty() }

            val alreadyPresent = components.any { it == ourComponent }

            if (!alreadyPresent) {
                val updated = if (enabled.isEmpty()) {
                    ourComponent
                } else {
                    "$enabled:$ourComponent"
                }
                Settings.Secure.putString(
                    cr,
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                    updated
                )
            }

            // Make sure the master accessibility switch is on too; enabling a
            // service while this flag is "0" leaves it inert.
            Settings.Secure.putString(
                cr,
                Settings.Secure.ACCESSIBILITY_ENABLED,
                "1"
            )

            true
        } catch (e: SecurityException) {
            // WRITE_SECURE_SETTINGS not granted — expected when the ADB grant
            // step has not been run. No-op.
            false
        } catch (e: Exception) {
            // Any other failure (e.g. settings provider quirk) — stay harmless.
            false
        }
    }
}
