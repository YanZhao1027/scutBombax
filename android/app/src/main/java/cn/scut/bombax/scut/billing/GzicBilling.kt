package cn.scut.bombax.scut.billing

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutException
import org.json.JSONObject

/**
 * A balance reading as the app presents it.
 *
 * The numeric fields are parsed out of the upstream text, the `*Text` fields keep
 * the school's own wording so the unit/semantics of each number can be checked on
 * a real account instead of being guessed at.
 */
data class BalanceReading(
    val campus: String,
    val room: String,
    val electric: Double?,
    val water: Double?,
    val ac: Double?,
    val electricText: String,
    val waterText: String,
    val acText: String,
    val updatedAtMillis: Long
)

/** Fee item response parsing for GZIC (广州国际校区). */
object GzicParser {

    const val OK_CODE = 200
    const val INFO_KEY = "信息"

    private val NUMBER = Regex("-?\\d+(?:\\.\\d+)?")

    fun code(json: JSONObject): Int = json.optInt("code", -1)

    fun info(json: JSONObject): String? =
        json.optJSONObject("map")
            ?.optJSONObject("showData")
            ?.optString(INFO_KEY)
            ?.takeIf { it.isNotBlank() }

    fun room(json: JSONObject): String? =
        json.optJSONObject("map")
            ?.optJSONObject("data")
            ?.optString("room")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }

    /**
     * Pulls the first number out of the upstream sentence.
     *
     * The water item answers with a comma-separated list whose last entry is the
     * balance, matching the old `split(',').pop()` behaviour.
     */
    fun parseAmount(text: String?, takeLastSegment: Boolean): Double? {
        if (text.isNullOrBlank()) return null
        val candidate = if (takeLastSegment) {
            text.split(',').lastOrNull()?.trim() ?: return null
        } else {
            text.trim()
        }
        return NUMBER.find(candidate)?.value?.toDoubleOrNull()
    }

    /**
     * @param electric fee item 1
     * @param ac fee item 2
     * @param water fee item 3
     */
    fun parse(
        electric: JSONObject,
        ac: JSONObject,
        water: JSONObject,
        now: Long
    ): BalanceReading {
        for ((name, json) in listOf("electric" to electric, "ac" to ac, "water" to water)) {
            if (code(json) != OK_CODE || json.optJSONObject("map") == null) {
                throw ScutException(
                    AppError.PROTOCOL_CHANGED,
                    "GZIC 费用项 $name 返回异常",
                    "gzic/$name/code=${code(json)}"
                )
            }
        }
        val room = room(electric)
            ?: throw ScutException(AppError.PROTOCOL_CHANGED, "GZIC 未返回房间", "gzic/room")
        val electricValue = parseAmount(info(electric), false)
        val acValue = parseAmount(info(ac), false)
        val waterValue = parseAmount(info(water), true)
        if (electricValue == null || acValue == null || waterValue == null) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "GZIC 余额文本无法解析",
                "gzic/amount"
            )
        }
        return BalanceReading(
            campus = "GZIC",
            room = room,
            electric = electricValue,
            water = waterValue,
            ac = acValue,
            electricText = info(electric).orEmpty(),
            waterText = info(water).orEmpty(),
            acText = info(ac).orEmpty(),
            updatedAtMillis = now
        )
    }
}
