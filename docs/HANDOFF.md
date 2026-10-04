# Handoff report — 2026-10-05

Scope of this report: what `AGENTS.md` asked for, what exists now, and what has **not**
been verified. The headline is that the app is implemented and builds cleanly, but **no
SCUT flow has ever run**, because this machine has no Android device attached
(`adb devices` → empty "List of devices attached", checked repeatedly).

## AGENTS.md handoff items

| Required item | Result | Grade |
| --- | --- | --- |
| commit SHA | `6d5a031` implementation, `1ef80d3` docs (branch `main`) | RUNTIME_VERIFIED |
| APK path | `android/app/build/outputs/apk/debug/app-debug.apk` — 4,778,453 bytes, sha256 `32619d63383426fedb6d81d56a128b2c79978e0c34e5487135efe0d3dabe5884` | RUNTIME_VERIFIED |
| tested Android version / device | none. `minSdk 24`, `targetSdk 36` are what the build *declares*; no device has executed it | NOT_TESTED |
| captcha behavior | endpoint + `{key, image}` shape confirmed from the host (HTTP 200, 32-hex key, `data:image/png;base64,` prefix). Whether SCUT **enforces** captcha at login is unproven | RUNTIME_VERIFIED (shape) / DEVICE_PENDING (enforcement) |
| exact verified captcha request field names | **not verified.** The app sends `captcha_header_code` / `captcha_header_key`; these come from the old `cf-web` branch and sibling Synjones deployments, i.e. HYPOTHESIS | HYPOTHESIS |
| login result | never attempted with credentials. The one token request made from the host used **empty** username/password and returned `{"status":400,"message":"用户名或密码错误","code":8000,"data":null}` | RUNTIME_VERIFIED (error path) / NOT_TESTED (success) |
| refresh_token result | unverified. `grant_type=refresh_token` is implemented standards-style and fails closed to `REAUTH_REQUIRED`; whether SCUT issues a refresh token at all is unknown | NOT_TESTED |
| GZIC result | unverified. Requests, header (`Synjones-Auth: bearer …`) and the `code/msg/map` parser are written and unit-tested against the old implementation's shapes | NOT_TESTED |
| DXC result | unverified. Manual redirect chain implemented (`redirect → thirdLogin → authorize → getCode → userinfo/ammeterBalance/waterBalance`) | NOT_TESTED |
| foreground refresh result | timer logic verified by 15 vitest state-machine cases only; no Android lifecycle event has been observed on a phone | NOT_TESTED (on device) |
| remaining protocol uncertainty | see below | — |

Service codes `8002` / `8003` as captcha signals remain **HYPOTHESIS** for the same reason;
they are marked as such in `docs/PROTOCOL.md` and in a code comment on
`LoginErrorClassifier.captchaServiceCodes`.

## What is actually proven

- `pnpm build` (`tsc --noEmit && vite build`), `pnpm test` (15 vitest),
  `./gradlew clean testDebugUnitTest assembleDebug` (58 tests, BUILD SUCCESSFUL) all pass
  on this host, with no Android Studio and no IDE.
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

## To close the remaining phases

The blocker is external: connect an Android phone and accept the USB-debugging prompt.
Then, from the repo root:

```bash
./scripts/check-env.sh           # should report "1 authorized device(s) attached"
pnpm exec cap sync android
cd android && JAVA_HOME="$HOME/opt/jdk-21.0.12.1+1" ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -c && adb logcat -s ScutBombax:V
```

and work through [`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md) sections 1-10 with the
user's own card password. Section 2 (a deliberately wrong captcha) is the one that settles
the field names and service codes; the rest settles GZIC/DXC semantics and the foreground
rules. Nothing there should be marked working until its log lines appear.

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
