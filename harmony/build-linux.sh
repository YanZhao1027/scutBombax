#!/usr/bin/env bash
set -eo pipefail

# Official SDK required. Does not download software or sign any HAP.
ROOT="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HARMONY_TOOLS"
if [[ -z "$TOOLS" || ! -x "$TOOLS/bin/hvigorw" ]]; then
  echo "Set HARMONY_TOOLS to the official command-line-tools directory." >&2
  exit 2
fi

if [[ -z "$DEVECO_NODE_HOME" ]]; then
  NODE="$(command -v node)"
  DEVECO_NODE_HOME="$(dirname "$(dirname "$(readlink -f "$NODE")")")"
  export DEVECO_NODE_HOME
fi
export DEVECO_SDK_HOME="$TOOLS/sdk"
export OHOS_SDK_HOME="$TOOLS/sdk/default/openharmony"
export LD_LIBRARY_PATH="$TOOLS/sdk/default/openharmony/previewer/common/bin:$TOOLS/sdk/default/hms/toolchains/lib:$LD_LIBRARY_PATH"
export PATH="$TOOLS/bin:$PATH"

cd "$ROOT"
"$TOOLS/bin/ohpm" install
"$TOOLS/bin/hvigorw" assembleHap --mode module -p product=default --no-daemon
echo "Unsigned HAP: entry/build/default/outputs/default/entry-default-unsigned.hap"
echo "Consumer HarmonyOS devices require Huawei-issued debug signing before installation."
