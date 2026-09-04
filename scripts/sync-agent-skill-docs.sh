#!/usr/bin/env bash
# Mirrors docs/skill/ into internal/memogit/assets/skill/, the copy go:embed
# compiles into the memogit binary as the checkout's agent manual.
#
# docs/skill/ is the single source of truth for agent-facing operating
# instructions (see docs/dev/requirements/collaboration/agent-manual-unification.md).
# internal/memogit/assets/skill/ is a generated mirror, committed like
# proto/gen/ so `go build` needs no extra step — never hand-edit it.
#
# Run this after any change under docs/skill/, then `go build ./internal/memogit/...`
# to confirm the embed picks it up.
set -euo pipefail
cd "$(dirname "$0")/.."

src="docs/skill"
dst="internal/memogit/assets/skill"

if [ ! -d "$src" ]; then
  echo "error: $src not found (run from repo root)" >&2
  exit 1
fi

rm -rf "$dst"
mkdir -p "$dst"
cp -R "$src"/. "$dst"/

echo "Synced $src/ -> $dst/"
