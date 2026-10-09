package cn.scut.bombax.scut.notice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import cn.scut.bombax.scut.Diag

/**
 * Two non-exported broadcasts, with different PendingIntents:
 * the everyday chosen clock slot and an explicitly requested one-time early test.
 * Both go through the same BalanceNoticeService / ScutRuntime queue.
 */
class DailyAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != DailyRefresh.ACTION_DAILY && action != DailyRefresh.ACTION_TEST) return
        val app = context.applicationContext
        val scheduledAt = intent.getLongExtra(DailyRefresh.EXTRA_TRIGGER_AT, 0L)
        val now = System.currentTimeMillis()
        val lateSeconds = ((now - scheduledAt) / 1000L).coerceAtLeast(0L)

        if (action == DailyRefresh.ACTION_TEST) {
            // Already fired/cancelled/replaced? Never send a duplicate school request.
            if (!DailyRefresh.consumeTest(app, scheduledAt)) {
                Diag.warn("stage=snapshotTest result=skipped reason=stale")
                return
            }
            val started = DailyRefresh.startRefresh(app, test = true)
            Diag.event("stage=snapshotTest result=fired lateSec=$lateSeconds start=$started")
            return
        }

        if (!DailyRefresh.isEnabled(app)) {
            Diag.warn("stage=daily result=skipped reason=disabled")
            return
        }
        val next = DailyRefresh.onFired(app, now)
        val started = DailyRefresh.startRefresh(app)
        val nextSeconds = if (next > 0L) DailySchedule.secondsUntil(now, next) else -1L
        Diag.event("stage=snapshot result=fired lateSec=$lateSeconds start=$started nextInSec=$nextSeconds")
    }
}
