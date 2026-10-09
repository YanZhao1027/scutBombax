package cn.scut.bombax.scut.notice

import java.util.concurrent.CopyOnWriteArraySet

/**
 * In-process notification that a local background read has finished.
 * Carries no balance, room, credentials, tokens, account or profile identifier.
 * If no WebView is alive, there are no listeners; its next foreground entry re-reads SQLite.
 */
object LocalSnapshotSignals {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    fun subscribe(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun unsubscribe(listener: () -> Unit) {
        listeners.remove(listener)
    }

    fun publish() {
        listeners.forEach { listener ->
            runCatching { listener() }
        }
    }
}
