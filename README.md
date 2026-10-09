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
8. [docs/TECHNICAL_CHALLENGES.md](docs/TECHNICAL_CHALLENGES.md) — every hard problem in this
   project in one place: symptom, why it misled, how it was pinned down, the fix, and the
   evidence — including the honest list of what is still unverified
9. [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) — the product requirement draft
   and the decisions taken against it (§15); Chinese
10. [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md) — the Release 0.2.0 on-device
   acceptance report, item by item against what was approved, with verified and unverified kept
   in separate tables; Chinese

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

## Release packaging (signed)

`assembleDebug` is signed with the machine's Android debug key, which is fine for adb installs
and useless for anything you want to keep updating. A release build needs **your** key, and this
repository deliberately cannot hold it: a signing key is the one secret whose loss is not
recoverable, because an APK signed with key B can never replace an installed APK signed with
key A.

```bash
# once, and then back the .jks up somewhere better than this laptop
keytool -genkeypair -v -keystore android/bombax.jks -alias bombax \
  -keyalg RSA -keysize 2048 -validity 10000

# either: copy android/keystore.properties.example to android/keystore.properties and fill it in
# (both files are gitignored), or pass the key in for a single build without writing a password
# to disk:
export BOMBAX_KEYSTORE_FILE=$PWD/android/bombax.jks
export BOMBAX_KEYSTORE_STORE_PASSWORD=…   BOMBAX_KEYSTORE_KEY_ALIAS=bombax
export BOMBAX_KEYSTORE_KEY_PASSWORD=…
pnpm apk:release        # cap sync + assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. With no key configured the build
still succeeds and says so, producing `app-release-unsigned.apk` — that file will not install, and
`apksigner verify` on it reports `DOES NOT VERIFY / Missing META-INF/MANIFEST.MF`.

Two things to know before the first install:

- **A release build cannot be installed over the debug build.** The signatures differ, so Android
  refuses; you uninstall first, and uninstalling deletes the Keystore-encrypted session with it —
  the next start needs a real login (account, password, captcha).
- **R8 stays off** (`minifyEnabled false`). Capacitor calls `@PluginMethod` reflectively, so
  enabling minification without keep rules is how a release APK loses the bridge while every unit
  test still passes. Turning it on is a change to verify on a phone, not on a host.

`versionCode` is 2 / `versionName` 0.2.0, in `android/app/build.gradle`, `package.json` and the
plugin's fallback string. Bump `versionCode` before distributing an update, or the new APK will
refuse to install over the old one.

The release key that first signed this app is identified by its **public certificate SHA-256**
`ef607f9df8e7872c9008d6aaf35da6d5ee69db217a97bc7b0f6d191629ff89d4` (recorded 2026-10-08; a
fingerprint is public information, the private key and its password are not and are not in this
repository). Any APK whose `apksigner verify --print-certs` reports a different digest cannot
update an existing install. Check it after a machine move:

```bash
$ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk | grep "certificate SHA-256"
```

## Interface

One column, one screen at a time, no cards and no shadows: the login form while signed out,
the room and three figures while signed in, with 会话与诊断 collapsed underneath. Light and
dark follow the system, `prefers-reduced-motion` is honoured, and the front-end is ~11 KB of
source (5.9 KB HTML + 5.1 KB CSS). The previous, heavier layout is preserved as the tag
`v0.1-classic-ui`; the native protocol layer is identical between them.


## Current status

Implemented and green on the host:

- Capacitor 8 shell in `cn.scut.bombax`, app-local `ScutApi` plugin, and a process-scoped
  `ScutRuntime` that owns the OkHttp client, the cookie jar, the session and the single-threaded
  native IO — so only one SCUT query can ever be in flight, whoever asked for it
- Kotlin/OkHttp ports of captcha, secure keyboard, OAuth password login, refresh attempt,
  GZIC fee items and the DXC manual-redirect chain
- Session token state lives in Kotlin and in a **Keystore-encrypted** file under
  `noBackupFilesDir`, so a restart no longer throws away a token the school issued for 70 days —
  verified on the device: force-stop and relaunch restores 已登录, re-queries with three requests
  and reuses the stored DFYC session, while 退出 wipes both copies. The card password, the captcha
  answer and the keyboard uuid are never persisted in any form (see `docs/ARCHITECTURE.md`
  "Persistence")
- Foreground auto refresh (off / 5 / 10 / 30 min) behind a 60-second spacing floor, plus the
  opt-in daily alarm above; no WorkManager, no exact alarms, no boot receiver
- Redacted logging through `Diag` (`adb logcat -s ScutBombax`)
- 114 JVM unit tests + 17 vitest refresh tests passing; `assembleDebug` produces
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

**Opt-in persistent notification, nightly snapshot, and local history:** a 常驻通知 checkbox posts
a silent, ongoing balance line to the shade; **晚间余额快照** arms one inexact `AlarmManager` alarm
per day that fires at **23:00 Beijing time** and takes the day's reading through the same native
queue the page uses; and every successful query — from anywhere — appends a row to a local
SQLite history under `noBackupFilesDir`, which is what the screen falls back to (clearly labelled
as history, never as live) when the school cannot be reached. All of it defaults to off, the
snapshot requires the notification, and turning the notification off cancels the alarm. AGENTS.md
forbids background services and background polling, so these are recorded, user-authorised
deviations, bounded in `docs/ARCHITECTURE.md` and measured in `docs/DEVICE_VERIFICATION.md`
§12/§13/§14. Two limits are worth knowing before trusting any of it: Android 12+ will not let an
*inexact* alarm start the foreground service, so the nightly sample only lands while the
notification is already alive; and the service **never logs in** — no password is stored and only a
human can read the captcha, so an expired session becomes 需重新登录 on the shade rather than an
attempt.

**Not verified:** GZIC balances (this account's dormitory is DXC), whether the interval
timer keeps polling while the app is backgrounded (§12: on this build it does not), and a
*successful* background refresh — every daily attempt in §13 hit the campus-network timeout
because the dormitory wifi was sitting on a captive portal, so the mechanics are measured and
the number actually changing on its own is not.

Keep the phone on campus Wi-Fi or the school SSL VPN, use the **card query password**
(校园卡查询密码, letters and digits, not the 6-digit payment PIN), stop after two `8000`
attempts, and work through `docs/DEVICE_VERIFICATION.md` §2.1 before trying a third.
