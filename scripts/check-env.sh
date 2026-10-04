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

check_cmd java
check_cmd node
check_cmd pnpm
check_cmd adb
check_cmd sdkmanager

echo

# A JRE satisfies `java` but cannot compile: Gradle then fails with
# "Toolchain installation ... does not provide the required capabilities: [JAVA_COMPILER]".
if command -v javac >/dev/null 2>&1; then
  printf '[ok] %-12s %s\n' javac "$(command -v javac)"
  echo "$(javac -version 2>&1 | head -n 1)"
else
  echo "[missing] javac — a JRE-only Java is installed. Install openjdk-21-jdk, or set"
  echo "          JAVA_HOME to a full JDK for every gradlew invocation (see docs/UBUNTU24.md §9)."
  missing=1
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  echo "[ok] JAVA_HOME=$JAVA_HOME"
else
  echo "[warn] JAVA_HOME unset — gradlew will use the JVM that is on PATH."
fi

echo

if [[ -n "${ANDROID_HOME:-}" ]]; then
  echo "[ok] ANDROID_HOME=$ANDROID_HOME"
elif [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "[ok] ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
else
  echo "[missing] ANDROID_HOME / ANDROID_SDK_ROOT"
  missing=1
fi

# An extracted-but-empty build-tools directory has no aapt2 and breaks packaging,
# so report which installed versions are actually usable.
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
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
if command -v adb >/dev/null 2>&1; then
  devices="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
  unauthorized="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="unauthorized"' | wc -l | tr -d ' ')"
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
if command -v adb >/dev/null 2>&1; then
  adb version | head -n 1
fi
if command -v sdkmanager >/dev/null 2>&1; then
  echo "sdkmanager $(sdkmanager --version 2>/dev/null | head -n 1)"
fi

echo
if [[ "$missing" -eq 0 ]]; then
  if [[ "$no_device" -eq 1 ]]; then
    echo "Toolchain is ready. No authorized Android device is attached, so every SCUT"
    echo "protocol item in AGENTS.md remains NOT_TESTED (see docs/DEVICE_VERIFICATION.md)."
  else
    echo "Environment looks ready."
  fi
  exit 0
else
  echo "Some tools are missing. See docs/UBUNTU24.md."
  exit 1
fi
