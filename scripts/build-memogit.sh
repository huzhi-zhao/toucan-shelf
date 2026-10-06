#!/usr/bin/env bash
#
# Builds the memogit CLI, syncing docs/skill/ into its embedded copy first —
# so packaging memogit never ships a stale agent manual just because someone
# forgot to run sync-agent-skill-docs.sh by hand.
#
# Other repos depend on memogit binaries built here (see
# docs/dev/requirements/collaboration/memogit-distribution.md), so build what
# you ship from a clean, up-to-date main: the version (`memogit -v`) is the
# commit date + hash, and a "-dirty" build can't be traced back to any commit.
#
# Usage:
#   ./scripts/build-memogit.sh                      # this machine -> ./build/memogit
#   ./scripts/build-memogit.sh -o memogit           # custom output path
#   ./scripts/build-memogit.sh --linux-amd64        # Linux x86-64 (Claude cloud sandbox)
#                                                   #   -> ./build/memogit-linux-amd64
#   ./scripts/build-memogit.sh --dist               # what the server publishes under /memogit/:
#                                                   #   every platform + version.json + install.sh
#                                                   #   + bootstrap.md -> ./memogit-dist/ (run before
#                                                   #   `docker build`, like the frontend)
#   cp ./build/memogit /opt/homebrew/bin/memogit    # install locally
#
# Without a git checkout (the server image builds the dist inside Docker, whose
# build context has no .git), pass the version in: MEMOGIT_VERSION=2026.10.06-a68e99be4.
# deploy.sh computes it from the checkout it deploys.
#
set -euo pipefail
cd "$(dirname "$0")/.."

OUTPUT=""
LINUX_AMD64=0
DIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      OUTPUT="$2"
      shift 2
      ;;
    --linux-amd64)
      LINUX_AMD64=1
      shift
      ;;
    --dist)
      DIST=1
      shift
      ;;
    *)
      break
      ;;
  esac
done

./scripts/sync-agent-skill-docs.sh

# Same string `memogit -v` prints (cmd/memogit/version.go), computed from git
# so it also works for a cross-compiled binary this machine can't run. It is
# also stamped in with -ldflags, which is what `memogit -v` falls back to when
# the build could not see the repo.
if [ -n "${MEMOGIT_VERSION:-}" ]; then
  VERSION="$MEMOGIT_VERSION"
  HAVE_GIT=0
else
  VERSION="$(TZ=UTC git log -1 --date=format-local:%Y.%m.%d --format='%cd')-$(git rev-parse --short=9 HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    VERSION="$VERSION-dirty"
  fi
  HAVE_GIT=1
fi
LDFLAGS="-X main.buildVersion=$VERSION"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

warn_unshippable() {
  [ "$HAVE_GIT" = 1 ] || return 0
  if [[ "$VERSION" == *-dirty ]]; then
    echo "warning: built with uncommitted changes; do not ship this binary to other repos" >&2
  fi
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$BRANCH" != "main" ]; then
    echo "warning: built from branch '$BRANCH', not main; features merged since it branched may be missing" >&2
  fi
}

if [ "$DIST" = 1 ]; then
  OUTPUT="${OUTPUT:-./memogit-dist}"
  # The output is wiped first; refuse anything that isn't a previous dist.
  if [ -d "$OUTPUT" ] && [ -n "$(ls -A "$OUTPUT")" ] && [ ! -f "$OUTPUT/version.json" ]; then
    echo "error: $OUTPUT is not empty and is not a memogit dist; refusing to wipe it" >&2
    exit 1
  fi
  rm -rf "$OUTPUT"
  mkdir -p "$OUTPUT"
  FILES=""
  for PLATFORM in darwin-arm64 darwin-amd64 linux-amd64 linux-arm64; do
    NAME="memogit-$PLATFORM"
    # Static, stripped binaries: sandboxes have no Go toolchain or libc guarantees.
    CGO_ENABLED=0 GOOS="${PLATFORM%-*}" GOARCH="${PLATFORM#*-}" \
      go build -trimpath -ldflags "-s -w $LDFLAGS" -o "$OUTPUT/$NAME" ./cmd/memogit "$@"
    SUM="$(sha256 "$OUTPUT/$NAME")"
    FILES="$FILES${FILES:+,}
    \"$PLATFORM\": {\"name\": \"$NAME\", \"sha256\": \"$SUM\"}"
  done
  printf '{\n  "version": "%s",\n  "files": {%s\n  }\n}\n' "$VERSION" "$FILES" >"$OUTPUT/version.json"
  cp scripts/memogit-install.sh "$OUTPUT/install.sh"
  cp docs/skill/bootstrap.md "$OUTPUT/bootstrap.md"
  echo "Built $OUTPUT/ ($(du -sh "$OUTPUT" | cut -f1)), version $VERSION"
  warn_unshippable
  exit 0
fi

if [ "$LINUX_AMD64" = 1 ]; then
  OUTPUT="${OUTPUT:-./build/memogit-linux-amd64}"
  mkdir -p "$(dirname "$OUTPUT")"
  # Static, stripped binary: the sandbox has no Go toolchain or libc guarantees.
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w $LDFLAGS" -o "$OUTPUT" ./cmd/memogit "$@"
else
  OUTPUT="${OUTPUT:-./build/memogit}"
  mkdir -p "$(dirname "$OUTPUT")"
  go build -ldflags "$LDFLAGS" -o "$OUTPUT" ./cmd/memogit "$@"
fi

echo "Built $OUTPUT ($(du -h "$OUTPUT" | cut -f1)), version $VERSION"
warn_unshippable
