# Device verification checklist

The credential-bearing steps below stay **NOT_TESTED** until they are executed on a
physical Android phone with the user's own SCUT credentials. The repository ships a
green build and 63 passing JVM unit tests; those prove the code parses the shapes it
has already observed, not that a real login works.

What the device has already confirmed (2026-10-05, Android 14 / API 34, arm64-v8a):
the native↔WebView bridge round trip, the captcha tile's failure path, the redacted
log format, that nothing session-shaped is persisted, and that the card host refuses
off-campus source addresses (§0.1). Those are RUNTIME_VERIFIED. Everything that needs
a logged-in session is still DEVICE_PENDING.

Fill in the recording template at the bottom as you go, and give each line an
evidence grade (see `docs/PROTOCOL.md`): RUNTIME_VERIFIED / SOURCE_VERIFIED /
HYPOTHESIS / DEVICE_PENDING.

## 0. Prerequisites

```bash
cd /home/zyubuntu/scutbombax/scutBombax
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

adb devices          # AGENTS.md Phase 0 step 3 — must list the phone
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`adb devices` printing an empty "List of devices attached" block means the phase is
not done; accept the USB-debugging authorization dialog on the phone.

Start a log capture in a second terminal and keep it running for the whole session:

```bash
adb logcat -c && adb logcat -s ScutBombax:V *:S | tee /tmp/scutbombax.log
```

`Diag` is the only logger and it never prints a credential, an encoded password, a
captcha answer, a token or a cookie **value** — only hosts, paths, methods, statuses,
elapsed milliseconds, service codes and presence flags. Do not paste this log into a
public issue if it contains a real student number that the user typed into the UI.

### 0.1 Network prerequisite (check this before anything else)

The card host only answers requests whose **source address** is inside the campus
address space. From a phone whose Wi-Fi egresses on a carrier address, every path on
`ecardwxnew.scut.edu.cn` returns the school's HTML block page and §1–§8 cannot start.

```bash
ADB="$ANDROID_HOME/platform-tools/adb"      # the SDK adb, not the distro one
$ADB shell curl -sS -o /dev/null -m 12 \
  -w 'HTTP=%{http_code} remote=%{remote_ip} tls=%{ssl_verify_result}\n' \
  'https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5'
```

`/system/bin/curl` is present on the tested Android 14 build, which makes this a
one-line check that does not depend on the app at all.

| Output | Meaning | Next step |
| --- | --- | --- |
| `HTTP=200` | this network location is allowed | continue with §1 |
| `HTTP=403` | refused by source address | join campus Wi-Fi, or connect the school's SSL VPN client on the phone, then re-run this check |

A 403 here is not an app defect: the app reports `CAMPUS_NETWORK_REQUIRED` for it and
the upstream page states its own remedy (校外可通过学校SSLVPN访问本网站). Do not route
the phone through a proxy or tunnel to defeat that check — AGENTS.md forbids adding
proxies and bypass mechanisms, and the school's sanctioned off-campus route is its own
VPN.

Log line and on-screen text produced by this case, both observed on the device:

```text
stage=captcha method=GET host=ecardwxnew.scut.edu.cn path=/berserker-auth/oauth/captcha status=403 ms=797 blocked=campus-network-only
验证码加载失败：CAMPUS_NETWORK_REQUIRED [captcha/403]: 当前网络无法访问一卡通服务，请连接校园网或使用学校 SSLVPN 后重试
```

Record which network the phone ended up using, because every RUNTIME_VERIFIED row
below inherits from it.

## 1. Captcha display

| Step | Expected |
| --- | --- |
| Open the app, look at the captcha tile | A png image renders; tapping it reloads |
| Log | `stage=captcha method=GET host=ecardwxnew.scut.edu.cn path=/berserker-auth/oauth/captcha status=200 ms=...` |
| Log | `stage=login method=POST ...` only after submitting |

Record: whether the image is legible on the phone, and whether every reload returns
a new `key`.

## 2. Captcha is actually enforced (this decides the field names)

Submit a deliberately wrong captcha code.

- Expected UI: "验证码不正确或已过期，已为你换一张。" and a fresh image.
- Expected log: `stage=login.captchaForm result=rejected error=CAPTCHA_INVALID status=<n> code=<service code>`

**This is the single most important line in the session.** Write down the real
`code=` value. The classifier currently treats `8002`/`8003` as captcha codes
because that is what sibling Synjones deployments do; it is a **HYPOTHESIS**. If the
observed code differs, update all three of:

1. `LoginErrorClassifier.captchaServiceCodes` in
   `android/app/src/main/java/cn/scut/bombax/scut/auth/TokenState.kt`
2. the `8002 / 8003` expectations in `LoginClassificationTest.kt`
3. the "Captcha" section of `docs/PROTOCOL.md`

Also confirm the request field names the app currently sends
(`captcha_header_code`, `captcha_header_key` in `LoginForm.kt`) are the ones SCUT
accepts — a wrong name shows up as "captcha always invalid", never as a clear error.

## 3. Login without a captcha

Optional but useful: with the captcha box empty, submit. Log shows
`stage=login.noCaptcha result=rejected error=... code=...`. This tells us whether
captcha is mandatory for every login or only after failed attempts, which changes the
UI flow.

## 4. Successful login

```text
stage=login.captchaForm method=POST host=ecardwxnew.scut.edu.cn
  path=/berserker-auth/oauth/token status=200 ms=...
stage=login.captchaForm result=ok campus=GZIC refreshToken=present cookies=TGC,locSession
```

Record:

- [ ] display name appears in the session pill (`已登录`)
- [ ] `refreshToken=present` or `absent` — decides whether Phase 3 refresh is possible at all
- [ ] cookie names listed (names only)
- [ ] which campus was selected

The `code=8000` credential path is already RUNTIME_VERIFIED from a credential-free
probe (`{"status":400,"message":"用户名或密码错误","code":8000,"data":null}`), so a
wrong password should land on `error=INVALID_CREDENTIALS`.

## 5. refresh_token

Press **测试 refresh_token** in the diagnostics row.

Success:
```text
stage=token.refresh ... status=200 ms=...
stage=token.refresh result=ok rotated=yes expiresIn=7100s tgc=present locSession=present
```
Failure:
```text
stage=token.refresh result=failed status=<n> code=<n>
```
or, when login handed back no refresh token:
```text
REAUTH_REQUIRED [refresh/absent]
```

Record all five AGENTS.md questions:

- [ ] does `grant_type=refresh_token` succeed? (yes/no)
- [ ] extra required form fields: ______
- [ ] does the refresh token rotate? (`rotated=yes|no`)
- [ ] new `expires_in`: ______ seconds
- [ ] are `TGC` / `locSession` re-issued? (`tgc=... locSession=...`)
- [ ] does the refreshed access token still work for GZIC? (press **立即刷新** afterwards)
- [ ] can DXC still complete SSO after a refresh? (run a DXC query afterwards)

A failure here must require reauthentication — never a stored-password replay. That
is the implemented behaviour; verify the UI actually asks for a login rather than
silently retrying.

## 6. GZIC balances

Select GZIC, log in, press **立即刷新** (or use **登录并查询**, which logs in and queries in one step).

```text
stage=gzic.electric ... status=200
stage=gzic.ac       ... status=200
stage=gzic.water    ... status=200
stage=gzic result=ok room=present electric=true ac=true water=true
```

Cross-check every number against the official SCUT e-card mini program / web page for
the same room **in the same minute**, then record which of these the platform text
actually means. `PROTOCOL.md` forbids assuming units beyond the upstream wording, so
the app displays the raw unit string it received:

| Item | App shows | Official shows | Match |
| --- | --- | --- | --- |
| electric | | | |
| water | | | |
| air conditioning | | | |

Record the room label too, and whether fee item `2` (air conditioning) exists for this
account — the app shows "该校区无空调费数据" when upstream returns nothing.

If one of the three requests fails, the log distinguishes:

- `status=401/403` → `REAUTH_REQUIRED` (session problem, expected after expiry)
- `status=200` but unparseable → `PROTOCOL_CHANGED` (the parser's assumption about the
  `code/msg/map` envelope or the `信息` / `room` keys is wrong; capture the raw JSON
  with a temporary debug build, do not guess a new parser)

## 7. DXC SSO chain

Select DXC, log in, press **立即刷新**. Redirects are followed manually, so each hop
appears as its own log line with a 30x status:

```text
stage=dxc.redirect    ... status=302
stage=dxc.thirdLogin  ... status=302
stage=dxc.thirdLogin jsessionid=obtained
stage=dxc.authorize   ... status=302
stage=dxc.getCode     ... status=302
stage=dxc.getCode result=session-established
stage=dxc.userInfo       ... status=200
stage=dxc.ammeterBalance ... status=200
stage=dxc.waterBalance   ... status=200
stage=dxc result=ok room=present electric=true water=true ac=none
```

Confirm the `getCode` hop lands on `/sdms-weixin-pay-sp/newWeixin/index.html`, which is
what the old implementation treats as "session established". If it lands elsewhere,
the redirect chain changed and `DxcBilling` must be re-derived from a live trace
rather than patched speculatively.

Record:

- [ ] the first hop that fails, if any: ______
- [ ] electric/water numbers vs the official DFYC page
- [ ] whether `TGC` + `locSession` were both required (dropping them is the cheapest
      experiment; the old Node code kept both)

## 8. Foreground-only refresh

AGENTS.md requires: no background service, no WorkManager, no alarms, at most one
in-flight query, one bounded retry for transient failures, and captcha/reauth
conditions stop the timer.

Procedure with the log open:

1. Choose **5 分钟**. UI shows `自动刷新：5 分钟`.
2. Kill the network (airplane mode) and wait for a tick → expect exactly one extra
   request 5 s later (the bounded retry), then a return to the normal interval. No
   retry storm.
3. Press **Home** / switch apps. The log must go completely quiet — no `stage=gzic.*`
   lines while backgrounded.
4. Return immediately → no query unless the interval has elapsed.
5. Return after the interval elapsed → exactly one query.
6. Let the token expire (or log out remotely) so a query returns `REAUTH_REQUIRED` →
   UI shows "自动刷新已暂停：需要重新登录。" and the log stops producing periodic
   requests. The timer must stay halted until a new login.
7. Log in again → the timer re-arms (this is `AutoRefresher.resume()`; without it the
   UI would look alive but never refresh).

- [ ] all seven steps observed: ______

## 9. Session storage and restart

The session lives **in memory only** (`SessionStore` holds a `TokenState` reference;
nothing is written to disk, and AGENTS.md Phase 6 accepts this as the first state). So the
expected behaviour after a force-stop is a clean logout:

```bash
adb shell am force-stop cn.scut.bombax   # relaunch from the launcher
```

- [ ] the app restarts **anonymous** (a restart that still shows `已登录` means something
      unexpected is persisting state — investigate before continuing)
- [ ] the password field is empty on restart, and no keyboard autofill suggests a stored
      credential
- [ ] **清除登录状态** returns to the same anonymous state while the app is running (and **退出** does the same)
- [ ] after restart, the captcha loads again and a fresh login works

If persistent login is later wanted, the requirement from AGENTS.md is Keystore-backed
encryption of the token state only — never the card password, and not `security-crypto`
unless it is current and maintained on this minSdk (24). That work is deliberately not
implemented here because it cannot be validated without a device.

**Checked on 2026-10-05** (device, after a real captcha exchange that ended in 403):
the app's own data directory contains only `files/profileInstalled` and three WebView
preference files, and the WebView cookie store holds **zero** rows — so nothing
session-shaped, and no school cookie, survives anywhere on disk:

```bash
adb shell "run-as cn.scut.bombax ls -laR /data/data/cn.scut.bombax/files /data/data/cn.scut.bombax/shared_prefs"
adb shell "run-as cn.scut.bombax cat /data/data/cn.scut.bombax/app_webview/Default/Cookies" > /tmp/phone-cookies.sqlite
python3 -c "import sqlite3;print(sqlite3.connect('/tmp/phone-cookies.sqlite').execute('select host_key,name from cookies').fetchall())"
```

The restart-behaviour and 清除登录状态 items above still need a logged-in session, so they
stay open.

## 10. Leakage audit (run after the whole session)

```bash
grep -nEi '(TGC|locSession|JSESSIONID|access_token|refresh_token|password|captchaCode|synAccessSource)=[^,;[:space:]]{6,}' \
  /tmp/scutbombax.log | grep -vE '=(present|absent|obtained|cleared|redacted|<opaque>)'
```

Expected output: **nothing**. Any printed line is a real redaction bug in `Diag`;
fix the call site before recording anything else as verified.

Also confirm TLS was never weakened:

```bash
git grep -nE 'X509TrustManager|sslSocketFactory|hostnameVerifier|_cert_pinning|proxy\(' android/app/src/main
```

Expected: no matches (certificate validation stays at OkHttp defaults, no proxy, no
WAF-bypass trick).

**Run on 2026-10-05** over the device log of a real 403 exchange: both printed nothing.
Two more greps belong here now that the app parses an upstream error page — the school's
block page echoes the caller's public address, so that text must never appear either:

```bash
grep -nEi '访问IP|[0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-f:]{16,}:' /tmp/scutbombax.log   # expect nothing
```

Nothing above was reached with a logged-in session, so the audit has to be repeated after
§1–§8 complete.

## Recording template

```text
Date / Android version / device model (no serials, no IMEI):
APK sha256:
Captcha enforced? field names accepted?:            service code seen on wrong captcha:
Login result:                                       campus / refreshToken present:
refresh_token result:                               rotated / new expires_in / TGC / locSession:
GZIC electric / water / ac  (app vs official):
DXC chain first failing hop:
Foreground refresh steps 1-7 observed:
Session restart behaviour:
Leakage audit output:
Remaining protocol uncertainty:
```

### 2026-10-05 (partial — stopped at §0.1)

```text
Date / Android version / device model (no serials, no IMEI): 2026-10-05 / Android 14 (API 34) / Redmi K50, arm64-v8a
APK sha256: 70f3d2fea48d4278ac80d121bb31ad5d99bb630c10b21adcc98089c658088358
Network location: off-campus uplink; card host answered 403, dfyc answered 200 on the same connection
Captcha enforced? field names accepted?:            service code seen on wrong captcha: NOT_REACHED
Login result:                                       campus / refreshToken present: NOT_REACHED
refresh_token result:                               rotated / new expires_in / TGC / locSession: NOT_REACHED
GZIC electric / water / ac  (app vs official):      NOT_REACHED
DXC chain first failing hop:                        not started (needs a session from the card host)
Foreground refresh steps 1-7 observed:              not started (needs a session)
Session restart behaviour: anonymous by construction; on-disk state audited clean (§9)
Leakage audit output: empty (§10)
Remaining protocol uncertainty: everything that requires a logged-in session
Also observed: plugin registered, health() returned over the bridge, UI rendered at 1440x3200
without breakage, and the 403 surfaced on screen as CAMPUS_NETWORK_REQUIRED [captcha/403]
```
