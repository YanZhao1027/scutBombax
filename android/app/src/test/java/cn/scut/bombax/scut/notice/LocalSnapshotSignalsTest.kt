package cn.scut.bombax.scut.notice

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalSnapshotSignalsTest {
    @Test
    fun `publication reaches an open subscriber but not one that was detached`() {
        var delivered = 0
        val listener: () -> Unit = { delivered++ }
        LocalSnapshotSignals.subscribe(listener)
        try {
            LocalSnapshotSignals.publish()
            assertEquals(1, delivered)
        } finally {
            LocalSnapshotSignals.unsubscribe(listener)
        }
        LocalSnapshotSignals.publish()
        assertEquals(1, delivered)
    }

    @Test
    fun `failing listeners cannot prevent other listeners from being notified`() {
        var delivered = 0
        val failure: () -> Unit = { error("fixture failure") }
        val healthy: () -> Unit = { delivered++ }
        LocalSnapshotSignals.subscribe(failure)
        LocalSnapshotSignals.subscribe(healthy)
        try {
            LocalSnapshotSignals.publish()
            assertEquals(1, delivered)
        } finally {
            LocalSnapshotSignals.unsubscribe(failure)
            LocalSnapshotSignals.unsubscribe(healthy)
        }
    }
}
