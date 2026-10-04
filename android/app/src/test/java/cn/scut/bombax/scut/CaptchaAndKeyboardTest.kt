package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.CaptchaParser
import cn.scut.bombax.scut.auth.SecureKeyboardEncoder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun `submits the chosen characters plus the keyboard uuid`() {
        // The official component emits numberKeyboard[tileIndex], i.e. the glyph the
        // user tapped, and appends "$1$" + uuid at submit time.
        assertEquals(
            "12345" + SecureKeyboardEncoder.SEPARATOR + "uuid-1",
            SecureKeyboardEncoder.encode("12345", "uuid-1")
        )
    }

    @Test
    fun `never permutes the password through the shuffled layout`() {
        // Regression: an earlier port mapped each digit through the layout, which
        // turned "123" into "876" for a shuffled keyboard and SCUT answered code=8000.
        val shuffledLayout = "9876543210"
        val submitted = SecureKeyboardEncoder.encode("123", "u")
        assertEquals("123" + SecureKeyboardEncoder.SEPARATOR + "u", submitted)
        assertFalse(submitted!!.startsWith(shuffledLayout.take(3)))
    }

    @Test
    fun `passes letters and symbols through untouched`() {
        // frontInfo: passwordRule "a/num/#/leng_8" for the SCUT card login.
        assertEquals(
            "ab12#xy" + SecureKeyboardEncoder.SEPARATOR + "u",
            SecureKeyboardEncoder.encode("ab12#xy", "u")
        )
    }

    @Test
    fun `refuses an empty password or uuid`() {
        assertNull(SecureKeyboardEncoder.encode("", "u"))
        assertNull(SecureKeyboardEncoder.encode("123", ""))
    }

    @Test
    fun `parses the keyboard payload`() {
        val json = JSONObject("""{"data":{"numberKeyboard":"5432109876","uuid":"k-9"}}""")
        val keyboard = SecureKeyboardEncoder.parse(json)!!
        assertEquals("5432109876", keyboard.numberKeyboard)
        assertEquals("k-9", keyboard.uuid)
    }

    @Test
    fun `parses a keyboard payload that carries no layout`() {
        // Only the uuid is needed to encode; the layout is the client's business.
        assertEquals("k-9", SecureKeyboardEncoder.parse(JSONObject("""{"data":{"uuid":"k-9"}}"""))!!.uuid)
    }

    @Test
    fun `rejects a keyboard payload without a uuid`() {
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{"data":{}}""")))
        assertNull(SecureKeyboardEncoder.parse(JSONObject("""{}""")))
    }
}
