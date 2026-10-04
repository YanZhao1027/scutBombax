package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.network.ScutHttp
import okhttp3.Request
import org.json.JSONObject

data class Keyboard(val numberKeyboard: String, val uuid: String)

/**
 * Secure-keyboard encoding, ported exactly from
 * `src/utils/keyboard.ts` / `worker/auth.ts`:
 *
 * ```
 * encoded = map(password digits through numberKeyboard) + "$1$" + uuid
 * ```
 *
 * The card password is a digit string in the official flow. An out-of-range
 * digit or a non-digit is reported as a protocol change instead of silently
 * producing a short password the way `String.charAt` did in JavaScript.
 */
object SecureKeyboardEncoder {
    const val SEPARATOR = "$1$"

    fun encode(password: String, numberKeyboard: String, uuid: String): String? {
        if (password.isEmpty() || numberKeyboard.isEmpty() || uuid.isEmpty()) return null
        val mapped = StringBuilder(password.length + SEPARATOR.length + uuid.length)
        for (char in password) {
            if (!char.isDigit()) return null
            val index = char - '0'
            if (index >= numberKeyboard.length) return null
            mapped.append(numberKeyboard[index])
        }
        return mapped.append(SEPARATOR).append(uuid).toString()
    }

    /** `{"data":{"numberKeyboard":"...","uuid":"..."}}` */
    fun parse(json: JSONObject): Keyboard? {
        val data = json.optJSONObject("data") ?: return null
        val keyboard = data.optString("numberKeyboard")
        val uuid = data.optString("uuid")
        if (keyboard.isBlank() || uuid.isBlank()) return null
        return Keyboard(keyboard, uuid)
    }
}

class SecureKeyboardService(private val http: ScutHttp) {

    fun fetch(): Keyboard {
        val url = ScutEndpoints.cardUrl(ScutEndpoints.KEYBOARD_PATH)
            .newBuilder()
            .addQueryParameter("type", "Standard")
            .addQueryParameter("order", "0")
            .addQueryParameter("synAccessSource", "h5")
            .build()

        val response = http.send(Stages.KEYBOARD, Request.Builder().url(url).get().build())
        if (response.status != 200) {
            throw ScutException(
                AppError.UPSTREAM_UNAVAILABLE,
                "安全键盘不可用",
                "${Stages.KEYBOARD}/${response.status}"
            )
        }
        val keyboard = SecureKeyboardEncoder.parse(response.requireJson())
            ?: throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "安全键盘响应结构已变化",
                "${Stages.KEYBOARD}/${response.status}"
            )
        return keyboard
    }
}
