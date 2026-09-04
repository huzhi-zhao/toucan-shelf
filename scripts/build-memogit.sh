#!/usr/bin/env bash
#
# Builds the memogit CLI, syncing docs/skill/ into its embedded copy first —
# so packaging memogit never ships a stale agent manual just because someone
# forgot to run sync-agent-skill-docs.sh by hand.
#
# Usage:
#   ./scripts/build-memogit.sh            # -> ./build/memogit
#   ./scripts/build-memogit.sh -o memogit # custom output path
#   sudo cp ./build/memogit /usr/local/bin/
#
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/sync-agent-skill-docs.sh

OUTPUT="./build/memogit"
if [ "${1:-}" = "-o" ]; then
  OUTPUT="$2"
  shift 2
fi

mkdir -p "$(dirname "$OUTPUT")"
go build -o "$OUTPUT" ./cmd/memogit "$@"

echo "Built $OUTPUT"
