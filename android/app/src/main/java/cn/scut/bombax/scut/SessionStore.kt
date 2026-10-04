package cn.scut.bombax.scut

import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.TokenState
import cn.scut.bombax.scut.auth.TokenPolicy

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
 * In-memory session owner (Phase 6 starts with memory only).
 *
 * Nothing is written to disk here. When persistence is added it must be
 * Keystore-backed and must still exclude the card password.
 */
class SessionStore {

    @Volatile
    private var current: TokenState? = null

    fun save(state: TokenState) {
        current = state
    }

    fun peek(): TokenState? = current

    fun require(): TokenState =
        current ?: throw ScutException(AppError.NO_SESSION, "尚未登录", "session/empty")

    fun clear() {
        // Drop the reference so the token strings become collectable.
        current = null
    }

    fun public(now: Long): SessionPublic {
        val state = current ?: return SessionPublic.anonymous()
        return SessionPublic(
            authenticated = true,
            campus = state.campus,
            name = state.name,
            expiresIn = TokenPolicy.secondsLeft(state.expiresAtMillis, now),
            canRefresh = state.refreshToken.isNotBlank()
        )
    }

    fun needsRefresh(now: Long): Boolean {
        val state = current ?: return false
        return TokenPolicy.needsRefresh(state.expiresAtMillis, now)
    }
}
