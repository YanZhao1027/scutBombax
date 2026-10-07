package cn.scut.bombax.scut.notice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The cadence maths is the only part of the daily path that can be proven off a device, and it is
 * the part that decides how often the school gets a request from this app — so it is pinned here.
 *
 * The parts that cannot be tested on a host (AlarmManager, a running foreground service, an OEM
 * that kills it) are measured on the phone instead, in docs/DEVICE_VERIFICATION.md §13.
 */
class DailyRefreshTest {

    private val day = DailySchedule.INTERVAL_MS

    @Test
    fun `first ever wake is one interval away`() {
        val now = 1_700_000_000_000L
        assertEquals(now + day, DailySchedule.nextTriggerAt(now, 0L))
    }

    @Test
    fun `the next wake is one interval after the anchor`() {
        val now = 1_700_000_000_000L
        val anchor = now - 6 * 60 * 60 * 1000L
        assertEquals(anchor + day, DailySchedule.nextTriggerAt(now, anchor))
    }

    @Test
    fun `re-arming on app start computes the same instant as the pending alarm`() {
        // Idempotence matters: `armIfEnabled` runs on every app open, and an app open must not
        // slide the daily wake further out.
        val armed = 1_700_000_000_000L + day
        val later = 1_700_000_000_000L + 3 * 60 * 1000L
        assertEquals(armed, DailySchedule.nextTriggerAt(later, 1_700_000_000_000L))
    }

    @Test
    fun `an overdue anchor catches up after the spacing floor, not immediately`() {
        // A reboot, a killed alarm or three days offline must produce one prompt query — never a
        // fire-the-instant-the-alarm-lands burst of the kind §12 measured and fixed.
        val now = 1_700_000_000_000L
        val overdue = now - 3 * day
        assertEquals(now + DailySchedule.MIN_DELAY_MS, DailySchedule.nextTriggerAt(now, overdue))
    }

    @Test
    fun `a fire that is exactly due still waits out the floor`() {
        val now = 1_700_000_000_000L
        assertEquals(now + DailySchedule.MIN_DELAY_MS, DailySchedule.nextTriggerAt(now, now - day))
    }

    @Test
    fun `a late delivery anchors on the scheduled time so the cadence self-corrects`() {
        // setAndAllowWhileIdle can deliver hours late out of Doze. Anchoring on the delivery time
        // would push the refresh later every day; anchoring on the scheduled time keeps it steady.
        val scheduled = 1_700_000_000_000L
        val deliveredLate = scheduled + 5 * 60 * 1000L
        assertEquals(
            scheduled + day,
            DailySchedule.nextTriggerAt(deliveredLate, scheduled)
        )
    }

    @Test
    fun `interval is one day and the floor is one minute`() {
        // Both numbers are load-bearing for the promise made to the school: at most one query per
        // day per device, and never two things at once.
        assertEquals(24L * 60 * 60 * 1000, day)
        assertEquals(60_000L, DailySchedule.MIN_DELAY_MS)
        assertTrue(day / DailySchedule.MIN_DELAY_MS == 1440L)
    }

    @Test
    fun `seconds until a wake is never negative`() {
        val now = 1_700_000_000_000L
        assertEquals(0L, DailySchedule.secondsUntil(now, now - 5_000L))
        assertEquals(120L, DailySchedule.secondsUntil(now, now + 120_000L))
    }
}
