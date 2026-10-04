# Ubuntu 24.04 Android build without Android Studio

Android Studio is not required to build, install or debug this project.

## 1. Base packages

A **JDK** is required, not a JRE. Android Gradle Plugin 8.13 with this project's
`compileSdk 36` / `jvmTarget 21` settings needs a Java 21 compiler:

```bash
sudo apt update
sudo apt install -y \
  openjdk-21-jdk \
  git \
  curl \
  unzip \
  zip \
  adb
```

Verify:

```bash
java -version
javac -version
adb version
```

`javac: command not found` means only the `-jre` / `-jre-headless` package is present.
If `sudo` is unavailable, see section 9 for the user-local JDK this machine used.

## 2. Node and pnpm

Use a current Node.js LTS installation. A version manager is preferable to Ubuntu's potentially older distro Node package.

After Node is installed:

```bash
corepack enable
pnpm --version
```

## 3. Android SDK command-line tools

Download the current **Command line tools only** archive for Linux from the official Android Developers site.

Use:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools/latest"
```

Extract the downloaded archive so this file exists:

```text
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager
```

Then add to `~/.bashrc` or `~/.zshrc`:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Reload the shell:

```bash
source ~/.bashrc
```

Verify:

```bash
sdkmanager --version
```

## 4. Install the SDK components the project actually needs

Use the generated project's real requirement, not a copied API level. This project is
`compileSdk 36` / `targetSdk 36` / `minSdk 24` (`android/variables.gradle`), so:

```bash
sdkmanager --licenses
sdkmanager \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.1.0"
```

`buildToolsVersion` is deliberately **not** pinned in `variables.gradle`; AGP chooses a
compatible one (it auto-installed `35.0.0` here) and a complete build-tools directory is
required for `aapt2`. See section 9 for the empty leftover directory this machine has.

`android/local.properties` records `sdk.dir` for this host only and is git-ignored, so a
fresh clone needs either that file or `ANDROID_HOME`.

## 5. Use a physical phone

Enable Developer options and USB debugging on the Android device.

```bash
adb devices
```

Accept the authorization prompt on the phone. Until that prompt is accepted the row
reads `<serial> unauthorized` and nothing can be installed.

Two `adb` binaries usually coexist here — the distro package and the SDK
`platform-tools` copy (on this host: `34.0.4-debian` vs `37.0.1`). If they disagree you
get `adb server version (NN) doesn't match this client (MM); killing...` in a loop.
Always put the SDK copy first in `PATH` and use only that one:

```bash
export PATH="$HOME/Android/Sdk/platform-tools:$PATH"
```

An empty "List of devices attached" means no phone is reachable — it is not something the
build can work around. On this host the distro `/usr/bin/adb` (34.0.4-debian) printed an
empty list for a phone the SDK's 37.0.1 client saw right away: the two clients fight over
port 5037, and whichever one starts the server first decides what the other reports. Once
the SDK adb owns the server even the old client lists the device, which makes the symptom
look intermittent. `scripts/check-env.sh` and `pnpm install:device` therefore resolve
`$HOME/Android/Sdk/platform-tools/adb` by path instead of trusting `PATH`.

A physical device is required for SCUT protocol testing because the request should
originate from a real user network, and no emulator is necessary. A device alone is not
sufficient: the school checks the **source address** of the request, so the phone also has
to be on a network the school accepts — see
[DEVICE_VERIFICATION.md](DEVICE_VERIFICATION.md) §0.1 before anything else.

## 6. CLI build loop

Verified on this host (Node 22.19.0, pnpm 10.15.0, Capacitor 8.5.2, AGP 8.13.0, Gradle
wrapper 8.14.3, Kotlin plugin 2.2.20):

```bash
pnpm install
pnpm build
pnpm test
pnpm check:dom
pnpm exec cap sync android

pnpm native:test          # Gradle tests, via scripts/with-jdk.sh
pnpm apk                  # debug APK, same wrapper
```

The wrapper exists because this host's `PATH` java is a JRE: it finds a JDK with `javac`
and exports `JAVA_HOME` for that one command. Calling Gradle directly still needs it:

```bash
cd android
JAVA_HOME=/home/zyubuntu/opt/jdk-21.0.12.1+1 ./gradlew clean testDebugUnitTest assembleDebug
```

The native JVM unit tests run on the host — no device and no emulator is needed for them.

APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install:

```bash
pnpm install:device        # resolves the SDK adb by path
# or, from android/:
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

View app logs without Android Studio. The single native log tag is `ScutBombax`
(`Diag.kt`), and its lines are redacted by design:

```bash
adb logcat -c && adb logcat -s ScutBombax:V *:S
```

See [docs/DEVICE_VERIFICATION.md](DEVICE_VERIFICATION.md) for which stage names mean what.

## 7. Useful terminal tools

No IDE is mandated. Good combinations include:

- VS Code + Android/Java/Kotlin language extensions
- Neovim + LSP
- plain terminal + agent

Gradle remains the actual build system either way.

## 8. Environment check

Run:

```bash
./scripts/check-env.sh
```

It reports missing pieces without installing anything automatically. It checks `javac`
(not just `java`), lists which installed build-tools directories contain `aapt2`, and
counts authorized `adb` devices, because those are the four things that actually stopped
this project from building.

## 9. Verified environment on this machine (2026-10-05)

Measured, not copied from a guide:

| Piece | Value |
| --- | --- |
| OS | Ubuntu 24.04 (GNU/Linux, x86_64) |
| Node | v22.19.0 (nvm) |
| pnpm | 10.15.0 |
| Capacitor CLI / core / android | 8.5.2 |
| Gradle | wrapper 8.14.3 (`gradle-8.14.3-all.zip`) |
| Android Gradle Plugin | 8.13.0 |
| Kotlin Gradle plugin | 2.2.20, `jvmTarget 21` |
| SDK | `$HOME/Android/Sdk` — platform-tools, `platforms;android-36`, build-tools 35.0.0 + 36.1.0, cmdline-tools (`sdkmanager 19.0`) |
| Java used to build | Temurin JDK 21.0.12.1+1 at `$HOME/opt/jdk-21.0.12.1+1` |
| adb | SDK copy 37.0.1; distro `/usr/bin/adb` is 34.0.4-debian |
| Device attached | Redmi K50, Android 14 (API 34), arm64-v8a — authorized, `install -r` and `logcat` verified (its serial is deliberately not recorded anywhere) |

Everything below is a trap that cost real time here.

### 9.1 The distro Java is a JRE and there is no sudo

`dpkg -l | grep openjdk` shows only `openjdk-21-jre` and `openjdk-21-jre-headless`;
`javac` is not on `PATH`, and installing `openjdk-21-jdk` requires root, which this
account does not have. Gradle's message in that state is unhelpful:

```text
Toolchain installation '/usr/lib/jvm/java-21-openjdk-amd64' does not provide the
required capabilities: [JAVA_COMPILER]
```

Fix without root: unpack a full JDK into the user directory and point `JAVA_HOME` at it.

```bash
mkdir -p "$HOME/opt"
curl -L -o /tmp/jdk21.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
sha256sum /tmp/jdk21.tar.gz   # must equal the "checksum" from the Adoptium release API
tar -xzf /tmp/jdk21.tar.gz -C "$HOME/opt"
```

This host has `$HOME/opt/jdk-21.0.12.1+1` from a tarball whose SHA-256
`ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94` matched the checksum
published by `https://api.adoptium.net/v3/assets/latest/21/hotspot`. Verify before
extracting; the Tsinghua Adoptium mirror serves the same bytes but publishes no `.sha256.txt`,
so take the expected value from the API instead of the mirror.

`JAVA_HOME` must be exported **inside the same shell invocation as `gradlew`** — an
agent's tool calls do not share shell state, and a build re-run without it fails with the
same `[JAVA_COMPILER]` message.

### 9.2 Seeding the Gradle distribution by hand

The wrapper downloads ~215 MB before it can run. If the mirror in use throttles mid-file,
resume with `curl -C -` in a loop and check the digest against
`https://services.gradle.org/distributions/gradle-8.14.3-all.zip.sha256`
(`ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c`).

Gradle looks for the unpacked distribution in a directory named after the **base-36 of the
MD5 of `distributionUrl`**, so a manual download only helps once that path exists:

```bash
python3 - <<'PY'
import hashlib
url = "https://services.gradle.org/distributions/gradle-8.14.3-all.zip"
n = int(hashlib.md5(url.encode()).hexdigest(), 16)
digits = "0123456789abcdefghijklmnopqrstuvwxyz"
out = ""
while n:
    n, r = divmod(n, 36)
    out = digits[r] + out
print(out)          # -> 10utluxaxniiv4wxiphsi49nj for this project's wrapper
PY

dist="$HOME/.gradle/wrapper/dists/gradle-8.14.3-all/10utluxaxniiv4wxiphsi49nj"
mkdir -p "$dist"
unzip -q /tmp/gradle-dl/gradle-8.14.3-all.zip -d "$dist"
touch "$dist/gradle-8.14.3-all.zip.ok" "$dist/gradle-8.14.3-all.zip.lck"
```

That is the verified end state on this machine — the directory holds the extracted
`gradle-8.14.3/`, the `.ok` marker and a `.lck` file, and no archive. Missing or renamed
markers make the wrapper re-download the whole 215 MB.

### 9.3 An empty build-tools directory

`$ANDROID_HOME/build-tools/36.0.0` is a 12 KB leftover with no `aapt2`, while 36.1.0
(150 MB) and 35.0.0 (147 MB) are complete. `android/variables.gradle` deliberately does not
pin `buildToolsVersion`, so AGP picks a complete one and the build is unaffected. If a future
change pins `36.0.0`, packaging fails with a missing-`aapt2` error; delete the stub or install
the real package rather than adding a pin.

### 9.4 A device is not enough: the school checks the source address

A phone plugged in over USB still has its own network route, and
`ecardwxnew.scut.edu.cn` answers `403` + `校外可通过学校SSLVPN访问本网站` for any source
address outside the campus range. `/system/bin/curl` is present on Android 14, so this is
worth checking before reading anything as an app failure:

```bash
$ADB shell curl -sS -o /dev/null -m 12 -w 'HTTP=%{http_code} remote=%{remote_ip}\n' \
  'https://ecardwxnew.scut.edu.cn/berserker-auth/oauth/captcha?synAccessSource=h5'
```

`403` on both IPv4 and IPv6 with `Server: rump/e`, for `curl` and for the app's OkHttp
alike, means the network location is the problem — put the phone on campus Wi-Fi or the
school SSL VPN. This workstation reaches the same URL only through its local
`Meta`/Tailscale tunnel, which is why host-side probes returned `200` all along. Do not
"fix" this by giving the app a proxy.

### 9.5 Not yet verified

Captcha enforcement at login, login itself, `refresh_token`, GZIC balances, the DXC SSO
chain and refresh with a live session: the device is attached and the bridge works, but the
card host refuses the phone's current network location, so no credential-bearing request
has ever been made. Do not infer otherwise from the passing unit tests; run
[docs/DEVICE_VERIFICATION.md](DEVICE_VERIFICATION.md) instead.
