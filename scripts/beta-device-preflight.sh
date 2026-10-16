#!/usr/bin/env sh
# Conservative Android 2.0 Beta device preflight: no PIN, school account, photo,
# QR token, device screenshot, logcat or student data is collected.
set -eu

APK="${1:-android/app/build/outputs/apk/debug/app-debug.apk}"
PACKAGE=cn.scut.bombax.beta
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"

if ! command -v adb >/dev/null 2>&1; then
  echo "BLOCKED: adb is not installed." >&2
  exit 2
fi

state="$(adb get-state 2>/dev/null || true)"
if [ "$state" != device ]; then
  echo "BLOCKED: ADB device not authorized/ready. Unlock the test phone and approve its USB debugging dialog." >&2
  echo "Do not enter a PIN in a log or shell script." >&2
  exit 2
fi

if [ ! -f "$APK" ]; then
  echo "BLOCKED: APK not found. Build beta.2 with Gradle first." >&2
  exit 2
fi

aapt=""
for path in "$SDK"/build-tools/*/aapt; do
  if [ -x "$path" ]; then aapt="$path"; fi
done
if [ -z "$aapt" ]; then
  echo "BLOCKED: Android SDK build-tools/aapt is required to check APK identity." >&2
  exit 2
fi

apk_package="$("$aapt" dump badging "$APK" | awk -F "'" '/^package:/{print $2;exit}')"
if [ "$apk_package" != "$PACKAGE" ]; then
  echo "REFUSED: APK package does not match isolated Beta application ID." >&2
  exit 1
fi

printf 'Android version: '
adb shell getprop ro.build.version.release
printf 'Android API: '
adb shell getprop ro.build.version.sdk
printf 'Display: '
adb shell wm size

if [ "${ADB_NO_INSTALL:-0}" != 1 ]; then
  # Do not uninstall on signature mismatch; preserving test phone app data is deliberate.
  adb install -r "$APK"
fi
installed_path="$(adb shell pm path "$PACKAGE" 2>/dev/null || true)"
case "$installed_path" in
  package:*) : ;;
  *) echo "BLOCKED: Beta application is not installed." >&2; exit 1 ;;
esac

launch="$(adb shell am start -W -n "$PACKAGE/cn.scut.bombax.MainActivity" 2>&1)"
case "$launch" in
  *"Status: ok"*) echo "PASS: isolated Beta package installed and launcher started." ;;
  *) echo "BLOCKED: launcher did not confirm success." >&2; exit 1 ;;
esac

echo "MANUAL: open Activity QuickCheck in-app and check Camera permission + real optical QR scan."
echo "MANUAL: check GPS permission, bad-signal fallback, system image picker, and Android Back."
echo "MANUAL: record device-specific evidence WITHOUT real student data or camera screenshots."
