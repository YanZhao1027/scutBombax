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
import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.Diag
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.ScutRuntime
import cn.scut.bombax.scut.billing.BalanceReading
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The balance in the shade, and the one queue it is refreshed through.
 *
 * This is a deliberate departure from AGENTS.md's "no background Service", which the user asked for
 * on 2026-10-07 and extended on 2026-10-08 to a daily refresh: it is opt-in, off by default, and
 * one query per day per device. Everything SCUT-facing goes through [ScutRuntime], so the service
 * shares the WebView's client, cookies, session and — the part that matters — its single-threaded
 * executor. The service still never logs in: only a person with the password and a read of the
 * captcha image can do that.
 */
class BalanceNoticeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel(applicationContext)
        // Whatever the process was started for, the runtime is the same object the plugin uses,
        // and its first act is to make the Keystore-backed session readable again.
        ScutRuntime.get(applicationContext)
    }

    /**
     * Shows the notification, then refreshes if — and only if — the alarm asked for it.
     *
     * `startForeground` has to happen before anything slow, so the display always comes from the
     * intent (or from the cached copy) and never from the network.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The service is the authority on whether it is running: the plugin's flag and this one
        // are the same object, so a page that reloads after a process death sees the truth.
        ScutRuntime.get(applicationContext).noticeRunning = true
        val data = NoticeData.of(intent, applicationContext)
        show(data)
        if (intent?.action == ACTION_REFRESH) refresh()
        return START_STICKY
    }

    override fun onDestroy() {
        NotificationManagerCompat.from(applicationContext).cancel(NOTIFICATION_ID)
        ScutRuntime.get(applicationContext).noticeRunning = false
        Diag.event("stage=notice result=removed")
        super.onDestroy()
    }

    private fun show(data: NoticeData) {
        data.cache(applicationContext)
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
    }

    /**
     * One daily query, on the shared queue, with no login and no retry.
     *
     * The notification is the only output: fresh numbers replace the old line, and any failure
     * keeps the last known numbers with a short reason attached. That asymmetry is intentional — a
     * failed refresh must not make the shade look like the balance is unknown, because the previous
     * reading is still the best estimate the user has.
     */
    private fun refresh() {
        val runtime = ScutRuntime.get(applicationContext)
        val last = NoticeData.cached(applicationContext)
        try {
            runtime.io.execute {
                // Reading the session can mean reading the Keystore file, and the answer decides
                // everything below, so the whole check belongs on the queue rather than in
                // onStartCommand.
                if (runtime.session.peek() == null) {
                    show(last.asNeedsRelogin())
                    Diag.warn("stage=daily result=no-session")
                    return@execute
                }
                runCatching { runtime.billing().fetchBills() }
                    .onSuccess { reading ->
                        show(NoticeData.from(reading))
                        Diag.event("stage=daily result=ok")
                    }
                    .onFailure { failure ->
                        val code = (failure as? ScutException)?.error
                        show(last.asFailure(code))
                        Diag.warn("stage=daily result=failed reason=${code?.name ?: failure.javaClass.simpleName}")
                    }
            }
        } catch (rejected: java.util.concurrent.RejectedExecutionException) {
            show(last.asFailure(AppError.BUSY))
            Diag.warn("stage=daily result=failed reason=queue-closed")
        }
    }

    companion object {
        const val CHANNEL_ID = "bombax.balance"
        const val NOTIFICATION_ID = 0xB0

        const val ACTION_REFRESH = "cn.scut.bombax.action.REFRESH"

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

        /** The alarm's entry point: no payload, because the point is to go and get a new one. */
        fun refreshIntent(context: Context): Intent =
            Intent(context, BalanceNoticeService::class.java).apply { action = ACTION_REFRESH }

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
            val text = if (data.needsRelogin) "需要重新登录" else "电 ${data.electric} · 水 ${data.water}"
            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_balance)
                .setContentTitle(data.room.ifBlank { "宿舍余额" })
                .setContentText(text)
                .setSubText(data.line())
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

/**
 * The five display strings, plus the reason line the daily path adds.
 *
 * Nothing here is a credential and nothing here is a token — the whole point of passing display
 * strings instead of a `BalanceReading` is that the notification cannot accidentally show one.
 */
data class NoticeData(
    val room: String,
    val electric: String,
    val water: String,
    val unit: String,
    val updatedAtLabel: String,
    /** Shown as a suffix on the sub line: "", "刷新失败" or "需要重新登录". */
    val note: String = "",
    val needsRelogin: Boolean = false
) {
    fun line(): String = if (note.isBlank()) "更新 $updatedAtLabel" else "更新 $updatedAtLabel · $note"

    /**
     * A failed daily query.
     *
     * An auth-shaped failure replaces the numbers: a reading that can no longer be refreshed may
     * be days old, and a stale balance presented as current is worse than no balance. Everything
     * else — network, campus-network-only, upstream — keeps the last numbers, because they are
     * still the best estimate the user has.
     */
    fun asFailure(code: AppError?): NoticeData = when (code) {
        AppError.REAUTH_REQUIRED, AppError.NO_SESSION, AppError.INVALID_CREDENTIALS -> asNeedsRelogin()
        AppError.CAMPUS_NETWORK_REQUIRED -> copy(note = "需在校内网络")
        else -> copy(note = "刷新失败")
    }

    fun asNeedsRelogin(): NoticeData = copy(note = "需重新登录", needsRelogin = true)

    /** Written on every display so a process that starts with no payload still has a number to show. */
    fun cache(context: Context) {
        runCatching {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ROOM, room)
                .putString(KEY_ELECTRIC, electric)
                .putString(KEY_WATER, water)
                .putString(KEY_UNIT, unit)
                .putString(KEY_UPDATED, updatedAtLabel)
                .apply()
        }
    }

    companion object {
        const val PREFS = "bombax.notice.v1"
        private const val KEY_ROOM = "lastRoom"
        private const val KEY_ELECTRIC = "lastElectric"
        private const val KEY_WATER = "lastWater"
        private const val KEY_UNIT = "lastUnit"
        private const val KEY_UPDATED = "lastUpdated"

        private val TIME = SimpleDateFormat("HH:mm", Locale.getDefault())

        /**
         * Intent extras win, with one exception.
         *
         * "—" is this app's own placeholder, so a payload built from an empty result carries no
         * information: a page that starts its notice at boot before the first query must not wipe
         * the last real numbers off the shade. The cached copy wins in that case, and the intent
         * still wins whenever it has a number.
         */
        fun of(intent: Intent?, context: Context): NoticeData {
            val room = intent?.getStringExtra(BalanceNoticeService.EXTRA_ROOM).orEmpty()
            val electric = intent?.getStringExtra(BalanceNoticeService.EXTRA_ELECTRIC)
            val fromIntent = if (room.isNotBlank() || !electric.isNullOrEmpty()) {
                NoticeData(
                    room = room,
                    electric = electric ?: "—",
                    water = intent?.getStringExtra(BalanceNoticeService.EXTRA_WATER) ?: "—",
                    unit = intent?.getStringExtra(BalanceNoticeService.EXTRA_UNIT).orEmpty(),
                    updatedAtLabel = intent?.getStringExtra(BalanceNoticeService.EXTRA_UPDATED) ?: "-"
                )
            } else {
                cached(context)
            }
            val fromCache = cached(context)
            return if (fromIntent.electric == "—" && fromCache.electric != "—") fromCache else fromIntent
        }

        fun cached(context: Context): NoticeData {
            val prefs = runCatching {
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            }.getOrNull()
            return NoticeData(
                room = prefs?.getString(KEY_ROOM, "").orEmpty(),
                electric = prefs?.getString(KEY_ELECTRIC, "—").orEmpty().ifBlank { "—" },
                water = prefs?.getString(KEY_WATER, "—").orEmpty().ifBlank { "—" },
                unit = prefs?.getString(KEY_UNIT, "").orEmpty(),
                updatedAtLabel = prefs?.getString(KEY_UPDATED, "-").orEmpty().ifBlank { "-" }
            )
        }

        fun from(reading: BalanceReading): NoticeData = NoticeData(
            room = reading.room,
            electric = formatNoticeNumber(reading.electric),
            water = formatNoticeNumber(reading.water),
            unit = reading.electricText,
            updatedAtLabel = TIME.format(Date(reading.updatedAtMillis))
        )
    }
}

/** Locale-independent number rendering for the notification line. */
fun formatNoticeNumber(value: Double?): String =
    if (value == null || value.isNaN()) "—" else String.format(Locale.CHINA, "%.2f", value)
