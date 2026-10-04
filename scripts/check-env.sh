#!/usr/bin/env bash
set -u

missing=0

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf '[ok] %-12s %s\n' "$name" "$(command -v "$name")"
  else
    printf '[missing] %s\n' "$name"
    missing=1
  fi
}

echo "scutBombax environment check"
echo

# The SDK's platform-tools must win: the distro package ships an older adb whose
# client only works while a newer server happens to be running, and that server
# dies with the next `adb kill-server`, reboot or USB re-plug.
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$sdk" && -d "$HOME/Android/Sdk" ]]; then
  sdk="$HOME/Android/Sdk"
  echo "[warn] ANDROID_HOME unset — inferring $sdk (export it to be explicit)"
fi
ADB=""
if [[ -n "$sdk" && -x "$sdk/platform-tools/adb" ]]; then
  ADB="$sdk/platform-tools/adb"
elif command -v adb >/dev/null 2>&1; then
  ADB="$(command -v adb)"
fi

check_cmd java
check_cmd node
check_cmd pnpm
if [[ -n "$ADB" ]]; then
  printf '[ok] %-12s %s\n' adb "$ADB"
else
  echo "[missing] adb — install platform-tools or set ANDROID_HOME"
  missing=1
fi

# sdkmanager lives in the SDK, not on PATH, unless cmdline-tools was exported.
if command -v sdkmanager >/dev/null 2>&1; then
  printf '[ok] %-12s %s\n' sdkmanager "$(command -v sdkmanager)"
else
  for candidate in \
    "${sdk:+$sdk/cmdline-tools/latest/bin/sdkmanager}" \
    "${sdk:+$sdk/cmdline-tools/bin/sdkmanager}" \
    "${sdk:+$sdk/tools/bin/sdkmanager}"; do
    if [[ -x "$candidate" ]]; then
      printf '[ok] %-12s %s (not on PATH)\n' sdkmanager "$candidate"
      SDKMANAGER="$candidate"
      break
    fi
  done
  [[ -n "${SDKMANAGER:-}" ]] || { echo "[missing] sdkmanager"; missing=1; }
fi

echo

# A JRE satisfies `java` but cannot compile: Gradle then fails with
# "Toolchain installation ... does not provide the required capabilities: [JAVA_COMPILER]".
# scripts/with-jdk.sh resolves the same candidates, so a JDK that is merely
# unpacked somewhere under ~/opt counts as ready.
JAVAC="$(command -v javac || true)"
if [[ -z "$JAVAC" ]]; then
  for candidate in "${JAVA_HOME:+$JAVA_HOME/bin/javac}" \
    "$HOME"/opt/jdk-*/bin/javac /usr/lib/jvm/*/bin/javac; do
    if [[ -x "$candidate" ]]; then JAVAC="$candidate"; break; fi
  done
fi
if [[ -n "$JAVAC" ]]; then
  if [[ "$JAVAC" == "$(command -v javac || true)" ]]; then
    printf '[ok] %-12s %s\n' javac "$JAVAC"
  else
    printf '[ok] %-12s %s (used by scripts/with-jdk.sh)\n' javac "$JAVAC"
  fi
  echo "$("$JAVAC" -version 2>&1 | head -n 1)"
else
  echo "[missing] javac — a JRE-only Java is installed and no JDK was found under"
  echo "          \$JAVA_HOME, ~/opt/jdk-* or /usr/lib/jvm. Install openjdk-21-jdk or"
  echo "          unpack a JDK there (see docs/UBUNTU24.md §9.1)."
  missing=1
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  echo "[ok] JAVA_HOME=$JAVA_HOME"
else
  echo "[warn] JAVA_HOME unset — gradlew uses the JVM on PATH; pnpm apk / pnpm native:test"
  echo "       cover this by running Gradle through scripts/with-jdk.sh."
fi

echo

if [[ -n "${ANDROID_HOME:-}" ]]; then
  echo "[ok] ANDROID_HOME=$ANDROID_HOME"
elif [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "[ok] ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
elif [[ -n "$sdk" ]]; then
  echo "[ok] SDK at $sdk (inferred, ANDROID_HOME unset)"
else
  echo "[missing] ANDROID_HOME / ANDROID_SDK_ROOT and no SDK at \$HOME/Android/Sdk"
  missing=1
fi

# An extracted-but-empty build-tools directory has no aapt2 and breaks packaging,
# so report which installed versions are actually usable. `sdk` was resolved at the
# top, where the inferred $HOME/Android/Sdk is accepted.
if [[ -n "$sdk" && -d "$sdk/build-tools" ]]; then
  for dir in "$sdk"/build-tools/*/; do
    [[ -d "$dir" ]] || continue
    if [[ -x "${dir}aapt2" ]]; then
      echo "[ok] build-tools $(basename "$dir") has aapt2"
    else
      echo "[warn] build-tools $(basename "$dir") has no aapt2 ($(du -sh "$dir" 2>/dev/null | cut -f1)); unused by this project if buildToolsVersion is unpinned"
    fi
  done
fi

echo

# Protocol acceptance needs a real phone; a device list of one is not optional.
no_device=0
if [[ -n "$ADB" ]]; then
  devices="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
  unauthorized="$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized"' | wc -l | tr -d ' ')"
  if [[ "$devices" -gt 0 ]]; then
    echo "[ok] $devices authorized device(s) attached"
  else
    no_device=1
    echo "[missing] no authorized device (unauthorized: ${unauthorized:-0})."
    echo "          Phase 0 step 3 and every SCUT on-device check stay NOT_TESTED until a"
    echo "          phone is connected and the USB debugging prompt is accepted."
  fi
fi

echo

if command -v java >/dev/null 2>&1; then
  java -version 2>&1 | head -n 1
fi
if command -v node >/dev/null 2>&1; then
  echo "node $(node --version)"
fi
if command -v pnpm >/dev/null 2>&1; then
  echo "pnpm $(pnpm --version)"
fi
if [[ -n "$ADB" ]]; then
  # Line 2 carries the platform-tools version; line 1 is the shared protocol number.
  "$ADB" version 2>/dev/null | sed -n '1,2p'
fi
if command -v sdkmanager >/dev/null 2>&1; then
  echo "sdkmanager $(sdkmanager --version 2>/dev/null | head -n 1)"
elif [[ -n "${SDKMANAGER:-}" ]]; then
  echo "sdkmanager $("$SDKMANAGER" --version 2>/dev/null | head -n 1)"
fi

echo
if [[ "$missing" -eq 0 ]]; then
  if [[ "$no_device" -eq 1 ]]; then
    echo "Toolchain is ready. No authorized Android device is attached, so every SCUT"
    echo "protocol item in AGENTS.md remains NOT_TESTED (see docs/DEVICE_VERIFICATION.md)."
  else
    echo "Environment looks ready. A device is not enough: the card host answers 403 to any"
    echo "off-campus source address, so run docs/DEVICE_VERIFICATION.md §0.1 before §1."
  fi
  exit 0
else
  echo "Some tools are missing. See docs/UBUNTU24.md."
  exit 1
fi
