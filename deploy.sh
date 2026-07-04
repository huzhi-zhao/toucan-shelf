#!/usr/bin/env bash
#
# One-click deploy script for memos.
# Clones (or updates) the GitHub repo and builds/runs it with docker compose.
#
# Usage:
#   ./deploy.sh                # update + rebuild + restart in current checkout
#   curl -fsSL <raw-url>/deploy.sh | bash -s -- --dir ~/memos --branch main
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/jimmy-zhz/memos.git}"
BRANCH="${BRANCH:-main}"
TARGET_DIR="${TARGET_DIR:-memos}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) TARGET_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--repo <url>] [--branch <name>] [--dir <path>]"
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

echo "==> Building image and starting container"
$COMPOSE up -d --build

echo "==> Deployment complete. memos is starting on port ${MEMOS_PORT:-5230}."
echo "    View logs with: $COMPOSE logs -f memos"
