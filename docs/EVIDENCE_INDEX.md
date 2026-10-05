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
```

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
