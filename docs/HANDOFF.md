# Handoff report — 2026-10-05

Scope of this report: what `AGENTS.md` asked for, what exists now, and what has **not**
been verified. The app is implemented, builds cleanly, installs and runs on a physical
phone. Two blockers have been cleared in sequence — the missing device, then the network
location (the school's card host refuses off-campus source addresses; the phone now sits on
the campus wireless network and reaches it). What still stands between this build and a
verified session is the **password encoding**, which was found and fixed on 2026-10-05 by
reading SCUT's own published client; the corrected build has not yet been used to log in.

## AGENTS.md handoff items

| Required item | Result | Grade |
| --- | --- | --- |
| commit SHA | `6d5a031` implementation, `1ef80d3` + `cd8f62a` docs and checks, `29876cb` bridge fix, `9a0dc76` device findings and `CAMPUS_NETWORK_REQUIRED`, `dc93924` environment honesty + device audit, `347f4ed` docs, `328d863` corrected keyboard encoding and `loginFrom` (branch `main`; this report's own edits land in the commit that follows) | RUNTIME_VERIFIED |
| APK path | `android/app/build/outputs/apk/debug/app-debug.apk` — 4,779,765 bytes, sha256 `f9a43d2139b5528ab06ab0c976fc07bd26649b15d1c79c8b46e3b07b0e8ca6d3` from a clean `clean testDebugUnitTest assembleDebug` (68 tests green; corrected keyboard encoding + `loginFrom`); installed on the phone, not yet exercised for a login. An intermediate incremental build of the same sources hashed `b66071a392477f1b73394444a67913f48fef5bcf645586eba89bc0178e90c550` — APK bytes are not reproducible here, so treat the sha as a session marker, not a content hash. Previous build `70f3d2fea48d4278ac80d121bb31ad5d99bb630c10b21adcc98089c658088358` (4,779,933 bytes) is the one the nine `code=8000` attempts were made with | RUNTIME_VERIFIED (build/install), DEVICE_PENDING (login with the fix) |
| tested Android version / device | Android 14 (API 34), Redmi K50, arm64-v8a, 1440×3200 @ 560dpi. `minSdk 24` / `targetSdk 36` remain the build's declaration; only API 34 has executed it | RUNTIME_VERIFIED (one device) |
| bridge + UI on device | `plugin=ScutApi ready api=34 release=14`, `health()` returned over the bridge, full Chinese UI rendered without layout breakage, and a native failure reached the screen as `CAMPUS_NETWORK_REQUIRED [captcha/403]: …` | RUNTIME_VERIFIED |
| nothing session-shaped persisted | `run-as` shows only WebView internals in `shared_prefs`, 0 `scut` rows in the WebView cookie DB, no session file | RUNTIME_VERIFIED |
| captcha behavior | endpoint + `{key, image}` shape confirmed on the device (HTTP 200, 32-hex key, `data:image/png;base64,` prefix, a new `key` on every reload). SCUT's own `frontInfo` config sets `openCaptcha:"1"` for the `card` login, so a captcha is expected on every attempt — which the app already does. Whether the school *rejects* a bad captcha is still unproven, because credentials are validated first | RUNTIME_VERIFIED (shape, display) / SOURCE_VERIFIED (`openCaptcha`) / DEVICE_PENDING (rejection code) |
| network location | `ecardwxnew.scut.edu.cn` answers `403` + "校外可通过学校SSLVPN访问本网站" for an off-campus source address, over IPv4 and IPv6, for `curl` and for OkHttp alike, while `dfyc.utc.scut.edu.cn` answers `200` on the same connection. The phone was then moved onto the campus wireless network and every card-host request in the second session returned 200/400, never 403 | RUNTIME_VERIFIED |
| exact verified captcha request field names | `captcha_header_code` / `captcha_header_key` — copied from SCUT's own login chunk (`login.acc9252b.js` builds the token body with exactly these two names). The app has sent them on every device attempt, and the school's answer was `code=8000` (credential), never a schema complaint | SOURCE_VERIFIED 2026-10-05 / DEVICE_PENDING for a captcha-specific code |
| login result | nine attempts on the phone, each `keyboard 200 → token 400 code=8000 用户名或密码错误`, all with a captcha attached. Cause identified the same day: the ported encoder permuted the password through the shuffled keyboard layout instead of submitting `<chosen characters>$1$<uuid>`, and the token field was spelled `loginForm` where the client sends `loginFrom`. Both fixed in this build; no login has yet succeeded, so success stays unverified and the user was asked to stop retrying (lockout policy unknown) | RUNTIME_VERIFIED (rejection path, ordering) / NOT_TESTED (success) |
| refresh_token result | unverified. `grant_type=refresh_token` is implemented standards-style and fails closed to `REAUTH_REQUIRED`; whether SCUT issues a refresh token at all is unknown | NOT_TESTED |
| GZIC result | unverified. Requests, header (`Synjones-Auth: bearer …`) and the `code/msg/map` parser are written and unit-tested against the old implementation's shapes. The card host is the one GZIC needs, so this is the blocked path | NOT_TESTED |
| DXC result | unverified. Manual redirect chain implemented (`redirect → thirdLogin → authorize → getCode → userinfo/ammeterBalance/waterBalance`). `dfyc` itself is reachable from the phone, but the chain starts on the card host | NOT_TESTED |
| foreground refresh result | `@capacitor/app` `isActive` events were observed on the device (`{"isActive":true}` in the bridge log), but the timer semantics are verified only by 15 vitest state-machine cases; no logged-in refresh has run | NOT_TESTED (with a session) |
| remaining protocol uncertainty | see below | — |

Service codes `8002` / `8003` are no longer folklore: the login chunk compares the token
response's service code against exactly those two values to decide "captcha required /
captcha wrong" (and `8001` = "pick a student number"). They are therefore SOURCE_VERIFIED
for this deployment and still not RUNTIME_VERIFIED for this app — the school checks the
credential pair first, so they can only appear in a trace that starts from a correct
password. `docs/DEVICE_VERIFICATION.md` §2 keeps the step that closes it.

## What is actually proven

- `pnpm build` (`tsc --noEmit && vite build`), `pnpm test` (15 vitest),
  `pnpm check:dom`, and `./gradlew clean testDebugUnitTest assembleDebug` (68 tests across
  nine classes, BUILD SUCCESSFUL) all pass on this host, with no Android Studio and no IDE.
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
7. **The secure keyboard is an anti-keylogger UI, not a password transform.** `SecureKeyboardEncoder`
   submits `<chosen characters>$1$<uuid>`. The digit-permuting version that came from a
   third-party port of the old Node implementation was the reason nine logins returned
   `code=8000`; `CaptchaAndKeyboardTest` pins the corrected behaviour and names the mistake,
   so it cannot be "re-fixed" the other way. Corroborated against SCUT's own
   `security-keyboard` component and its `login` chunk.
8. **The school's published client is the reference for protocol spelling** — its `/plat/js/*`
   bundles and `GET /berserker-app/frontInfo` are readable without credentials from any
   network, so field names, login types and captcha codes can be settled without guessing.
   The copies used for this are archived outside the repository under `evidence/client/`
   (third-party minified code is deliberately not vendored into the repo).

## To close the remaining phases

A phone is attached, authorized, on the campus wireless network, and running the corrected
build. The next thing to observe is a **successful login** (§4), and it needs the user's own
card query password typed on the phone — never by the assistant. Two attempts max, then stop
and read the log; SCUT's lockout policy is undocumented.

```bash
./scripts/check-env.sh           # should report "1 authorized device(s) attached"
adb="$HOME/Android/Sdk/platform-tools/adb"
$adb shell curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' \
  'https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5'   # 200 = go
$adb logcat -c && $adb logcat -s ScutBombax:V
```

Then work through [`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md): §4 (login) unblocks
§2 (deliberately wrong captcha → the runtime captcha service code), §5 (`refresh_token`),
§6 (GZIC), §7 (DXC) and §8 (foreground refresh). Nothing there should be marked working
until its log lines appear. If §4 answers `code=8000` again, follow §2.1 in that file before
retrying: the encoding, then the field spelling, then which password the user typed.

Deliberately not done: routing the phone's traffic through this workstation's tunnel to
make its source address acceptable. That is an access-control bypass of the school's own
restriction, AGENTS.md forbids adding proxies or bypass mechanisms, and the app must stay
free of any such setting. The sanctioned off-campus route is the school's SSL VPN, run on
the phone by the user.

## Remaining protocol uncertainty

- whether the corrected password encoding is the one SCUT accepts (one login settles it)
- the service codes the school actually returns for each captcha state (`8002` / `8003` are
  documented by its own client, not yet observed here)
- whether `expires_in` is seconds or millis in practice (guarded by `ExpiryParser`), and
  whether a refresh token is issued, rotates, or is even accepted by `/oauth/token`
- whether `TGC` and `locSession` are both required for the DXC chain, and whether the
  `getCode` hop still terminates on `/sdms-weixin-pay-sp/newWeixin/index.html`
- the exact unit semantics of each GZIC fee item string (yuan vs kWh vs cubic metres), and
  whether fee item `2` exists for every dormitory
- whether any SCUT logout endpoint exists — the app only clears client-side state, and does
  not invent an endpoint
