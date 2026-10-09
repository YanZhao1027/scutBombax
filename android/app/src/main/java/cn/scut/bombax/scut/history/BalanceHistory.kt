package cn.scut.bombax.scut.history

import java.security.MessageDigest

/**
 * Why a snapshot was recorded.
 *
 * Kept as data because the paths are not equally trustworthy for analysis: a `daily` row is the
 * one the trend chart can rely on being roughly 24 hours apart, while `manual` rows cluster
 * wherever the user happened to look. `UNKNOWN` exists so a value that arrived wrong from the page
 * shows up as itself instead of being silently counted as a tap.
 */
enum class SnapshotSource(val wire: String) {
    MANUAL("manual"),
    AUTO("auto"),
    LOGIN("login"),
    RESTORE("restore"),
    NIGHTLY("nightly"), // legacy fixed 23:00 rows, kept readable
    DAILY("daily"),    // new user-selected daily clock slot
    TEST("test"),      // explicit early one-off verification
    UNKNOWN("unknown");

    companion object {
        fun from(value: String?): SnapshotSource =
            entries.firstOrNull { it.wire == value?.trim()?.lowercase() } ?: UNKNOWN
    }
}

/** One balance reading, as stored. Values are the school's numbers; units are ours. */
data class BalanceSnapshot(
    val profileId: String,
    val campus: String,
    val room: String,
    val recordedAtMillis: Long,
    val electric: Double?,
    val water: Double?,
    val ac: Double?,
    val electricUnit: String,
    val waterUnit: String,
    val acUnit: String,
    val source: SnapshotSource
)

/**
 * The part of the history feature that can be proven on a host.
 *
 * The database itself is a thin `SQLiteOpenHelper` and can only be exercised on a phone; the
 * decisions that actually risk corrupting a time series — which account a row belongs to, and
 * whether a write is a duplicate — are here and are unit-tested.
 */
object HistoryLogic {

    /**
     * Two identical readings closer together than this are the *same event* reaching the writer
     * twice, not two observations of a flat balance.
     *
     * The window is deliberately short. A balance that really does not move for three days is
     * information (consumption ≈ 0), and deduplicating by value across a wider window would erase
     * exactly the flat stretches the trend chart needs. The single-choke-point write path in
     * `BillingRepository` is what guarantees "one query, one row"; this is only the safety net for
     * a caller that fires twice inside a second.
     */
    const val DUPLICATE_WINDOW_MS = 90_000L

    /** Hex characters kept from the digest: 64 bits of a SHA-256, plenty for a handful of rooms. */
    const val PROFILE_ID_LENGTH = 16

    /**
     * A local grouping key for one dormitory's series.
     *
     * Hashed so the room number does not have to appear in a log line or an export header for the
     * grouping to work — that is the leak this project has actually audited (§10).
     *
     * **This is not anonymisation, and must not be described as irreversible.** A dormitory room
     * number is a small, well-known space, so anyone holding both the digest and the campus layout
     * can recover the room by enumeration; and two different users in the same room get the same
     * key, which is correct for a meter series but wrong the moment one install holds several
     * accounts or the data ever leaves the device. Acceptable for a single user on their own
     * phone, which is all this app is today. Before any multi-user or data-export release: mix a
     * device-local secret in (HMAC under a key the Keystore generates once) and decide whether the
     * series identity is the room or the account — see docs/ARCHITECTURE.md.
     */
    fun profileId(campus: String, room: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$campus|$room".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(PROFILE_ID_LENGTH)
    }

    /** True when [next] repeats [previous] closely enough to be the same event. */
    fun isDuplicate(previous: BalanceSnapshot?, next: BalanceSnapshot): Boolean {
        if (previous == null) return false
        if (previous.profileId != next.profileId) return false
        if (next.recordedAtMillis - previous.recordedAtMillis >= DUPLICATE_WINDOW_MS) return false
        return sameNumbers(previous, next)
    }

    /**
     * The line logged after a row is accepted.
     *
     * A release build cannot be inspected with `run-as` — that is precisely what not being
     * debuggable means — so without this there is no way to see the history feature working on the
     * phone users actually get. Presence flags only: **no room, no grouping key, no balance value,
     * no timestamp**, and `BalanceHistoryTest` fails if any of them appear.
     */
    fun recordLogLine(snapshot: BalanceSnapshot): String =
        "stage=history result=recorded source=${snapshot.source.wire} " +
            "electric=${snapshot.electric != null} water=${snapshot.water != null} " +
            "ac=${snapshot.ac != null}"

    private fun sameNumbers(a: BalanceSnapshot, b: BalanceSnapshot): Boolean =
        a.electric == b.electric && a.water == b.water && a.ac == b.ac
}

/**
 * The write side of the history, as the billing layer sees it.
 *
 * An interface rather than the store itself for two reasons: `BillingRepository` stays free of
 * Android types so it keeps compiling in JVM tests, and a test can then assert the acceptance rule
 * that matters — one successful query writes exactly one row, a failed query writes nothing —
 * without a database.
 */
interface SnapshotWriter {
    fun record(snapshot: BalanceSnapshot)
}

/** The read side: the newest row for one dormitory, used when the school cannot be reached. */
interface SnapshotReader {
    fun latest(profileId: String): BalanceSnapshot?

    /**
     * The newest row for whichever dormitory was last queried.
     *
     * The session record holds no room — only the balance answer does — so the offline fallback
     * cannot derive a profile id on its own. Reading the newest row overall is not a guess across
     * accounts: rows always carry their own profile, and the newest one is by construction the
     * series the screen was showing before the network went away.
     */
    fun latestAny(): BalanceSnapshot?
}
