#!/usr/bin/env bash
# One-time USER-EXECUTED maintenance only for synthetic staging accounts.
# Does not contain or print plaintext credentials.
set -euo pipefail
ROOT="/home/zyubuntu/scutbombax/scutBombax-activity-live/activity-quickcheck"
SQL="/tmp/bombax-synthetic-password-migration.sql"
PASS="/tmp/bombax-stage-new-password"
WR="/home/zyubuntu/Downloads/audition-lite-phase2/audition-lite/node_modules/.bin/wrangler"
cd "$ROOT"
if [[ ! -f "$SQL" || ! -f "$PASS" ]]; then
  echo "Staged migration files are missing; do not attempt a partial rotation." >&2
  exit 1
fi
if [[ "$(wc -l < "$SQL")" -ne 4 ]]; then
  echo "Expected exactly four synthetic account updates." >&2
  exit 1
fi
if ! grep -q '"database_name": "scut-bombax-activity-stage"' wrangler.stage.jsonc; then
  echo "The Wrangler binding does not point to the isolated staging database." >&2
  exit 1
fi
echo "Target: scut-bombax-activity-stage (ONLY synthetic demo accounts)."
echo "No audition, production, school, or campus account will be changed."
read -r -p "Type MIGRATE-TEST to apply four test-account hash updates: " confirmation
if [[ "$confirmation" != "MIGRATE-TEST" ]]; then
  echo "Cancelled without changes."
  exit 2
fi
"$WR" d1 execute scut-bombax-activity-stage --remote --file "$SQL" -c wrangler.stage.jsonc > /tmp/bombax-stage-login-migration-result.log
rm -f "$SQL"
echo "Synthetic migration applied. Previous test password no longer works."
echo "Your new private synthetic password is stored at: $PASS (mode 0600)."
echo "View it only in your own Ubuntu terminal, and avoid screenshots or sharing it with third parties."
