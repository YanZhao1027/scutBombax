package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.ExpiryParser
import cn.scut.bombax.scut.auth.LoginErrorClassifier
import cn.scut.bombax.scut.auth.TokenParser
import cn.scut.bombax.scut.auth.TokenPolicy
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Covers the login failure taxonomy and the expiry maths.
 *
 * The 8002 / 8003 expectations below encode the *hypothesis* inherited from the
 * old implementation. A device trace that shows different codes has to change
 * both the classifier and this test, which is exactly the point of pinning them.
 */
class LoginClassificationTest {

    @Test
    fun `service code 8002 without a captcha answer means captcha required`() {
        val json = JSONObject("""{"code":8002,"message":"验证码错误"}""")
        assertEquals(
            AppError.CAPTCHA_REQUIRED,
            LoginErrorClassifier.classify(json, 400, hadCaptcha = false)
        )
    }

    @Test
    fun `service code 8003 with an answer already given means captcha invalid`() {
        val json = JSONObject("""{"code":"8003","message":"验证码不正确"}""")
        assertEquals(
            AppError.CAPTCHA_INVALID,
            LoginErrorClassifier.classify(json, 400, hadCaptcha = true)
        )
    }

    @Test
    fun `text signals are read as captcha signals`() {
        val json = JSONObject("""{"error":"invalid_grant","error_description":"请输入验证码"}""")
        assertEquals(
            AppError.CAPTCHA_REQUIRED,
            LoginErrorClassifier.classify(json, 400, hadCaptcha = false)
        )
    }

    @Test
    fun `plain bad credentials stay a credential error`() {
        val json = JSONObject("""{"error":"invalid_grant","error_description":"用户名或密码错误"}""")
        assertEquals(
            AppError.INVALID_CREDENTIALS,
            LoginErrorClassifier.classify(json, 401, hadCaptcha = false)
        )
    }

    @Test
    fun `the observed empty-credential response is a credential error`() {
        // RUNTIME_VERIFIED 2026-10-05: a token POST with no credentials answered
        // HTTP 400 with exactly this body, so 8000 is a measured signal rather
        // than an inherited guess. Note the envelope is status/message/code/data,
        // not the code/msg/map shape used by the fee-item API.
        val json = JSONObject("""{"status":400,"message":"用户名或密码错误","code":8000,"data":null}""")
        assertEquals("8000", LoginErrorClassifier.serviceCode(json))
        assertEquals(
            AppError.INVALID_CREDENTIALS,
            LoginErrorClassifier.classify(json, 400, hadCaptcha = false)
        )
        // A credential code behind a server error is still a school outage.
        assertEquals(
            AppError.UPSTREAM_UNAVAILABLE,
            LoginErrorClassifier.classify(json, 503, hadCaptcha = false)
        )
    }

    @Test
    fun `an unrecognised empty body is a protocol change not a wrong password`() {
        assertEquals(
            AppError.PROTOCOL_CHANGED,
            LoginErrorClassifier.classify(JSONObject("""{}"""), 400, hadCaptcha = false)
        )
    }

    @Test
    fun `every error code has its own user-facing line`() {
        for (error in AppError.entries) {
            assertTrue("${error.wire} has no message", error.human().isNotBlank())
        }
        assertEquals("需要输入图形验证码", AppError.CAPTCHA_REQUIRED.human())
        assertEquals("一卡通接口结构已变化", AppError.PROTOCOL_CHANGED.human())
    }

    @Test
    fun `an empty body with a server error is an upstream failure`() {
        assertEquals(
            AppError.UPSTREAM_UNAVAILABLE,
            LoginErrorClassifier.classify(null, 500, hadCaptcha = false)
        )
        assertEquals(
            AppError.INVALID_CREDENTIALS,
            LoginErrorClassifier.classify(JSONObject("""{"error":"invalid_grant"}"""), 400, false)
        )
    }

    @Test
    fun `service code extraction ignores missing fields`() {
        assertEquals("8002", LoginErrorClassifier.serviceCode(JSONObject("""{"code":8002}""")))
        assertEquals(null, LoginErrorClassifier.serviceCode(JSONObject("""{}""")))
        assertEquals(null, LoginErrorClassifier.serviceCode(null))
    }
}

class TokenStateTest {

    private val now = 1_730_000_000_000L

    @Test
    fun `refresh is needed inside the five minute skew window`() {
        val soon = now + 4 * 60 * 1000L
        assertTrue(TokenPolicy.needsRefresh(soon, now))
        assertFalse(TokenPolicy.needsRefresh(now + 6 * 60 * 1000L, now))
    }

    @Test
    fun `expired tokens are clamped to zero seconds left`() {
        assertEquals(0L, TokenPolicy.secondsLeft(now - 10_000L, now))
        assertEquals(120L, TokenPolicy.secondsLeft(now + 120_000L, now))
        assertTrue(TokenPolicy.isExpired(now - 1L, now))
    }

    @Test
    fun `expires_in in seconds becomes a deadline`() {
        assertEquals(now + 7200_000L, ExpiryParser.toDeadlineMillis(7200L, now))
    }

    @Test
    fun `a millisecond timestamp is not multiplied again`() {
        val asMillis = now + 3_600_000L
        assertEquals(asMillis, ExpiryParser.toDeadlineMillis(asMillis, now))
    }

    @Test
    fun `token response parsing keeps refresh token and cookies`() {
        val json = JSONObject(
            """{"access_token":"A","expires_in":7200,"refresh_token":"R","name":"张三","sno":"2021","token_type":"bearer"}"""
        )
        val state = TokenParser.parse(
            json = json,
            status = 200,
            campus = cn.scut.bombax.scut.auth.Campus.GZIC,
            tgc = "T",
            locSession = "L",
            previousRefreshToken = "",
            now = now,
            hadCaptcha = true
        )
        assertEquals("A", state.accessToken)
        assertEquals("R", state.refreshToken)
        assertEquals(now + 7_200_000L, state.expiresAtMillis)
        assertEquals("T", state.tgc)
        assertEquals("L", state.locSession)
        assertEquals("张三", state.name)
    }

    @Test
    fun `a refresh response without a new refresh token reuses the old one`() {
        val json = JSONObject("""{"access_token":"A2","expires_in":3600,"token_type":"bearer"}""")
        val state = TokenParser.parse(
            json = json,
            status = 200,
            campus = cn.scut.bombax.scut.auth.Campus.DXC,
            tgc = "",
            locSession = "",
            previousRefreshToken = "R-old",
            now = now,
            hadCaptcha = false
        )
        assertEquals("R-old", state.refreshToken)
    }

    @Test(expected = ScutException::class)
    fun `a token response without expires_in is a protocol change`() {
        val json = JSONObject("""{"access_token":"A"}""")
        TokenParser.parse(json, 200, cn.scut.bombax.scut.auth.Campus.GZIC, "", "", "", now, false)
    }

    @Test
    fun `a rejected login becomes a classified failure`() {
        val json = JSONObject("""{"code":8002,"message":"验证码"}""")
        var caught: ScutException? = null
        try {
            TokenParser.parse(json, 400, cn.scut.bombax.scut.auth.Campus.GZIC, "", "", "", now, false)
        } catch (failure: ScutException) {
            caught = failure
        }
        assertEquals(AppError.CAPTCHA_REQUIRED, caught?.error)
        assertTrue(caught?.detail?.contains("8002") == true)
    }

    @Test
    fun `public projection never carries a secret`() {
        val store = SessionStore()
        store.save(
            cn.scut.bombax.scut.auth.TokenState(
                accessToken = "SECRET-ACCESS",
                refreshToken = "SECRET-REFRESH",
                expiresAtMillis = now + 60_000L,
                tokenType = "bearer",
                tgc = "SECRET-TGC",
                locSession = "SECRET-LOC",
                name = "李四",
                sno = "20210001",
                campus = cn.scut.bombax.scut.auth.Campus.GZIC
            )
        )
        val public = store.public(now)
        val rendered = listOf(public.authenticated, public.campus?.name, public.name, public.expiresIn, public.canRefresh)
            .toString()
        for (secret in listOf("SECRET-ACCESS", "SECRET-REFRESH", "SECRET-TGC", "SECRET-LOC", "20210001")) {
            assertFalse("public session leaked $secret", rendered.contains(secret))
        }
        assertTrue(public.authenticated)
        assertEquals("李四", public.name)
        assertEquals(60L, public.expiresIn)
        assertTrue(public.canRefresh)
    }

    @Test
    fun `clearing the store yields an anonymous session`() {
        val store = SessionStore()
        store.save(
            cn.scut.bombax.scut.auth.TokenState(
                "A", "R", now + 60_000L, "bearer", "T", "L", "王五", "1",
                cn.scut.bombax.scut.auth.Campus.DXC
            )
        )
        store.clear()
        assertEquals(false, store.public(now).authenticated)
        assertEquals(-1L, store.public(now).expiresIn)
    }
}
