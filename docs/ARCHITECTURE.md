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

Keep JavaScript responsible for presentation only.

Suggested native components:

```text
android/.../scutbombax/
  ScutApiPlugin.kt
  network/
    ScutHttpClient.kt
    CookieStore.kt
  auth/
    CaptchaService.kt
    SecureKeyboard.kt
    AuthRepository.kt
    TokenState.kt
  billing/
    BillingRepository.kt
    GzicBilling.kt
    DxcBilling.kt
  storage/
    SessionStore.kt
```

Names can differ; the separation is more important than the exact paths.

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

Expose stable app errors instead of raw upstream text:

- `CAPTCHA_REQUIRED`
- `CAPTCHA_INVALID`
- `INVALID_CREDENTIALS`
- `REAUTH_REQUIRED`
- `UPSTREAM_UNAVAILABLE`
- `PROTOCOL_CHANGED`

Preserve richer redacted diagnostics in native debug logs during development.

## Foreground refresh

A timer may live in the UI layer because it is intentionally foreground-only.

On app visibility/pause:

- suspend the timer
- do not query

On resume:

- if an interval is selected and elapsed, perform one query

No background scheduler is required.

## Persistence

MVP order:

1. in-memory token/session
2. validate refresh behavior
3. optionally persist token state using Android Keystore-backed encryption

Do not persist the card password.

## Testing strategy

Pure parsers and state transitions should be unit-tested on the JVM where possible. Device integration tests should be sparse, user-triggered and rate-limited because they talk to school services.
