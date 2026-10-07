# Agent instructions for scutBombax

You are implementing an Android client on Ubuntu 24.04. Do not require Android Studio.

## Mission

Build a small Android app for SCUT dormitory utility balance queries.

Reuse the existing web UI ideas from `YanZhao1027/scut-notipay@cf-web`, but move every SCUT request into Android native code. The app should use Capacitor only as the UI shell/bridge.

The key rule is:

```text
WebView UI -> Capacitor native plugin -> Kotlin -> OkHttp -> SCUT
```

Never:

```text
WebView JavaScript -> fetch(https://ecardwxnew.scut.edu.cn/...)
```

because browser/WebView CORS will block the response.

## Known network findings

Already tested:

- local/native-style HTTP to SCUT captcha: HTTP 200
- local/native-style HTTP to SCUT secure keyboard: HTTP 200
- Cloudflare Worker to those endpoints: HTTP 403
- browser direct fetch: upstream HTTP 200 but CORS blocked, with no Access-Control-Allow-Origin

Do not spend time trying to repair the Cloudflare Worker path.

## Required stack

Prefer:

- Ubuntu 24.04
- JDK 17 unless the generated Android Gradle Plugin explicitly requires another supported JDK
- Node.js LTS + pnpm
- Capacitor
- TypeScript + lightweight HTML/CSS UI (Vite is fine)
- Kotlin
- OkHttp
- Android SDK command-line tools
- Gradle wrapper
- adb + physical Android device

Avoid unnecessary frameworks.

Do not add a backend.

## Phase 0 - environment

1. Run `./scripts/check-env.sh`.
2. Install missing Android command-line components.
3. Confirm `adb devices` sees a physical device.
4. Record JDK, Node, pnpm, SDK and Gradle versions in the final report.

Do not install Android Studio unless the user explicitly asks.

## Phase 1 - create the application shell

Create a minimal Capacitor application in this repository.

Suggested package id:

`cn.scut.bombax`

Suggested display name:

`SCUT Bombax`

The web UI should be mobile-first and initially contain:

- campus picker: GZIC / DXC
- account/student number
- password
- captcha image
- captcha text field
- login/query button
- result cards: room / electric / water / air conditioning
- manual refresh
- optional foreground refresh: off / 5 / 10 / 30 minutes
- logout / clear session

Do not add an Android background Service or WorkManager.

Authorized deviation, recorded 2026-10-08: the user asked for an opt-in persistent balance
notification (2026-10-07) and then for it to stay current once a day (2026-10-08). A
`specialUse` foreground service and one inexact `AlarmManager` alarm therefore exist. The rule
still holds in every other direction: no WorkManager, no exact alarm, no boot receiver, no
stored password, no captcha OCR, and the service never logs in. Bounds and measurements are in
`docs/ARCHITECTURE.md` ("Persistent notification and daily refresh") and
`docs/DEVICE_VERIFICATION.md` §12/§13.

## Phase 2 - native network bridge

Implement a small custom Capacitor plugin instead of relying on WebView fetch.

The JS-facing surface should stay narrow. A reasonable API is:

- `health()`
- `getCaptcha()`
- `login({ username, password, campus, captchaKey?, captchaCode? })`
- `getBills()`
- `refreshSession()`
- `logout()`

Do not expose access_token, refresh_token, TGC, locSession or JSESSIONID to JavaScript unless absolutely necessary. Prefer keeping all session state in Kotlin.

Use one OkHttp client with an explicit CookieJar where useful. Redirect behavior must be controllable because the DXC path relies on inspecting 302 responses.

## Phase 3 - port the SCUT protocol

Read `docs/PROTOCOL.md` and the referenced old-repo files before implementation.

Port protocol behavior, not old Node runtime structure.

### Captcha

Known endpoint:

`GET https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5`

Known response contains:

- `key`
- `image` (base64/data URL)

Display it to the user. No OCR.

### Secure keyboard

Port the old secure-keyboard encoding exactly after verifying the current endpoint and response.

Do not send the raw card password to SCUT if the official flow expects the encoded keyboard form.

### Login

Port the current OAuth token request.

Do not assume captcha field names until verified on-device. Candidate names observed in the Synjones ecosystem are:

- `captcha_header_code`
- `captcha_header_key`

Treat numeric service codes 8002 and 8003 as likely captcha-related signals, but verify with a controlled request before documenting them as SCUT facts.

No high-frequency retry.

### Token refresh

The token response includes a `refresh_token` in the existing implementation.

Test SCUT itself:

- whether `grant_type=refresh_token` works
- whether refresh_token rotates
- new expires_in
- whether TGC / locSession are returned or remain reusable
- GZIC query after refresh
- DXC SSO after refresh

If refresh fails, require reauthentication. Do not automatically replay a stored password.

## Phase 4 - GZIC first

Implement GZIC before DXC.

The previous implementation queries fee item IDs 1, 2 and 3 using `Synjones-Auth: bearer <access token>`.

Verify real response semantics and units before labeling balances.

Acceptance:

- captcha loads on the phone
- successful login
- room is shown
- electric/water/air-conditioning values parse correctly
- manual refresh works
- app backgrounding stops UI-driven refresh
- returning to foreground can refresh once if the chosen interval elapsed

## Phase 5 - DXC

Only after GZIC is stable.

Port the existing redirect chain from the old `billing.ts`.

The old flow involves:

- `berserker-base/redirect?appId=360...`
- TGC
- locSession
- thirdLogin
- JSESSIONID
- authorize
- getCode
- `dfyc.utc.scut.edu.cn`
- userInfo
- ammeterBalance
- waterBalance

Do not simplify or remove cookies until a device trace proves they are unnecessary.

Log only status codes, host/path and redirect stage. Never log sensitive cookie values.

## Phase 6 - session storage

First make the app work with in-memory session state.

Then, if desired, persist only what is necessary.

Requirements:

- never persist the card password by default
- use Android Keystore-backed encryption for persistent tokens
- prefer current maintained Android APIs; do not blindly add deprecated security libraries
- provide a clear "clear login state" action
- clear sensitive memory references where practical

## Foreground refresh behavior

The optional refresh timer belongs to the visible UI lifecycle.

Rules:

- default off
- no background service
- no WorkManager
- no alarm
- when app/page is not visible: no polling
- when visible again and the selected interval elapsed: query once
- at most one in-flight query
- one bounded retry for transient network errors is acceptable
- captcha/reauth condition stops auto-refresh

The first three lines above are superseded for the opt-in daily path only, by the user's
decision of 2026-10-08: one inexact alarm per day, through the same single-threaded native queue
as everything else, and only while the notification service is already running. "At most one
in-flight query" is the reason the native stack is one process-scoped `ScutRuntime` rather than
plugin state. This section's foreground-timer rules are otherwise unchanged and still enforced.

## Security

Never commit secrets or credentials.

Never log:

- username/student number
- password or encoded password
- captcha solution
- access token
- refresh token
- TGC
- locSession
- JSESSIONID

Redacted diagnostics may include:

- endpoint host/path
- method
- HTTP status
- elapsed time
- service code
- redirect destination host/path

TLS certificate validation must remain enabled.

Do not add unknown public proxies or WAF bypass mechanisms.

## Tests

Unit-test pure logic:

- captcha parser
- secure keyboard mapping
- login error/service-code classification
- token expiry decision
- cookie extraction
- GZIC balance parser
- DXC response parser
- refresh-state transitions

Real SCUT integration tests must be opt-in and must not contain credentials in source control.

## Build acceptance

The project must build without Android Studio:

```bash
pnpm install
pnpm build
pnpm exec cap sync android
cd android
./gradlew assembleDebug
```

And install with:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Final handoff report

When the MVP works, report:

- commit SHA
- APK path
- tested Android version/device (do not expose device identifiers)
- captcha behavior
- exact verified captcha request field names
- login result
- refresh_token result
- GZIC result
- DXC result
- foreground refresh result
- any remaining protocol uncertainty

Do not claim an untested flow is working.
