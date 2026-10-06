package cn.scut.bombax.scut.auth

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.network.ScutHttp
import okhttp3.Request
import org.json.JSONObject

/**
 * One secure-keyboard session: the four token rows plus the id the server binds them to.
 *
 * Each row is a per-session random string of the same length as a **fixed** on-screen layout.
 * Tile `i` of a row shows a known character and submits `row[i]`, so the wire value is a
 * substitution of the password, not the password:
 *
 * ```text
 * digits    0123456789                     -> numberKeyboard
 * lowercase qwertyuiopasdfghjklzxcvbnm     -> lowerLetterKeyboard
 * uppercase QWERTYUIOPASDFGHJKLZXCVBNM     -> upperLetterKeyboard
 * symbols   *\-[ ]{}/!<,>?~&#.:+|`%'$;^"_  -> symbolKeyboard
 * ```
 *
 * The layouts were read off the server's own tile images on 2026-10-06 (a credential-free
 * `GET /berserker-secure/keyboard?type=Standard`, decoded to PNGs): the digits run 0-9 in
 * order, the letters are QWERTY, and the symbols are in the order above — none of them is
 * shuffled, only the token strings are. That is why the mapping can be done here at all: a
 * human taps glyphs on the school's keyboard, and an app that already holds the characters
 * can look up the same tile index.
 */
data class Keyboard(
    val uuid: String,
    val numberKeyboard: String = "",
    val lowerLetterKeyboard: String = "",
    val upperLetterKeyboard: String = "",
    val symbolKeyboard: String = ""
) {

    /** The token the school expects for one typed character, or null if no row covers it. */
    fun tokenFor(char: Char): Char? {
        val (order, tokens) = when {
            char in DIGIT_ORDER -> DIGIT_ORDER to numberKeyboard
            char in LOWER_ORDER -> LOWER_ORDER to lowerLetterKeyboard
            char in UPPER_ORDER -> UPPER_ORDER to upperLetterKeyboard
            char in SYMBOL_ORDER -> SYMBOL_ORDER to symbolKeyboard
            else -> return null
        }
        val index = order.indexOf(char)
        return if (index in tokens.indices) tokens[index] else null
    }

    companion object {
        const val DIGIT_ORDER = "0123456789"
        const val LOWER_ORDER = "qwertyuiopasdfghjklzxcvbnm"
        const val UPPER_ORDER = "QWERTYUIOPASDFGHJKLZXCVBNM"

        /**
         * Tile order of the symbol row, read off the server's own images:
         * `* \ - [ ] { } / ! , < > ? ~ & @ # . : + | ` % ' $ ; ^ " _`
         */
        const val SYMBOL_ORDER = "*\\-[]{}/!<,>?~&@#.:+|`%'\$;^\"_"

        /** Every character a row covers, used for the "no row covers this" diagnostic. */
        val SUPPORTED: String = DIGIT_ORDER + LOWER_ORDER + UPPER_ORDER + SYMBOL_ORDER
    }
}

/**
 * Secure-keyboard encoding:
 *
 * ```
 * submitted = map(each password character through its keyboard row) + "$1$" + uuid
 * ```
 *
 * Verified against SCUT's own client on 2026-10-06. The `security-keyboard` component
 * (`/plat/js/chunk-2d0f0054.fe26bac8.js`) emits `numberKeyboard[tileIndex]` for a tap, and
 * the login chunk (`/plat/js/login.acc9252b.js`) only appends `"$1$" + keyboardUuid`.
 *
 * Two earlier readings of this were both wrong and both cost a device attempt:
 * substituting digits only (this file before 2026-10-05) silently rejects a legal
 * alphanumeric password, and submitting the characters verbatim (2026-10-05) sends a
 * password the server then decodes into nonsense. Both answer `code=8000`.
 *
 * A character outside all four rows cannot be encoded at all, so it is reported rather than
 * replaced or dropped.
 */
object SecureKeyboardEncoder {
    const val SEPARATOR = "$1$"

    fun encode(password: String, keyboard: Keyboard): String? {
        if (password.isEmpty() || keyboard.uuid.isEmpty()) return null
        val out = StringBuilder(password.length + SEPARATOR.length + keyboard.uuid.length)
        for (char in password) {
            val token = keyboard.tokenFor(char) ?: return null
            out.append(token)
        }
        return out.append(SEPARATOR).append(keyboard.uuid).toString()
    }

    /** `{"data":{"uuid":"...","numberKeyboard":"...","lowerLetterKeyboard":"...", …}}` */
    fun parse(json: JSONObject): Keyboard? {
        val data = json.optJSONObject("data") ?: return null
        val uuid = data.optString("uuid").trim()
        if (uuid.isEmpty()) return null
        return Keyboard(
            uuid = uuid,
            numberKeyboard = data.optString("numberKeyboard"),
            lowerLetterKeyboard = data.optString("lowerLetterKeyboard"),
            upperLetterKeyboard = data.optString("upperLetterKeyboard"),
            symbolKeyboard = data.optString("symbolKeyboard")
        )
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
