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
RUNTIME_VERIFIED  observed in a response body/status from this workstation on the
                  date given, with no user credentials involved
SOURCE_VERIFIED   taken from the old working implementation's source code
HYPOTHESIS        inherited assumption, not yet proven against SCUT
DEVICE_PENDING    can only be closed by a logged-in trace on a physical phone
```

| Item | Grade | Still open |
| --- | --- | --- |
| captcha endpoint and `{key, image}` shape | RUNTIME_VERIFIED 2026-10-05 | no |
| secure-keyboard endpoint and `data.numberKeyboard` / `data.uuid` shape | RUNTIME_VERIFIED 2026-10-05 | no |
| OAuth error envelope and `code=8000` = credential failure | RUNTIME_VERIFIED 2026-10-05 (empty-credential probe) | no |
| login form field names other than the captcha pair | SOURCE_VERIFIED | accepted values on a real account |
| `captcha_header_code` / `captcha_header_key` | HYPOTHESIS | DEVICE_PENDING |
| service codes `8002` / `8003` as captcha signals | HYPOTHESIS | DEVICE_PENDING |
| successful login, `expires_in` unit, `refresh_token` presence | SOURCE_VERIFIED | DEVICE_PENDING |
| `grant_type=refresh_token` support and rotation | HYPOTHESIS | DEVICE_PENDING |
| GZIC fee item 1/2/3 semantics and units | SOURCE_VERIFIED | DEVICE_PENDING |
| DXC redirect chain hop-by-hop requirements | SOURCE_VERIFIED | DEVICE_PENDING |

No login attempt with guessed or real credentials was made from the host; the only
token request sent was an empty-credential control probe, so the captcha-related
codes stay unconfirmed until the user's own device trace shows them.

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

Not yet verified against a successful SCUT login.

Candidate names seen in the Synjones ecosystem and used experimentally in the old `cf-web` branch:

```text
captcha_header_code
captcha_header_key
```

Do not mark these as confirmed until a controlled device request proves it.

Codes `8002` / `8003` are commonly captcha-related in similar Synjones systems, but must still be confirmed for the SCUT deployment.

## Secure keyboard

The old Node implementation calls the SCUT secure-keyboard endpoint and transforms the password before token login.

Read and port:

`YanZhao1027/scut-notipay/src/utils/keyboard.ts`

and the later Cloudflare implementation:

`YanZhao1027/scut-notipay@cf-web/worker/auth.ts`

Do not replace this with raw password submission without proving the current official protocol changed.

Ported in `android/app/src/main/java/cn/scut/bombax/scut/auth/SecureKeyboard.kt`; the old
reference sources are no longer vendored into this repository, so treat that file as the
port of record.

RUNTIME_VERIFIED 2026-10-05:

```http
GET /berserker-secure/keyboard?type=Standard&order=0&synAccessSource=h5
```

answers HTTP 200 with the envelope `{code, data, msg, success}` and these
`data` keys:

```text
numberKeyboard        exactly 10 characters  -> the digit map the encoder indexes
uuid                                           -> appended after the "$1$" separator
numberKeyboardImage   lowerLetterKeyboard    upperLetterKeyboard
symbolKeyboard       password                …Image variants
```

The 10-character `numberKeyboard` is what makes the ported mapping
`digit -> numberKeyboard[digit]` meaningful. The letter/symbol keyboards and the
`data.password` field are ignored by this app and are never logged.

## OAuth token

Existing project endpoint:

```http
POST /berserker-auth/oauth/token
Host: ecardwxnew.scut.edu.cn
Content-Type: application/x-www-form-urlencoded
Authorization: Basic <mobile_service_platform client credentials used by official web client>
```

The historical login request used fields similar to:

```text
username
password=<secure-keyboard encoded>
grant_type=password
scope=all
loginForm=h5
logintype=card
device_token=h5
synAccessSource=h5
```

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

No other service code was observed. `8002` / `8003` remain HYPOTHESIS: proving them
requires a real login trace, which only happens on the phone with the user's own
account.

## Refresh token

Unverified on SCUT.

The Android implementation should test a standards-style request only after obtaining a real refresh token through normal user login.

Questions to answer:

- does `grant_type=refresh_token` succeed?
- which extra form fields are required?
- does the refresh token rotate?
- what is the new `expires_in`?
- are TGC and locSession refreshed?
- does the refreshed access token work for GZIC?
- can DXC rebuild SSO after refresh?

Failure must fall back to interactive reauthentication, not stored-password replay.

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
