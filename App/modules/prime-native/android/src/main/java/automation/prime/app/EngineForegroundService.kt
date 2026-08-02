package automation.prime.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * The "keep alive" service.
 *
 * Android will aggressively kill background processes; a foreground service
 * with a persistent notification opts out of that. The service itself does no
 * work — its only job is to keep the app process alive so the JS engine loop
 * running inside the React Native runtime is not collected.
 *
 * Started from JS via [PrimeNativeModule]'s `startEngineService`, stopped via
 * `stopEngineService`.
 */
class EngineForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Android requires startForeground() within ~5s of EVERY
    // startForegroundService() call — even when we're about to stop, and even if
    // a start/stop race delivers them out of order. Skipping it (the old stop
    // path did) crashes the app with "did not then call Service.startForeground()".
    // So always promote to the foreground first, then stop if that's the request.
    val label = intent?.getStringExtra(EXTRA_LABEL) ?: "محرّك Prime يعمل"
    ensureChannel()
    startForeground(NOTIFICATION_ID, buildNotification(label))

    if (intent?.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    // START_STICKY = the system tries to restart us if it kills us anyway.
    return START_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "محرّك الأتمتة",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "يبقى نشطاً ليحافظ على محرّك الأتمتة قيد التشغيل في الخلفية."
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification(label: String) =
    NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Prime Automation")
      .setContentText(label)
      .setSmallIcon(android.R.drawable.ic_menu_compass)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()

  companion object {
    const val ACTION_START = "automation.prime.app.action.START_ENGINE"
    const val ACTION_STOP = "automation.prime.app.action.STOP_ENGINE"
    const val EXTRA_LABEL = "label"
    private const val CHANNEL_ID = "prime_engine"
    private const val NOTIFICATION_ID = 1001
  }
}
