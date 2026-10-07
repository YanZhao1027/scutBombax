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
7. [docs/EVIDENCE_INDEX.md](docs/EVIDENCE_INDEX.md) — checksums for the device captures and
   the school's own client bundles that the `SOURCE_VERIFIED` claims were read from

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

## Interface

One column, one screen at a time, no cards and no shadows: the login form while signed out,
the room and three figures while signed in, with 会话与诊断 collapsed underneath. Light and
dark follow the system, `prefers-reduced-motion` is honoured, and the front-end is ~11 KB of
source (5.9 KB HTML + 5.1 KB CSS). The previous, heavier layout is preserved as the tag
`v0.1-classic-ui`; the native protocol layer is identical between them.


## Current status

Implemented and green on the host:

- Capacitor 8 shell in `cn.scut.bombax`, app-local `ScutApi` plugin, single-threaded
  native IO so only one SCUT query can ever be in flight
- Kotlin/OkHttp ports of captcha, secure keyboard, OAuth password login, refresh attempt,
  GZIC fee items and the DXC manual-redirect chain
- Session token state lives in Kotlin and in a **Keystore-encrypted** file under
  `noBackupFilesDir`, so a restart no longer throws away a token the school issued for 70 days —
  verified on the device: force-stop and relaunch restores 已登录, re-queries with three requests
  and reuses the stored DFYC session, while 退出 wipes both copies. The card password, the captcha
  answer and the keyboard uuid are never persisted in any form (see `docs/ARCHITECTURE.md`
  "Persistence")
- Foreground-only auto refresh (off / 5 / 10 / 30 min), no Service, no WorkManager, no alarms
- Redacted logging through `Diag` (`adb logcat -s ScutBombax`)
- 77 JVM unit tests + 15 vitest refresh tests passing; `assembleDebug` produces
  `android/app/build/outputs/apk/debug/app-debug.apk`

Verified on a physical phone (Android 14, arm64-v8a) on 2026-10-05 and 2026-10-06:

- the APK installs and starts, `ScutApi` registers, `health()` returns over the bridge, and
  the Chinese UI renders at 1440×3200 without layout damage
- a native error reaches the screen intact, i.e. the whole
  WebView → plugin → Kotlin → OkHttp → classification → rejection path works
- nothing session-shaped is persisted: the app's own data directory has no session file and
  no school cookies in the WebView cookie store
- the school's card host answers `403` for a source address outside campus, over IPv4 and
  IPv6, for `curl` and for OkHttp alike; the app reports that as `CAMPUS_NETWORK_REQUIRED`
  rather than as an outage. On the campus network the same requests reach the application
  layer: captcha `200`, secure keyboard `200`, and — once the two bugs below were fixed — token `200`
- the captcha path works end to end: a stale captcha answers `code=8002` and a freshly loaded
  one is accepted, which also settles the order — the school checks the captcha first, then
  the credential pair
- login took two client fixes before it worked, because the school answers every credential
  problem with the same `code=8000`: the secure keyboard is a **per-session substitution
  table** over fixed tile layouts (digits `0-9`, letters in QWERTY order, a 29-glyph symbol
  row), so the submitted password is each character mapped through its own row plus
  `"$1$" + uuid` — neither the raw characters nor a digits-only mapping is accepted; and the
  account belongs to 学工号登录 (`logintype=sno`), while the app had hardcoded `card`. The
  login screen now asks for the type, and the bridge refuses an unknown value rather than
  guessing.

**Verified on 2026-10-06:** login (HTTP 200, `result=ok`, a refresh token issued) and the
complete DXC chain — `redirect → thirdLogin → authorize → getCode → userinfo / ammeterBalance /
waterBalance` — with the room and both balances rendered on screen and the air-conditioning
card correctly reporting that the campus has no such fee item.

**Refresh:** a refresh token is issued, but the school does not accept
`grant_type=refresh_token` — a real-token attempt answered HTTP 500, a credential-free
bogus-token probe answered HTTP 401 `Cannot convert access token to JSON`, and SCUT's own
client never sends the grant. The app therefore fails closed to re-login and never replays a
stored password; the foreground timer only re-queries, it does not call the grant.

**Not verified:** GZIC balances (this account's dormitory is DXC), and the foreground timer's
pause-when-hidden rule — its 5-minute tick did fire exactly once and on time, but the query
behind it exposed a real bug: the DXC SSO chain is single-use, so re-walking it while the
school still holds the DFYC session makes `thirdLogin` redirect to the landing page and
`authorize` answer 200 where 302 was expected. The app now keeps the DFYC session and goes
straight to the three balance reads (3 requests instead of 7), rebuilding the chain only if
a read refuses it — confirmed on the device: two refreshes after a login produced only the
three reads, all 200.
Keep the phone on campus Wi-Fi or the school SSL VPN, use the **card query password**
(校园卡查询密码, letters and digits, not the 6-digit payment PIN), stop after two `8000`
attempts, and work through `docs/DEVICE_VERIFICATION.md` §2.1 before trying a third.
