#!/usr/bin/env bash
# Heartbeat only. Run from a locked-down systemd unit as a dedicated user.
set -euo pipefail
umask 077
: "${CAMPUS_HEARTBEAT_SECRET:?set in protected EnvironmentFile}"
: "${CAMPUS_RELEASE_SHA:?set exact frontend static release}"
if [[ ! "$CAMPUS_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then exit 2; fi
ready=false
if curl -fsS --connect-timeout 1 --max-time 3 http://127.0.0.1:8080/health-static >/dev/null; then
  ready=true
fi
# Pass secret over stdin to curl rather than command line args.
curl -fsS --connect-timeout 3 --max-time 8 --config - <<CONFIG
url = "https://activity.10273055.xyz/__campus/heartbeat"
request = "POST"
header = "Authorization: Bearer ${CAMPUS_HEARTBEAT_SECRET}"
header = "Content-Type: application/json"
data = "{\"release\":\"${CAMPUS_RELEASE_SHA}\",\"ready\":${ready}}"
CONFIG
