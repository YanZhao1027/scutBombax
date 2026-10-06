package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.CaptchaParser
import cn.scut.bombax.scut.auth.Keyboard
import cn.scut.bombax.scut.auth.SecureKeyboardEncoder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptchaAndKeyboardTest {

    @Test
    fun `parses the documented captcha shape`() {
        val json = JSONObject(
            """{"key":"abc123","image":"data:image/png;base64,iVBORw0KGgo="}"""
        )
        val challenge = CaptchaParser.parse(json)!!
        assertEquals("abc123", challenge.key)
        assertEquals("data:image/png;base64,iVBORw0KGgo=", challenge.image)
    }

    @Test
    fun `adds a data url prefix when the image is bare base64`() {
        val json = JSONObject("""{"key":"k","image":"iVBORw0KGgo="}""")
        val challenge = CaptchaParser.parse(json)!!
        assertEquals("data:image/png;base64,iVBORw0KGgo=", challenge.image)
    }

    @Test
    fun `rejects captcha payloads that are missing a part`() {
        assertNull(CaptchaParser.parse(JSONObject("""{"key":"k"}""")))
        assertNull(CaptchaParser.parse(JSONObject("""{"image":"x"}""")))
        assertNull(CaptchaParser.parse(JSONObject("""{"key":"","image":"x"}""")))
        assertNull(CaptchaParser.parse(null))
    }

    /**
     * Synthetic rows, each as long as the layout it stands for, so every expected token
     * below is traceable to a tile index:
     *
     * ```text
     * digits    0->a 1->b … 9->j
     * lowercase q->K w->L … a->U … m->0   (QWERTY tile order)
     * uppercase Q->z W->y … Z->g … M->a   (QWERTY tile order)
     * symbols   *->0 \->1 … _->S           (the order the server's images show)
     * ```
     */
    private val keyboard = Keyboard(
        uuid = "k-1",
        numberKeyboard = "abcdefghij",
        lowerLetterKeyboard = "KLMNOPQRSTUVWXYZ1234567890",
        upperLetterKeyboard = "zyxwvutsrqponmlkjihgfedcba",
        symbolKeyboard = "0123456789ABCDEFGHIJKLMNOPQRS"
    )

    /** The submitted password with the "$1$uuid" tail removed, so assertions read clearly. */
    private fun tokens(password: String, on: Keyboard = keyboard): String? =
        SecureKeyboardEncoder.encode(password, on)?.removeSuffix(
            SecureKeyboardEncoder.SEPARATOR + on.uuid
        )

    @Test
    fun `the four layouts are the fixed orders read off the server's tile images`() {
        assertEquals("0123456789", Keyboard.DIGIT_ORDER)
        assertEquals("qwertyuiopasdfghjklzxcvbnm", Keyboard.LOWER_ORDER)
        assertEquals("QWERTYUIOPASDFGHJKLZXCVBNM", Keyboard.UPPER_ORDER)
        assertEquals("*\\-[]{}/!<,>?~&@#.:+|`%'\$;^\"_", Keyboard.SYMBOL_ORDER)
        assertEquals(
            "each row must cover its layout exactly once",
            listOf(10, 26, 26, 29),
            listOf(
                Keyboard.DIGIT_ORDER.length,
                Keyboard.LOWER_ORDER.length,
                Keyboard.UPPER_ORDER.length,
                Keyboard.SYMBOL_ORDER.length
            )
        )
        assertEquals(Keyboard.SYMBOL_ORDER.toSet().size, Keyboard.SYMBOL_ORDER.length)
    }

    @Test
    fun `digits map to the number row by tile index`() {
        assertEquals("abcdefghij", tokens("0123456789"))
    }

    @Test
    fun `lowercase maps through the QWERTY row, not alphabetical order`() {
        // q is tile 0, a is tile 10 and m is tile 25: an alphabetical lookup is wrong here.
        assertEquals("KUT04", tokens("qapmz"))
    }

    @Test
    fun `uppercase maps through its own row`() {
        assertEquals("zyg", tokens("QWZ"))
    }

    @Test
    fun `symbols map through the symbol row`() {
        assertEquals("0S", tokens("*_"))
        assertEquals("O", tokens("\$"))
    }

    @Test
    fun `a mixed password keeps every character in its own row`() {
        assertEquals("UbOg", tokens("a1\$Z"))
    }

    @Test
    fun `appends the separator and the uuid of the session that produced the rows`() {
        assertEquals(
            "b" + SecureKeyboardEncoder.SEPARATOR + "k-1",
            SecureKeyboardEncoder.encode("1", keyboard)
        )
    }

    @Test
    fun `refuses a character the keyboard has no tile for`() {
        // The school's keyboard has no space and no non-ASCII glyph, so neither may be
        // dropped or replaced with something the user did not type.
        assertNull(SecureKeyboardEncoder.encode("a b", keyboard))
        assertNull(SecureKeyboardEncoder.encode("密码", keyboard))
    }

    @Test
    fun `refuses an empty password or a keyboard without a uuid`() {
        assertNull(SecureKeyboardEncoder.encode("", keyboard))
        assertNull(SecureKeyboardEncoder.encode("1", keyboard.copy(uuid = "")))
    }

    @Test
    fun `a missing row makes its characters unencodable rather than guessed`() {
        val digitsOnly = keyboard.copy(
            lowerLetterKeyboard = "",
            upperLetterKeyboard = "",
            symbolKeyboard = ""
        )
        assertEquals("b", tokens("1", digitsOnly))
        assertNull(SecureKeyboardEncoder.encode("q", digitsOnly))
    }

    @Test
    fun `parses the full keyboard payload`() {
        val json = JSONObject(
            """{"data":{"uuid":"k-9","numberKeyboard":"5432109876",
               "lowerLetterKeyboard":"abcdefghijklmnopqrstuvwxyZ",
               "upperLetterKeyboard":"ZYXWVUTSRQPONMLKJIHGFEDCBA",
               "symbolKeyboard":"aBcDeFgHiJkLmNoPqRsTuVwXyZ012"}}"""
        )
        val parsed = SecureKeyboardEncoder.parse(json)!!
        assertEquals("k-9", parsed.uuid)
        assertEquals('5', parsed.tokenFor('0'))
        assertEquals('a', parsed.tokenFor('q'))
        assertEquals('Z', parsed.tokenFor('Q'))
        assertEquals('a', parsed.tokenFor('*'))
    }

    @Test
    fun `parses a keyboard payload that carries only the number row`() {
        val parsed = SecureKeyboardEncoder.parse(
            JSONObject("""{"data":{"uuid":"k-9","numberKeyboard":"5432109876"}}""")
        )!!
        assertEquals("k-9", parsed.uuid)
        assertNull(parsed.tokenFor('q'))
    }

    @Test
    fun `rejects a keyboard payload without a uuid`() {
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{"data":{}}""")))
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{}""")))
    }
}
