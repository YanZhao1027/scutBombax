# scutBombax

A lightweight Android client for querying SCUT dormitory utility balances without Android Studio.

The project is intentionally designed for **Ubuntu 24.04 + terminal/VS Code/Neovim + Android SDK command-line tools + Gradle**. The UI will be built with web technologies and packaged with Capacitor, while all SCUT network requests are sent by Android native code through OkHttp so they are not subject to browser CORS.

## Why Android native networking

The previous web experiment in `YanZhao1027/scut-notipay` established:

- local machine -> SCUT captcha: HTTP 200
- local machine -> SCUT secure keyboard: HTTP 200
- Cloudflare Worker -> both endpoints: HTTP 403
- browser direct fetch -> SCUT returns HTTP 200, but the response is unreadable because SCUT does not return `Access-Control-Allow-Origin`

Therefore a pure browser or pure Cloudflare implementation is blocked. Android native HTTP uses the user's own network and is not governed by browser CORS.

## Target architecture

```text
HTML / CSS / TypeScript UI
          |
          | Capacitor bridge
          v
Kotlin native plugin / repositories
          |
          | OkHttp + CookieJar
          v
SCUT ecard / dormitory services
```

The WebView must **not** call SCUT directly with `fetch()`.

## Product scope

First release:

- GZIC and DXC campus selection
- captcha display and manual input
- secure-keyboard password encoding
- login and token/session handling
- utility balance query
- manual refresh
- optional 5/10/30 minute refresh while the app is visibly in the foreground
- refresh-token experiment and reuse if SCUT supports it
- no server backend
- no Cloudflare relay
- no D1
- no Android background service
- no WorkManager polling
- no push notification
- no automatic captcha solving

Passwords should not be persisted. Token persistence is optional and must use Android Keystore-backed storage if implemented.

## Source references

Protocol behavior should be ported and verified from:

- original project: `Naptie/scut-notipay`
- working fork: `YanZhao1027/scut-notipay`
- Cloudflare experiment branch: `YanZhao1027/scut-notipay@cf-web`

Useful files in the old project:

- `src/utils/keyboard.ts`
- `src/utils/session.ts`
- `src/utils/captcha.ts`
- `src/utils/billing.ts`
- `worker/auth.ts`
- `worker/billing.ts`

See [docs/PROTOCOL.md](docs/PROTOCOL.md) before changing authentication behavior.

## Ubuntu workflow

No Android Studio is required.

Read:

1. [docs/UBUNTU24.md](docs/UBUNTU24.md)
2. [AGENTS.md](AGENTS.md)
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
4. [docs/PROTOCOL.md](docs/PROTOCOL.md)
5. [docs/DEVICE_VERIFICATION.md](docs/DEVICE_VERIFICATION.md)
6. [docs/HANDOFF.md](docs/HANDOFF.md) — status report for 2026-10-05, including what is
   and is not verified

Environment sanity check:

```bash
./scripts/check-env.sh
```

Verified build loop (Java 21 must be a full JDK; see `docs/UBUNTU24.md` §9):

```bash
pnpm install
pnpm build          # tsc --noEmit && vite build
pnpm test           # vitest: refresh-state machine
pnpm exec cap sync android

cd android
JAVA_HOME="$HOME/opt/jdk-21.0.12.1+1" ./gradlew clean testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s ScutBombax:V
```

Use a physical Android phone for protocol testing. An emulator is not required.

## Current status

Implemented and green on the host:

- Capacitor 8 shell in `cn.scut.bombax`, app-local `ScutApi` plugin, single-threaded
  native IO so only one SCUT query can ever be in flight
- Kotlin/OkHttp ports of captcha, secure keyboard, OAuth password login, refresh attempt,
  GZIC fee items and the DXC manual-redirect chain
- Session held in memory only, all secrets staying in Kotlin; "clear login state" is an
  explicit action and the card password is never persisted (AGENTS.md Phase 6 asks for
  in-memory first — see `docs/ARCHITECTURE.md` for the persistence decision)
- Foreground-only auto refresh (off / 5 / 10 / 30 min), no Service, no WorkManager, no alarms
- Redacted logging through `Diag` (`adb logcat -s ScutBombax`)
- 58 JVM unit tests + 15 vitest refresh tests passing; `assembleDebug` produces
  `android/app/build/outputs/apk/debug/app-debug.apk`

**Not verified:** every SCUT network behavior. No Android device has been attached to this
machine (`adb devices` lists nothing), so captcha enforcement, login, `refresh_token`, GZIC
balances, the DXC SSO chain and foreground refresh have never run against the school. The
captcha form field names and the `8002`/`8003` service codes are documented as hypotheses,
not facts — see `docs/PROTOCOL.md`. Work through `docs/DEVICE_VERIFICATION.md` on a real
phone before treating any of it as working.
