# Handoff report — 2026-10-05

Scope of this report: what `AGENTS.md` asked for, what exists now, and what has **not**
been verified. The app is implemented, builds cleanly, installs and runs on a physical
phone, and **login now works**: on 2026-10-06 23:50 a DXC session was established and the
whole DXC balance chain ran end to end on the phone. What it took was clearing three blockers
in sequence — no device, then the network location (the card host refuses off-campus source
addresses), then two independent client bugs found by reading SCUT's own published client and
its served keyboard images: the secure-keyboard encoding is a per-session substitution table,
and the account belongs to 学工号登录 (`sno`), not the hardcoded `card`.

Remaining: `grant_type=refresh_token` acceptance, a GZIC dormitory, and the foreground-refresh
rules with a live session.

## AGENTS.md handoff items

| Required item | Result | Grade |
| --- | --- | --- |
| commit SHA | `6d5a031` implementation, `1ef80d3` + `cd8f62a` docs and checks, `29876cb` bridge fix, `9a0dc76` device findings and `CAMPUS_NETWORK_REQUIRED`, `dc93924` environment honesty + device audit, `347f4ed`/`328d863`/`e85c6c8` corrected keyboard encoding and `loginFrom`, `35c2a05`/`6858e0e` evidence manifest, `eea2170`/`6666c98` keyboard substitution, `6de0ee3`/`ebe6126` verified login and audits, `f77191d`/`03ebeb7` single-use DXC chain, `d5b4180`/`a6bb1ce` Keystore session persistence — **all pushed to `origin/main`** (`633ab13..a6bb1ce` and later), see [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md) for the deploy-key command | RUNTIME_VERIFIED |
| APK path | **current build: 4,799,939 bytes, sha256 `35c80c04f15f22d73d2c9d00ae08a1d4054f10261fc8cc8b3ec173be2151fbbf`** — full keyboard substitution (all four rows) plus the selectable `logintype` (default 学工号登录), 77 tests green, installed 2026-10-06 23:30 and **not yet exercised**; its assets and dex were checked by unpacking the APK. Superseded the same evening: `c6255c80d06207ce0f04a7844e8364cad09da7cba776677dbc93835f94f424a5` (4,781,497 B, substitution only), then `18095f723185b11b9cabbe44d729b852fbb63ff262f2d6ccbfd341076a53dfb3` (incremental build of the same sources), `f9a43d2139b5528ab06ab0c976fc07bd26649b15d1c79c8b46e3b07b0e8ca6d3` (2026-10-05, the "submit the characters verbatim" reading, used for the three 2026-10-06 attempts) and `70f3d2fea48d4278ac80d121bb31ad5d99bb630c10b21adcc98089c658088358` (2026-10-05, digits-only encoder, used for the nine `code=8000` attempts). APK bytes are not reproducible here, so a sha is a session marker, not a content hash | RUNTIME_VERIFIED (build/install), DEVICE_PENDING (login) |
| tested Android version / device | Android 14 (API 34), Redmi K50, arm64-v8a, 1440×3200 @ 560dpi. `minSdk 24` / `targetSdk 36` remain the build's declaration; only API 34 has executed it | RUNTIME_VERIFIED (one device) |
| bridge + UI on device | `plugin=ScutApi ready api=34 release=14`, `health()` returned over the bridge, full Chinese UI rendered without layout breakage, and a native failure reached the screen as `CAMPUS_NETWORK_REQUIRED [captcha/403]: …` | RUNTIME_VERIFIED |
| what is persisted, and is it safe | **verified on device 2026-10-07**: one Keystore-encrypted record `no_backup/scut-session.bin` (1561 B, mode 600, header `01 0c …`; no field name or value readable in the bytes) plus three UI choices in `localStorage`. A `force-stop` + relaunch restores it (`stage=session result=restored campus=DXC refreshToken=present expiresIn=6047797s`) and the next query reuses the stored DFYC session (three reads, no chain hops); pressing Back does not log out; 退出 clears both copies (`stage=logout result=cleared`, file gone). The card password, the captcha answer and the keyboard uuid are in nothing, anywhere — `SessionPersistenceTest` pins the serialised key set | RUNTIME_VERIFIED 2026-10-07 |
| captcha behavior | endpoint + `{key, image}` shape confirmed on the device (HTTP 200, 32-hex key, `data:image/png;base64,` prefix, a new `key` on every reload). `frontInfo` sets `openCaptcha:"1"` for the `card` login, so a captcha belongs on every attempt, which the app does. **Enforcement is now observed:** a stale captcha answered `code=8002`, a freshly fetched one was accepted and the answer moved to `code=8000` — so the captcha is evaluated before the credential pair whenever the captcha fields are present | RUNTIME_VERIFIED 2026-10-06 |
| network location | `ecardwxnew.scut.edu.cn` answers `403` + "校外可通过学校SSLVPN访问本网站" for an off-campus source address, over IPv4 and IPv6, for `curl` and for OkHttp alike, while `dfyc.utc.scut.edu.cn` answers `200` on the same connection. The phone was then moved onto the campus wireless network and every card-host request in the second session returned 200/400, never 403 | RUNTIME_VERIFIED |
| exact verified captcha request field names | `captcha_header_code` / `captcha_header_key` — **accepted by the school.** They are copied from SCUT's own login chunk, and on 2026-10-06 a freshly loaded captcha paired with those names moved the answer from `8002` to `8000`, i.e. past the captcha stage | RUNTIME_VERIFIED 2026-10-06 |
| login result | **succeeded on 2026-10-06 23:50** after two independent client fixes: the keyboard row substitution and `logintype=sno`. `stage=login.captchaForm POST /berserker-auth/oauth/token status=200 ms=260` then `result=ok campus=DXC refreshToken=present cookies=TGC,error_times,locSession`. The eleven earlier `code=8000` answers were the school rejecting a valid password presented in the wrong account namespace, encoded with a transform it does not use | RUNTIME_VERIFIED 2026-10-06 |
| refresh_token result | a refresh token **is issued at login** (`refreshToken=present`), but the school does not accept the grant: this app's real-token attempt answered **HTTP 500** (`code=400`); a credential-free bogus-token probe answered **HTTP 401** with `Cannot convert access token to JSON`, byte-identical for the minimal and the full form body; and SCUT's own client never sends the refresh grant (0 occurrences of the `grant_type:"refresh_token"` spelling, it stores `refreshObj` and never reads it). So refresh is unavailable on this deployment rather than broken here — `refreshSession()` fails closed to `REAUTH_REQUIRED`, the stored password is never replayed, and the foreground timer only re-queries | RUNTIME_VERIFIED 2026-10-06/07 |
| GZIC result | unverified. Requests, header (`Synjones-Auth: bearer …`) and the `code/msg/map` parser are written and unit-tested against the old implementation's shapes. The card host is the one GZIC needs, so this is the blocked path | NOT_TESTED |
| DXC result | **verified end to end on 2026-10-06** (`redirect 302 → thirdLogin 302 (JSESSIONID) → authorize 302 → getCode 302 → userinfo/ammeterBalance/waterBalance 200`, room and both balances rendered, `ac=none` because this dormitory has no air-conditioning fee item). **A second query in the same session then failed**, and that was a real bug rather than the school: the chain is single-use, so re-walking it while the DFYC session is alive makes `thirdLogin` redirect to the landing page and `authorize` answer 200 where 302 was expected. Fixed on 2026-10-07 by keeping the DFYC `JSESSIONID` in the in-memory session and going straight to the three reads (3 requests instead of 7), re-walking the chain only when a read refuses the session — installed as `582ebe9c18b99406700060023a01dcdce1acfbf56e4f916130093c06f1605c32` and **confirmed on the device**: after a login that walked the chain, two refreshes 9 s and 10 s later sent only the three balance reads (all 200, `result=ok`), no chain hops at all | RUNTIME_VERIFIED 2026-10-07 |
| foreground refresh result | `@capacitor/app` `isActive` events were observed on the device (`{"isActive":true}` in the bridge log), but the timer semantics are verified only by 15 vitest state-machine cases; no logged-in refresh has run | NOT_TESTED (with a session) |
| remaining protocol uncertainty | see below | — |

Service codes `8002` / `8003` are no longer folklore: the login chunk compares the token
response's service code against exactly those two values to decide "captcha required /
captcha wrong" (and `8001` = "pick a student number"). `8002` was observed live on
2026-10-06 from this app's own request; `8003` is still only documented by the client.

## What is actually proven

- `pnpm build` (`tsc --noEmit && vite build`), `pnpm test` (15 vitest),
  `pnpm check:dom`, and `./gradlew clean testDebugUnitTest assembleDebug` (89 tests across
  eleven classes, BUILD SUCCESSFUL) all pass on this host, with no Android Studio and no IDE.
  `pnpm native:test` / `pnpm apk` now route through `scripts/with-jdk.sh`, which finds a
  JDK with `javac` instead of relying on an exported `JAVA_HOME`.
- The APK installs (`adb install -r` → Success) and starts on Android 14, and the bridge
  is live in both directions: a native classification reaches the WebView and is printed
  verbatim on screen.
- Nothing sensitive is persisted, checked from the app's own data directory:
  `run-as cn.scut.bombax ls -laR` shows only `files/profileInstalled` and three WebView
  preference files under `shared_prefs`, the WebView cookie store contains **0** cookie
  rows in total (read with sqlite3 after `run-as … cat`), and there is no session file.
- The §10 leakage audit was run against a real 403 exchange: the credential/token/cookie
  grep, the address-echo grep and the TLS/proxy source grep all printed nothing. The
  school's block page carries the caller's public IP, so that third grep matters —
  `NetworkAccess` keeps a boolean and discards the body.
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

1. **Session state is memory plus a Keystore-encrypted file; the password is in neither.**
   AGENTS.md Phase 6 asks for in-memory first and persistence "if desired". The first device
   verification settled the question: the school's access token is valid for 70 days, so
   memory-only meant retyping account, password and captcha after every process death for no
   security gain. Since 2026-10-07 the token state is written as AES/GCM through a
   non-exportable Android Keystore key into `noBackupFilesDir` (outside auto backup and
   `adb backup`), and `logout` / "clear login state" wipe both copies. The card password, the
   captcha answer and the keyboard uuid are never persisted — `TokenState` has no field for
   them and `SessionPersistenceTest` pins the serialised key set. `androidx.security:security-crypto`
   was deliberately not added; the platform Keystore API is used directly. Rationale and the
   `dropMemory` vs `clear` trap in `docs/ARCHITECTURE.md`.2. **One public credential is in source**: `ScutEndpoints.BASIC_AUTH`, the base64 public
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
6. `ScutHttp.send` classifies exactly one response shape itself: the school's off-campus
   `403` page becomes `CAMPUS_NETWORK_REQUIRED` and its body is dropped, because that page
   echoes the caller's public IP (identifying), means the same thing at every stage, and
   would otherwise be reported as an upstream outage. Every other non-2xx answer still goes
   back to the caller untouched for stage-specific classification.
7. **The secure keyboard is a per-session substitution cipher over fixed tile layouts.**
   `SecureKeyboardEncoder` maps every character of the password through the row it belongs to
   (digits `0-9`, lowercase and uppercase in QWERTY order, a fixed 29-glyph symbol row) and
   appends `"$1$" + uuid`. Two earlier readings were both wrong and each cost device
   attempts: digits-only substitution (rejects a legal alphanumeric password) and submitting
   the characters verbatim (the server reads those as tile tokens). The layouts were settled
   on 2026-10-06 by decoding the server's own tile images from a credential-free request, not
   by reasoning about the component; `CaptchaAndKeyboardTest` pins each row and names both
   mistakes so the file cannot be "re-fixed" the other way again.
8. **The school's published client is the reference for protocol spelling** — its `/plat/js/*`
   bundles and `GET /berserker-app/frontInfo` are readable without credentials from any
   network, so field names, login types and captcha codes can be settled without guessing.
   The copies used for this are archived outside the repository under `evidence/client/`
   (third-party minified code is deliberately not vendored into the repo), with checksums
   listed in [`EVIDENCE_INDEX.md`](EVIDENCE_INDEX.md).
9. **`logintype` is part of the credential, and the app used to hardcode `card`.**
   `frontInfo` offers 账号登录 (`card`, a 一卡通 account) and 学工号登录 (`sno`, a student/staff
   number), both with `encryption:"keyboard"`. The hardcoded value came from the old `cf-web`
   worker. On 2026-10-06 the user reported that the successful control login on `/plat-h5/` was
   made under **学工号登录**, so every attempt so far presented a valid password in the wrong
   account namespace — which the school answers with the same `code=8000` it uses for a wrong
   password. The login screen now asks (default 学工号登录), the native layer refuses an unknown
   value instead of guessing, and a refresh replays the type that obtained the token. This is
   the second independent reason login has failed; the first is the keyboard encoding
   (decision 7).

10. **No background refresh, no stored password, no captcha OCR — and the 70-day token is why
    none of them are needed.** Three tempting "convenience" additions were considered and
    rejected on 2026-10-07, after login was verified:
    - *a resident background refresh.* AGENTS.md forbids a Service, WorkManager and alarms, and
      the requirement it protects is gone: the access token lasts `6048000` seconds (70 days),
      so there is nothing to keep alive, and balances only matter while the screen is up. The
      school also counts failed attempts (`error_times`), so background retries would poll a
      rate-limited endpoint for no benefit.
    - *storing the card password.* AGENTS.md says never persist it by default, and refresh
      cannot be built on top of it anyway ("do not automatically replay a stored password").
      Re-login is at most once per ten weeks. If typing the password is the pain, the answer is
      Android's own autofill / the user's password manager (`autocomplete="current-password"`),
      which keeps the credential under the OS and never in this app's files — see
      `docs/ARCHITECTURE.md` for the session-storage decision this follows.
    - *an on-device model that solves the captcha.* AGENTS.md states "No OCR is planned", and
      the deeper problem is that solving it is defeating an anti-automation control the school
      deliberately put on its own login, next to a lockout counter. This belongs to the same
      category as the proxy/bypass that was already refused: the app asks a human, and a human
      answers, once every ten weeks.

## To close the remaining phases

Login works (§4) and the DXC chain runs end to end (§7), so the protocol questions that
needed a session are closed. What is left is narrower than the original checklist and mostly
needs a different account rather than more attempts with this one.

```bash
./scripts/check-env.sh           # should report "1 authorized device(s) attached"
adb="$HOME/Android/Sdk/platform-tools/adb"
$adb shell curl -sS -o /dev/null -w 'HTTP=%{http_code}\n' \
  'https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5'   # 200 = go
$adb logcat -c && $adb logcat -s ScutBombax:V
```

Remaining items in [`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md):

- **§8 foreground refresh with a live session** — the only behavioural check left that this
  account can exercise: pick 5 minutes, background the app for ~6, return, and confirm exactly
  one catch-up query and zero requests while hidden.
- **§6 GZIC** — needs a GZIC dormitory. This account's room is DXC, so the fee-item semantics
  and units stay SOURCE_VERIFIED; do not "verify" them by querying GZIC with a DXC room.
- **§2's wrong-captcha case** — `8002` is already observed; `8003` is not worth chasing, the
  classifier treats both identically.
- **§9/§10 re-audit after a session exists** — the on-disk and logcat leakage checks were run
  when no session had ever existed; re-run them now that TGC/locSession/JSESSIONID have been
  live in memory. The install with the current wording changes (`4644f297…`) is built but was
  deliberately not pushed to the phone in order to keep the session alive; it goes on with the
  next re-login.

Deliberately not done: routing the phone's traffic through this workstation's tunnel to
make its source address acceptable. That is an access-control bypass of the school's own
restriction, AGENTS.md forbids adding proxies or bypass mechanisms, and the app must stay
free of any such setting. The sanctioned off-campus route is the school's SSL VPN, run on
the phone by the user.

## Remaining protocol uncertainty

Closed since the first successful login: the password encoding, the login type, the captcha
field names, `8002`, `expires_in` (**seconds; `6048000` = 70 days**) and the refresh grant
(issued but not accepted, and unnecessary at a 70-day lifetime).

What is genuinely still unknown:

- `8003` — documented by the school's own client as the other captcha code, never observed here.
  No reason to chase it: the classifier already treats both identically.
- Whether `TGC` and `locSession` are each individually required by the DXC chain. The chain
  works while the app sends both, so removing one would be an experiment against the school for
  no user benefit.
- GZIC fee-item semantics and units, and whether fee item `2` exists for every dormitory. This
  account's dormitory is DXC, so GZIC needs a GZIC room to verify — the parser is unit-tested
  against the old implementation's shapes and nothing more.
- Whether any SCUT logout endpoint exists. The app clears client-side state only and does not
  invent an endpoint.
- `error_times`: the card host sets this cookie, so it counts failed attempts, but the threshold
  and the lockout behaviour are undocumented. That is an argument for the two-attempt cap in
  `DEVICE_VERIFICATION.md` §2.1, not for testing it.
