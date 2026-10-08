package cn.scut.bombax.scut.notice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import cn.scut.bombax.scut.Diag
import java.util.Calendar
import java.util.TimeZone

/**
 * The schedule maths, with no Android in it.
 *
 * The nightly snapshot fires at **23:00 Beijing time**, not "24 hours after the last one". The
 * change was made on 2026-10-08 when the feature's purpose became a daily *sample* rather than a
 * keep-alive: a series only means something if the points are comparable, and an interval
 * schedule drifts to whatever time of day the user happened to switch it on. A wall-clock slot
 * also removes the drift problem by construction — a delivery that arrives 45 s late is simply
 * followed by tomorrow's 23:00, no anchor bookkeeping required.
 *
 * `java.time` is API 26 and this app supports 24, so this uses `Calendar` with an explicit
 * [TimeZone] rather than enabling desugaring for one calculation.
 */
object DailySchedule {

    /** The planned sampling hour and minute, in [BEIJING]. */
    const val SNAPSHOT_HOUR = 23
    const val SNAPSHOT_MINUTE = 0

    /**
     * The dormitory is in Guangzhou, so the sampling slot is defined against that clock rather
     * than the device's: a phone that travels, or a ROM with a mis-set default zone, must not
     * move the sample an hour away from the network's own daily rhythm.
     */
    val BEIJING: TimeZone = TimeZone.getTimeZone("Asia/Shanghai")

    /** One calendar day in a zone with no DST transitions, which is what [BEIJING] is. */
    const val DAY_MS = 24 * 60 * 60 * 1000L

    /**
     * The next 23:00 in Beijing time, strictly after [now].
     *
     * Nothing here catches up. If the phone was off, in a pocket, or Dozing through the slot, the
     * answer is tomorrow's 23:00 — a missed sample is a gap in the series, and the series is
     * better off honest than dense. This is also what keeps the school at one request a day:
     * there is no code path in which several overdue samples turn into several queries.
     */
    fun nextSnapshotAt(
        now: Long,
        hour: Int = SNAPSHOT_HOUR,
        minute: Int = SNAPSHOT_MINUTE
    ): Long {
        val calendar = Calendar.getInstance(BEIJING).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        // `<=` and not `<`: an alarm armed for "now" fires immediately, which would let an app
        // open at exactly 23:00:00 spend a query the slot has already spent.
        if (calendar.timeInMillis <= now) calendar.add(Calendar.DAY_OF_YEAR, 1)
        return calendar.timeInMillis
    }

    /** Whole seconds between [now] and [triggerAt], never negative; for display only. */
    fun secondsUntil(now: Long, triggerAt: Long): Long =
        if (triggerAt <= now) 0L else (triggerAt - now) / 1000L
}

/**
 * The inexact daily alarm that asks the notification service for one refresh.
 *
 * Deliberately *not* an exact alarm: `SCHEDULE_EXACT_ALARM` is not granted by default to an app
 * like this on Android 14+, and a balance is not an appointment. The cost is measured and
 * documented in docs/DEVICE_VERIFICATION.md §13 — an inexact alarm does not, on its own, exempt a
 * background foreground-service start on Android 12+, which is why [startRefresh] has a fallback
 * and why this whole path only exists while the persistent notice is keeping the process up.
 */
object DailyRefresh {

    const val ACTION_DAILY = "cn.scut.bombax.action.DAILY_REFRESH"
    const val EXTRA_TRIGGER_AT = "triggerAt"

    const val PREFS = "bombax.notice.v1"
    const val KEY_ENABLED = "dailyEnabled"

    private const val REQUEST_CODE = 0xD41

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun alarmManager(context: Context): AlarmManager? =
        context.applicationContext.getSystemService(AlarmManager::class.java)

    fun isEnabled(context: Context): Boolean =
        runCatching { prefs(context).getBoolean(KEY_ENABLED, false) }.getOrDefault(false)

    /**
     * Switches the nightly snapshot on and arms the first alarm.
     *
     * The switch is meaningless without the persistent notice — that service is what keeps this
     * process alive long enough to be allowed to do anything at all — but the caller is the page,
     * and the page is what enforces the pairing.
     */
    fun enable(context: Context, now: Long): Long {
        runCatching { prefs(context).edit().putBoolean(KEY_ENABLED, true).apply() }
        return arm(context, now)
    }

    fun disable(context: Context) {
        runCatching { prefs(context).edit().putBoolean(KEY_ENABLED, false).apply() }
        cancel(context)
        Diag.event("stage=daily result=disabled")
    }

    /**
     * (Re)arms the next alarm. Safe to call on every app start: an alarm is a one-shot, does not
     * survive a reboot, and this is how the schedule comes back after either.
     *
     * Because the slot is a wall-clock time rather than an interval, recomputing it is idempotent
     * — an app open that finds tomorrow's alarm already pending arms the identical instant, and no
     * stored anchor is needed to make that true.
     */
    fun armIfEnabled(context: Context, now: Long): Long =
        if (isEnabled(context)) arm(context, now) else 0L

    /** When the pending alarm is due, for the UI only. 0 while the switch is off. */
    fun nextDue(context: Context, now: Long): Long =
        if (!isEnabled(context)) 0L else DailySchedule.nextSnapshotAt(now)

    private fun arm(context: Context, now: Long): Long {
        val next = DailySchedule.nextSnapshotAt(now)
        val manager = alarmManager(context) ?: run {
            Diag.warn("stage=daily result=unavailable reason=no-alarm-manager")
            return 0L
        }
        val pending = pendingIntent(context, next)
        return runCatching {
            // Cancel first: setAndAllowWhileIdle with an identical PendingIntent is documented to
            // replace the alarm, but "identical" is not something worth trusting with cadence.
            manager.cancel(pending)
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            Diag.event(
                "stage=daily result=armed dueInSec=${DailySchedule.secondsUntil(now, next)} api=${Build.VERSION.SDK_INT}"
            )
            next
        }.getOrElse { failure ->
            Diag.warn("stage=daily result=arm-failed reason=${failure.javaClass.simpleName}")
            0L
        }
    }

    private fun cancel(context: Context) {
        runCatching { alarmManager(context)?.cancel(pendingIntent(context, 0L)) }
    }

    private fun pendingIntent(context: Context, triggerAt: Long): PendingIntent {
        val intent = Intent(context, DailyAlarmReceiver::class.java).apply {
            action = ACTION_DAILY
            putExtra(EXTRA_TRIGGER_AT, triggerAt)
        }
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * Hands the fired alarm to the service.
     *
     * The start rules — and the reason a fallback exists at all — live in
     * [BalanceNoticeService.start], because the page's own switch needs exactly the same
     * behaviour. Both paths failing is the OEM-kill case, and it is logged as such instead of
     * being retried.
     */
    fun startRefresh(context: Context): String =
        BalanceNoticeService.start(context, BalanceNoticeService.refreshIntent(context))

    /**
     * Called by the receiver: re-arm first, then start the work.
     *
     * Arming before the query means a service that gets killed mid-flight still leaves tomorrow's
     * alarm behind; the cost of the ordering is one skipped sample at worst, and the alternative is
     * a schedule that stops forever after a single crash. Recomputing from `now` is what keeps the
     * slot at 23:00 regardless of how late the delivery was.
     */
    fun onFired(context: Context, now: Long): Long =
        if (isEnabled(context)) arm(context, now) else 0L
}
