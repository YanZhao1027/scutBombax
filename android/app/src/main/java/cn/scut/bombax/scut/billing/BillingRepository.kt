package cn.scut.bombax.scut.billing

import cn.scut.bombax.scut.AppError
import cn.scut.bombax.scut.Diag
import cn.scut.bombax.scut.ScutEndpoints
import cn.scut.bombax.scut.ScutException
import cn.scut.bombax.scut.SessionStore
import cn.scut.bombax.scut.Stages
import cn.scut.bombax.scut.auth.AuthRepository
import cn.scut.bombax.scut.auth.Campus
import cn.scut.bombax.scut.auth.TokenState
import cn.scut.bombax.scut.auth.TokenPolicy
import cn.scut.bombax.scut.history.BalanceHistoryStore
import cn.scut.bombax.scut.history.SnapshotSource
import cn.scut.bombax.scut.history.SnapshotWriter
import cn.scut.bombax.scut.network.ScutCookieJar
import cn.scut.bombax.scut.network.ScutHttp
import cn.scut.bombax.scut.network.ScutResponse
import okhttp3.Request
import org.json.JSONObject

/**
 * Balance queries.
 *
 * The same rules as the old implementation are kept, but the sequence is
 * explicit and every hop is identified by a stage name in logcat:
 *
 * - GZIC: three fee items with the `Synjones-Auth` header.
 * - DXC: the redirect chain that ends in a DFYC JSESSIONID session.
 * - A token close to expiry is refreshed before querying, and a query rejected
 *   as unauthenticated refreshes once and retries once. Never a retry loop.
 */
class BillingRepository(
    private val http: ScutHttp,
    private val cookieJar: ScutCookieJar,
    private val session: SessionStore,
    private val authRepository: AuthRepository,
    /** Null when history is unavailable; a record that cannot be written must not fail a query. */
    private val snapshots: SnapshotWriter? = null
) {

    /**
     * Queries both balances, and records the result.
     *
     * This is the **only** place a history row is written. The page updates the screen and the
     * notification from the same reading, and a writer at either of those points would produce two
     * rows per query — which is exactly how a consumption series quietly doubles its own deltas.
     *
     * @param source why the query happened, so the nightly series can be told apart from taps
     */
    fun fetchBills(
        source: SnapshotSource = SnapshotSource.UNKNOWN,
        now: Long = System.currentTimeMillis()
    ): BalanceReading {
        val reading = fetchUncached(now)
        record(reading, source, now)
        return reading
    }

    private fun fetchUncached(now: Long): BalanceReading {
        var state = session.require()
        var refreshed = false

        if (TokenPolicy.needsRefresh(state.expiresAtMillis, now)) {
            state = runCatching { authRepository.refresh(state) }.getOrElse { failure ->
                if (failure is ScutException && failure.error == AppError.NETWORK) throw failure
                session.clear()
                throw ScutException(
                    AppError.REAUTH_REQUIRED,
                    "登录已过期，请重新登录",
                    "preRefresh"
                )
            }
            session.save(state)
            refreshed = true
        }

        return try {
            query(state, now)
        } catch (failure: ScutException) {
            if (failure.error != AppError.REAUTH_REQUIRED || refreshed) throw failure
            // One rebuild attempt, then require interactive reauthentication.
            val rebuilt = runCatching { authRepository.refresh(state) }.getOrElse {
                session.clear()
                throw ScutException(AppError.REAUTH_REQUIRED, "需要重新登录", "postQueryRefresh")
            }
            session.save(rebuilt)
            query(rebuilt, System.currentTimeMillis())
        }
    }

    private fun record(reading: BalanceReading, source: SnapshotSource, now: Long) {
        val writer = snapshots ?: return
        runCatching {
            BalanceHistoryStore.snapshotOf(reading, atMillis = now, source = source)?.let(writer::record)
        }.onFailure {
            // A failed write is a gap in a chart, not a failed query. Reported, never rethrown.
            Diag.warn("stage=history result=write-failed reason=${it.javaClass.simpleName}")
        }
    }

    private fun query(state: TokenState, now: Long): BalanceReading = when (state.campus) {
        Campus.GZIC -> queryGzic(state, now)
        Campus.DXC -> queryDxc(state, now)
    }

    // ---------------------------------------------------------------- GZIC

    private fun gzicUrl(feeItemId: Int) =
        ScutEndpoints.cardUrl(ScutEndpoints.FEE_ITEM_PATH)
            .newBuilder()
            .addQueryParameter("feeitemid", feeItemId.toString())
            .addQueryParameter("synAccessSource", "h5")
            .build()

    /** Sequential, not parallel: three requests per refresh is already chatty. */
    private fun queryGzic(state: TokenState, now: Long): BalanceReading {
        val items = listOf(
            Stages.GZIC_ELECTRIC to ScutEndpoints.FEE_ITEM_ELECTRIC,
            Stages.GZIC_AC to ScutEndpoints.FEE_ITEM_AC,
            Stages.GZIC_WATER to ScutEndpoints.FEE_ITEM_WATER
        )
        val bodies = ArrayList<JSONObject>(items.size)
        for ((stage, id) in items) {
            val response = http.send(
                stage,
                Request.Builder()
                    .url(gzicUrl(id))
                    .header("Synjones-Auth", "bearer ${state.accessToken}")
                    .get()
                    .build()
            )
            bodies.add(requireJson(response, stage))
        }
        val reading = GzicParser.parse(bodies[0], bodies[1], bodies[2], now)
        Diag.event(
            "stage=gzic result=ok room=present electric=${reading.electric != null} " +
                "ac=${reading.ac != null} water=${reading.water != null}"
        )
        return reading
    }

    // ----------------------------------------------------------------- DXC

    private fun cookieHeader(vararg pairs: Pair<String, String?>): String? =
        pairs.filter { !it.second.isNullOrEmpty() }
            .joinToString("; ") { "${it.first}=${it.second}" }
            .takeIf { it.isNotEmpty() }

    private fun expectStatus(response: ScutResponse, expected: Int, stage: String) {
        if (response.status == 401 || response.status == 403) {
            throw ScutException(
                AppError.REAUTH_REQUIRED,
                "需要重新登录",
                "$stage/${response.status}"
            )
        }
        if (response.status != expected) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "$stage 期望 $expected，实际 ${response.status}",
                "$stage/${response.status}"
            )
        }
    }

    private fun follow(response: ScutResponse, base: okhttp3.HttpUrl, stage: String): okhttp3.HttpUrl {
        val url = DxcParser.resolveRedirect(response.location, base, stage)
        Diag.event("stage=$stage hop host=${url.host} path=${url.encodedPath}")
        return url
    }

    /**
     * DXC needs a DFYC session, and that session is established by walking the SSO chain.
     *
     * The chain is only good once: while the school still holds the DFYC session it created,
     * `thirdLogin` short-circuits to the DFYC index page instead of bouncing back through
     * `/berserker-auth/oauth/authorize`, so a second walk of the same session fails on the
     * `authorize` hop with "expected 302, got 200" (observed on a device on 2026-10-07, which
     * is also what a 5-minute foreground timer hits on its first tick after login). So:
     * reuse the session, and rebuild it only when the reuse is refused — once, never in a loop.
     */
    private fun queryDxc(state: TokenState, now: Long): BalanceReading {
        val held = state.dxcJsession
        if (held.isNotBlank()) {
            try {
                return readDxcBalances(held, now)
            } catch (stale: DxcSessionStale) {
                // The card token is still fine; only the缴费 session died. Rebuild it once and
                // do not surface this as an outage.
                Diag.warn("stage=dxc result=session-stale detail=${stale.detail}")
            }
        }
        val established = establishDxcSession(state)
        session.save(state.copy(dxcJsession = established))
        return try {
            readDxcBalances(established, now)
        } catch (stale: DxcSessionStale) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "缴费系统持续拒绝新会话，请稍后重试或重新登录",
                "dxc/rebuild-failed/${stale.detail}"
            )
        }
    }

    /** A DFYC read that says "this session is gone"; never escapes the class. */
    private class DxcSessionStale(val detail: String) : Exception(detail)

    /** Walks the SSO chain and returns the DFYC `JSESSIONID` it leaves behind. */
    private fun establishDxcSession(state: TokenState): String {
        val startUrl = ScutEndpoints.cardUrl(ScutEndpoints.REDIRECT_PATH)
            .newBuilder()
            .addQueryParameter("appId", "360")
            .addQueryParameter("loginFrom", "h5")
            .addQueryParameter("synAccessSource", "h5")
            .addQueryParameter("synjones-auth", state.accessToken)
            .addQueryParameter("type", "app")
            .build()

        val entryCookies = cookieHeader(
            "TGC" to state.tgc,
            "error_times" to "0",
            "locSession" to state.locSession
        )
        val redirect = http.send(
            Stages.DXC_REDIRECT,
            Request.Builder().url(startUrl).applyHeader("Cookie", entryCookies).get().build()
        )
        expectStatus(redirect, 302, Stages.DXC_REDIRECT)
        val thirdLoginUrl = follow(redirect, startUrl, Stages.DXC_REDIRECT)

        val thirdLoginCookies = cookieHeader(
            "TGC" to state.tgc,
            "locSession" to state.locSession,
            "error_times" to "0"
        )
        val thirdLogin = http.send(
            Stages.DXC_THIRD_LOGIN,
            Request.Builder().url(thirdLoginUrl).applyHeader("Cookie", thirdLoginCookies).get().build()
        )
        expectStatus(thirdLogin, 302, Stages.DXC_THIRD_LOGIN)
        val jsessionid = thirdLogin.cookiePairs["JSESSIONID"] ?: cookieJar.value("JSESSIONID")
        if (jsessionid.isNullOrEmpty()) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "thirdLogin 未下发 JSESSIONID",
                "${Stages.DXC_THIRD_LOGIN}/cookies=${thirdLogin.cookieNames.joinToString(",")}"
            )
        }
        Diag.event("stage=${Stages.DXC_THIRD_LOGIN} jsessionid=obtained")

        val hop = follow(thirdLogin, thirdLoginUrl, Stages.DXC_THIRD_LOGIN)
        if (DxcParser.landsOnIndex(hop)) {
            // The school already holds a live DFYC session for this user: the handshake is
            // finished, so it sends us to the landing page instead of through /oauth/authorize.
            Diag.event("stage=${Stages.DXC_THIRD_LOGIN} result=already-established")
            return jsessionid
        }

        val ssoCookies = cookieHeader(
            "JSESSIONID" to jsessionid,
            "TGC" to state.tgc,
            "locSession" to state.locSession,
            "error_times" to "0"
        )
        val authorize = http.send(
            Stages.DXC_AUTHORIZE,
            Request.Builder().url(hop).applyHeader("Cookie", ssoCookies).get().build()
        )
        expectStatus(authorize, 302, Stages.DXC_AUTHORIZE)

        val getCodeUrl = follow(authorize, hop, Stages.DXC_AUTHORIZE)
        val getCode = http.send(
            Stages.DXC_GET_CODE,
            Request.Builder().url(getCodeUrl).applyHeader("Cookie", ssoCookies).get().build()
        )
        expectStatus(getCode, 302, Stages.DXC_GET_CODE)
        DxcParser.isIndexPage(getCode.location, Stages.DXC_GET_CODE)
        Diag.event("stage=${Stages.DXC_GET_CODE} result=session-established")
        return jsessionid
    }

    /** The three DFYC reads, with nothing but the session cookie they need. */
    private fun readDxcBalances(jsessionid: String, now: Long): BalanceReading {
        val dfcCookies = cookieHeader("JSESSIONID" to jsessionid)
        val userInfo = http.send(
            Stages.DXC_USER_INFO,
            Request.Builder()
                .url(ScutEndpoints.dfycUrl(ScutEndpoints.DFYC_USER_INFO_PATH))
                .applyHeader("Cookie", dfcCookies)
                .get()
                .build()
        )
        refuseStaleSession(userInfo, Stages.DXC_USER_INFO)
        val userInfoJson = DxcParser.requireOk(requireJson(userInfo, Stages.DXC_USER_INFO), Stages.DXC_USER_INFO)
        val room = DxcParser.roomName(userInfoJson)
            ?: throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "DFYC 未返回房间",
                "${Stages.DXC_USER_INFO}/room"
            )

        val ammeter = http.send(
            Stages.DXC_AMMETER,
            Request.Builder()
                .url(
                    ScutEndpoints.dfycUrl(ScutEndpoints.DFYC_AMMETER_PATH)
                        .newBuilder()
                        .addQueryParameter("type", "1")
                        .build()
                )
                .applyHeader("Cookie", dfcCookies)
                .get()
                .build()
        )
        refuseStaleSession(ammeter, Stages.DXC_AMMETER)
        val ammeterJson = DxcParser.requireOk(requireJson(ammeter, Stages.DXC_AMMETER), Stages.DXC_AMMETER)

        val water = http.send(
            Stages.DXC_WATER,
            Request.Builder()
                .url(
                    ScutEndpoints.dfycUrl(ScutEndpoints.DFYC_WATER_PATH)
                        .newBuilder()
                        .addQueryParameter("type", "3")
                        .addQueryParameter("systemType", "1")
                        .build()
                )
                .applyHeader("Cookie", dfcCookies)
                .get()
                .build()
        )
        refuseStaleSession(water, Stages.DXC_WATER)
        val waterJson = DxcParser.requireOk(requireJson(water, Stages.DXC_WATER), Stages.DXC_WATER)

        val electric = DxcParser.money(ammeterJson)
        val waterValue = DxcParser.money(waterJson)
        if (electric == null || waterValue == null) {
            throw ScutException(
                AppError.PROTOCOL_CHANGED,
                "DFYC 余额字段无法解析",
                "${Stages.DXC_AMMETER}=${electric != null} ${Stages.DXC_WATER}=${waterValue != null}"
            )
        }
        // Field names only, never values: this is the probe that will settle whether the
        // number we read is 元 or 度 (see DxcParser.resultKeys).
        Diag.event(
            "stage=dxc result=ok room=present electric=true water=true ac=none " +
                "ammeterKeys=${DxcParser.resultKeys(ammeterJson)} " +
                "waterKeys=${DxcParser.resultKeys(waterJson)}"
        )
        return BalanceReading(
            campus = "DXC",
            room = room,
            electric = electric,
            water = waterValue,
            ac = null,
            // "元" is USER_VERIFIED, not RUNTIME_VERIFIED: the DFYC answer carries no unit text at
            // all — `resultObject.leftMoney` is the only quantity field — and the user confirmed
            // against the school's own page on 2026-10-08 that this number is money, not kWh.
            // A kWh figure is a different measure and is not read here at all.
            electricText = "元",
            // Water has not been checked the same way, so it keeps the neutral label rather than
            // inheriting a unit because the item next to it happens to have one.
            waterText = "平台返回余额",
            acText = "大学城校区无空调费数据",
            updatedAtMillis = now
        )
    }

    // ------------------------------------------------------------- shared

    /**
     * Turns a DFYC answer that means "session gone" into [DxcSessionStale] before the generic
     * JSON check can report it as an upstream outage. Only the destination host and path of the
     * redirect are recorded, never its query — the school puts tokens in those.
     */
    private fun refuseStaleSession(response: ScutResponse, stage: String) {
        if (!DxcSession.isStale(response.status)) return
        val target = response.location?.substringBefore('?')?.takeIf { it.isNotBlank() } ?: "-"
        // scrub() as a second line of defence: a redirect target is allowed in a log line,
        // an embedded credential is not.
        throw DxcSessionStale(Diag.scrub("$stage/${response.status} target=$target"))
    }

    private fun requireJson(response: ScutResponse, stage: String): JSONObject {
        if (response.status == 401 || response.status == 403) {
            throw ScutException(AppError.REAUTH_REQUIRED, "需要重新登录", "$stage/${response.status}")
        }
        if (response.status !in 200..299) {
            throw ScutException(AppError.UPSTREAM_UNAVAILABLE, "上游暂不可用", "$stage/${response.status}")
        }
        return response.json ?: throw ScutException(
            AppError.PROTOCOL_CHANGED,
            "$stage 返回的不是 JSON",
            "$stage/json"
        )
    }

    private fun Request.Builder.applyHeader(name: String, value: String?): Request.Builder =
        if (value.isNullOrEmpty()) this else this.header(name, value)
}
