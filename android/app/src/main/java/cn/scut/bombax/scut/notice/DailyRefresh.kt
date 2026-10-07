package cn.scut.bombax.scut.notice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import cn.scut.bombax.scut.Diag

/**
 * The cadence maths, with no Android in it.
 *
 * One day is the interval the user agreed to on 2026-10-08 ("每天可以吧"), after I argued against
 * the 5-minute background polling the WebView timer wanted. A daily query is a request a school
 * billing page can be reasonably expected to serve once per account, and a missed one is caught
 * up by the next start rather than retried in a loop.
 */
object DailySchedule {

    const val INTERVAL_MS = 24 * 60 * 60 * 1000L

    /** Never arm "in the past": the system would fire immediately, and a burst is what we fixed in §12. */
    const val MIN_DELAY_MS = 60_000L

    /**
     * @param now current wall clock, epoch millis
     * @param anchor the scheduled time of the fire this one follows (0 when never fired)
     * @return when to wake next, at least [MIN_DELAY_MS] after [now]
     *
     * Anchoring on the *scheduled* time instead of the actual fire time is what makes the
     * cadence self-correcting: `setAndAllowWhileIdle` may deliver hours late out of Doze, and
     * anchoring on the delivery time would push the refresh later every single day.
     */
    fun nextTriggerAt(
        now: Long,
        anchor: Long,
        intervalMs: Long = INTERVAL_MS,
        minDelayMs: Long = MIN_DELAY_MS
    ): Long {
        if (anchor <= 0L) return now + intervalMs
        val due = anchor + intervalMs
        return if (due <= now) now + minDelayMs else due
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

    /**
     * The reference point the next wake is measured from: the scheduled time of the last fire, or
     * the moment the switch was turned on. Storing the *anchor* rather than the next alarm time is
     * what makes [armIfEnabled] idempotent — re-arming after an app start computes the very same
     * instant as the alarm that is already pending, instead of pushing it a day further out.
     */
    const val KEY_ANCHOR = "dailyAnchor"

    private const val REQUEST_CODE = 0xD41

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun alarmManager(context: Context): AlarmManager? =
        context.applicationContext.getSystemService(AlarmManager::class.java)

    fun isEnabled(context: Context): Boolean =
        runCatching { prefs(context).getBoolean(KEY_ENABLED, false) }.getOrDefault(false)

    fun anchor(context: Context): Long =
        runCatching { prefs(context).getLong(KEY_ANCHOR, 0L) }.getOrDefault(0L)

    /**
     * Switches the daily refresh on and arms the first alarm.
     *
     * The switch is meaningless without the persistent notice — that service is what keeps this
     * process alive long enough to be allowed to do anything at all — but the caller is the page,
     * and the page is what enforces the pairing.
     */
    fun enable(context: Context, now: Long): Long {
        runCatching { prefs(context).edit().putBoolean(KEY_ENABLED, true).putLong(KEY_ANCHOR, now).apply() }
        return arm(context, now, now)
    }

    fun disable(context: Context) {
        runCatching {
            prefs(context).edit().putBoolean(KEY_ENABLED, false).remove(KEY_ANCHOR).apply()
        }
        cancel(context)
        Diag.event("stage=daily result=disabled")
    }

    /**
     * (Re)arms the next alarm. Safe to call on every app start: an alarm is a one-shot, does not
     * survive a reboot, and this is how the cadence comes back after either. Computed from the
     * stored anchor, so an app start that finds a pending alarm re-arms the identical instant.
     */
    fun armIfEnabled(context: Context, now: Long): Long {
        if (!isEnabled(context)) return 0L
        val anchor = anchor(context)
        // A reboot or a killed process swallowed the alarm; the stored anchor tells us how stale
        // the last number on the shade is. `nextTriggerAt` turns an overdue anchor into one prompt
        // catch-up query, not a retry loop.
        return arm(context, now, if (anchor > 0L) anchor else now)
    }

    /** When the pending alarm is due, for the UI only. 0 while the switch is off. */
    fun nextDue(context: Context, now: Long): Long =
        if (!isEnabled(context)) 0L
        else DailySchedule.nextTriggerAt(now, anchor(context).let { if (it > 0L) it else now })

    private fun arm(context: Context, now: Long, anchor: Long): Long {
        val next = DailySchedule.nextTriggerAt(now, anchor)
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
     * `startForegroundService` is the first choice, and the fallback matters more than it looks:
     * Android 12+ throws `ForegroundServiceStartNotAllowedException` for an alarm that was not set
     * exact, while the *same already-running* notice service accepts a plain `startService`
     * because the process is not in the restricted state any more. Both failing is the OEM-killer
     * case, and it is logged as such instead of being retried.
     */
    fun startRefresh(context: Context): String {
        val app = context.applicationContext
        val intent = BalanceNoticeService.refreshIntent(app)
        return runCatching {
            ContextCompat.startForegroundService(app, intent)
            "foreground-service"
        }.recoverCatching {
            app.startService(intent)
            "service"
        }.getOrElse { failure ->
            Diag.warn("stage=daily result=start-refused reason=${failure.javaClass.simpleName}")
            "refused"
        }
    }

    /**
     * Called by the receiver: re-arm first, then start the work.
     *
     * Arming before the query means a service that gets killed mid-flight still leaves a next
     * alarm behind; the cost of the ordering is one skipped day at worst, and the alternative is a
     * cadence that stops forever after a single crash.
     */
    fun onFired(context: Context, scheduledAt: Long, now: Long): Long {
        if (!isEnabled(context)) return 0L
        val anchor = if (scheduledAt > 0L) scheduledAt else now
        runCatching { prefs(context).edit().putLong(KEY_ANCHOR, anchor).apply() }
        return arm(context, now, anchor)
    }
}
