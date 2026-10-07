package cn.scut.bombax.scut.notice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import cn.scut.bombax.scut.Diag

/**
 * Wakes the notification service once a day.
 *
 * This receiver does no network work and holds no session: it re-arms the next alarm and hands the
 * refresh to the service, which dispatches onto the shared single-threaded queue in
 * [cn.scut.bombax.scut.ScutRuntime]. That ordering is what keeps "at most one in-flight SCUT
 * request" true even when the page's own timer is also running.
 *
 * No `RECEIVE_BOOT_COMPLETED` is registered, so a reboot clears the cadence until the app is
 * opened again — a deliberate omission (it is one more permanent permission for a feature that is
 * a nicety), and it is documented rather than hidden.
 */
class DailyAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != DailyRefresh.ACTION_DAILY) return
        val app = context.applicationContext
        if (!DailyRefresh.isEnabled(app)) {
            // A stale alarm from before the switch was turned off. Do nothing, and do not re-arm.
            Diag.warn("stage=daily result=skipped reason=disabled")
            return
        }
        val scheduledAt = intent.getLongExtra(DailyRefresh.EXTRA_TRIGGER_AT, 0L)
        val now = System.currentTimeMillis()
        val next = DailyRefresh.onFired(app, scheduledAt, now)
        val started = DailyRefresh.startRefresh(app)
        Diag.event(
            "stage=daily result=fired start=$started nextInSec=" +
                if (next > 0L) DailySchedule.secondsUntil(now, next) else -1L
        )
    }
}
