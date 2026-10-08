package cn.scut.bombax.scut.history

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import cn.scut.bombax.scut.Diag
import cn.scut.bombax.scut.billing.BalanceReading
import java.io.File

/**
 * The local balance history: one row per accepted reading.
 *
 * Deliberately thin. Every decision that could corrupt a time series lives in [HistoryLogic] and
 * is unit-tested on a host; this file only translates those decisions into SQL.
 *
 * The database file goes under `noBackupFilesDir`, not the default `databases/` directory. The app
 * already sets `android:allowBackup="false"`, so nothing is auto-backed-up either way, but a room
 * number and a consumption history are the kind of data that should stay out of *every* transport
 * an OS offers — auto backup, `adb backup`, and device-to-device transfer — unless a user-triggered
 * export is designed on purpose.
 *
 * Nothing in here is logged beyond a row count: the room number is an identifier, and the balances
 * are the user's private figures.
 */
class BalanceHistoryStore private constructor(
    context: Context,
    path: String
) : SQLiteOpenHelper(context, path, null, DATABASE_VERSION), SnapshotWriter, SnapshotReader {

    constructor(context: Context) : this(
        context,
        File(context.applicationContext.noBackupFilesDir, DATABASE_FILE_NAME).absolutePath
    )

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(CREATE_TABLE)
        db.execSQL(CREATE_INDEX)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // One version exists. When a second appears, the migration has to be written by hand
        // rather than dropped-and-recreated: the history is the thing users would notice losing.
        db.execSQL("DROP TABLE IF EXISTS $TABLE")
        onCreate(db)
    }

    override fun record(snapshot: BalanceSnapshot) {
        val db = writableDatabase
        val previous = readLatest(db, snapshot.profileId)
        if (HistoryLogic.isDuplicate(previous, snapshot)) {
            // The single-choke-point write path is what guarantees one row per query; this only
            // catches two calls landing inside the same window, and says so instead of silently
            // dropping the row.
            Diag.event("stage=history result=deduplicated source=${snapshot.source.wire}")
            return
        }
        db.insert(TABLE, null, snapshot.toValues())
        prune(db, snapshot.profileId)
        // Redacted by construction — see HistoryLogic.recordLogLine.
        Diag.event(HistoryLogic.recordLogLine(snapshot))
    }

    override fun latest(profileId: String): BalanceSnapshot? = readLatest(readableDatabase, profileId)

    override fun latestAny(): BalanceSnapshot? {
        val db = readableDatabase
        db.query(
            TABLE,
            null,
            null,
            null,
            null,
            null,
            "$COLUMN_RECORDED DESC",
            "1"
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return rowFrom(cursor)
        }
    }

    /**
     * Deletes history. With no profile given, everything.
     *
     * Separate from logout on purpose: signing out must not destroy the series the user came to
     * look at, but "删除本地历史" has to be able to.
     */
    fun clear(profileId: String?): Int {
        val db = writableDatabase
        val deleted = if (profileId == null) {
            db.delete(TABLE, null, null)
        } else {
            db.delete(TABLE, "$COLUMN_PROFILE = ?", arrayOf(profileId))
        }
        Diag.event("stage=history result=cleared rows=$deleted")
        return deleted
    }

    private fun prune(db: SQLiteDatabase, profileId: String) {
        // A daily snapshot reaches 2 000 rows in under six years; a foreground timer set to five
        // minutes gets there in a week, so the cap is what keeps the chart query cheap.
        db.execSQL(
            "DELETE FROM $TABLE WHERE $COLUMN_PROFILE = ? AND $COLUMN_ID NOT IN " +
                "(SELECT $COLUMN_ID FROM $TABLE WHERE $COLUMN_PROFILE = ? " +
                "ORDER BY $COLUMN_RECORDED DESC LIMIT $MAX_ROWS_PER_PROFILE)",
            arrayOf(profileId, profileId)
        )
    }

    private fun readLatest(db: SQLiteDatabase, profileId: String): BalanceSnapshot? {
        db.query(
            TABLE,
            null,
            "$COLUMN_PROFILE = ?",
            arrayOf(profileId),
            null,
            null,
            "$COLUMN_RECORDED DESC",
            "1"
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return rowFrom(cursor)
        }
    }

    private fun rowFrom(cursor: android.database.Cursor): BalanceSnapshot = BalanceSnapshot(
        profileId = cursor.string(COLUMN_PROFILE),
        campus = cursor.string(COLUMN_CAMPUS),
        room = cursor.string(COLUMN_ROOM),
        recordedAtMillis = cursor.getLong(cursor.getColumnIndexOrThrow(COLUMN_RECORDED)),
        electric = cursor.optionalDouble(COLUMN_ELECTRIC),
        water = cursor.optionalDouble(COLUMN_WATER),
        ac = cursor.optionalDouble(COLUMN_AC),
        electricUnit = cursor.string(COLUMN_ELECTRIC_UNIT),
        waterUnit = cursor.string(COLUMN_WATER_UNIT),
        acUnit = cursor.string(COLUMN_AC_UNIT),
        source = SnapshotSource.from(cursor.string(COLUMN_SOURCE))
    )

    private fun BalanceSnapshot.toValues(): ContentValues = ContentValues().apply {
        put(COLUMN_PROFILE, profileId)
        put(COLUMN_CAMPUS, campus)
        put(COLUMN_ROOM, room)
        put(COLUMN_RECORDED, recordedAtMillis)
        putNull(COLUMN_ELECTRIC)
        electric?.let { put(COLUMN_ELECTRIC, it) }
        putNull(COLUMN_WATER)
        water?.let { put(COLUMN_WATER, it) }
        putNull(COLUMN_AC)
        ac?.let { put(COLUMN_AC, it) }
        put(COLUMN_ELECTRIC_UNIT, electricUnit)
        put(COLUMN_WATER_UNIT, waterUnit)
        put(COLUMN_AC_UNIT, acUnit)
        put(COLUMN_SOURCE, source.wire)
    }

    private fun android.database.Cursor.string(column: String): String {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) "" else getString(index)
    }

    private fun android.database.Cursor.optionalDouble(column: String): Double? {
        val index = getColumnIndexOrThrow(column)
        return if (isNull(index)) null else getDouble(index)
    }

    companion object {
        const val DATABASE_FILE_NAME = "bombax-history.db"
        const val DATABASE_VERSION = 1
        const val MAX_ROWS_PER_PROFILE = 2_000

        const val TABLE = "balance_snapshot"
        const val COLUMN_ID = "_id"
        const val COLUMN_PROFILE = "profile_id"
        const val COLUMN_CAMPUS = "campus"
        const val COLUMN_ROOM = "room"
        const val COLUMN_RECORDED = "recorded_at"
        const val COLUMN_ELECTRIC = "electric"
        const val COLUMN_WATER = "water"
        const val COLUMN_AC = "ac"
        const val COLUMN_ELECTRIC_UNIT = "electric_unit"
        const val COLUMN_WATER_UNIT = "water_unit"
        const val COLUMN_AC_UNIT = "ac_unit"
        const val COLUMN_SOURCE = "source"

        private const val CREATE_TABLE = """
            CREATE TABLE $TABLE (
                $COLUMN_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                $COLUMN_PROFILE TEXT NOT NULL,
                $COLUMN_CAMPUS TEXT NOT NULL,
                $COLUMN_ROOM TEXT NOT NULL,
                $COLUMN_RECORDED INTEGER NOT NULL,
                $COLUMN_ELECTRIC REAL,
                $COLUMN_WATER REAL,
                $COLUMN_AC REAL,
                $COLUMN_ELECTRIC_UNIT TEXT NOT NULL DEFAULT '',
                $COLUMN_WATER_UNIT TEXT NOT NULL DEFAULT '',
                $COLUMN_AC_UNIT TEXT NOT NULL DEFAULT '',
                $COLUMN_SOURCE TEXT NOT NULL
            )
        """

        private const val CREATE_INDEX =
            "CREATE INDEX idx_profile_recorded ON $TABLE ($COLUMN_PROFILE, $COLUMN_RECORDED)"

        /**
         * Turns a fresh reading into a snapshot and hands it to the writer.
         *
         * The room is required: a reading without one is not a series point, and inventing a key
         * for it would merge unrelated dormitories into one line.
         */
        fun snapshotOf(reading: BalanceReading, atMillis: Long, source: SnapshotSource): BalanceSnapshot? {
            val room = reading.room.trim()
            if (room.isEmpty()) return null
            return BalanceSnapshot(
                profileId = HistoryLogic.profileId(reading.campus, room),
                campus = reading.campus,
                room = room,
                recordedAtMillis = atMillis,
                electric = reading.electric,
                water = reading.water,
                ac = reading.ac,
                electricUnit = reading.electricText,
                waterUnit = reading.waterText,
                acUnit = reading.acText,
                source = source
            )
        }
    }
}
