# Evidence index

Device and protocol evidence is kept **outside** the repository, in:

```text
/home/zyubuntu/scutbombax/evidence/
```

Two reasons: the school's published bundles are third-party minified code and must not be
vendored into this repository, and `/tmp` on this workstation is cleared between sessions, so
anything a later session has to re-check needs a durable home plus a checksum to verify it
against. This file is the manifest that travels with the code; the bytes themselves stay on
the machine that produced them.

Re-check the archive:

```bash
cd /home/zyubuntu/scutbombax/evidence && sha256sum -c sha256-2026-10-05T0208.txt
cd /home/zyubuntu/scutbombax/evidence && sha256sum -c sha256-2026-10-08.txt   # 10-07 + 10-08
```

## Pushing from this workstation, and the offline backup

`origin` is an HTTPS URL and no HTTPS credential is stored on this machine (no credential
helper, no `gh`), so pushes go over SSH to the explicit remote URL — which leaves the
configured `origin` untouched:

```bash
cd /home/zyubuntu/scutbombax/scutBombax
GIT_SSH_COMMAND='ssh -F /dev/null -o IdentityAgent=none -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=accept-new -i ~/.ssh/scutbombax_deploy' \
  git push git@github.com:YanZhao1027/scutBombax.git main:main
```

`~/.ssh/scutbombax_deploy` is a repository-scoped deploy key (`ubuntu24-scutbombax`,
`SHA256:/3v/j/kclFOKuagXkyOACRyTEFlrCsIHfU6WoPRMUC8`) with read/write on this project only.
It is deliberately not this machine's account key, and it is revocable on its own.

The `-F /dev/null -o IdentityAgent=none` part is not decoration. `~/.ssh/config` binds
`github.com` to `~/.ssh/github_nix_builder` with `IdentitiesOnly yes`, and ssh offers **that**
key even when `-i` names another one — GitHub then answers

```text
ERROR: The key you are authenticating with has been marked as read only.
```

which reads like a permission problem on this repository but is really the other repository's
read-only deploy key being accepted. `ssh -T git@github.com` gives it away: the greeting names
the repo the key belongs to. Expect `Hi YanZhao1027/scutBombax!`; anything else means the
wrong key was offered.

As a second line of defence against local loss, a full-history bundle is kept next to the
evidence:

```text
scutBombax-main-full.bundle   regenerate after any commit worth keeping; verify with
                              git bundle verify ../evidence/scutBombax-main-full.bundle
                              ("The bundle records a complete history")
```

A bundle cannot record its own creation, so its checksum is only meaningful until the next
commit. Read the actual head instead of trusting a number copied from here:

```bash
git bundle list-heads ../evidence/scutBombax-main-full.bundle
```

Restore or push from it on another machine:

```bash
git clone scutBombax-main-full.bundle scutBombax        # a complete repository
cd scutBombax && git push git@github.com:YanZhao1027/scutBombax.git main:main
```

Refresh it with:

```bash
cd /home/zyubuntu/scutbombax/scutBombax && git bundle create ../evidence/scutBombax-main-full.bundle --branches --tags
```

## 2026-10-08

| SHA256 | Artifact | What it establishes |
| --- | --- | --- |
| `af2113fba98ffdb5a15c4d018f697d669039b106799adb8802b4282c9ad3bb03` | `app-debug-2026-10-08-daily.apk` (4,813,670 B) | the installed build: `ScutRuntime`, the daily alarm, and the two front-end fixes from §13.6 |
| `d08f8e062a4d02882cf754eaaaa79e0c1e14bfbd2a4e0b709b9a066c07b7f91a` | `app-release-2026-10-08-v0.1.0.apk` (3,712,670 B) | the first release-signed APK, signed with the user's own key (certificate SHA-256 `ef607f9d…`, recorded in the README). **Built and signature-verified only — never installed on a device**, because installing it means uninstalling the debug build and that wipes the session |
| `8923d7923dcd69e9afbe0106924b817581484679259c545f792be21e06125c7d` | `logcat-2026-10-08-daily.txt` | §13's measurement: `result=armed dueInSec=60` → real alarm fire in the background → `start=foreground-service` → `result=failed reason=NETWORK`, plus `userAgent=cached` and the re-armed `86354` |
| `2586beae04572d536872afd495e1404a9d072ef9533d28251fe493316ec991dc` | `app-debug-2026-10-08-v02a.apk` (4,859,288 B) | the installed build: local history store, the 23:00 Beijing slot, the offline last-known reading, and the removal of the unsafe `startService` fallback (§14.2) |
| `e98d454f7fefc602380881c04ec919d9b15f4d9c91e4b388f4ad4c8564ff0a3d` | `logcat-2026-10-08-v02a.txt` | §14: `result=armed dueInSec=37793` (= 23:00:00 to the second), the history DB created empty, and `stage=notice result=start-refused` with the process surviving |
| `21b378efa82979878e699cf1fe39e1bdd569419fc5887cd923240df05297708b` | `phone-2026-10-08-daily-ui.png` | both switches ticked, the AC row gone with no data, and 下次约 23 小时 50 分后 after the resume re-read |

The log file is `Diag` output only (14 lines, grepped for SSID, IPv4/IPv6, bearer tokens and
cookie values before archiving — the single `token` hit is the word `refreshToken=present`, a
presence flag by design). The screenshot shows the placeholder room 宿舍 and no account name,
because no query succeeded in that session.

## 2026-10-07

| SHA256 | Artifact | What it establishes |
| --- | --- | --- |
| `582ebe9c18b99406700060023a01dcdce1acfbf56e4f916130093c06f1605c32` | `app-debug-2026-10-07T0033-dxc-reuse.apk` (4,784,117 B) | the build that reuses the DFYC `JSESSIONID` instead of re-walking the single-use chain |
| `1fad90ea783104f0fe4fc57763de6db8c497842224c9fc595a657c3460461c07` | `logcat-2026-10-07T0101-dxc-reuse-verified.txt` | two refreshes after one login, each three reads and no chain rebuild — §7's confirmation |
| `6938cc1b6a17fef7e468a1f789fafbf0c8c20a47afd86c31abd97001d9d2dcb2` | `app-debug-2026-10-07T1633-persistence.apk` (4,791,373 B) | Keystore-backed session persistence, first device build with it |
| `ffb82e19fc3058888b034a741dae8d17f6d0d8d5b3359088bddb69b232367bc1` | `logcat-2026-10-07T1615-session2.txt` | §9: write → force-stop → `result=restored` → re-query, and `退出` wiping both copies |
| `f17ec59528638e7f65552056abdb7613387c91e37626c908cc74d3f9aacf25ca` | `phone-2026-10-07T0040-relaunch.png` | the app after a relaunch |
| `ed58dc2b2601df3284ad0de1c8dd83e86650ffa33a93e8a7d632b86ce7eac0bc` | `phone-2026-10-07T1842-restored.png` | restored session, before the query that proves it is usable |
| `ee3e99faaf21a8e6f32f97f468f7b88c92e349ac78e56a572d3f50ef80d86ab2` | `phone-2026-10-07T1843-restored-queried.png` | the same session after a successful query — the bug that made `boot()` always query |
| `d9206a4804737108ab5bb4bb002346cbcba112efc99bad5ada62ecdb43ff5344` | `app-debug-2026-10-07T2020-stale-fix.apk` (4,830,882 B) | the DFYC-302-as-stale-session fix (§7's `上游暂不可用` misclassification) |
| `cd8a4344009160aea220ca62438a9d77cbc9c1ab942e731fd62895b193a813df` | `app-debug-2026-10-07T2330-notice.apk` (5,084,827 B) | the persistent notification, and the 60-second spacing floor measured in §12 |
| `9d42252858dcc29cd47c5ae1072ceab4822d910a8c9df1a75fae88f23c3ae4ee` | `phone-2026-10-07T2050-lite-dark.png` | the rewritten UI in dark mode |

These were missing from this index until 2026-10-08; the artifacts themselves are the originals
from that day.

## 2026-10-06

| SHA256 | Artifact | What it establishes |
| --- | --- | --- |
| `c6255c80d06207ce0f04a7844e8364cad09da7cba776677dbc93835f94f424a5` | `app-debug-2026-10-06T2303-substitution.apk` (4,781,497 B) | the clean build with the full four-row keyboard substitution; installed, not yet exercised |
| `35c80c04f15f22d73d2c9d00ae08a1d4054f10261fc8cc8b3ec173be2151fbbf` | `app-debug-2026-10-06T2330-logintype.apk` (4,799,939 B) | the build now installed: keyboard substitution **and** the selectable `logintype` (`card` / `sno`, default 学工号登录). Assets and dex verified by unpacking; no login attempted with it |
| `b66d92a0318bed1febafb2b16f84f142e764993c232095ee77ef22014df7b858` | `logcat-2026-10-06T2238-bombax-attempt.txt` | the three attempts: stale captcha → `8002`, fresh captcha → `8000`, i.e. captcha is evaluated before the credential pair |
| `e5fd5e1204857c1325f4a7a4f5c6e6483755624c566ccb2cf6b1d572f5b1a42c` | `kb-tiles-number-2026-10-06.png` | the ten digit tiles, rendered from a credential-free `GET /berserker-secure/keyboard`, in the order `0 1 … 9` |
| `f49c27895a57ef43ecd2ef22ad525df8a380227a2b26b8af449e46169915453c` | `kb-tiles-lower-2026-10-06.png` | the lowercase row in **QWERTY** tile order, not alphabetical |
| `93766ff79880f0a387502b9a08bec9df4e3fa8fee70215625a99224ba85ef899` | `kb-tiles-upper-2026-10-06.png` | the uppercase row, same QWERTY order |
| `3a30553b6632d08b37c2cf8f8b8e42230862187ff2169503ec280878f6dbc801` | `kb-tiles-symbol-2026-10-06.png` | the 29-glyph symbol row, whose order `SecureKeyboard.SYMBOL_ORDER` copies |

These four strips are the evidence behind the keyboard claim in `PROTOCOL.md`: the response's
token strings are random per session, but the **layouts are fixed**, which is what makes the
substitution computable without a human tapping tiles. They contain no session value — the
`uuid` and the token strings are not in them, and the per-session JSON was deliberately not
archived.


## 2026-10-05

| SHA256 | Artifact | What it establishes |
| --- | --- | --- |
| `f9a43d2139b5528ab06ab0c976fc07bd26649b15d1c79c8b46e3b07b0e8ca6d3` | `app-debug-2026-10-05T0214-clean.apk` (4,779,765 B) | the clean build that carries the corrected keyboard encoding and `loginFrom`; this is the APK installed on the phone |
| `b66071a392477f1b73394444a67913f48fef5bcf645586eba89bc0178e90c550` | `app-debug-2026-10-05T0208.apk` (4,782,714 B) | incremental build of the same sources; kept to show that APK bytes are not reproducible here, so a sha is a session marker, not a content hash |
| `e717e8f93cdaede8d971c7aa94523b33e9caecdbd8142fe2cc43f858942e86c0` | `logcat-2026-10-05T0208-campus.txt` | the campus-network session: `keyboard 200`, `captcha 200`, `token 400 code=8000` per attempt — the trail that located the encoding bug |
| `290799dfa0cba9d74d5d89d5f13090d8e92ac2a2cbb23d00f932984f2ad4fe1c` | `logcat-2026-10-05T0152-campus.txt` | the first campus-network capture after §0.1 cleared |
| `17be39a66ddfb28d0f952b5c45720e1ff23be14fa2688fb80fd0bc207fdb4d74` | `phone-403.png` | the off-campus `403` surfaced on screen as `CAMPUS_NETWORK_REQUIRED` |
| `a6535903bf6b5d37777f8ce3917fe6c01a6ea47cdbe1bbcaf637725daed1b748` | `phone-captcha1.png` | captcha tile rendering a real school image |
| `dfdb5a88c4d76f38afd88990f659df6cef8329851c2797f59f2405114274289d` | `phone-captcha2.png` | a reload returning a different captcha |
| `d4a41b4ac5c6eca3b8092be5ddf99474c9e9ea44fc9537eef7263eb81206ca61` | `phone-final.png` | end of the first session |
| `0311c94382a8ffa35ab8322fb2d3f9ae71ed16bc173095aac863972ccd1b4dbf` | `phone-state.png` | app state / diagnostics panel |
| `979475bd37ef921136f79af7db47cafb35fadf4e629ff46952a8aa95c76e5fed` | `phone-2026-10-05T0216-fixedbuild.png` | the corrected build running: the password field now reads 一卡通查询密码（字母 + 数字，不少于 8 位） |

Every screenshot shows an **empty** form: no account, no password, no captcha answer. The log
captures are `Diag` output, which never prints a credential value; they were additionally
grepped for the device serial, IPv4/IPv6 addresses, SSID, bearer tokens and cookie values
before being archived, and all of those greps returned nothing (see
[`DEVICE_VERIFICATION.md`](DEVICE_VERIFICATION.md) §10).

## The school's own client bundles

`SOURCE_VERIFIED` protocol claims in [`PROTOCOL.md`](PROTOCOL.md) come from these four
publicly served files, archived under `evidence/client/`. They are readable without
credentials from any network, including off-campus, because `/plat/js/*` is not covered by
the source-address policy that blocks the API paths.

| SHA256 | Artifact | Source URL |
| --- | --- | --- |
| `fb30dd1be6e96f617786e6f1498f9f82abd0288b5dbc787f5562224ccce492c6` | `client/app.bc759729.js` | `https://ecardwxnew.scut.edu.cn/plat/js/app.bc759729.js` |
| `088124a6d38ed860ef459ed70a0ed4a92ed835e86c95dcc757b2412fb62bb594` | `client/login.chunk-acc9252b.js` | `https://ecardwxnew.scut.edu.cn/plat/js/login.acc9252b.js` |
| `3e6bc4bfd06794fc60a9e8b43a44c4d4d7192c56a49ce6bf02810c05f602d6d7` | `client/keyboard-component.chunk-2d0f0054.fe26bac8.js` | `https://ecardwxnew.scut.edu.cn/plat/js/chunk-2d0f0054.fe26bac8.js` |
| `823ebdafce26e06b3803b8728d21be1ddffa3e9d4bf2e5613a94f98e2eb34b69` | `client/frontInfo-scut.json` | `https://ecardwxnew.scut.edu.cn/berserker-app/frontInfo?synAccessSource=h5` |

The hashes matter because the file names are content-hashed: when the school redeploys, the
URL changes, and a stale bundle is exactly the kind of evidence that quietly makes a
`SOURCE_VERIFIED` claim wrong. Re-fetch before relying on one:

```bash
curl -s 'https://ecardwxnew.scut.edu.cn/berserker-app/frontInfo?synAccessSource=h5' \
  | python3 -c 'import json,sys;print(json.loads(json.load(sys.stdin)["data"]["getFrontConfig"])["loginType"])'
```
