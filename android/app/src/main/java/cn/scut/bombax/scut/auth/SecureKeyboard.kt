package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.network.ScutHttp
import okhttp3.Request
import org.json.JSONObject

data class Keyboard(val uuid: String, val numberKeyboard: String = "")

/**
 * Secure-keyboard encoding.
 *
 * ```
 * submitted = the characters the user chose + "$1$" + uuid
 * ```
 *
 * Verified against SCUT's own client on 2026-10-05 (`/plat/js/chunk-2d0f0054.fe26bac8.js`,
 * the `security-keyboard` component): a tap on tile `i` emits `numberKeyboard[i]`, i.e. the
 * **character drawn on that tile**, and the login chunk only appends `"$1$" + keyboardUuid`.
 * The server shuffles the layout and remembers it under `uuid`, so the scrambling exists to
 * defeat keyloggers and screen recording — the value that reaches `/oauth/token` is the real
 * password. Mapping the digits through the layout here (an earlier port of a third-party
 * reference implementation) permutes the password and the school answers `code=8000`.
 *
 * SCUT's `frontInfo` config sets the card login to `encryption: "keyboard"` and
 * `passwordRule: "a/num/#/leng_8"`, so letters and symbols are legal and must be passed
 * through unchanged.
 */
object SecureKeyboardEncoder {
    const val SEPARATOR = "$1$"

    fun encode(password: String, uuid: String): String? {
        if (password.isEmpty() || uuid.isEmpty()) return null
        return password + SEPARATOR + uuid
    }

    /** `{"data":{"uuid":"...","numberKeyboard":"..."}}` — only `uuid` is required. */
    fun parse(json: JSONObject): Keyboard? {
        val data = json.optJSONObject("data") ?: return null
        val uuid = data.optString("uuid")
        if (uuid.isBlank()) return null
        return Keyboard(uuid.trim(), data.optString("numberKeyboard"))
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
