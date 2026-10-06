# Architecture

## Goal

Keep the application client-only while reusing a web-style UI.

```text
+------------------------------+
| Capacitor WebView            |
| HTML / CSS / TypeScript      |
|                              |
| forms, result cards, timers  |
+--------------+---------------+
               |
               | typed Capacitor calls
               v
+------------------------------+
| Native Android plugin        |
| Kotlin                       |
|                              |
| AuthRepository               |
| BillingRepository            |
| SessionState                 |
+--------------+---------------+
               |
               | OkHttp
               v
+------------------------------+
| SCUT services                |
| ecardwxnew.scut.edu.cn       |
| dfyc.utc.scut.edu.cn         |
+------------------------------+
```

## Why a custom native bridge

A normal browser/WebView fetch to the ecard host is blocked by CORS even though the school responds HTTP 200. Cloudflare Worker egress receives HTTP 403. Native Android networking avoids both problems because the request is sent from the user's device and there is no browser same-origin enforcement on OkHttp.

## Module boundaries

JavaScript is responsible for presentation only. The implemented layout:

```text
src/
  bridge.ts        typed wrappers over the ScutApi plugin; normalizes native rejections
  types.ts         the cross-boundary contract (Campus, SessionInfo, Bills, ScutErrorCode)
  refresh.ts       AutoRefresher — the foreground timer state machine, no DOM access
  main.ts          DOM wiring only

android/app/src/main/java/cn/scut/bombax/
  MainActivity.kt                        registers the plugin before super.onCreate
  scut/
    ScutApiPlugin.kt                     @CapacitorPlugin("ScutApi"): health getCaptcha
                                         login getBills refreshSession logout
    ScutEndpoints.kt                     hosts, paths, Basic client, Stages.* log names
    ScutError.kt                         AppError enum + wire codes + human() text
    Diag.kt                              the only logger; redaction happens here
    SessionStore.kt                      in-memory owner of TokenState + SessionPublic
    network/ScutHttp.kt                  OkHttp client, no automatic redirects
    network/ScutCookieJar.kt             host-scoped cookie jar, names-only diagnostics
    network/CookieExtractor.kt           Set-Cookie parsing that ignores attributes
    auth/CaptchaService.kt               captcha image + key
    auth/SecureKeyboard.kt               SCUT keyboard password encoding
    auth/TokenState.kt                   TokenState, TokenPolicy, ExpiryParser,
                                         TokenParser, LoginErrorClassifier
    auth/AuthRepository.kt               login / refresh / logout over the above
    billing/GzicBilling.kt               fee items 1/2/3 + parser
    billing/DxcBilling.kt                redirect-chain step resolution + DFYC parsers
    billing/BillingRepository.kt         campus dispatch, hop-by-hop DXC driver
```

Two rules hold the design together:

- **At most one request on the wire.** `src/main.ts` keeps a `querying` flag and
  `AutoRefresher` keeps an `inFlight` flag, so a second UI-triggered query is refused
  instead of starting. Behind that, every plugin method runs on a single-thread daemon
  executor named `scut-io`, which serializes native work so two SCUT requests can never
  overlap even if a caller slips past the UI guards. `BUSY` is only returned once that
  executor has shut down during app teardown.
- **Secrets stop at the Kotlin boundary.** `SessionPublic` and `Bills` are the only
  shapes that cross into JavaScript, and the `public projection never carries a secret`
  test in `TokenStateTest` asserts that a rendered public projection contains no token,
  cookie or student number.

## Bridge error format

Capacitor serializes `call.reject(message, code, extra, data)` as
`{ message, code, data }`, and `native-bridge.js` copies only *top-level* keys onto the
`Error` it throws in JavaScript. The redacted `detail` therefore travels inside
`data.detail`, and `bridge.ts` reads it there (falling back to a top-level `detail` for
web previews). Any new error field must follow the same nesting or it silently disappears
in the UI.

## Session ownership

Native Kotlin owns:

- access token
- refresh token
- token expiry
- TGC
- locSession
- JSESSIONID or transient DXC cookies

The WebView should receive only user-visible state:

- authenticated true/false
- name if needed
- room
- balances
- updated time
- structured error codes

## Error model

Stable app errors cross the bridge instead of raw upstream text. The full set is defined
once in `src/types.ts` (`ScutErrorCode`) and mirrored by `AppError` in `ScutError.kt`, which
also carries the wire string and the Chinese `human()` line shown in the UI:

`CAPTCHA_REQUIRED`, `CAPTCHA_INVALID`, `INVALID_CREDENTIALS`, `REAUTH_REQUIRED`,
`UPSTREAM_UNAVAILABLE`, `PROTOCOL_CHANGED`, `NO_SESSION`, `BUSY`, `INVALID_INPUT`,
`NETWORK`, `CAMPUS_NETWORK_REQUIRED`

Adding a code means updating both lists and the `every error code has its own user-facing
line` test, so a missing translation fails the build rather than showing a raw enum name.

`CAMPUS_NETWORK_REQUIRED` is the one case `ScutHttp.send` classifies itself: the school's
edge answers `403` with an HTML page for any source address outside the campus range, and
that page echoes the caller's public IP, so `NetworkAccess` matches the text, keeps a
boolean, and drops the body (see `docs/PROTOCOL.md`).

Alongside the code, each rejection carries a redacted `detail` such as `status=400 code=8000`
or `dxc.getCode/302` — status and service code only, never a body.

## Foreground refresh

`src/refresh.ts` owns the policy as a testable state machine (`off → waiting → running`,
plus `halted`) with an injectable `TimerHost`, so the transitions are covered by vitest
without a clock or a DOM. `main.ts` only feeds it visibility events (`visibilitychange`, plus
Capacitor `appStateChange` / `pause` / `resume`) and the selected interval.

- default off; selecting an interval re-arms a halted timer
- hidden or paused cancels the timer immediately; at most one query in flight
- returning to the foreground queries once only if the interval already elapsed
- a `network` outcome schedules exactly one bounded 5 s retry, then returns to the plan
- a `reauth` outcome halts until a successful login calls `resume()`

No background scheduler is required, and none exists: there is no Service, no WorkManager,
no alarm and no push.

## Persistence

Implemented state: **memory only**. `SessionStore` holds one `@Volatile TokenState?`, and
`clear()` drops the reference so the token strings become collectable. Nothing sensitive is
written to disk, `SharedPreferences` is not used for session data, and the card password is
never stored anywhere. A process restart therefore means a logout.

This follows the order AGENTS.md Phase 6 sets out ("first make the app work with in-memory
session state. Then, if desired, persist only what is necessary"). Persistence is deferred
deliberately rather than by omission:

- the refresh-token path is still unverified on a device, so there is no evidence yet that a
  stored token is worth the risk surface
- `androidx.security:security-crypto` is the usual `EncryptedSharedPreferences` route and is
  not a comfortably maintained choice for a new minSdk-24 app — AGENTS.md explicitly warns
  against blindly adding deprecated security libraries
- a Keystore-backed writer cannot be exercised by JVM unit tests and cannot be tested here
  without a device, so it would ship unvalidated

If it is added later, the requirements are: Keystore-backed encryption of token state only,
never the password, and the existing `logout` / "clear login state" path must wipe the
persisted entry as well as the in-memory one.

## Testing strategy

JVM unit tests (`android/app/src/test`) cover the parsers and decisions that were written
against observed payloads: captcha response shape, secure-keyboard mapping, login error /
service-code classification, token expiry maths, cookie extraction, log-line scrubbing, GZIC
balance parsing, the DXC redirect resolution and the school's off-campus block page
(77 tests across ten classes). Vitest covers `AutoRefresher` transitions, including
backgrounding and the bounded retry (15 tests).

`pnpm native:test` and `pnpm apk` wrap Gradle in `scripts/with-jdk.sh`, which locates a JDK
that has `javac`; this machine's PATH `java` is a JRE and there is no sudo to fix it.
`pnpm install:device` uses the SDK's `adb`, since the distro package ships an older one that
does not see modern devices.

Device integration is deliberately not automated: it needs the user's real credentials and
hits school services, so it stays manual, sparse and rate-limited through
[DEVICE_VERIFICATION.md](DEVICE_VERIFICATION.md).

Two host-side checks run without a device:

```bash
pnpm check:dom    # index.html <-> main.ts id/selector contract, plus the CSP directives
./scripts/check-env.sh   # javac, build-tools aapt2 presence, authorized adb devices
```
