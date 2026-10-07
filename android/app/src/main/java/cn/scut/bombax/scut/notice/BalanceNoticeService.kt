package cn.scut.bombax.scut.notice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import cn.scut.bombax.R
import cn.scut.bombax.scut.Diag
import java.util.Locale

/**
 * A persistent balance notification, and the process priority that comes with it.
 *
 * This is a deliberate departure from AGENTS.md's "no background Service": the user asked for
 * it on 2026-10-07 and it is opt-in, off by default, and does nothing on its own — it never
 * opens a socket, never talks to SCUT and never schedules a query. The refresh path stays the
 * WebView timer behind the plugin's single-thread executor. What the service provides is a
 * visible notification and a foreground process that the OEM task killer is less inclined to
 * reclaim, which is exactly the capability being measured.
 */
class BalanceNoticeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val data = NoticeData.of(intent)
        val notification = build(applicationContext, data)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        Diag.event("stage=notice result=shown updated=${data.updatedAtLabel}")
        return START_STICKY
    }

    override fun onDestroy() {
        NotificationManagerCompat.from(applicationContext).cancel(NOTIFICATION_ID)
        Diag.event("stage=notice result=removed")
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "bombax.balance"
        const val NOTIFICATION_ID = 0xB0

        const val EXTRA_ROOM = "room"
        const val EXTRA_ELECTRIC = "electric"
        const val EXTRA_WATER = "water"
        const val EXTRA_UNIT = "unit"
        const val EXTRA_UPDATED = "updated"

        fun intent(
            context: Context,
            room: String,
            electric: String,
            water: String,
            unit: String,
            updatedAt: String
        ): Intent = Intent(context, BalanceNoticeService::class.java).apply {
            putExtra(EXTRA_ROOM, room)
            putExtra(EXTRA_ELECTRIC, electric)
            putExtra(EXTRA_WATER, water)
            putExtra(EXTRA_UNIT, unit)
            putExtra(EXTRA_UPDATED, updatedAt)
        }

        fun createChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            // IMPORTANCE_LOW: visible, silent, no heads-up. A balance is not an alert.
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "余额", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "常驻显示宿舍电费与水费余额"
                    setShowBadge(false)
                }
            )
        }

        private fun build(context: Context, data: NoticeData): Notification {
            val launch = context.packageManager
                .getLaunchIntentForPackage(context.packageName)
                ?.let {
                    PendingIntent.getActivity(
                        context, 0, it,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                }
            // The school's own label for the number is "平台返回余额", which reads as noise in a
            // one-line notification; the figures speak for themselves.
            val text = "电 ${data.electric} · 水 ${data.water}"
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_balance)
                .setContentTitle(data.room.ifBlank { "宿舍余额" })
                .setContentText(text)
                .setSubText("更新 ${data.updatedAtLabel}")
                .setContentIntent(launch)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build()
        }
    }
}

/** The five display strings. Nothing here is a credential, and nothing here is a token. */
data class NoticeData(
    val room: String,
    val electric: String,
    val water: String,
    val unit: String,
    val updatedAtLabel: String
) {
    companion object {
        fun of(intent: Intent?): NoticeData = NoticeData(
            room = intent?.getStringExtra(BalanceNoticeService.EXTRA_ROOM).orEmpty(),
            electric = intent?.getStringExtra(BalanceNoticeService.EXTRA_ELECTRIC) ?: "—",
            water = intent?.getStringExtra(BalanceNoticeService.EXTRA_WATER) ?: "—",
            unit = intent?.getStringExtra(BalanceNoticeService.EXTRA_UNIT).orEmpty(),
            updatedAtLabel = intent?.getStringExtra(BalanceNoticeService.EXTRA_UPDATED) ?: "-"
        )
    }
}

/** Locale-independent number rendering for the notification line. */
fun formatNoticeNumber(value: Double?): String =
    if (value == null || value.isNaN()) "—" else String.format(Locale.CHINA, "%.2f", value)
