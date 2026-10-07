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
    ScutRuntime.kt                       process-wide owner: OkHttp client, cookie jar,
                                         SessionStore, repositories, the one `scut-io` queue
    ScutApiPlugin.kt                     @CapacitorPlugin("ScutApi"): health getCaptcha
                                         login getBills refreshSession logout noticeStatus
                                         startNotice stopNotice enableDaily disableDaily
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
    notice/BalanceNoticeService.kt       the shade line, and the only network caller besides
                                         the plugin
    notice/DailyRefresh.kt               cadence maths + the inexact alarm
    notice/DailyAlarmReceiver.kt         wake → re-arm → hand the refresh to the service
```

Two rules hold the design together:

- **At most one request on the wire.** `src/main.ts` keeps a `querying` flag and
  `AutoRefresher` keeps an `inFlight` flag, so a second UI-triggered query is refused
  instead of starting. Behind that, every SCUT call — from the WebView *or* from the daily
  alarm — runs on the one single-thread daemon executor named `scut-io` inside `ScutRuntime`,
  so two requests can never overlap even if a caller slips past the UI guards. This is the
  reason the runtime is a process-scoped object rather than plugin state: a service with its
  own client and queue would have quietly doubled every invariant above. `BUSY` is only
  returned once that executor has shut down during app teardown.
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

Two layers, and they are deliberately different:

- **Session token state — encrypted, native.** `SessionStore` keeps the live `TokenState` in
  memory and, when a store is attached, writes a `SessionCodec` JSON record through
  `SessionEnvelope` → `KeystoreSessionCipher` (AES/GCM, 256-bit, non-exportable key in the
  `AndroidKeyStore` provider, fresh 12-byte nonce per write) into
  `noBackupFilesDir/scut-session.bin`. `noBackupFilesDir` is the point: neither Android auto
  backup nor `adb backup` carries it. `logout` and "清除登录状态" wipe the file and the memory
  reference together; an unreadable, wrong-version or expired record is deleted and the app
  starts anonymous rather than half-authenticated.
- **UI choices — plain, web layer.** Campus, login type and the refresh interval live in
  `localStorage` under `bombax.prefs.v1`. Three strings, no account and no token. The key name
  deliberately contains no school identifier so the §10 storage grep stays a real test.

Never stored, in either layer: the card password, the captcha answer, the keyboard uuid.
`TokenState` has no field for them and `SessionPersistenceTest` asserts the exact serialised
key set, so a future field cannot quietly add one.

Why this landed now rather than at the start: AGENTS.md Phase 6 asks for memory first and
persistence "if desired", and the three deferral reasons that were written here were each
removed by the device work — the token turned out to be valid for 70 days (`expires_in`
`6048000`), so a restart cost a full re-login for no security gain; the Keystore path is
testable on the host because the *format* is separated from the *key's home* (unit tests run
the same envelope code against a JCE AES/GCM key); and `androidx.security:security-crypto` was
avoided entirely by using the platform Keystore API directly.

Two more were caught on 2026-10-07 by the startup probe (`FileSessionStore.probe()`), which
encrypts, writes, reads back and deletes a constant before the plugin reports
`stage=session result=disk-ready`: asking the `AndroidKeyStore` **provider** for
`AES/GCM/NoPadding` throws `NoSuchAlgorithmException` (only the *key* lives in that provider;
the cipher is the platform's), and the first nonce-packing helper allocated one byte short, an
`ArrayIndexOutOfBoundsException` on every write. Both would have looked like "persistence
silently does nothing" if the save path had been the only signal — and finding them that way
would have cost a login each time. The blob layout now lives in `CipherBlob`, shared by
production and the unit tests, so the tests exercise the exact bytes the Keystore path writes.

One trap worth naming, because the first implementation fell into it: the plugin's
`handleOnDestroy` used to call `session.clear()`, which would delete the file we had just
written — pressing Back would log the user out and persistence would appear broken. Destroy now
calls `dropMemory()`, which forgets the in-memory reference while leaving the record for the
next start; only `logout` deletes it.

**A query spacing floor sits under the whole scheduler.** `MIN_TICK_SPACING_MS` (60 s) caps
how often any path — interval tick, resume catch-up, re-armed timer — may start a query,
because a backgrounded WebView on this OEM build reports itself visible repeatedly and each
flip looked like an elapsed interval (four queries in eleven seconds, measured 2026-10-07).
The single bounded network retry is exempt, since AGENTS.md wants that one within seconds.

## Persistent notification and daily refresh (opt-in, added 2026-10-07/08)

AGENTS.md says "Do not add an Android background Service or WorkManager" and "when app/page is
not visible: no polling". The user authorised a persistent balance notification on 2026-10-07 and
a **once-a-day** background refresh on 2026-10-08, so these are **recorded, deliberate
deviations**, constrained to keep the spirit of the rules:

- `BalanceNoticeService` is a foreground service (`foregroundServiceType="specialUse"`, with the
  subtype property) started **only** from the 常驻通知 checkbox, which defaults to off and is
  restored from the service's actual running state at startup;
- the daily path is **one** query per day per device — an inexact `setAndAllowWhileIdle` alarm,
  re-armed after every fire and on every app open. Not WorkManager, not an exact alarm, not a
  boot receiver: `SCHEDULE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED` are permissions this app
  should not need for a nicety, and the reboot gap is documented instead of papered over;
- the service queries through `ScutRuntime`, never its own client, so its request shares the
  WebView's cookies, session and — the load-bearing part — the single `scut-io` queue. Two
  callers, still at most one request on the wire;
- **it never logs in.** No password is stored, and only a human can read the captcha, so a
  missing or expired session produces 需重新登录 on the shade rather than an attempt;
- a failed refresh keeps the last numbers and grows a reason (刷新失败 / 需在校内网络 /
  需重新登录) instead of showing an unknown balance, and no retry follows — the next attempt is
  tomorrow;
- the two switches are one-way coupled: 每日后台刷新 requires 常驻通知 (enforced in the page and
  in `enableDaily`), and turning the notification off disables the alarm, because a user who
  asked for no notification must not be woken by something that makes one;
- updates from the page are still pushed by `syncNotice()` after a query it was going to make
  anyway, so the foreground cadence stays bounded by the same interval selector as the UI;
- 退出 / 清除登录状态 switches both off — a stale balance must not sit on the shade after the
  session is gone;
- channel `bombax.balance` is `IMPORTANCE_LOW`: silent, no heads-up, badge-free, `VISIBILITY_PRIVATE`;
- `android:allowBackup` was flipped to `false` in the same change, so neither the encrypted
  session record nor the WebView storage leaves the device through backup or device transfer.

Measured on the device (`docs/DEVICE_VERIFICATION.md` §12, §13): the hidden WebView's interval
timers do **not** fire on this OEM build, which is why the clock had to move into native code,
and the inexact alarm does get delivered while backgrounded (45 s late in the sample) — but
Android 12+ will not let that alarm *start* the foreground service, so the daily path only runs
while the notification is already alive. That constraint is why the page re-starts the service on
every open when the daily switch is armed, and why the honest statement of behaviour is "one
query a day, from a process you already asked to keep running".

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
