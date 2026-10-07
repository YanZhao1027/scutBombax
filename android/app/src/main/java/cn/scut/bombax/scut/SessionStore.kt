package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.LoginType
import cn.scut.bombax.scut.auth.TokenState
import cn.scut.bombax.scut.auth.TokenPolicy
import org.json.JSONObject

/**
 * What the WebView is allowed to know about the session. Deliberately has no
 * token, no cookie and no identity fields beyond the display name.
 */
data class SessionPublic(
    val authenticated: Boolean,
    val campus: Campus?,
    val name: String,
    val expiresIn: Long,
    val canRefresh: Boolean
) {
    companion object {
        fun anonymous(): SessionPublic =
            SessionPublic(false, null, "", -1, false)
    }
}

/**
 * The on-disk shape of a [TokenState].
 *
 * The field list is deliberately explicit — a data class reflection helper would silently
 * start persisting any new field, and the whole point of this file is that the card password
 * is not in it. `TokenState` has no password field to begin with; `SessionCodecTest` pins the
 * exact key set so a future field cannot smuggle one in.
 */
object SessionCodec {

    fun toJson(state: TokenState): String = JSONObject()
        .put("accessToken", state.accessToken)
        .put("refreshToken", state.refreshToken)
        .put("expiresAtMillis", state.expiresAtMillis)
        .put("tokenType", state.tokenType)
        .put("tgc", state.tgc)
        .put("locSession", state.locSession)
        .put("name", state.name)
        .put("sno", state.sno)
        .put("campus", state.campus.name)
        .put("loginType", state.loginType.wire)
        .put("dxcJsession", state.dxcJsession)
        .toString()

    /** Null for anything that is not a complete, sane session record. */
    fun fromJson(text: String): TokenState? = runCatching {
        val json = JSONObject(text)
        val accessToken = json.getString("accessToken")
        if (accessToken.isBlank()) return null
        val campus = runCatching { Campus.valueOf(json.optString("campus")) }.getOrNull() ?: return null
        val loginType = LoginType.from(json.optString("loginType")) ?: return null
        TokenState(
            accessToken = accessToken,
            refreshToken = json.optString("refreshToken"),
            expiresAtMillis = json.getLong("expiresAtMillis"),
            tokenType = json.optString("tokenType").ifBlank { "bearer" },
            tgc = json.optString("tgc"),
            locSession = json.optString("locSession"),
            name = json.optString("name"),
            sno = json.optString("sno"),
            campus = campus,
            loginType = loginType,
            dxcJsession = json.optString("dxcJsession")
        )
    }.getOrNull()
}

/**
 * Owns the live session, and — since 2026-10-07 — an optional Keystore-encrypted copy of it.
 *
 * The memory-only behaviour is still the default: without [attachDisk] this is exactly the
 * store that shipped through the first device verification, and every unit test uses that
 * path. With a disk attached, a saved session survives a process death (the school's access
 * token is valid for 70 days, so losing it to a restart was pure self-inflicted friction), an
 * expired record is dropped on arrival, and [clear] — which is what "清除登录状态" calls —
 * removes both copies.
 *
 * What is never written: the card password, the captcha answer, the keyboard uuid.
 */
class SessionStore {

    @Volatile
    private var current: TokenState? = null

    @Volatile
    private var disk: FileSessionStore? = null

    private var restored = false

    /** Safe to call at any time; a store that cannot be built just leaves memory-only behaviour. */
    fun attachDisk(store: FileSessionStore) {
        if (disk == null) disk = store
    }

    fun save(state: TokenState) {
        current = state
        restored = true
        disk?.save(SessionCodec.toJson(state))?.let {
            Diag.warn("stage=session result=not-persisted reason=$it")
        }
    }

    fun peek(): TokenState? {
        current?.let { return it }
        if (restored) return null
        return restoreFromDisk()
    }

    fun require(): TokenState =
        peek() ?: throw ScutException(AppError.NO_SESSION, "尚未登录", "session/empty")

    fun clear() {
        // Drop the reference so the token strings become collectable, then remove the copy.
        current = null
        restored = true
        disk?.clear()
    }

    /**
     * Forgets the session in memory but keeps the stored copy, so the next start can restore it.
     *
     * This is what the plugin calls when its Activity is destroyed. Routing that through
     * [clear] would delete the file we just wrote, and pressing Back would log the user out —
     * which is precisely the behaviour this feature exists to remove.
     */
    fun dropMemory() {
        current = null
        // The next read is allowed to come back from disk — that is the point of keeping it.
        restored = false
    }

    fun public(now: Long): SessionPublic {
        val state = peek() ?: return SessionPublic.anonymous()
        return SessionPublic(
            authenticated = true,
            campus = state.campus,
            name = state.name,
            expiresIn = TokenPolicy.secondsLeft(state.expiresAtMillis, now),
            canRefresh = state.refreshToken.isNotBlank()
        )
    }

    fun needsRefresh(now: Long): Boolean {
        val state = peek() ?: return false
        return TokenPolicy.needsRefresh(state.expiresAtMillis, now)
    }

    private fun restoreFromDisk(): TokenState? {
        restored = true
        val store = disk ?: return null
        val state = store.load()?.let { SessionCodec.fromJson(it) }
        if (state == null) return null
        val now = System.currentTimeMillis()
        if (TokenPolicy.isExpired(state.expiresAtMillis, now)) {
            Diag.warn("stage=session result=discarded reason=expired")
            clear()
            return null
        }
        current = state
        Diag.event(
            "stage=session result=restored campus=${state.campus.name} " +
                "refreshToken=${if (state.refreshToken.isBlank()) "absent" else "present"} " +
                "expiresIn=${TokenPolicy.secondsLeft(state.expiresAtMillis, now)}s"
        )
        return state
    }
}
