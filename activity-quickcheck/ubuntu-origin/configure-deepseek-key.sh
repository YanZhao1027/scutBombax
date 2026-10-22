#!/usr/bin/env bash
# Run by the Ubuntu service owner on a trusted terminal.
# The API key is never echoed or stored in the Git working tree.
set -euo pipefail
umask 077
root="$HOME/.config/bombax-activity-origin"
mkdir -p "$root"; chmod 700 "$root"
printf 'Paste DeepSeek API key (hidden): ' >&2
IFS= read -r -s key
printf '\n' >&2
length="$(printf '%s' "$key" | wc -c)"
if (( length < 20 || length > 400 )); then
  unset key
  printf 'Invalid API key length; no changes made.\n' >&2
  exit 1
fi
tmp="$(mktemp "$root/.deepseek.key.XXXXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf '%s' "$key" > "$tmp"
unset key
chmod 600 "$tmp"
mv -f "$tmp" "$root/deepseek.key"
systemctl --user restart bombax-activity-origin.service
printf 'DeepSeek key installed privately; staff AI review can now be tested.\n'
