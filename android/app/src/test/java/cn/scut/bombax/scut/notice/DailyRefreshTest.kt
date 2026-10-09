package cn.scut.bombax.scut.notice

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

/**
 * The nightly sampling slot.
 *
 * What is being pinned is the property the feature exists for: the sample lands at 23:00 Beijing
 * time every day, whatever time the user switched it on, however late the delivery was, and
 * whatever zone the device clock claims to be in. A drift of minutes per day would look fine in a
 * single test run and ruin a 30-day chart, so the no-drift case is asserted directly.
 */
class DailyRefreshTest {

    private val beijing = TimeZone.getTimeZone("Asia/Shanghai")
    private val previousDefault = TimeZone.getDefault()

    @After
    fun restoreDefaultZone() {
        TimeZone.setDefault(previousDefault)
    }

    /** Independent construction path: the test says "23:00 on this date", not "what the code says". */
    private fun beijingMillis(year: Int, month: Int, day: Int, hour: Int, minute: Int = 0): Long =
        Calendar.getInstance(beijing).apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
        }.timeInMillis

    private fun hourAndMinute(millis: Long): Pair<Int, Int> =
        Calendar.getInstance(beijing).apply { timeInMillis = millis }.let {
            it.get(Calendar.HOUR_OF_DAY) to it.get(Calendar.MINUTE)
        }

    @Test
    fun `before the slot, the next sample is today at 23 00`() {
        val morning = beijingMillis(2026, 10, 8, 9, 15)
        assertEquals(beijingMillis(2026, 10, 8, 23), DailySchedule.nextSnapshotAt(morning))
    }

    @Test
    fun `after the slot, the next sample is tomorrow at 23 00`() {
        val lateNight = beijingMillis(2026, 10, 8, 23, 30)
        assertEquals(beijingMillis(2026, 10, 9, 23), DailySchedule.nextSnapshotAt(lateNight))
    }

    @Test
    fun `being exactly at the slot never arms an alarm in the past or at now`() {
        val exactly = beijingMillis(2026, 10, 8, 23, 0)
        val next = DailySchedule.nextSnapshotAt(exactly)
        assertTrue("must be strictly later, or the alarm fires the instant it is set", next > exactly)
        assertEquals(beijingMillis(2026, 10, 9, 23), next)
    }

    @Test
    fun `a late delivery does not slide the slot`() {
        // The old interval schedule drifted: each late delivery pushed the next one later. With a
        // wall-clock slot, a sample that lands 45 seconds late is simply followed by tomorrow's
        // 23:00 — measured on the device as a 45 s Doze delay on 2026-10-08.
        val late = beijingMillis(2026, 10, 8, 23) + 45_000L
        assertEquals(beijingMillis(2026, 10, 9, 23), DailySchedule.nextSnapshotAt(late))
    }

    @Test
    fun `consecutive slots are exactly one day apart`() {
        val first = DailySchedule.nextSnapshotAt(beijingMillis(2026, 10, 8, 12))
        val second = DailySchedule.nextSnapshotAt(first + 1_000L)
        assertEquals(DailySchedule.DAY_MS, second - first)
    }

    @Test
    fun `the slot is 23 00 in Beijing time for any moment of the day`() {
        for (hour in 0..23 step 5) {
            val next = DailySchedule.nextSnapshotAt(beijingMillis(2026, 12, 31, hour, 7))
            assertEquals(23 to 0, hourAndMinute(next))
        }
    }

    @Test
    fun `the device clock's zone does not move the sample`() {
        val at = beijingMillis(2026, 10, 8, 15, 0)
        val computedHere = DailySchedule.nextSnapshotAt(at)
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        assertEquals(computedHere, DailySchedule.nextSnapshotAt(at))
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
        assertEquals(computedHere, DailySchedule.nextSnapshotAt(at))
    }

    @Test
    fun `a switch turned on in the afternoon still waits for tonight, not for 24 hours`() {
        // The behaviour the user asked for on 2026-10-08: enabling the feature at 14:00 must not
        // produce a daily refresh at 14:00 forever after.
        val afternoon = beijingMillis(2026, 10, 8, 14, 0)
        assertEquals(9 * 60 * 60 * 1000L, DailySchedule.nextSnapshotAt(afternoon) - afternoon)
    }

    @Test
    fun `seconds until a slot is never negative`() {
        val now = beijingMillis(2026, 10, 8, 15, 0)
        assertEquals(0L, DailySchedule.secondsUntil(now, now - 5_000L))
        assertEquals(30L, DailySchedule.secondsUntil(now, now + 30_000L))
    }

    @Test
    fun `a chosen nearby future time is scheduled today and not tomorrow`() {
        val now = beijingMillis(2026, 10, 8, 20, 26)
        assertEquals(
            beijingMillis(2026, 10, 8, 20, 32),
            DailySchedule.nextSnapshotAt(now, 20, 32)
        )
    }

    @Test
    fun `a chosen time that has passed waits until tomorrow`() {
        val now = beijingMillis(2026, 10, 8, 20, 26)
        assertEquals(
            beijingMillis(2026, 10, 9, 20, 25),
            DailySchedule.nextSnapshotAt(now, 20, 25)
        )
    }

    @Test
    fun `a chosen time at midnight crosses the calendar date safely`() {
        val now = beijingMillis(2026, 10, 8, 23, 59)
        assertEquals(
            beijingMillis(2026, 10, 9, 0, 5),
            DailySchedule.nextSnapshotAt(now, 0, 5)
        )
    }

    @Test
    fun `changing chosen time does not depend on device timezone`() {
        val now = beijingMillis(2026, 10, 8, 20, 26)
        val target = DailySchedule.nextSnapshotAt(now, 20, 40)
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        assertEquals(target, DailySchedule.nextSnapshotAt(now, 20, 40))
    }

    @Test
    fun `invalid times are not accepted as clock settings`() {
        assertEquals(false, DailySchedule.validTime(24, 0))
        assertEquals(false, DailySchedule.validTime(23, 60))
        assertEquals(false, DailySchedule.validTime(-1, 0))
        assertEquals(true, DailySchedule.validTime(0, 0))
        assertEquals(true, DailySchedule.validTime(23, 59))
    }

    @Test
    fun `an early one-time test is a distinct five-minute intent`() {
        val now = beijingMillis(2026, 10, 8, 20, 26)
        assertEquals(300_000L, DailySchedule.TEST_DELAY_MS)
        assertTrue(now + DailySchedule.TEST_DELAY_MS < DailySchedule.nextSnapshotAt(now))
        assertNotEquals(DailyRefresh.ACTION_TEST, DailyRefresh.ACTION_DAILY)
    }

    @Test
    fun `the slot is not midnight, which is when the dorm network drops`() {
        // Sampling at the boundary would produce a missing row every single night.
        assertNotEquals(0, hourAndMinute(DailySchedule.nextSnapshotAt(beijingMillis(2026, 10, 8, 20))).first)
    }
}
