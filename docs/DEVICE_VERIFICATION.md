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

### 2026-10-07, 20:02 and 20:19: the DFYC session expires, and it says so with a 302

A query 49 minutes after login answered `dxc.userInfo 302` and the user was told
**上游暂不可用** — a wrong diagnosis produced by our own classification: a redirect is not an
outage. Fixed the same evening (`DxcSession.isStale` + one rebuild, then the reads), and
verified on the device:

```text
20:19:58  dxc.userInfo 302 → result=session-stale detail=dxc.userInfo/302 target=…/oauth/authorize
20:20:09  redirect → thirdLogin → authorize → getCode → session-established
20:20:09  userInfo 200 · ammeterBalance 200 · waterBalance 200 → result=ok
```

A second defect surfaced while testing it: a restored session armed the timer from stored
preferences and then relied on that timer for its first query — but the page can still report
itself hidden at that moment, so nothing queried and the pill said 已登录 over empty cards
again. `boot()` now always runs one `restore` query.

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

**Changed on 2026-10-07.** Through the first successful login the session was memory-only, so a
restart meant a clean logout. That behaviour is now deliberately replaced: the school's access
token is valid for 70 days, and losing it to a process death meant retyping account, password
and captcha for no reason. `SessionStore` can now hold a Keystore-encrypted copy of the token
state.

What is on disk, and where:

| Location | Contents | Sensitive? |
| --- | --- | --- |
| `noBackupFilesDir/scut-session.bin` | AES/GCM blob of `TokenState`: access token, refresh token, expiry, token type, `TGC`, `locSession`, display name, `sno`, campus, login type, DFYC `JSESSIONID`. Key is a non-exportable Android Keystore key | Yes — treat as a credential file, hence `noBackupFilesDir` (outside auto backup and `adb backup`) |
| WebView `localStorage`, key `bombax.prefs.v1` | campus, login type, refresh interval | No — three UI choices, no account, no token |

Never written anywhere: the card password, the captcha answer, the keyboard uuid. There is no
field in `TokenState` for any of them, and `SessionPersistenceTest` pins the exact key set of
the serialised record so a future field cannot add one quietly.

Verified on the device on 2026-10-07, in this order, with one login:

- [x] **the record is written and is opaque.** `no_backup/scut-session.bin`, 1561 bytes, mode
      `-rw-------`, first bytes `01 0c …` (envelope version, then a 12-byte nonce length).
      Grepping the file for `accessToken`, `TGC`, `locSession`, `JSESSIONID`, `DXC`, `sno` or
      the display name returns nothing.
- [x] **a process death does not log out.** `am force-stop` + relaunch →
      `stage=session result=restored campus=DXC refreshToken=present expiresIn=6047797s`, the
      pill shows 已登录, and the page then queries on its own: three reads
      (`dxc.userInfo` / `ammeterBalance` / `waterBalance`, all 200) with **no** chain hops, so
      the stored DFYC session survived too. `expiresIn` counting down across the restart also
      settles the `expires_in` unit question: seconds, 70 days.
- [x] **pressing Back does not log out** — the `dropMemory()` path, which is what the first
      implementation got wrong by calling `clear()`.
- [x] **退出 wipes both copies.** `stage=logout result=cleared`, `no_backup/` is empty
      afterwards, and the next start is anonymous with a fresh captcha.
- [x] **the UI choices survive independently of the session.** After 退出 and a reinstall the
      form still shows DXC · 大学城校区 and 学工号登录 while 未登录 — those come from
      `localStorage`, and the HTML default is GZIC, so the restore is visible.
- [ ] an expired record is dropped on arrival (`result=discarded reason=expired`) — unit-tested
      only; 70 days is not a window anyone is going to wait out.
- [ ] a Keystore key that no longer exists yields `result=discarded reason=undecryptable` rather
      than a crash — unit-tested with a different key; not reproducible on this device without
      wiping app data.

Two findings from this run, both fixed the same evening: the startup probe caught
`Provider AndroidKeyStore does not provide AES/GCM/NoPadding` and a one-byte-short nonce
packing (`ArrayIndexOutOfBoundsException`), and a restored session used to render 已登录 over
an empty card set because nothing queried — `boot()` now runs one `restore` query and the
campus picker follows the session instead of the HTML default.

The 2026-10-05 and 2026-10-07 runs below are kept because they are what justified the original
claim; they describe the memory-only build, not this one.

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

## 11. UI rewrite smoke list (2026-10-07)

The front-end was rewritten the same day into a single-column, one-screen-at-a-time layout
(`v0.1-classic-ui` keeps the old one). The Kotlin/OkHttp layer is byte-for-byte unchanged, so
every protocol grade above still applies; what changed is which DOM the verified paths drive.

Already seen on the device: signed-in screen in both light and dark, the three figures, the
collapsed diagnostics, and the stored 30-minute interval restored as selected.

Not yet seen on the device, because the login form is hidden while a session is live and
checking it means logging out:

- [ ] the login form renders correctly when signed out (two selects, account, password,
      captcha row, submit) and a real login still works through it
- [ ] 换一张 and tapping the captcha image still swap the image
- [ ] the error line under the form still carries the redacted `CODE [stage/status]` text
- [ ] 退出 from the new layout returns to the signed-out screen and wipes the stored session
- [ ] the diagnostics panel still shows 会话：… and the log lines

None of these is a protocol question; they are layout and wiring. Run them at the next natural
re-login rather than spending a credential attempt on them deliberately.

## 12. Persistent notification capability (2026-10-07)

Setup on the device: 常驻通知 switched on, 自动刷新 = 5 分钟, app sent to the launcher at
`23:30:48`. Three separate questions, and they have separate answers:

```bash
adb shell pidof cn.scut.bombax                                   # process alive?
adb shell dumpsys activity services cn.scut.bombax | grep -c BalanceNoticeService
adb shell dumpsys notification | grep -c 'cn.scut.bombax|176'    # notification posted?
adb logcat -d -s ScutBombax:V | awk '$2>"23:30:50"'              # did anything query?
```

Observed at the moment of enabling: `stage=notice result=shown updated=23:28:49`, one
notification record on channel `bombax.balance` (importance 2, ongoing, no sound,
`VISIBILITY_PRIVATE`), and `BalanceNoticeService` listed as a running service.

Whether the hidden WebView's interval timer keeps firing was measured over two intervals with
the app on the launcher. Result, 23:30:48 → 23:40:06 with a 5-minute interval:

```text
process                pid 23566 unchanged — survived
foreground service     BalanceNoticeService still registered
notification           record present on channel bombax.balance
queries while hidden   4 complete cycles between 23:34:02 and 23:34:13  ← 11 seconds
```

So the answer to "does polling continue when backgrounded" is **yes, and that is a problem**:
one tick was owed and four requests went to the school. The OEM freezer makes the page report
itself visible repeatedly, and every flip legitimately looked like "the interval elapsed,
catch up now". This also retro-explains the six queries in seven seconds seen earlier the same
day, which had been put down to taps.

Fixed by a spacing floor in `AutoRefresher`: at most one query per `MIN_TICK_SPACING_MS`
(60 s) regardless of how many timers, flips or resumes arrive, with the single bounded network
retry deliberately exempt because AGENTS.md wants that one in seconds. A refused tick waits
out the remainder of the floor rather than rescheduling from `lastFinishedAt`, which for a
stale timestamp would land at delay 0 and busy-loop — the first version of the guard did
exactly that and the fake-clock test caught it.

Re-measured with the floor in place — same setup, backgrounded at `23:45:11`, checked at
`23:52:53`, a 7 m 42 s window in which one 5-minute tick was owed:

```text
process / service / notification   all alive throughout
ScutBombax log lines in the window 0        ← not one query, not one retry
```

So the two measurements together say: **the persistent notification works, and background
polling does not.** The four queries seen earlier were not the interval timer running in the
background — they were freeze/thaw visibility flips taking the catch-up path, and with those
capped the hidden WebView's timers simply do not fire on this device. Practical meaning of
what is shipped: the notification keeps showing the numbers from the last query the app made
while it was visible, and goes quiet (not stale-but-updating) once you leave it.

Making it update on schedule in the background would need the service to own the clock
(a `Handler` in the service, or `AlarmManager`/`WorkManager`). That is a larger departure from
AGENTS.md than the notification itself, it is the difference between "shows a number" and
"keeps asking the school when nobody is looking", and it has **not** been done. It needs an
explicit decision, and if taken, a rate that is defensible to the school (tens of minutes, not
minutes).

That decision was taken on 2026-10-08, at the more conservative end: **once a day**, and it is
measured in §13.

## 13. Daily background refresh (2026-10-08)

What had to exist before a background query was possible at all: the OkHttp client, the cookie
jar, the session and the single-threaded `scut-io` queue used to live inside `ScutApiPlugin`, so
a service that queried on its own would have had a second set of each — and two queues means two
requests in flight, which is the one invariant AGENTS.md states outright. They now live in
`ScutRuntime`, one object per process, shared by the plugin, the service and the alarm receiver.

Authorisation: the user asked for a persistent notification on 2026-10-07 and, when offered a
background cadence, chose one day ("每天可以吧", 2026-10-08). This is the second deliberate
departure from AGENTS.md's "no background Service / no WorkManager", and it is *not* WorkManager:
an inexact `setAndAllowWhileIdle` alarm, no new permission, no boot receiver. Off by default.

Rules the code is built around, all of them verified below:

- one query per day per device, and only ever on the shared queue;
- the service never logs in — no password, no captcha, so a missing session means a message, not
  an attempt;
- a failure keeps the last numbers on the shade instead of showing "unknown";
- the daily switch implies the notification, and turning the notification off turns the daily
  path off with it.

### 13.1 Arming and cadence

Turning the switch on at `00:57:59` produced:

```text
stage=daily result=armed dueInSec=86400 api=34
```

and one `AlarmManager` entry, visible to the system as an inexact `RTC_WAKEUP`:

```bash
adb shell dumpsys alarm | grep -A2 bombax
#   RTC_WAKEUP #46: Alarm{... type 0 origWhen <now+24h> ... cn.scut.bombax}
#     tag=*walarm*:cn.scut.bombax.action.DAILY_REFRESH
```

### 13.2 The real fire, backgrounded

To get a genuine `AlarmManager` delivery without waiting a day, the stored anchor was rewritten
to 25 hours in the past through `run-as` and the app was reopened, which is exactly the code path
a reboot or a lost alarm takes:

```text
01:08:34  stage=daily result=armed dueInSec=60      ← catch-up from an overdue anchor, not "now"
01:08:44  ActivityManager: Background started FGS: Allowed [uidState: TOP; code:PROC_STATE_TOP]
01:08:44  stage=notice result=shown updated=—
01:08:49  (home button — app backgrounded)
01:10:19  stage=daily result=armed dueInSec=86354
01:10:19  stage=daily result=fired start=foreground-service nextInSec=86354
01:10:19  stage=notice result=shown updated=—
01:10:29  stage=dxc.userInfo ... status=-1 ms=10013 io=SocketTimeoutException
01:10:29  stage=daily result=failed reason=NETWORK
```

Four things in that window are worth stating precisely:

1. **The inexact alarm fired while the app was on the launcher**, 45 s later than its nominal
   time (01:09:34 → 01:10:19). That gap is the scheduler's flex, not a bug, and it is why the
   UI says "下次约 …" instead of a minute.
2. **The cadence self-corrects**: the next wake was armed for `86354` s, i.e. 24 h after the
   *scheduled* time, not after the late delivery. Anchoring on the delivery time would push the
   refresh later every day.
3. **The query ran on the shared queue** — thread `1431`, the same `scut-io` worker the WebView
   uses. The boot `startNotice` call is independent evidence of the serialization: it was issued
   at once and executed at `01:08:44.904`, the millisecond the 10-second restore query freed the
   queue.
4. **The failure path is honest**: after the timeout the notification kept its numbers and grew
   a reason, `flags=0x6a` (ongoing, no-clear, foreground, alert-once):

```text
android.title   宿舍
android.text    电 — · 水 —
android.subText 更新 — · 刷新失败
```

### 13.3 The one thing that does not work, and what it forced

The same fire, measured earlier with the notification service *not* running:

```text
01:02:34  ActivityManager: Background started FGS: Disallowed
          [uidState: RCVR; uidBFSL: n/a; act=cn.scut.bombax.action.REFRESH; code:DENIED]
01:02:34  stage=daily result=start-refused reason=BackgroundServiceStartNotAllowedException
01:02:34  stage=daily result=fired start=refused nextInSec=86354
```

Android 12+ does not treat an *inexact* alarm as an exemption for starting a foreground service,
and the plain `startService` fallback is refused too (`code:DENIED`, the caller is only a
broadcast receiver). So the daily path is only reachable while the notification's service is
already alive — which is what "每日后台刷新 implies 常驻通知" means in practice, and it is now
enforced on both sides: the page refuses the switch without the notification, and the page
re-starts the notification on every open if the daily switch is armed. Before that fix a
force-stop left the alarm armed with nothing to wake, which is the state that produced the log
above. Making it survive a real kill anyway would need an exact alarm (`SCHEDULE_EXACT_ALARM` is
not a permission this app should ask for) or `WorkManager`, and neither was taken.

**Amended 2026-10-08 while building §14:** the plain `startService` fallback mentioned above has
been removed, because it was worse than the refusal it was meant to soften. A service started as a
foreground service that then gets refused by `startForeground` is not merely ignored — Android
records it as *crashed* and kills the process. See §14.2 for the reproduction and the fix. The
conclusion of this section is unchanged: the daily path is reachable only while the notification's
service is already alive.

Related, and the reason the alarm is re-armed on every app open: **installing and force-stopping
both clear the app's alarms** —

```text
01:04:19  ActivityManager: Force stopping cn.scut.bombax appid=… user=-1: installPackageLI
01:04:19  AlarmManager: Package cn.scut.bombax, uid … lost permission to set exact alarms!
```

### 13.4 Session and identity across a process death

```text
01:08:34  stage=session result=disk-ready path=noBackupFilesDir
01:08:34  stage=runtime result=ready api=34 release=14 userAgent=cached
01:08:34  stage=session result=restored campus=DXC refreshToken=present expiresIn=6026683s
```

`userAgent=cached` is the second half of the runtime hoist: the daily alarm can start the process
with no WebView, and the one header the whole protocol was verified with is the WebView's. Only
its presence is ever logged — the string names this device.

### 13.5 Not verified

- **A successful background update.** Every background attempt in this session failed with
  `NETWORK`: the dormitory wifi was sitting on a captive portal, where `plat.hf.scut.edu.cn` does
  not resolve and TCP/443 to the DFYC host times out. The mechanics (wake → service → queue →
  request → classify → display) are measured; the number changing on its own is not.
- The daily fire arriving after the Activity was destroyed with Back but the service still alive
  (the `dropMemory` + queue-outlives-the-Activity combination). Logic is covered by §9's
  persistence results and by the spacing tests; the combination is not.
- The "a placeholder payload must not wipe the cached numbers" rule in `NoticeData.of`: in this
  run both the payload and the cache were placeholders, so the branch never had anything to
  protect.

Evidence: `evidence/logcat-2026-10-08-daily.txt` (sha256 `8923d792…`) was captured on the build
immediately before the two front-end fixes in §13.6 — the Kotlin daily path is identical in both,
and the installed build is `evidence/app-debug-2026-10-08-daily.apk` (sha256 `af2113fb…`), with
§13.6's screen in `evidence/phone-2026-10-08-daily-ui.png`. Host-side tests: 99 JVM (8 of them
the cadence maths) + 17 vitest.

### 13.6 What the screen showed, and two bugs it exposed

With both switches on and no successful query in the session, the signed-in screen renders:

```text
已登录 · 宿舍 · 电费余额 平台返回余额 · 元 · 水费 —
常驻通知 ☑   每日后台刷新 ☑  一天一次，只查余额不登录。下次约 23 小时 50 分后
```

Two defects came out of looking at it rather than at logcat, and both are fixed here:

- **The air-conditioning row was visible with no data.** It is meant to appear only when upstream
  actually returns an AC figure (`renderBills` hides it), but on a *restored session with a failed
  first query* nothing had called `renderBills` yet, so the row sat there showing its HTML
  placeholder — the opposite of what the user asked for on 2026-10-07 ("把空调费去掉"). The row is
  now `hidden` in the markup and the data layer unhides it, so absence is the default.
- **The next-wake hint went stale.** It was computed once at boot, so a page left open across a
  fire kept saying 下次约 1 分后. `noticeStatus()` is now re-read whenever the page becomes
  visible, which is also the moment the alarm may have moved.

Tooling note for the next reader, because it wasted ten minutes: `uiautomator dump` reports
`checked=false` for both boxes while the screenshot plainly shows them ticked. The accessibility
node reflects the HTML attribute, not the DOM property that `input.checked = true` sets. Judge
checkbox state from a screenshot or from the page's own `noticeStatus()` console line — the
`enabled=true` on the daily row was the reliable signal here, since the code only enables that
switch while the notification is implied.

## 14. v0.2a: local history, the 23:00 slot, and one crash (2026-10-08)

Scope of this step, from `docs/PRODUCT_REQUIREMENTS.md`: record every successful balance query
into a local series, fall back to the newest stored reading when the school cannot be reached,
and move the nightly sample from "24 hours after the switch" to **23:00 Beijing time**. Charts
wait until there is data to draw.

### 14.1 The slot, verified the moment it was installed

```text
12:20:33.719  stage=daily result=armed dueInSec=38366 api=34
```

12:20:33 + 38 366 s = **23:00:00**, to the second. That is the whole point of the change: the
switch was turned on at 00:57 the previous night, and under the old interval logic the sample
would have tried to happen at 00:57 every day — after the dormitory network's ~00:06 cut-off, and
at a time that meant nothing. The same computation now runs on every app open and is idempotent,
so the anchor bookkeeping (and the drift question in §13.2) is gone rather than fixed.

Twelve host tests cover the rule, including: a delivery 45 s late still yields tomorrow's 23:00
(no drift, by construction), a device set to UTC or Los Angeles computes the same instant, and
"exactly 23:00:00" never arms an alarm at `now`.

### 14.2 A crash the new code caused, and what it taught

The first install of this step was launched over adb while the screen was off. The page booted,
the restore query timed out after 10 s, and the boot path that re-starts the notification ran:

```text
12:20:46.482  ActivityManager: startForegroundService() not allowed due to mAllowStartForeground false
12:20:46.545  ActivityManager: Service.startForeground() not allowed due to mAllowStartForeground false
12:20:46.601  ActivityTaskManager:   Force finishing activity cn.scut.bombax/.MainActivity
12:20:46.856  ActivityManager: Process cn.scut.bombax (pid 9550) has died: fg  SVC
12:20:46.858  ActivityManager: Scheduling restart of crashed service … in 1000ms for start-requested
12:20:48.706  ActivityManager: Process cn.scut.bombax (pid 9900) has died: fg  SVC
12:20:48.707  ActivityManager: Scheduling restart of crashed service … in 1800000ms for start-requested
```

Two processes, 1.2 seconds apart, then a **30-minute** backoff. The mechanism is the part worth
remembering: `startService` as a fallback for a refused `startForegroundService` *succeeds*. The
service then runs, calls `startForeground()`, is refused again, and a service that was started in
the foreground state but never goes foreground is treated as crashed — the system kills the host
process rather than quietly ignoring it. The fallback that §13.3 recorded as "also refused, so we
log it" was therefore not a safety net at all; in the state where it succeeded it was the crash.

Three changes, all in `BalanceNoticeService`:

- the `startService` fallback is gone. A refusal is reported as `refused` and nothing starts;
- `startForeground()` itself is wrapped: on refusal the service logs
  `result=not-foregrounded`, clears `noticeRunning` and **`stopSelf()`s**, so the worst case is a
  missing notification rather than a dead app;
- `onStartCommand` returns `START_NOT_STICKY` after such a refusal, so the system does not
  re-restart something that has already told us it cannot run.

Honest status, updated minutes later on the same build: the **throwing** variant of the refusal was
reproduced and is now handled cleanly —

```text
12:30:18.191  stage=dxc.userInfo … io=SocketTimeoutException
12:30:18.218  ActivityManager: Background started FGS: Disallowed [uidState: TPSL; code:DENIED]
12:30:18.218  ActivityManager: startForegroundService() not allowed due to mAllowStartForeground false
12:30:18.223  stage=notice result=start-refused reason=ForegroundServiceStartNotAllowedException
```

`pidof` still returns the same process afterwards, there is no `has died: fg SVC`, and no
`Scheduling restart of crashed service` — the refusal is reported and the app keeps working, which
is exactly the behaviour the fallback used to destroy.

The **non-throwing** variant (the one that actually crashed: `startForegroundService` accepted,
`startForeground()` refused) has not been reproduced against the fixed build. `show()`'s catch is
therefore reasoned from the 12:20 system logs rather than observed; tonight's 23:00 delivery is the
first natural chance to see it.

### 14.3 The history store, now with rows in it

The dormitory network came back at 13:14, so this section was rewritten from "created and empty"
to the real thing. A successful query produced the first rows:

```bash
adb shell run-as cn.scut.bombax sqlite3 no_backup/bombax-history.db \
  "select recorded_at, electric, water, source from balance_snapshot order by recorded_at desc;"
# 1791436553952  31.13  28.2  restore
# 1791436474577  31.15  28.2  unknown
```

The write path works, the values are right, and the two rows 79 seconds apart were **not**
deduplicated — correctly, because the electricity figure had moved (31.15 → 31.13); the 90-second
rule only suppresses a repeat of the *same* event.

The `unknown` on the first row is a real bug this feature caught in its own first hour. Capacitor
delivers plugin arguments as a JSON **object**, so `getBills("restore")` never reached
`call.getString("source")` and every row would have been mislabelled. Fixed in `bridge.ts` by
passing `{ source }`; the second row is labelled `restore`, and the first is left as `unknown`
rather than quietly rewritten — that is what the value means. It is also exactly why `UNKNOWN`
exists as an enum case instead of defaulting to `manual`.

### 14.4 The offline fallback, verified with the radio off

Wi-Fi and mobile data were switched off and the app cold-started, so the restore query failed on
DNS (`io=UnknownHostException`, 7 ms) rather than on a timeout:

```text
13:17:03.585  stage=session result=restored campus=DXC refreshToken=present expiresIn=5982974s
13:17:03.677  stage=dxc.userInfo … status=-1 ms=7 io=UnknownHostException
13:17:03.704  stage=notice result=shown updated=13:15:53
```

The screen showed the last stored reading — 电费余额 31.13 元, 水费 28.2, 更新 13:15:53 — under
the caption **"显示的是 今天 13:15 的历史记录（当前无法连接校园一卡通），不是实时余额"**, with
网络暂时不可用 below it and the snapshot row still reading 下次约 9 小时 43 分后 (= 23:00). The
notification re-posted the same cached figures. Nothing on the screen claimed to be live.

The screenshot itself is **not archived**: it shows the room number, which is an identifier in the
same category as a student number for this project, and the rule in §10 is that identifiers stay
out of the evidence. The log lines above are what was kept.

### 14.5 v0.2a acceptance status

| Item | Grade |
| --- | --- |
| A successful query writes exactly one row, from one place | RUNTIME_VERIFIED 2026-10-08 13:14 |
| A failed query writes nothing | RUNTIME_VERIFIED — the offline cold start added no row |
| Duplicate suppression keeps a real flat reading | UNIT_TESTED; the live case (changed value, 79 s apart, both kept) is RUNTIME_VERIFIED |
| Offline display names its own age and says it is not live | RUNTIME_VERIFIED 2026-10-08 13:17 |
| The nightly slot is 23:00 Beijing, not "24 h after the switch" | RUNTIME_VERIFIED — `dueInSec=34976` from 13:17:03 = 23:00:00 |
| A refused foreground start no longer kills the process | RUNTIME_VERIFIED for the throwing variant (12:30:18, process survived); the non-throwing variant of §14.2 is still unobserved |
| **Tonight's 23:00 delivery, end to end** | **PENDING** — the first real sample, and the first natural test of the refusal path in the other direction |
| Water's unit | Still an inference from the field names; one look at the official page closes it |

### 14.6 Version 0.2.0 and the release key

`versionCode 2` / `versionName 0.2.0` in `android/app/build.gradle`, `package.json`, and the
plugin's fallback string. Both variants rebuilt; the release APK was re-signed and its certificate
digest compared against the one recorded in the README:

```bash
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
# Signer #1 certificate SHA-256 digest: ef607f9df8e7872c9008d6aaf35da6d5ee69db217a97bc7b0f6d191629ff89d4
```

Identical — the same key that signed the first release build. **Not installed**: switching to the
release signature means uninstalling the debug build, which deletes the Keystore session *and* the
history database, and the user's instruction is to hold until they confirm the swap. The ordering
note worth keeping is that the history is only two rows deep today, so the cost of switching now is
two rows; after a month of nightly samples it would be a month.

## 15. Release 0.2.0 on the phone (2026-10-08, in progress)

The user approved the signature swap and explicitly allowed the data wipe: no import/export
feature is being built for a handful of snapshots, so the debug build's session and history
database were discarded rather than migrated. The pre-swap state is recorded in
`evidence/release-swap-2026-10-08.txt` — a **record, not a restore path**: an uninstall takes
`/data/data/cn.scut.bombax` with it, and a release build cannot read a debug build's private
directory, so nothing can be put back without a designed export/import feature.

### 15.1 What the swap proved

```bash
adb uninstall cn.scut.bombax && adb install .../release/app-release.apk
adb shell dumpsys package cn.scut.bombax | grep flags
```

```text
versionCode=2  versionName=0.2.0  flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]
```

No `DEBUGGABLE` — the phone is running the signed release build now. `apksigner verify` exits 0
and the certificate digest is still `ef607f9d…`, the same key that signed the first release APK,
so the update path from here on is in-place rather than another wipe.

First launch of the release build, on a device that had just lost its Wi-Fi association:

```text
14:32:15.053  stage=session result=disk-ready path=noBackupFilesDir
14:32:15.053  stage=runtime result=ready api=34 release=14 userAgent=absent
14:32:15.056  plugin=ScutApi ready api=34 release=14 bridge=2
14:32:15.529  stage=captcha … status=-1 ms=6 io=UnknownHostException
```

Four things worth naming, because each is a different claim:

- the **Keystore-backed session store initialises on a release build** (`disk-ready`). This is not
  automatic: the debug build had been the only thing ever exercising it, and a release signature
  changes the Keystore key's owning UID, so a fresh key had to be generated and probed;
- `userAgent=absent` is the correct clean-install state, and it is the same code path the nightly
  alarm depends on — the first query after a login will cache the WebView UA for future cold
  starts;
- the captcha request failing in 6 ms with `UnknownHostException` is the honest answer for a
  device whose Wi-Fi shows `Supplicant state: DISCONNECTED`, and the app surfaced it as a network
  error without crashing;
- `POST_NOTIFICATIONS: granted=false` and **zero pending alarms** are both correct for a fresh
  install with no session: the permission is asked for when the user turns the notification on,
  and 晚间余额快照 deliberately refuses to arm without a session to query with.

### 15.2 Still pending, and who can do each

| Item | Blocked on |
| --- | --- |
| Login + first query on the release build | **the user**: unlock the phone, rejoin campus Wi-Fi (or the school SSL VPN), authenticate the portal, then enter account / password / captcha. Credentials are never typed by the assistant and never logged |
| First nightly-capable snapshot row | the login above |
| Offline cold start showing history with the 历史记录 caption | one successful query first |
| 常驻通知 toggle and the runtime permission prompt | the user's tap |
| 23:00 alarm registered from the release build | a session existing |
| Tonight's 23:00 delivery: no crash, refusal recorded if the system denies it, one `nightly` row if the request succeeds, no catch-up if it is missed | the above, plus the phone being on and the service alive |

If tonight's 23:00 attempt fails on the network it still verifies scheduling and service
lifecycle, and it must be recorded as a failed sample rather than a snapshot — a missed slot is
left missed, by design.

### 15.3 Release acceptance, item by item (17:00–17:09)

```text
16:58:12.698  stage=history result=recorded source=restore electric=true water=true ac=false
16:58:29.209  stage=notice  result=shown updated=16:58:12
17:03:00.523  stage=daily   result=armed dueInSec=21419          ← 17:03:00 + 21419 s = 23:00:00
17:05:27.765  stage=dxc.userInfo … io=ConnectException  (offline, dead-proxy trick)
17:05:27.777  stage=notice  result=shown updated=17:01:04        ← cached figures, cached time
17:09:06.010  dxc.userInfo / ammeterBalance / waterBalance 200   ← three requests, no chain re-walk
17:09:06.096  stage=history result=recorded source=restore
17:09:06.117  stage=notice  result=shown updated=17:09:05
```

| Item | Result |
| --- | --- |
| Login on the release build | RUNTIME_VERIFIED — the user logged in once, first try; the token came back with `expiresIn=6047594s` ≈ 70 days |
| In-place release → release update keeps the session | RUNTIME_VERIFIED — three reinstalls, each followed by `result=restored`, no re-login needed. This is the whole point of having a private signing key |
| First snapshot row written | RUNTIME_VERIFIED — `result=recorded source=restore` |
| Offline cold start shows history, labelled | RUNTIME_VERIFIED — screen text read out of the accessibility tree: "显示的是 今天 17:01 的历史记录（当前无法连接校园一卡通），不是实时余额" |
| Notification permission flow | RUNTIME_VERIFIED after the fix below — dialog → 允许 → notice posted without a second tap |
| 23:00 alarm registered, and re-armed after a kill | RUNTIME_VERIFIED — `origWhen 1791471600000` = 23:00:00 Beijing, present again after each `force-stop` |
| Cached-display rule from §13.5 ("not verified") | **now verified** — offline, the shade kept the 17:01 figures rather than showing the placeholder the page sent |
| Tonight's 23:00 delivery | PENDING |

Two bugs surfaced by testing on a release build specifically, because a release build is the only
place they could show up:

1. **`run-as` refuses, so the history was invisible.** `run-as: package not debuggable` is the
   correct security posture, and it also means the write path has no observable effect on the
   device a user actually holds. Fixed by logging a redacted line on every accepted row —
   presence flags only, no room, no grouping key, no balance, no timestamp, with two tests that
   fail if any of them appear.
2. **The permission callback signature crashed the app.** The first version of
   `requestNoticePermission` answered with the pre-dialog state, so the page reverted its own
   switch and the user had to toggle twice; the fix — Capacitor's
   `requestPermissionForAlias(alias, call, callbackName)` — then crashed with
   `IllegalArgumentException: Wrong number of arguments; expected 2, got 1` at 16:54:24, because
   `Plugin.triggerPermissionCallback` invokes `method.invoke(this, savedCall)`: **one argument**.
   The grant map is not passed to the callback. Fixed and re-verified end to end; the signature
   requirement is now written down next to the method, because the javadoc does not say it.

Also worth keeping: **how to test the offline path without touching Wi-Fi.** `svc wifi disable`
works but drops the association, and an open campus network will not auto-join afterwards — that
cost 40 minutes of manual rejoining earlier today. `settings put global http_proxy 127.0.0.1:1`
fails every connection in 2 ms instead, leaves the association intact, and is undone with
`:0`. Verified by a 200 from the captcha endpoint after restoring.

## 16. History outside the login gate (PR #1 follow-up, host-verified)

The trend panel and the offline caption both lived inside `#results-panel`, which is hidden when
there is no session — so the feature that exists for "the network is down / the session expired /
I signed out" was unreachable in exactly those three states. The same rule was broken from the
other side by `renderSession`, which called `renderBills(null)` on sign-out and blanked figures
the device still held.

Restructured: `#history-panel` (reading, caption, trend) is shown whenever there is something to
read, `#results-panel` now holds only what can reach the school (query, auto-refresh, the two
notification switches, logout), and `#login-panel` is shown whenever there is no session. All
three are set in one place, from `deriveView({ authenticated, live, hasHistory })` in
`src/view.ts` — a pure function with nine host tests, because "every caller remembers to gate and
label correctly" is the assumption that produced the bug.

Two rules worth stating:

- **The caption is produced by the view, not by the caller.** Anything on screen that is not a
  live reading gets `显示的是 … 的历史记录…不是实时余额`, with its own timestamp, whether the
  reason is a network failure, an expired session or simply signing out. A caller can no longer
  paint a stored reading and forget to label it.
- **A live reading owns the screen.** `showLastKnown()` returns early while `state.live` is true:
  the stored row behind a fresh query is the same number one round trip older, and painting it
  would replace a live figure with a stale one and then have to describe the result as history.

`清除本机历史` is now a separate action under 会话与诊断, behind its own confirmation, and
`退出` no longer touches it. `window.confirm` failing open would be the wrong direction, so the
handler requires a truthy answer before calling `clearHistory()`.

**Status: host-verified only.** `pnpm build`, 39 vitest (17 refresh + 13 trend + 9 view),
`check:dom` and 116 JVM tests pass, and the release APK builds. It is **not installed**: tonight's
23:00 sample has to be taken by the build already on the phone, and an install would clear the
alarm and stop the service mid-window. Device acceptance of the five states — signed in, signed
out with history, signed out without history, after 退出, after a session expires — follows the
23:00 check.
