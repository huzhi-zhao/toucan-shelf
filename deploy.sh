#!/usr/bin/env bash
#
# One-click deploy script for ToucanShelf.
# Clones (or updates) the GitHub repo and builds/runs it with docker compose.
#
# Usage:
#   ./deploy.sh                # update + rebuild + restart in current checkout
#   curl -fsSL <raw-url>/deploy.sh | bash -s -- --dir ~/memos --branch main
#
# MEMOS_INSTANCE_URL is the public URL users actually reach. It doubles as the
# "is this instance public" switch: unset means anonymous visitors get nothing,
# which also hides per-attachment public links. Override with --instance-url or
# by exporting MEMOS_INSTANCE_URL before running.
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/huzhi-zhao/toucan-shelf.git}"
BRANCH="${BRANCH:-main}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Running ./deploy.sh from an existing checkout should update that checkout. The
# fallback directory is only for the curl-pipe/bootstrap form, where the script
# itself does not live in a Git worktree.
if [ -z "${TARGET_DIR:-}" ]; then
  if [ -d "$SCRIPT_DIR/.git" ]; then
    TARGET_DIR="$SCRIPT_DIR"
  else
    TARGET_DIR="memos"
  fi
fi
MEMOS_INSTANCE_URL="${MEMOS_INSTANCE_URL:-https://toucan.huzhi.dev}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) TARGET_DIR="$2"; shift 2 ;;
    --instance-url) MEMOS_INSTANCE_URL="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--repo <url>] [--branch <name>] [--dir <path>] [--instance-url <url>]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

command -v git >/dev/null 2>&1 || { echo "git is required but not installed." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required but not installed." >&2; exit 1; }

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "docker compose (or docker-compose) is required but not installed." >&2
  exit 1
fi

if [ -d "$TARGET_DIR/.git" ]; then
  echo "==> Updating existing checkout in $TARGET_DIR"
  git -C "$TARGET_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$TARGET_DIR" checkout "$BRANCH"
  git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
else
  echo "==> Cloning $REPO_URL (branch: $BRANCH) into $TARGET_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

# docker-compose.yaml reads this from the environment; without exporting it the
# variable stays shell-local and compose falls back to the empty default.
export MEMOS_INSTANCE_URL
echo "=======> Instance URL: ${MEMOS_INSTANCE_URL:-<unset, private mode>}"

echo "=======> Building image and starting container"
$COMPOSE up -d --build

echo "=======> Deployment complete. ToucanShelf is starting on port ${MEMOS_PORT:-5230}."
echo "    View logs with: $COMPOSE logs -f toucan-shelf"
