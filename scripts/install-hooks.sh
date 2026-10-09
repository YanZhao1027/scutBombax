#!/usr/bin/env bash
# Install the versioned hooks in scripts/git-hooks/ into this clone's .git/hooks/.
#
# Git does not share hook files, so each clone opts in once. Without it the privacy guard still runs
# as `pnpm check:privacy` and in review, but nothing stops a leak at commit time.
set -euo pipefail

repo="$(git rev-parse --show-toplevel)"
src="$repo/scripts/git-hooks"
dst="$(git rev-parse --git-path hooks)"
mkdir -p "$dst"

if [ ! -d "$src" ]; then
  echo "no hooks to install at $src" >&2
  exit 1
fi

for hook in "$src"/*; do
  name="$(basename "$hook")"
  if [ -e "$dst/$name" ] && ! grep -q "installed by scripts/install-hooks.sh" "$dst/$name" 2>/dev/null; then
    cp "$dst/$name" "$dst/$name.local-backup"
    echo "kept your existing $name as $name.local-backup"
  fi
  install -m 0755 "$hook" "$dst/$name"
  echo "installed $name -> $dst/$name"
done

echo
echo "verify with: git commit --allow-empty -m 'hook smoke test' && git reset --hard HEAD~1"
