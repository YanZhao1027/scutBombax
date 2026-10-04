# Handoff report — 2026-10-05

Scope of this report: what `AGENTS.md` asked for, what exists now, and what has **not**
been verified. The app is implemented, builds cleanly, installs and runs on a physical
phone. The headline blocker has moved: it is no longer "no device", it is that the
school's card host refuses the phone's current network location (§"Network location"
below), so no credential-bearing SCUT flow has run yet.

## AGENTS.md handoff items

| Required item | Result | Grade |
| --- | --- | --- |
| commit SHA | `6d5a031` implementation, `1ef80d3` + `cd8f62a` docs and checks, `29876cb` bridge fix, `9a0dc76` device findings and `CAMPUS_NETWORK_REQUIRED` (branch `main`; this report's own edits land in the commit that follows) | RUNTIME_VERIFIED |
| APK path | `android/app/build/outputs/apk/debug/app-debug.apk` — 4,779,933 bytes, sha256 `70f3d2fea48d4278ac80d121bb31ad5d99bb630c10b21adcc98089c658088358` (clean `testDebugUnitTest assembleDebug`); installed and launched on the phone | RUNTIME_VERIFIED |
| tested Android version / device | Android 14 (API 34), Redmi K50, arm64-v8a, 1440×3200 @ 560dpi. `minSdk 24` / `targetSdk 36` remain the build's declaration; only API 34 has executed it | RUNTIME_VERIFIED (one device) |
| bridge + UI on device | `plugin=ScutApi ready api=34 release=14`, `health()` returned over the bridge, full Chinese UI rendered without layout breakage, and a native failure reached the screen as `CAMPUS_NETWORK_REQUIRED [captcha/403]: …` | RUNTIME_VERIFIED |
| nothing session-shaped persisted | `run-as` shows only WebView internals in `shared_prefs`, 0 `scut` rows in the WebView cookie DB, no session file | RUNTIME_VERIFIED |
| captcha behavior | endpoint + `{key, image}` shape confirmed from the host (HTTP 200, 32-hex key, `data:image/png;base64,` prefix). Whether SCUT **enforces** captcha at login is unproven, and the device could not fetch one (403, see below) | RUNTIME_VERIFIED (shape) / DEVICE_PENDING (enforcement) |
| network location | `ecardwxnew.scut.edu.cn` answers `403` + "校外可通过学校SSLVPN访问本网站" for the phone's source address, over IPv4 and IPv6, for `curl` and for OkHttp alike, while `dfyc.utc.scut.edu.cn` answers `200` on the same connection | RUNTIME_VERIFIED |
| exact verified captcha request field names | **not verified.** The app sends `captcha_header_code` / `captcha_header_key`; these come from the old `cf-web` branch and sibling Synjones deployments, i.e. HYPOTHESIS | HYPOTHESIS |
| login result | never attempted with credentials. The one token request made from the host used **empty** username/password and returned `{"status":400,"message":"用户名或密码错误","code":8000,"data":null}` | RUNTIME_VERIFIED (error path) / NOT_TESTED (success) |
| refresh_token result | unverified. `grant_type=refresh_token` is implemented standards-style and fails closed to `REAUTH_REQUIRED`; whether SCUT issues a refresh token at all is unknown | NOT_TESTED |
| GZIC result | unverified. Requests, header (`Synjones-Auth: bearer …`) and the `code/msg/map` parser are written and unit-tested against the old implementation's shapes. The card host is the one GZIC needs, so this is the blocked path | NOT_TESTED |
| DXC result | unverified. Manual redirect chain implemented (`redirect → thirdLogin → authorize → getCode → userinfo/ammeterBalance/waterBalance`). `dfyc` itself is reachable from the phone, but the chain starts on the card host | NOT_TESTED |
| foreground refresh result | `@capacitor/app` `isActive` events were observed on the device (`{"isActive":true}` in the bridge log), but the timer semantics are verified only by 15 vitest state-machine cases; no logged-in refresh has run | NOT_TESTED (with a session) |
| remaining protocol uncertainty | see below | — |

Service codes `8002` / `8003` as captcha signals remain **HYPOTHESIS** for the same reason;
they are marked as such in `docs/PROTOCOL.md` and in a code comment on
`LoginErrorClassifier.captchaServiceCodes`. They cannot be closed from a network location
the card host refuses, because the captcha request itself never gets past the edge.

## What is actually proven

- `pnpm build` (`tsc --noEmit && vite build`), `pnpm test` (15 vitest),
  `pnpm check:dom`, and `./gradlew clean testDebugUnitTest assembleDebug` (63 tests,
  BUILD SUCCESSFUL) all pass on this host, with no Android Studio and no IDE.
  `pnpm native:test` / `pnpm apk` now route through `scripts/with-jdk.sh`, which finds a
  JDK with `javac` instead of relying on an exported `JAVA_HOME`.
- The APK installs (`adb install -r` → Success) and starts on Android 14, and the bridge
  is live in both directions: a native classification reaches the WebView and is printed
  verbatim on screen.
- Nothing sensitive is persisted, checked from the app's own data directory:
  `run-as cn.scut.bombax ls -laR` shows only `files/profileInstalled` and three WebView
  preference files under `shared_prefs`, the WebView cookie store contains **0** cookie
  rows in total (read with sqlite3 after `run-as … cat`), and there is no session file.
- The §10 leakage audit was run against a real 403 exchange: the credential/token/cookie
  grep, the address-echo grep and the TLS/proxy source grep all printed nothing. The
  school's block page carries the caller's public IP, so that third grep matters —
  `NetworkAccess` keeps a boolean and discards the body.
- The APK contains the compiled plugin, the web assets and the `bridgeVersion` /
  `electricUnit` keys that `src/types.ts` expects (checked by unpacking and `strings`).
- Protocol shapes recorded as RUNTIME_VERIFIED came only from **credential-free** probes of
  the captcha and secure-keyboard endpoints plus one empty-credential token POST. No guess
  at the user's credentials was ever submitted, and no login was attempted to chase a
  service code.
- Redaction is enforced in one place (`Diag.kt`) and covered by `DiagnosticsScrubTest`.
  `grep` over `android/app/src/main` for `X509TrustManager|sslSocketFactory|hostnameVerifier|proxy(`
  returns nothing: TLS validation is OkHttp's default, no proxy, no WAF-bypass mechanism.
  Query strings are never logged, which matters because the DXC chain puts a token in one.

## Decisions the next reader should know

1. **Session state is memory-only.** AGENTS.md Phase 6 asks for in-memory first and
   persistence "if desired". Keystore-backed persistence was deliberately not added: the
   usual `androidx.security:security-crypto` is not a comfortably maintained choice, and
   with no device available it could not be validated. Consequence: a process restart logs
   the user out. Rationale in `docs/ARCHITECTURE.md`.
2. **One public credential is in source**: `ScutEndpoints.BASIC_AUTH`, the base64 public
   client id/secret embedded in the school's own H5 page. It is not a user credential and
   the OAuth grant does not work without it, but it is the only secret-shaped literal in
   the repository — flagged here rather than buried, since AGENTS.md says never commit
   credentials.
3. **Two upstream envelopes are kept apart on purpose**: auth returns
   `status/message/code/data`, fee items return `code/msg/map`. Merging them would silently
   misclassify failures.
4. Capacitor nests rejection payloads as `data.detail`, so `bridge.ts` reads it there. A
   field added at top level would vanish in JavaScript — this bug was found and fixed.
5. `BUSY` is only produced when the io executor has shut down; concurrency is otherwise
   handled by the UI `querying` guard plus single-thread serialization.
6. `ScutHttp.send` classifies exactly one response shape itself: the school's off-campus
   `403` page becomes `CAMPUS_NETWORK_REQUIRED` and its body is dropped, because that page
   echoes the caller's public IP (identifying), means the same thing at every stage, and
   would otherwise be reported as an upstream outage. Every other non-2xx answer still goes
   back to the caller untouched for stage-specific classification.

## To close the remaining phases

A phone is attached and authorized. What is missing is a **network location the school
accepts**: the card host answers `403` for the phone's current uplink. Either connect the
phone to campus Wi-Fi or to the school's SSL VPN client, or attach it to a host whose
egress the school accepts. Then, from the repo root:

```bash
./scripts/check-env.sh           # should report "1 authorized device(s) attached"
pnpm apk && pnpm install:device
adb="$HOME/Android/Sdk/platform-tools/adb"
$adb shell curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' \
  'https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5'   # 200 = go
$adb logcat -c && $adb logcat -s ScutBombax:V
```

and work through [`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md) sections 1-10 with the
user's own card password. Section 2 (a deliberately wrong captcha) is the one that settles
the field names and service codes; the rest settles GZIC/DXC semantics and the foreground
rules. Nothing there should be marked working until its log lines appear.

Deliberately not done: routing the phone's traffic through this workstation's tunnel to
make its source address acceptable. That is an access-control bypass of the school's own
restriction, AGENTS.md forbids adding proxies or bypass mechanisms, and the app must stay
free of any such setting. The sanctioned off-campus route is the school's SSL VPN, run on
the phone by the user.

## Remaining protocol uncertainty

- captcha enforcement policy (always required? after N failures? per campus?)
- the accepted captcha form field names, and the service codes for each captcha state
- whether `expires_in` is seconds or millis in practice (guarded by `ExpiryParser`), and
  whether a refresh token is issued, rotates, or is even accepted by `/oauth/token`
- whether `TGC` and `locSession` are both required for the DXC chain, and whether the
  `getCode` hop still terminates on `/sdms-weixin-pay-sp/newWeixin/index.html`
- the exact unit semantics of each GZIC fee item string (yuan vs kWh vs cubic metres), and
  whether fee item `2` exists for every dormitory
- whether any SCUT logout endpoint exists — the app only clears client-side state, and does
  not invent an endpoint
