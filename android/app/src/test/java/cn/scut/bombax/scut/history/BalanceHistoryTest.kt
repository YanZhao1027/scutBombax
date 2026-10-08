package cn.scut.bombax.scut.history

import cn.scut.bombax.scut.billing.BalanceReading
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two decisions that can silently corrupt a balance series, proven on a host.
 *
 * The database itself is a thin `SQLiteOpenHelper` and is exercised on the phone; what would
 * actually damage the data — which account a row belongs to, and whether a write is the same event
 * twice — is pure logic and belongs here.
 */
class BalanceHistoryTest {

    private val room = "九栋 302"

    private fun snapshot(
        at: Long,
        electric: Double? = 30.0,
        water: Double? = 12.0,
        campus: String = "DXC",
        room: String = this.room,
        source: SnapshotSource = SnapshotSource.NIGHTLY
    ) = BalanceHistoryStore.snapshotOf(
        BalanceReading(
            campus = campus,
            room = room,
            electric = electric,
            water = water,
            ac = null,
            electricText = "元",
            waterText = "平台返回余额",
            acText = "",
            updatedAtMillis = at
        ),
        atMillis = at,
        source = source
    )!!

    // ------------------------------------------------------------- grouping

    @Test
    fun `the same dormitory always groups to the same profile`() {
        assertEquals(
            HistoryLogic.profileId("DXC", room),
            HistoryLogic.profileId("DXC", room)
        )
    }

    @Test
    fun `a different room or campus is a different series`() {
        val base = HistoryLogic.profileId("DXC", room)
        assertNotEquals(base, HistoryLogic.profileId("DXC", "九栋 303"))
        assertNotEquals(base, HistoryLogic.profileId("GZIC", room))
    }

    @Test
    fun `the profile id is not the room, and not reversible by lookup`() {
        // The room number identifies where a person lives; the grouping key is what keeps it out
        // of log lines and export headers. It is not a secret — the row itself still carries the
        // room — it is the difference between "leaks in diagnostics" and "stays in the database".
        val id = HistoryLogic.profileId("DXC", room)
        assertEquals(HistoryLogic.PROFILE_ID_LENGTH, id.length)
        assertTrue(id.matches(Regex("[0-9a-f]{16}")))
        assertNotEquals(room, id)
        assertTrue(id != room.lowercase().replace(" ", ""))
    }

    // -------------------------------------------------------------- dedupe

    @Test
    fun `two identical readings inside the window are the same event`() {
        val first = snapshot(at = 1_730_000_000_000L)
        val again = snapshot(at = first.recordedAtMillis + 3_000L)
        assertTrue(HistoryLogic.isDuplicate(first, again))
    }

    @Test
    fun `an identical balance the next day is a real observation, not a duplicate`() {
        // A flat series is information: consumption ≈ 0. Deduplicating by value across a day would
        // erase exactly the stretches the chart needs to show.
        val first = snapshot(at = 1_730_000_000_000L)
        val nextDay = snapshot(at = first.recordedAtMillis + HistoryLogic.DUPLICATE_WINDOW_MS)
        assertEquals(false, HistoryLogic.isDuplicate(first, nextDay))
    }

    @Test
    fun `a changed balance is never a duplicate`() {
        val first = snapshot(at = 1_730_000_000_000L, electric = 30.0)
        val spent = snapshot(at = first.recordedAtMillis + 1_000L, electric = 27.9)
        assertEquals(false, HistoryLogic.isDuplicate(first, spent))
    }

    @Test
    fun `another dormitory's reading is never a duplicate of this one`() {
        val first = snapshot(at = 1_730_000_000_000L)
        val elsewhere = snapshot(at = first.recordedAtMillis + 1_000L, room = "九栋 303")
        assertEquals(false, HistoryLogic.isDuplicate(first, elsewhere))
    }

    @Test
    fun `no previous row means nothing is a duplicate`() {
        assertEquals(false, HistoryLogic.isDuplicate(null, snapshot(at = 1_730_000_000_000L)))
    }

    // ------------------------------------------------------------- sources

    @Test
    fun `a reading with no room is not a series point`() {
        // Inventing a key for it would merge every unidentified reading into one line.
        val nameless = BalanceHistoryStore.snapshotOf(
            BalanceReading("DXC", "   ", 30.0, 12.0, null, "元", "", "", 1L),
            atMillis = 1L,
            source = SnapshotSource.MANUAL
        )
        assertNull(nameless)
    }

    @Test
    fun `a source the page did not send is recorded as unknown, not as a tap`() {
        assertEquals(SnapshotSource.MANUAL, SnapshotSource.from("manual"))
        assertEquals(SnapshotSource.AUTO, SnapshotSource.from(" auto "))
        assertEquals(SnapshotSource.NIGHTLY, SnapshotSource.from("NIGHTLY"))
        assertEquals(SnapshotSource.TEST, SnapshotSource.from("test"))
        assertEquals(SnapshotSource.UNKNOWN, SnapshotSource.from("definitely-not-a-source"))
        assertEquals(SnapshotSource.UNKNOWN, SnapshotSource.from(null))
    }

    @Test
    fun `the recorded log line carries presence flags and nothing else`() {
        // This line is the only way to see the history feature work on a release build, so it is
        // also the one place a balance or a room could leak into logcat by accident.
        val row = snapshot(at = 1_791_436_553_952L, electric = 31.13, water = 28.2)
        val line = HistoryLogic.recordLogLine(row)

        assertEquals(
            "stage=history result=recorded source=nightly electric=true water=true ac=false",
            line
        )
        assertFalse(line.contains("31.13"))
        assertFalse(line.contains("28.2"))
        assertFalse(line.contains(room))
        assertFalse(line.contains(row.profileId))
        assertFalse(line.contains("1791436553952"))
    }

    @Test
    fun `a missing balance is logged as absent, not as a number`() {
        val partial = BalanceHistoryStore.snapshotOf(
            BalanceReading("DXC", room, null, 28.2, null, "元", "", "", 1_791_436_553_952L),
            atMillis = 1_791_436_553_952L,
            source = SnapshotSource.MANUAL
        )!!
        assertEquals(
            "stage=history result=recorded source=manual electric=false water=true ac=false",
            HistoryLogic.recordLogLine(partial)
        )
    }

    @Test
    fun `a missing balance is stored as absent rather than as zero`() {
        // Zero reads as "out of money" on a chart; absent reads as a gap, which is the truth.
        val partial = BalanceHistoryStore.snapshotOf(
            BalanceReading("DXC", room, null, 12.0, null, "元", "", "", 1_730_000_000_000L),
            atMillis = 1_730_000_000_000L,
            source = SnapshotSource.RESTORE
        )!!
        assertNull(partial.electric)
        assertEquals(12.0, partial.water!!, 1e-9)
    }
}
