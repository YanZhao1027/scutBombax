# Ubuntu 24.04 Android build without Android Studio

Android Studio is not required to build, install or debug this project.

## 1. Base packages

```bash
sudo apt update
sudo apt install -y \
  openjdk-17-jdk \
  git \
  curl \
  unzip \
  zip \
  adb
```

Verify:

```bash
java -version
adb version
```

If the generated Android Gradle Plugin later requires a different supported JDK, follow that project's explicit requirement rather than installing Android Studio.

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

After the agent creates the Capacitor Android project, inspect its `compileSdk` / build configuration.

Then install matching components. Example only:

```bash
sdkmanager --licenses
sdkmanager \
  "platform-tools" \
  "platforms;android-<compileSdk>" \
  "build-tools;<matching-build-tools-version>"
```

Do not blindly copy an old API level from documentation. Use the generated project's actual requirement.

## 5. Use a physical phone

Enable Developer options and USB debugging on the Android device.

```bash
adb devices
```

Accept the authorization prompt on the phone.

A physical device is preferred for SCUT protocol testing because the request should originate from a real user network and no emulator is necessary.

## 6. CLI build loop

Once the Capacitor project is initialized:

```bash
pnpm install
pnpm build
pnpm exec cap sync android

cd android
./gradlew assembleDebug
```

APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Install:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

View app logs without Android Studio:

```bash
adb logcat
```

Filter by a chosen application tag once the agent defines one.

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

It reports missing pieces without installing anything automatically.
