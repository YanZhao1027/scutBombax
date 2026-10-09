package cn.scut.bombax.scut.notice

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import cn.scut.bombax.scut.Diag
import java.util.Calendar
import java.util.TimeZone

/**
 * Pure calendar arithmetic. A configured Beijing wall-clock time, not 24 h after the last query.
 * No java.time / desugaring: minSdk 24.
 */
object DailySchedule {
    const val DEFAULT_HOUR = 23
    const val DEFAULT_MINUTE = 0
    const val TEST_DELAY_MS = 5 * 60 * 1000L
    val BEIJING: TimeZone = TimeZone.getTimeZone("Asia/Shanghai")
    const val DAY_MS = 24 * 60 * 60 * 1000L

    fun validTime(hour: Int, minute: Int): Boolean = hour in 0..23 && minute in 0..59

    /** Always strictly in the future. Missed calendar slots are never made up. */
    fun nextSnapshotAt(
        now: Long,
        hour: Int = DEFAULT_HOUR,
        minute: Int = DEFAULT_MINUTE
    ): Long {
        require(validTime(hour, minute)) { "Invalid Beijing snapshot clock time" }
        val calendar = Calendar.getInstance(BEIJING).apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (calendar.timeInMillis <= now) calendar.add(Calendar.DAY_OF_YEAR, 1)
        return calendar.timeInMillis
    }

    /** Whole seconds for display only; an inexact alarm has no minute-level guarantee. */
    fun secondsUntil(now: Long, triggerAt: Long): Long =
        if (triggerAt <= now) 0L else (triggerAt - now) / 1000L
}

/**
 * User-configurable daily sample plus an explicitly requested, separate one-shot QA sample.
 * Both are inexact, go through the same service and ScutRuntime, and never retry.
 */
object DailyRefresh {
    const val ACTION_DAILY = "cn.scut.bombax.action.DAILY_REFRESH"
    const val ACTION_TEST = "cn.scut.bombax.action.SNAPSHOT_TEST"
    const val EXTRA_TRIGGER_AT = "triggerAt"

    const val PREFS = "bombax.notice.v1"
    const val KEY_ENABLED = "dailyEnabled"
    const val KEY_HOUR = "dailyHour"
    const val KEY_MINUTE = "dailyMinute"
    private const val KEY_TEST_DUE = "snapshotTestDueAt"
    private const val KEY_DAILY_DUE = "snapshotDailyDueAt"

    private const val DAILY_REQUEST_CODE = 0xD41
    private const val TEST_REQUEST_CODE = 0xD42

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun alarmManager(context: Context): AlarmManager? =
        context.applicationContext.getSystemService(AlarmManager::class.java)

    fun isEnabled(context: Context): Boolean =
        runCatching { prefs(context).getBoolean(KEY_ENABLED, false) }.getOrDefault(false)

    /** Old installs default to 23:00 until the user changes it. The setting is native-owned. */
    fun selectedTime(context: Context): Pair<Int, Int> {
        val p = prefs(context)
        val hour = p.getInt(KEY_HOUR, DailySchedule.DEFAULT_HOUR)
        val minute = p.getInt(KEY_MINUTE, DailySchedule.DEFAULT_MINUTE)
        return if (DailySchedule.validTime(hour, minute)) hour to minute
        else DailySchedule.DEFAULT_HOUR to DailySchedule.DEFAULT_MINUTE
    }

    /** Changing the time replaces only the daily alarm, not the independent test alarm. */
    fun setTime(context: Context, now: Long, hour: Int, minute: Int): Long {
        require(DailySchedule.validTime(hour, minute)) { "Invalid snapshot time" }
        val previous = selectedTime(context)
        val settings = prefs(context)
        if (!settings.edit().putInt(KEY_HOUR, hour).putInt(KEY_MINUTE, minute).commit()) return -1L
        if (!isEnabled(context)) return 0L
        val armed = arm(context, now)
        if (armed != 0L) return armed
        // If Android refused scheduling, do not leave UI claiming the new time is armed.
        settings.edit().putInt(KEY_HOUR, previous.first)
            .putInt(KEY_MINUTE, previous.second).commit()
        arm(context, now)
        return -1L
    }

    fun enable(context: Context, now: Long): Long {
        if (!prefs(context).edit().putBoolean(KEY_ENABLED, true).commit()) return 0L
        val armed = arm(context, now)
        if (armed == 0L) {
            prefs(context).edit().putBoolean(KEY_ENABLED, false).commit()
            cancelDaily(context)
        }
        return armed
    }

    fun disable(context: Context) {
        prefs(context).edit().putBoolean(KEY_ENABLED, false).commit()
        cancelDaily(context)
        Diag.event("stage=daily result=disabled")
    }

    /** App reopening is allowed to rearm the DAILY schedule, never to catch up past slots. */
    fun armIfEnabled(context: Context, now: Long): Long =
        if (isEnabled(context)) arm(context, now) else 0L

    fun nextDue(context: Context, now: Long): Long {
        if (!isEnabled(context)) return 0L
        // A delayed, inexact alarm can still be pending AFTER its nominal slot.
        // Keep reporting that original due time until the receiver actually re-arms.
        val armedAt = prefs(context).getLong(KEY_DAILY_DUE, 0L)
        if (armedAt > 0L) return armedAt
        val (hour, minute) = selectedTime(context)
        return DailySchedule.nextSnapshotAt(now, hour, minute)
    }

    private fun arm(context: Context, now: Long): Long {
        val (hour, minute) = selectedTime(context)
        val next = DailySchedule.nextSnapshotAt(now, hour, minute)
        val manager = alarmManager(context) ?: run {
            Diag.warn("stage=daily result=unavailable reason=no-alarm-manager")
            return 0L
        }
        val pending = pendingIntent(context, ACTION_DAILY, DAILY_REQUEST_CODE, next)
        return runCatching {
            manager.cancel(pending)
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            prefs(context).edit().putLong(KEY_DAILY_DUE, next).apply()
            Diag.event(
                "stage=daily result=armed dueInSec=${DailySchedule.secondsUntil(now, next)} " +
                    "hour=$hour minute=$minute api=${Build.VERSION.SDK_INT}"
            )
            next
        }.getOrElse { failure ->
            Diag.warn("stage=daily result=arm-failed reason=${failure.javaClass.simpleName}")
            0L
        }
    }

    private fun cancelDaily(context: Context) {
        prefs(context).edit().remove(KEY_DAILY_DUE).apply()
        runCatching { alarmManager(context)?.cancel(pendingIntent(context, ACTION_DAILY, DAILY_REQUEST_CODE, 0L)) }
    }

    /**
     * A one-off, opt-in, inexact QA alarm. A second tap cannot create another query while one is
     * pending. The setting and PendingIntent are separate from the daily schedule.
     */
    @Synchronized
    fun scheduleTest(context: Context, now: Long): Long {
        val previous = testDue(context)
        if (previous > 0L) return previous
        val manager = alarmManager(context) ?: return 0L
        val at = now + DailySchedule.TEST_DELAY_MS
        if (!prefs(context).edit().putLong(KEY_TEST_DUE, at).commit()) return 0L
        val pending = pendingIntent(context, ACTION_TEST, TEST_REQUEST_CODE, at)
        val armed = runCatching {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            Diag.event("stage=snapshotTest result=armed dueInSec=${DailySchedule.secondsUntil(now, at)}")
            true
        }.getOrElse { failure ->
            Diag.warn("stage=snapshotTest result=arm-failed reason=${failure.javaClass.simpleName}")
            false
        }
        if (armed) return at
        prefs(context).edit().remove(KEY_TEST_DUE).commit()
        runCatching { manager.cancel(pending) }
        return 0L
    }

    fun testDue(context: Context): Long = prefs(context).getLong(KEY_TEST_DUE, 0L)

    @Synchronized
    fun consumeTest(context: Context, scheduledAt: Long): Boolean {
        if (scheduledAt <= 0L || scheduledAt != testDue(context)) return false
        return prefs(context).edit().remove(KEY_TEST_DUE).commit()
    }

    @Synchronized
    fun cancelTest(context: Context) {
        prefs(context).edit().remove(KEY_TEST_DUE).commit()
        runCatching { alarmManager(context)?.cancel(pendingIntent(context, ACTION_TEST, TEST_REQUEST_CODE, 0L)) }
        Diag.event("stage=snapshotTest result=cancelled")
    }

    private fun pendingIntent(context: Context, actionName: String, code: Int, triggerAt: Long): PendingIntent {
        val intent = Intent(context, DailyAlarmReceiver::class.java).apply {
            action = actionName
            putExtra(EXTRA_TRIGGER_AT, triggerAt)
        }
        return PendingIntent.getBroadcast(
            context, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** The service owns authentication checks, execution and no-retry behaviour. */
    fun startRefresh(context: Context, test: Boolean = false): String =
        BalanceNoticeService.start(
            context,
            if (test) BalanceNoticeService.testRefreshIntent(context)
            else BalanceNoticeService.refreshIntent(context)
        )

    /** Receiver re-arms tomorrow's chosen slot before starting a daily query. */
    fun onFired(context: Context, now: Long): Long =
        if (isEnabled(context)) arm(context, now) else 0L
}
