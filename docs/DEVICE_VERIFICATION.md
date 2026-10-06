# Device verification checklist

The credential-bearing steps below stay **NOT_TESTED** until they are executed on a
physical Android phone with the user's own SCUT credentials. The repository ships a
green build and 74 passing JVM unit tests; those prove the code parses the shapes it
has already observed, not that a real login works.

What the device has already confirmed (2026-10-05/06, Android 14 / API 34, arm64-v8a):
the native↔WebView bridge round trip, captcha fetch and rejection (`8002` on a stale code,
accepted when fresh), the secure-keyboard session, the redacted log format, that nothing
session-shaped is persisted, that the card host refuses off-campus source addresses (§0.1),
and that eleven credentialed attempts were rejected with `code=8000` — which is where
§2.1's checklist now points. Those are RUNTIME_VERIFIED. Login itself, and everything that
needs a session, is still DEVICE_PENDING.

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

### 0.2 Credential-free configuration probe (run this before §1)

`frontInfo` is readable from anywhere and states how the school expects a login to look:

```bash
curl -s 'https://ecardwxnew.scut.edu.cn/berserker-app/frontInfo?synAccessSource=h5' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin)["data"];f=json.loads(d["getFrontConfig"]);print(f["loginType"]);print("passwordRule:",f["passwordRule"])'
```

Expected on 2026-10-05: three login types (`card`, `sno`, `sso`), the first two with
`"encryption":"keyboard"` and `"openCaptcha":"1"`, and `passwordRule: a/num/#/leng_8`.
If `card` ever stops being `encryption: keyboard`, the encoding in `SecureKeyboard.kt` is
wrong for that deployment and §2.1 step 1 becomes the first thing to re-test.

## 1. Captcha display

| Step | Expected |
| --- | --- |
| Open the app, look at the captcha tile | A png image renders; tapping it reloads |
| Log | `stage=captcha method=GET host=ecardwxnew.scut.edu.cn path=/berserker-auth/oauth/captcha status=200 ms=...` |
| Log | `stage=login method=POST ...` only after submitting |

Record: whether the image is legible on the phone, and whether every reload returns
a new `key`.

## 2. Captcha is actually enforced (this decides the field names)

Read §0.2 and §2.1 first: since 2026-10-05 the field names and the `8002`/`8003` codes are
no longer guesses — they are what SCUT's own client does. What this step still has to prove
is that **this app's** request is accepted by the school.

The school evaluates the captcha **before** the credential pair whenever the captcha fields are
present (2026-10-06: a stale captcha answered `8002`, a fresh one answered `8000`), so a
deliberately wrong captcha is a cheap experiment that costs the account nothing — do it before
retrying a password.

Submit a deliberately wrong captcha code against a freshly loaded image.

- Expected UI: "验证码不正确或已过期，已为你换一张。" and a fresh image.
- Expected log: `stage=login.captchaForm result=rejected error=CAPTCHA_INVALID status=<n> code=<service code>`

Write down the real `code=` value and compare it with `8002` / `8003`. If it differs, update
all three of:

1. `LoginErrorClassifier.captchaServiceCodes` in
   `android/app/src/main/java/cn/scut/bombax/scut/auth/TokenState.kt`
2. the `8002 / 8003` expectations in `LoginClassificationTest.kt`
3. the "Captcha" section of `docs/PROTOCOL.md`

The field names the app sends (`captcha_header_code`, `captcha_header_key`) are copied from
the official login chunk, so a persistent "captcha always invalid" would point at the
**captcha answer lifecycle** (the `key` expiring, or the keyboard uuid being reused after the
captcha was re-fetched) rather than at the names.

### 2.1 If login keeps answering `code=8000`

Stop after two attempts on the same account. Eleven 8000 responses were logged across
2026-10-05/06 before the causes were found, and SCUT's lockout policy is undocumented in this
repository — repeated wrong passwords are the one way this app can damage the user's account.
A `8002` (captcha) is not in that category: it costs the account nothing.

8000 with the network and captcha steps already green means the school accepted the captcha
and rejected the **credential pair**. Check these in order before blaming the typed password:

1. **the login type.** `frontInfo` offers 账号登录 (`logintype=card`, a 一卡通 account) and
   学工号登录 (`logintype=sno`, a student/staff number), plus 统一身份认证 SSO which involves no
   card password at all. Until 2026-10-06 the app sent `card` for whatever the user typed, and
   the user then reported that the successful control login on `/plat-h5/` was made under
   **学工号登录** — so all eleven attempts presented a valid password in the wrong account
   namespace, which the school answers with the same `code=8000` it uses for a wrong password.
   The login screen now asks (defaulting to 学工号登录) and the native layer refuses an unknown
   value rather than guessing. If a future attempt still answers `8000`, settle this question
   again before touching anything else;
2. **the password encoding.** The submitted value must be
   `<each character substituted through its keyboard row>$1$<keyboard uuid>` — the substitution
   table is the whole point of the endpoint (`docs/PROTOCOL.md` "Secure keyboard"). Neither
   the raw characters nor a digits-only substitution is correct;
3. the field spelling: `loginFrom`, `scope=all`, `device_token=h5`, `synAccessSource=h5`;
4. **isolate the app from the credential**: on the same phone, open
   `https://ecardwxnew.scut.edu.cn/plat-h5/` in the browser and log in there with the same
   account and password — and **note which tab was used**, because that is the answer to
   step 1. If the official page accepts it and this app still gets 8000, the request this app
   builds is wrong; if the official page also refuses it, the app is not the problem and the
   query password needs the school's own reset path;
5. only then, the password itself.

## 3. Login without a captcha

`frontInfo` already answers the question this step used to pose: `openCaptcha:"1"` for the
`card` login, so the official client shows a captcha before the first submit and this app
does the same. Keep the step as a confirmation that the school enforces it server-side too:
with the captcha box empty, submit and read
`stage=login.noCaptcha result=rejected error=... code=...`. A captcha code there means the
server enforces it independently of the client; `code=8000` means credentials were checked
first, as they were on 2026-10-05.

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

### Resolved 2026-10-06/07: the school does not accept the refresh grant

```text
stage=token.refresh POST /berserker-auth/oauth/token status=500 serviceCode=400
stage=token.refresh result=failed status=500 code=400
```

A credential-free control from the phone's own `curl` — same URL, same public client
credential, `refresh_token=not-a-real-token-0000` — answers **HTTP 401**
`{"status":400,"message":"Cannot convert access token to JSON","code":400}`, identically for the
minimal OAuth body and for this app's full body, so the form fields are not the variable and the
grant is wired up at all. The school's own token therefore parses and the server then fails
inside its refresh path. SCUT's published client never sends the grant either
(`grant_type:"refresh_token"` appears 0 times; it writes `refreshObj` and never reads it), which
is the strongest available evidence that this is the deployment's intended behaviour.

What the app does about it, and what §5 therefore no longer asks:

- `refreshSession()` fails closed to `REAUTH_REQUIRED`; the stored password is never replayed;
- the captcha is re-armed so re-login is one tap away;
- a foreground tick is `getBills()` only — the timer never calls the grant, so no interval can
  hammer a request the school rejects;
- "does the refreshed token work for GZIC / can DXC rebuild SSO after refresh" are **not
  applicable**: there is no refreshed token. Re-login re-runs the DXC chain, verified working.

**`expires_in` is in seconds, and the value is `6048000` = 70 days** (the session pill read
`token 剩余 6047998s` two seconds after login, 2026-10-07). That also explains the negative
above: a client that only has to log in once every ten weeks has no reason to implement refresh,
and SCUT's own web client indeed does not. No further refresh requests are needed or wanted —
nothing about this answer changes, and each one costs a needless round trip to the school.

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
### 2026-10-07: the timer fired, and that is how the single-use chain was found

With 自动刷新 = 5 分钟, a login at `00:17:23` was followed by a query at `00:22:23.040` —
exactly one interval later, one query, no retry. The timing behaviour is right. The query itself
failed, because it re-walked the DXC chain while the school still held the DFYC session that the
login walk had created:

```text
dxc.thirdLogin 302 → hop …/sdms-weixin-pay-sp/newWeixin/index.html
dxc.authorize  GET …/newWeixin/index.html status=200     → "dxc.authorize 期望 302，实际 200"
```

Fixed by keeping the DFYC `JSESSIONID` in the in-memory session and going straight to the three
reads on every later query, re-walking the chain only if a read refuses the session. See
`docs/PROTOCOL.md` "DXC billing".

**Confirmed 01:01 on 2026-10-07:** after a login that walked the chain, two manual refreshes
nine and ten seconds later each produced only `dxc.userInfo` + `dxc.ammeterBalance` +
`dxc.waterBalance` (200, `stage=dxc result=ok`) with **no** `redirect`/`thirdLogin`/`authorize`/
`getCode` lines — the DFYC session is reused, 3 requests instead of 7, and the second query no
longer fails. §7 is closed for good.

**Still to confirm with the user:** whether the app was in the foreground or the background at
`00:22:23`. The timer is supposed to stop when the WebView is not visible, and an interval tick
landing exactly on +5:00.0 is what a still-running timer looks like. If it fired while
backgrounded, §8 is not satisfied and the pause path needs fixing — one question, no more
attempts needed.


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

### 2026-10-05, second session (on the campus wireless network — §0.1 cleared, §1 cleared, stopped at §4)

```text
Date / Android version / device model (no serials, no IMEI): 2026-10-05 / Android 14 (API 34) / Redmi K50, arm64-v8a
APK sha256 at the start of the session: 70f3d2fea48d4278ac80d121bb31ad5d99bb630c10b21adcc98089c658088358
Network location: campus wireless; §0.1 prerequisite satisfied (card host answered 200, no 403 block page)
Captcha display (§1): PASS — image legible, every reload returns a new key,
  stage=captcha ... status=200 on each refresh
Captcha enforced? field names accepted?: NOT_REACHED — the school rejected the credential
  pair first, so the captcha branch could not be exercised
Login result: REJECTED, nine attempts, every one:
  stage=keyboard  method=GET /berserker-secure/keyboard status=200
  stage=login.captchaForm method=POST /berserker-auth/oauth/token status=400 serviceCode=8000
  stage=login.captchaForm result=rejected error=INVALID_CREDENTIALS status=400 code=8000
  campus / refreshToken present: n/a
refresh_token result / GZIC / DXC / foreground refresh: NOT_REACHED (no session)
Session restart behaviour: anonymous by construction; on-disk state audited clean (§9)
Leakage audit output: empty (§10) — no IP, SSID, serial, token or captcha answer in logcat
Cause found the same day (SOURCE_VERIFIED, see docs/PROTOCOL.md): the encoder was permuting
  the password through the shuffled keyboard layout instead of submitting
  <chosen characters>$1$<uuid>, and the token field was spelled loginForm instead of
  loginFrom. Both fixed; the clean rebuild now installed is
  app-debug.apk sha256 f9a43d2139b5528ab06ab0c976fc07bd26649b15d1c79c8b46e3b07b0e8ca6d3,
  4779765 bytes (archived at evidence/app-debug-2026-10-05T0214-clean.apk; the earlier
  incremental build of the same sources hashed b66071a392477f1b73394444a67913f48fef5bcf645586eba89bc0178e90c550,
  so APK bytes are a session marker rather than a content hash). Not yet exercised against
  the school — the user was asked to stop retrying to avoid lockout.
Remaining protocol uncertainty: whether the corrected encoding is accepted (needs one
  login), 8002/8003 at runtime, expires_in unit, refresh_token presence and rotation,
  GZIC semantics, DXC chain
```

### 2026-10-06, third session (three login attempts; captcha path closed, login still open)

```text
Date / Android version / device model (no serials, no IMEI): 2026-10-06 / Android 14 (API 34) / Redmi K50, arm64-v8a
APK under test: f9a43d2139b5528ab06ab0c976fc07bd26649b15d1c79c8b46e3b07b0e8ca6d3 (the 2026-10-05 "plaintext" build)
Control: the user logged in successfully on https://ecardwxnew.scut.edu.cn/plat-h5/ with the same
  account and query password, so the credential itself is valid. Which tab was used is not yet known.
Attempt 1, 22:43:04  keyboard 200 -> token 400 code=8002 error=CAPTCHA_REQUIRED
  the captcha on screen had never been re-fetched (no stage=captcha line between 22:38 and 22:43),
  so it was stale; the app swapped a fresh one at 22:43:04.769
Attempt 2, 22:48:15  captcha fetched 22:48:01 -> keyboard 200 -> token 400 code=8000
Attempt 3, 22:48:28  keyboard 200 -> token 400 code=8000
Ordering established: with the captcha fields present the captcha is evaluated FIRST
  (stale -> 8002), and only then the credential pair (fresh captcha -> 8000). The
  2026-10-05 note claiming the reverse was an over-reading of the nine 8000s.
Captcha field names: ACCEPTED by the school — a fresh pair moved the answer to 8000, so
  captcha_header_code / captcha_header_key are no longer DEVICE_PENDING.
8002: RUNTIME_VERIFIED for this app. 8003: still only SOURCE_VERIFIED.
Cause of the 8000s, found afterwards: the 2026-10-05 encoding change was itself wrong. The
  keyboard response is a per-session substitution table over FIXED tile layouts (verified by
  decoding the server's own tile images: digits 0-9, letters in QWERTY order, a 29-glyph
  symbol row), so each character must be substituted through its own row. Reimplemented in
  SecureKeyboard.kt, 74 tests green; the clean build now installed is
  app-debug.apk sha256 c6255c80d06207ce0f04a7844e8364cad09da7cba776677dbc93835f94f424a5
  (4781497 bytes, 23:03; the 22:58 incremental build of the same sources hashed
  18095f723185b11b9cabbe44d729b852fbb63ff262f2d6ccbfd341076a53dfb3) and it has NOT yet been
  exercised — no further attempts were made against the account.
Next, in this order (docs/DEVICE_VERIFICATION.md §2.1): confirm which login type the control
  login used (card vs sno vs SSO), then one attempt with the substitution build.
Session restart behaviour: anonymous by construction; the log capture holds no credential,
  cookie, token, IP, SSID or device serial (§10).
Remaining protocol uncertainty: successful login, expires_in unit, refresh_token presence and
  rotation, GZIC semantics, DXC chain, 8003
```

#### 2026-10-06, same evening: the second cause

Asked which tab the successful control login used, the user answered **学工号登录** — i.e.
`logintype=sno`. The app had been sending `card`, so all eleven attempts presented a valid
password in the wrong account namespace, and the school answers that with the same
`code=8000` it uses for a wrong password. That is independent of the keyboard encoding, which
was also fixed the same evening.

Changes made for it, none of which is exercised yet:

- the login screen asks for the type (default 学工号登录); `index.html` `#login-type`,
  `src/types.ts` `LoginType`, `src/main.ts` passes it through;
- `LoginType.from()` returns null for anything but `card` / `sno` and the bridge answers
  `INVALID_INPUT` with detail `login/loginType` rather than defaulting;
- `TokenState.loginType` records the type, so `refresh` replays it instead of assuming `card`;
- `LoginFormTest` pins both wire values on the password and refresh forms.

77 JVM tests green. Build now installed: `35c80c04f15f22d73d2c9d00ae08a1d4054f10261fc8cc8b3ec173be2151fbbf`
(4,799,939 B, 23:30); its packaged `index.html`, JS bundle and dex were checked by unpacking
(`#login-type`, `logintype`, `login/loginType` all present). The screen itself could not be
photographed — the device is on its lock screen and unlocking it is the user's action.

**Next, in this order:** one attempt with 学工号登录 selected and a freshly loaded captcha.
Nothing else. If it answers `8000`, stop and re-open §2.1 from step 1 rather than trying again.

### 2026-10-06, 23:50 — login succeeded, and the DXC chain came with it

One attempt, after both fixes (row substitution + `logintype=sno`) and a captcha refreshed
seconds before submitting:

```text
23:50:24.888  stage=keyboard 200
23:50:25.153  stage=login.captchaForm POST /berserker-auth/oauth/token status=200 ms=260
23:50:25.159  stage=login.captchaForm result=ok campus=DXC refreshToken=present
              cookies=TGC,error_times,locSession
23:50:25.2xx  dxc.redirect 302 → dxc.thirdLogin 302 (jsessionid=obtained) → dxc.authorize 302
              → dxc.getCode 302 (result=session-established)
              → dxc.userInfo 200 → dxc.ammeterBalance 200 → dxc.waterBalance 200
23:50:25.679  stage=dxc result=ok room=present electric=true water=true ac=none
```

Screen: room rendered, 电费 and 水费 cards populated, 空调 card says 该校区无空调费数据,
最后更新 timestamp shown, 登录成功. (The screenshot is kept in `evidence/` only — it carries
the room identifier and must not be committed.)

Grades this closes: §4 successful login = RUNTIME_VERIFIED; §7 DXC chain = RUNTIME_VERIFIED
end to end for a DXC dormitory; `refresh_token` is issued at login = RUNTIME_VERIFIED (its
acceptance at `/oauth/token` is §5, still open); captcha field names = RUNTIME_VERIFIED.

New fact worth keeping: the card host sets an **`error_times`** cookie, i.e. it counts failed
attempts per session/account. That is the documented reason §2.1 caps live attempts at two —
and, in hindsight, the eleven `code=8000` responses were the counter climbing.

Still open: §5 `grant_type=refresh_token` (next: the 刷新 token button in 会话与诊断),
§6 GZIC (this account is a DXC dormitory; a GZIC query needs a GZIC room), §8 foreground
refresh with a live session, and whether the displayed numbers match the school's own page.

### §9 / §10 re-audited 2026-10-07 01:05 — with a real session live

The earlier audits ran when no session had ever existed, which made them weaker than they
looked. This one ran while the app held a logged-in DXC session (access token, refresh token,
`TGC`, `locSession`, a DFYC `JSESSIONID` and the school's `error_times` all live in memory):

```text
run-as cn.scut.bombax ls -laR          → app_textures, app_webview, cache, code_cache, files,
                                        shared_prefs only
shared_prefs                           → AwOriginVisitLoggerPrefs.xml (mtime today),
                                        CapWebViewSettings.xml, WebViewChromiumPrefs.xml
app_webview/Default/Cookies            → mtime still 2026-10-05 01:16, i.e. never written since
                                        install, and 0 rows in the cookies table
grep -ril "TGC|locSession|JSESSIONID|access_token|berserker|scut"
     shared_prefs, Local Storage, Session Storage, files   → no matches
```

And over the whole 94-line session log (`evidence/logcat-2026-10-07T0101-dxc-reuse-verified.txt`),
covering captcha, keyboard, login, the DXC chain, its reuse and the failed refresh grant:

```text
TGC=<value>  locSession=<value>  JSESSIONID=<value>  synjones-auth=<value>
access_token  Bearer <token>  refresh_token=<value>  password=  → 0 hits each
any 11+ digit run (student number)  any 32-hex string  any IPv4  device serial  → 0 hits each
```

So "session state is memory-only, and the password is never persisted" is now verified against a
live session rather than argued from the code. §9 and §10 are closed.
