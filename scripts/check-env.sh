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

if [[ -n "${ANDROID_HOME:-}" ]]; then
  echo "[ok] ANDROID_HOME=$ANDROID_HOME"
elif [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
  echo "[ok] ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
else
  echo "[missing] ANDROID_HOME / ANDROID_SDK_ROOT"
  missing=1
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
  echo "Environment looks ready."
  exit 0
else
  echo "Some tools are missing. See docs/UBUNTU24.md."
  exit 1
fi
