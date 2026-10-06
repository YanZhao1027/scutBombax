# SCUT protocol notes

This document separates **known observations** from **items that still require device verification**.
Every `DEVICE_PENDING` row below is closed by working through
[DEVICE_VERIFICATION.md](DEVICE_VERIFICATION.md) on a physical phone.

Source references:

- `Naptie/scut-notipay`
- `YanZhao1027/scut-notipay`
- `YanZhao1027/scut-notipay` branch `cf-web`

## Evidence grades used here

```text
RUNTIME_VERIFIED  observed in a live response (status and/or body) on the date
                  given, from this workstation or from the physical device, with
                  no user credentials involved
SOURCE_VERIFIED   taken from a source of record: SCUT's own published client code,
                  or the old working implementation
HYPOTHESIS        inherited assumption, not yet proven against SCUT
DEVICE_PENDING    can only be closed by a logged-in trace on a physical phone
```

| Item | Grade | Still open |
| --- | --- | --- |
| captcha endpoint and `{key, image}` shape | RUNTIME_VERIFIED 2026-10-05 | no |
| secure-keyboard endpoint and its four token rows + tile layouts | RUNTIME_VERIFIED 2026-10-06 (credential-free; tile images decoded) | no |
| OAuth error envelope and `code=8000` = credential failure | RUNTIME_VERIFIED 2026-10-05 (empty-credential probe) | no |
| card host answers `403` for any off-campus source address | RUNTIME_VERIFIED 2026-10-05 (physical device, both address families) | no |
| `code=8002` = the captcha was rejected, and it is evaluated before the credential check | RUNTIME_VERIFIED 2026-10-06 (device, stale captcha + otherwise valid request) | whether `8003` also appears |
| SCUT login types: `card` / `sno` (both `encryption:"keyboard"`, `openCaptcha:"1"`), `sso` | SOURCE_VERIFIED 2026-10-05 (`frontInfo`, credential-free) | no |
| which login type the user's account belongs to | **RUNTIME_VERIFIED 2026-10-06**: `logintype=sno` (学工号登录) logged in; `card` never did | whether any account needs `card` |
| password submitted as `<row-substituted characters>$1$<keyboard uuid>` | **RUNTIME_VERIFIED 2026-10-06** — a login with it returned HTTP 200 and a session | no |
| token field spelling `loginFrom` (not `loginForm`) | SOURCE_VERIFIED 2026-10-05 | no |
| `captcha_header_code` / `captcha_header_key` | SOURCE_VERIFIED 2026-10-05, and a fresh captcha pair was accepted by the server on 2026-10-06 (the answer moved to `8000`, past the captcha stage) | no |
| service codes `8002` / `8003` as captcha signals | `8002` RUNTIME_VERIFIED 2026-10-06; `8003` SOURCE_VERIFIED | `8003` |
| successful login and `refresh_token` presence | **RUNTIME_VERIFIED 2026-10-06** — `stage=login.captchaForm status=200`, `result=ok campus=DXC refreshToken=present cookies=TGC,error_times,locSession` | no |
| `expires_in` is seconds, and SCUT issues a **70-day** access token (`6048000`) | **RUNTIME_VERIFIED 2026-10-07** — the session pill read `token 剩余 6047998s` two seconds after login | no |
| `grant_type=refresh_token` | **RUNTIME_VERIFIED 2026-10-06/07: not usable** — a real token answers HTTP 500, a bogus one HTTP 401 `Cannot convert access token to JSON`, and the school's own client never sends the grant | nothing to fix client-side |
| GZIC fee item 1/2/3 semantics and units | SOURCE_VERIFIED | DEVICE_PENDING |
| DXC redirect chain hop-by-hop requirements | **RUNTIME_VERIFIED 2026-10-06** — `redirect 302 → thirdLogin 302 (JSESSIONID issued) → authorize 302 → getCode 302 → userinfo/ammeterBalance/waterBalance 200` | whether `error_times` or any cookie is load-bearing beyond what worked |

The only token request sent from the host was an empty-credential control probe; every
credentialed request was made by the user on the phone.

## Hosts

Known from the existing project:

```text
CARD_BASE = https://ecardwxnew.scut.edu.cn
DFYC_BASE = https://dfyc.utc.scut.edu.cn
```

## Network feasibility already tested

2026-10-04 web experiment:

```text
local captcha HTTP   = 200
worker captcha HTTP  = 403
local keyboard HTTP  = 200
worker keyboard HTTP = 403

browser direct captcha:
  upstream returned HTTP 200
  browser fetch could not read it because CORS was blocked
  no Access-Control-Allow-Origin response header
```

This is why the Android app must use native networking.

### 2026-10-05 on-device: the card host restricts by source address

The first physical-device run reached the school's edge and was refused by it:

| Request | Phone (off-campus uplink) | This workstation |
| --- | --- | --- |
| `GET /berserker-auth/oauth/captcha?synAccessSource=h5` | `403` | `200` |
| `GET /berserker-secure/keyboard` | `403` | `200` |
| `GET /` on the card host | `403` | `200` |
| `GET https://dfyc.utc.scut.edu.cn/sdms-weixin-pay-sp/newWeixin/index.html` | `200` | `200` |

The 403 is an HTML page rather than an API answer, and it states its own reason:

```text
HTTP/1.1 403 Forbidden
Server: rump/e
Content-Type: text/html

403 抱歉，页面无法访问
校外可通过学校SSLVPN访问本网站。
访问IP：<the page echoes the caller's own public address — never logged, never stored>
```

Established by repeating the same request from the phone under control:

- Identical over IPv4 and IPv6 (`403` both times, the page echoing the v4 and the
  v6 source address respectively), so it is not a DNS or address-family problem.
- Identical for `/system/bin/curl` on the device and for the app's own OkHttp
  client, with `Server: rump/e` in both cases and certificate validation intact
  (`curl` reported `ssl_verify_result=0`), so it is not a client-library, header
  or TLS-fingerprint problem.
- Both hosts resolved to the same dual-stack edge (`202.38.251.178` /
  `2001:da8:2000:2251::178`) and only `ecardwxnew` refused, so the policy is
  per-vhost, not a campus-wide block, and the phone's network itself is fine.
- This workstation reaches the card host through its local `Meta`/Tailscale tunnel
  (fake-IP answer `198.18.0.33`), which is why every earlier `RUNTIME_VERIFIED`
  row above came from an address the school accepts.

What this changes for the project:

- The app classifies this page as `CAMPUS_NETWORK_REQUIRED` instead of
  `UPSTREAM_UNAVAILABLE`, because the school's own remedy — campus network or its
  SSL VPN — is actionable and "try again later" is not. See
  `scut/network/NetworkAccess.kt`.
- No captcha, login, refresh or GZIC item can be closed from a device whose
  uplink is outside the campus address space. The phone has to join campus Wi-Fi
  or the school SSL VPN. Per AGENTS.md no proxy or other bypass may be built into
  the app, and none is needed: this is an ordinary network-location requirement.
- The block page body is dropped at the boundary: it carries the device's public
  address, which is identifying. Only a boolean and the redacted
  `blocked=campus-network-only` marker in the log line survive.

## The school's own H5 client (read 2026-10-05)

The card host serves its official mobile client as a Vue SPA, and the assets are
readable from anywhere (`/plat/js/*` is not covered by the source-address policy that
blocks the API). Reading it settled four questions this repository had been guessing at.

Sources, archived with their SHA256 outside the repo at `evidence/client/` plus
`evidence/sha256-2026-10-05T0208.txt`:

| Asset | Role |
| --- | --- |
| `/plat/js/app.bc759729.js` | store, axios interceptor, config bootstrap |
| `/plat/js/login.acc9252b.js` | the login screens and the token payload |
| `/plat/js/chunk-2d0f0054.fe26bac8.js` | the `security-keyboard` component |
| `GET /berserker-app/frontInfo?synAccessSource=h5` | SCUT's own login configuration |

`frontInfo` needs no authentication and returns, among other things:

```text
schoolNameCode = scut
loginType = [ {key:"card", name:"账号登录",  encryption:"keyboard", value:"一卡通查询密码", openCaptcha:"1"},
              {key:"sno",  name:"学工号登录", encryption:"keyboard", openCaptcha:"1"},
              {key:"sso",  name:"统一身份认证登录", url:"/berserker-auth/cas/redirect/neusoft?targetUrl=…"} ]
passwordRule = a/num/#/leng_8
```

Consequences, each traceable to that chunk:

1. **Both password logins use `encryption=keyboard` and show a captcha from the start**
   (`openCaptcha:"1"`), and the account type is part of the credential: `card` for a campus-card
   account, `sno` for a student/staff number. The app asks which one, and sends the answer on
   login and on every refresh.
2. **The submitted password is a substitution of it** — see the keyboard section below. (A
   first reading of the component said "the password itself"; the server's own tile images
   show that is wrong.)
3. **The token field is spelled `loginFrom`**, not `loginForm`:
   `{username, password, grant_type:"password", scope:"all", loginFrom, logintype, device_token}`.
   `loginForm` occurs 0 times in the client bundle.
4. **`synAccessSource` is merged into every `application/x-www-form-urlencoded` POST by the
   axios interceptor**, so sending it as a form field (as this app does) matches the client.
5. **`8002` / `8003` are this deployment's captcha codes**: the login handler compares the
   service code against exactly those two values to decide that a captcha is required and
   re-opens the captcha dialog. That upgrades them from "sibling-deployment folklore" to
   SOURCE_VERIFIED; a runtime observation with a real session is still outstanding.

Grade these as SOURCE_VERIFIED (the vendor's own code), not RUNTIME_VERIFIED: the school's
server accepts other shapes too, and only a successful login proves what this app sends is
accepted.

## Captcha

Known endpoint:

```http
GET /berserker-auth/oauth/captcha?synAccessSource=h5
Host: ecardwxnew.scut.edu.cn
```

Observed JSON shape:

```json
{
  "key": "...",
  "image": "data:image/png;base64,..."
}
```

RUNTIME_VERIFIED 2026-10-05: HTTP 200, body contains exactly the two keys above,
`key` is a 32-character hex string and `image` already carries the
`data:image/png;base64,` prefix. `auth/CaptchaService.kt` therefore accepts both a
prefixed and a bare base64 value.

The user should manually enter the image code.

No OCR is planned.

### Captcha login fields

SOURCE_VERIFIED 2026-10-05 against `/plat/js/login.acc9252b.js`, which builds the token body as:

```js
this.captcha.captchaKey && (this.$set(i, "captcha_header_code", this.loginForm.captchaCode),
                            this.$set(i, "captcha_header_key", this.captcha.captchaKey))
```

so the names this app sends (`captcha_header_code` = what the user typed,
`captcha_header_key` = the `key` from `/berserker-auth/oauth/captcha`) match the official
client exactly. `8002` / `8003` are likewise the codes that client treats as
"captcha required / captcha wrong", and `8001` as "choose a student number".

Closed on 2026-10-06: with a freshly fetched captcha the school answered `code=8000`, i.e. it
accepted this app's captcha pair and moved on to the credential check. A stale captcha on the
same request shape answered `8002` instead, so the captcha is evaluated **first** whenever the
captcha fields are present — see "Login failures".

## Secure keyboard

`GET /berserker-secure/keyboard` returns a **substitution table**, not a display hint. The
tile layouts are fixed; the token strings are random per session. The submitted password is
therefore a per-session cipher of the real password, and the school's server maps it back
through the `uuid`.

Established on 2026-10-06 by decoding the server's own tile images from a credential-free
request (the PNGs are in `data.*Image`, one per tile):

| Row | Tile order shown in the images | Token string length |
| --- | --- | --- |
| `numberKeyboard` | `0 1 2 3 4 5 6 7 8 9` | 10 |
| `lowerLetterKeyboard` | `q w e r t y u i o p a s d f g h j k l z x c v b n m` | 26 |
| `upperLetterKeyboard` | `Q W E R T Y U I O P A S D F G H J K L Z X C V B N M` | 26 |
| `symbolKeyboard` | `* \ - [ ] { } / ! , < > ? ~ & @ # . : + \| ` % ' $ ; ^ " _` | 29 |

Example of what one session looked like (`numberKeyboard = ~$JHG8m}q+`, i.e. tile 0 shows
`0` and submits `~`, tile 1 shows `1` and submits `$`, …). Nothing in the response is the
password, and nothing sensitive is logged.

The official component confirms the direction — a tap on tile `e` emits `numberKeyboard[e]`:

```js
click(e, t) { … s = this.keyboardInfo.numberKeyboard[e]; this.$emit("input", s, this.keyboardInfo.uuid) }
```

and the login chunk only appends the session id:

```js
"keyboard" === this.loginType.encryption && … && (e = e + "$1$" + this.keyboardUuid)
```

So the value that reaches `/oauth/token` is:

```text
password = map(each character through its row) + "$1$" + <keyboard uuid>
```

`SecureKeyboard.kt` implements exactly that, and `CaptchaAndKeyboardTest` pins the tile orders
and a worked example for every row. A character that no row covers (space, non-ASCII) is
refused rather than dropped, because dropping it would silently change the password.

**Two earlier readings were both wrong, and each cost device attempts:**

- digits only, mapped through `numberKeyboard` (before 2026-10-05): correct for digits, but it
  rejects a legal alphanumeric password outright, and SCUT's `passwordRule` is
  `a/num/#/leng_8`;
- characters submitted verbatim with only the `$1$uuid` tail appended (2026-10-05, and the
  change that this section corrects): the server decodes those as tile tokens and gets a
  different password, so it answers `code=8000`.

`keyboardOptions:{types:"1"}` on the login screen is why the request asks for `type=Standard`
(digits + letters + symbols) rather than `type=Number`; `order:0` matches the official client.
The response also carries a `password` field, which was `null` in the observed session and is
ignored. The official client's `maxLength` resolves to 99 for this `passwordRule`, so
truncation is not a factor.


## OAuth token

Existing project endpoint:

```http
POST /berserker-auth/oauth/token
Host: ecardwxnew.scut.edu.cn
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <mobile_service_platform client credentials used by official web client>
```

The password-grant body this app sends, field for field as the official client builds it
(`login.acc9252b.js`, plus the captcha pair and the interceptor's `synAccessSource`):

```text
username
password=<each character substituted through its keyboard row> + "$1$" + <keyboard uuid>
grant_type=password
scope=all
loginFrom=h5
logintype=card            (账号登录, a campus-card account)
logintype=sno             (学工号登录, a student/staff number)
device_token=h5
synAccessSource=h5
captcha_header_code=<typed>        captcha_header_key=<key>   (when a captcha is shown)
```

Note `loginFrom`. The old `cf-web` worker sent `loginForm`, and this repository copied that
spelling until 2026-10-05; the client bundle contains `loginForm` 0 times.

`logintype` is not a detail to guess at. `card` and `sno` are separate account namespaces, the
school answers the wrong pairing with `code=8000` — byte for byte the same response as a wrong
password — and `frontInfo` publishes both for SCUT. This app therefore asks the user, with
**学工号登录 (`sno`) as the default** because that is the tab the verified control login on
`/plat-h5/` succeeded under (reported by the user 2026-10-06); the native layer rejects a
missing or unknown value instead of falling back, and a refresh replays the type that obtained
the token.

Successful responses have included:

```text
access_token
token_type
expires_in
refresh_token
name
sno
```

and may set:

```text
TGC
locSession
```

These cookies matter particularly for DXC in the existing implementation.

The successful shape is also what the official client reads: `token_type`, `access_token`,
and the store dispatch on login success. `refresh_token` is not visible in the bundle's
login path, so whether SCUT issues one for this grant remains UNKNOWN until a real login
returns it.

### First successful login (RUNTIME_VERIFIED 2026-10-06)

With `logintype=sno` and the row-substituted password, one request from the phone closed the
whole chain:

```text
stage=keyboard           GET  /berserker-secure/keyboard      200
stage=login.captchaForm  POST /berserker-auth/oauth/token     200   (260 ms)
stage=login.captchaForm  result=ok campus=DXC refreshToken=present cookies=TGC,error_times,locSession
```

so the token response does carry `access_token`, `expires_in`, `token_type` and a
**`refresh_token`**, and the card host sets `TGC`, `locSession` and — new to this project's
notes — **`error_times`**. That last cookie is the school's own failed-attempt counter, which
is the concrete reason this repository caps live login attempts: eleven `code=8000` responses
were recorded against one account before the two client-side bugs were found.

The same session then completed the DXC chain without any client change beyond login:

```text
dxc.redirect 302 → dxc.thirdLogin 302 (JSESSIONID issued) → dxc.authorize 302
  → dxc.getCode 302 (session-established)
  → dxc.userInfo 200 → dxc.ammeterBalance 200 → dxc.waterBalance 200
stage=dxc result=ok room=present electric=true water=true ac=none
```

`ac=none` is a real shape, not a failure: this dormitory has no air-conditioning fee item, and
the UI says 该校区无空调费数据 rather than showing a zero.

### Login failures (RUNTIME_VERIFIED 2026-10-05)

A token POST with empty `username`/`password` and the public client credential
answers HTTP 400 with:

```json
{ "status": 400, "message": "用户名或密码错误", "code": 8000, "data": null }
```

Two things follow from that, and only from that:

- the auth error envelope is `status` / `message` / `code` / `data`, which is
  **not** the `code` / `msg` / `map` envelope used by the fee-item API, so the two
  parsers must stay separate;
- service code `8000` means "account or password rejected", which
  `auth/TokenState.kt` now treats as an explicit signal instead of a fallthrough.

No other service code was observed there.

### Which check runs first (RUNTIME_VERIFIED 2026-10-06, correcting 2026-10-05)

Three request shapes, all made by the user on the phone or by an empty-credential probe from
the host, pin the order down:

| Captcha fields | Password | Answer |
| --- | --- | --- |
| absent | empty | `8000` — credential check reached |
| present, **stale** | correct on the official page | `8002` — captcha rejected first |
| present, **fresh** | correct on the official page | `8000` — captcha passed, credential rejected |

So: when the captcha fields are present the captcha is evaluated **before** the credential
pair; when they are absent the server goes straight to the credential check. The
2026-10-05 note in this file claimed the opposite, inferred from nine `8000` responses that
were later explained by a different bug — see the keyboard section.

Practical consequences:

- `8002` is now RUNTIME_VERIFIED for this app, and it is a *cheap* failure: a stale captcha
  costs the account nothing. `8000` is the expensive one, because the account lockout policy
  is undocumented — stop after two of them.
- A `8000` on a request whose captcha was accepted means the credential pair itself is what
  the school rejected: the encoding, then which login type the account belongs to
  (`card` = 一卡通账号 vs `sno` = 学工号; `frontInfo` offers both, and the page also offers
  统一身份认证 SSO, which involves no card password at all), then the password.

## Refresh token

**A refresh token is issued but the school does not accept the refresh grant.** Established on
2026-10-06/07 from the phone:

```text
login:            result=ok … refreshToken=present        (the token IS handed out)
our real attempt: POST /berserker-auth/oauth/token  grant_type=refresh_token
                  → HTTP 500, body {"status":…,"code":400}
bogus token     : same request with refresh_token=not-a-real-token-0000
                  → HTTP 401, {"status":400,"message":"Cannot convert access token to JSON","code":400}
                  identical with and without logintype / device_token / synAccessSource / loginFrom
```

The bogus-token probe is credential-free and runs from the phone (`curl` on the campus
network); it reaches a JWT parser, so the grant is wired up at all. The difference between
`401` for a garbage token and `500` for the school's own token means the real token parses and
the server then fails inside the refresh path — and the form fields are not the variable, since
the minimal OAuth body and this app's full body produce byte-identical answers.

Corroborating the conclusion, SCUT's own published client **never sends the grant**: the string
`grant_type:"refresh_token"` occurs 0 times in its bundles, `refreshObj` (where it stores
`refresh_token`, `expires_in`, `login_time`, `logintype`) is written but never read, and the
only `grant_type` values anywhere are `password`. The school's H5 client re-authenticates with
the password instead of refreshing.

Consequences for this app, already implemented:

- `refreshSession()` fails closed to `REAUTH_REQUIRED`; the stored password is never replayed
  (AGENTS.md), and the captcha is re-armed so the next login is ready to go;
- the foreground timer never calls the grant — a tick is `getBills()` only — so an interval
  selection cannot spam a request the school rejects;
- the diagnostics panel states the finding next to the button that reproduces it;
- "does the refreshed access token work for GZIC / can DXC rebuild SSO after refresh" are
  therefore **not applicable**: there is no refreshed access token. Re-login re-runs the DXC
  chain from `berserker-base/redirect`, which is verified working.

And the reason the grant is unused becomes obvious with the expiry in hand: **`expires_in` is
`6048000`, i.e. 70 days** (the session pill read `token 剩余 6047998s` two seconds after login,
RUNTIME_VERIFIED 2026-10-07). A campus client that re-authenticates at most once every ten weeks
has no use for token refresh — which is consistent with the official client never sending the
grant. `ExpiryParser`'s seconds/milliseconds guard stays, but the seconds branch is now the
observed one.


## GZIC billing

The existing project requests three fee items from:

```http
GET /charge/feeitem/getThirdDataByFeeItemId?feeitemid=<id>&synAccessSource=h5
Synjones-Auth: bearer <access_token>
```

Existing mapping:

```text
1 = electric
2 = air conditioning
3 = water
```

Do not assume units beyond what the current SCUT response text states. Preserve raw semantics and verify on a real account.

## DXC billing

The existing Node implementation performs an SSO chain before querying DFYC.

High-level flow:

```text
access_token + TGC + locSession
        |
        v
ecard /berserker-base/redirect
        |
       302
        v
thirdLogin
        |
  obtain JSESSIONID
        |
       302
        v
authorize
        |
       302
        v
getCode
        |
       302
        v
dfyc session established
        |
        +--> /service/find/userinfo
        +--> /service/ammeterBalance?type=1
        +--> /service/waterBalance?type=3&systemType=1
```

Use the old `src/utils/billing.ts` as the reference implementation.

Important: preserve manual redirect handling until each step is verified on Android. Automatic redirect following can hide cookies and Location headers needed by the flow.

## Diagnostics

During development, log only:

- request stage name
- method
- host/path
- status code
- elapsed time
- redirect host/path
- non-sensitive service error code

Never log credentials, encoded password, captcha answer, tokens or cookie values.
