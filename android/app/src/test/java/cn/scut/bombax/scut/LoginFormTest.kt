package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.LoginForm
import cn.scut.bombax.scut.auth.LoginType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The wire field names are protocol surface, so they are pinned here rather than trusted to a
 * comment. Each expected value is the spelling used by SCUT's own login chunk, read from
 * `/plat/js/login.acc9252b.js` on 2026-10-05.
 */
class LoginFormTest {

    private fun names(form: okhttp3.FormBody): Map<String, String> =
        (0 until form.size).associate { form.name(it) to form.value(it) }

    private fun password(
        loginType: LoginType,
        captchaKey: String? = null,
        captchaCode: String? = null
    ) = names(LoginForm.passwordForm("u", "p", captchaKey, captchaCode, loginType))

    @Test
    fun `password grant sends the fields the official client sends`() {
        val fields = names(
            LoginForm.passwordForm("2021010100001", "hunter2\$1\$uuid", null, null, LoginType.SNO)
        )
        assertEquals("password", fields["grant_type"])
        assertEquals("all", fields["scope"])
        assertEquals("sno", fields["logintype"])
        assertEquals("h5", fields["device_token"])
        assertEquals("h5", fields["synAccessSource"])
        assertEquals("hunter2\$1\$uuid", fields["password"])
        assertEquals("2021010100001", fields["username"])
    }

    @Test
    fun `each login type sends its own frontInfo key`() {
        // card and sno are different account namespaces and a mismatch looks like a wrong
        // password, so neither may be substituted for the other.
        assertEquals("sno", password(LoginType.SNO)["logintype"])
        assertEquals("card", password(LoginType.CARD)["logintype"])
        assertEquals("sno", LoginType.SNO.wire)
        assertEquals("card", LoginType.CARD.wire)
    }

    @Test
    fun `a refresh replays the type that obtained the token`() {
        assertEquals("sno", names(LoginForm.refreshForm("rt", LoginType.SNO))["logintype"])
        assertEquals("card", names(LoginForm.refreshForm("rt", LoginType.CARD))["logintype"])
    }

    @Test
    fun `sends loginFrom, never loginForm`() {
        // The old repo spelled this loginForm; the school's client uses loginFrom.
        val fields = password(LoginType.SNO)
        assertEquals("h5", fields["loginFrom"])
        assertFalse(fields.containsKey("loginForm"))
        val refresh = names(LoginForm.refreshForm("rt", LoginType.SNO))
        assertEquals("h5", refresh["loginFrom"])
        assertFalse(refresh.containsKey("loginForm"))
    }

    @Test
    fun `captcha pair is sent together or not at all`() {
        val withBoth = password(LoginType.SNO, "cap-key", "ab3d")
        assertEquals("ab3d", withBoth[LoginForm.FIELD_CAPTCHA_CODE])
        assertEquals("cap-key", withBoth[LoginForm.FIELD_CAPTCHA_KEY])

        val withoutCode = password(LoginType.SNO, "cap-key", null)
        assertFalse(withoutCode.containsKey(LoginForm.FIELD_CAPTCHA_CODE))
        assertFalse(withoutCode.containsKey(LoginForm.FIELD_CAPTCHA_KEY))
    }

    @Test
    fun `refresh grant keeps the token out of the field list it replays`() {
        val fields = names(LoginForm.refreshForm("rotating-token", LoginType.SNO))
        assertEquals("refresh_token", fields["grant_type"])
        assertEquals("rotating-token", fields["refresh_token"])
        assertFalse(fields.containsKey("password"))
        assertTrue(fields.containsKey("logintype"))
    }

    @Test
    fun `an unknown login type is refused rather than defaulted`() {
        assertEquals(LoginType.SNO, LoginType.from("sno"))
        assertEquals(LoginType.CARD, LoginType.from(" card "))
        assertNull(LoginType.from("verificationCode"))
        assertNull(LoginType.from(null))
        assertNull(LoginType.from(""))
    }
}
