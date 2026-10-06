#!/bin/sh
#
# Installs the memogit build that matches a ToucanShelf server, then
# optionally runs it. Published by the server as /memogit/install.sh (see
# scripts/build-memogit.sh --dist); what it is for is explained to agents in
# /memogit/bootstrap.md.
#
#   curl -fsSL "$TOUCANSHELF_SERVER/memogit/install.sh" | sh
#   curl -fsSL "$TOUCANSHELF_SERVER/memogit/install.sh" | sh -s -- hook session-start
#
# Environment:
#   TOUCANSHELF_SERVER    server URL (MEMOGIT_SERVER also works)
#   MEMOGIT_INSTALL_DIR   install here instead of picking a directory
#
# Arguments, if any, are passed to the installed memogit. When they start with
# `hook`, failures are printed to stdout as a "not ready" status and the
# script exits 0: a Claude Code hook's stdout is what the agent sees.
set -u

SERVER="${TOUCANSHELF_SERVER:-${MEMOGIT_SERVER:-}}"
SERVER="${SERVER%/}"
HOOK=0
if [ "${1:-}" = "hook" ]; then
  HOOK=1
fi

fail() {
  if [ "$HOOK" = 1 ]; then
    printf '⛔ memogit: 知识库未就绪\n\nmemogit 安装失败：%s\n\n停下来把原因告诉用户，不要读写知识库内容，也不要改用 MCP 或其他途径绕过。排查和配置步骤见 %s/memogit/bootstrap.md。\n' \
      "$1" "${SERVER:-<TOUCANSHELF_SERVER>}"
    exit 0
  fi
  echo "memogit install: $1" >&2
  exit 1
}

# Run the installed binary with the caller's arguments, if there are any.
run() {
  if [ $# -gt 1 ]; then
    bin="$1"
    shift
    exec "$bin" "$@"
  fi
  exit 0
}

[ -n "$SERVER" ] || fail "环境变量 TOUCANSHELF_SERVER 没有设置"
command -v curl >/dev/null 2>&1 || fail "需要 curl"

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "不支持的系统 $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) fail "不支持的 CPU 架构 $(uname -m)" ;;
esac
PLATFORM="$OS-$ARCH"

TMP="$(mktemp -d)" || fail "无法创建临时目录"
trap 'rm -rf "$TMP"' EXIT

CURRENT="$(command -v memogit 2>/dev/null || true)"

if ! curl -fsSL "$SERVER/memogit/version.json" -o "$TMP/version.json" 2>"$TMP/curl.err"; then
  reason="读取 $SERVER/memogit/version.json 失败：$(cat "$TMP/curl.err")。403 多半是云端环境的网络白名单没放行服务器域名；404 说明服务器还没部署 memogit 分发"
  # An installed memogit still works against a server it can reach for the
  # API; carry on with it rather than refusing to sync.
  if [ -n "$CURRENT" ]; then
    echo "memogit install: $reason; using the installed $CURRENT" >&2
    run "$CURRENT" "$@"
  fi
  fail "$reason"
fi

# version.json is written by scripts/build-memogit.sh with one platform per
# line, so plain sed is enough to read it.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TMP/version.json" | head -n 1)"
ENTRY="$(grep "\"$PLATFORM\"" "$TMP/version.json" || true)"
NAME="$(printf '%s' "$ENTRY" | sed -n 's/.*"name": *"\([^"]*\)".*/\1/p')"
SUM="$(printf '%s' "$ENTRY" | sed -n 's/.*"sha256": *"\([^"]*\)".*/\1/p')"
[ -n "$VERSION" ] || fail "version.json 里没有版本号"
[ -n "$NAME" ] && [ -n "$SUM" ] || fail "服务器没有提供 $PLATFORM 平台的 memogit"

if [ -n "$CURRENT" ] && [ "$("$CURRENT" -v 2>/dev/null)" = "memogit $VERSION" ]; then
  run "$CURRENT" "$@"
fi

writable() { [ -d "$1" ] && [ -w "$1" ]; }
if [ -n "${MEMOGIT_INSTALL_DIR:-}" ]; then
  DIR="$MEMOGIT_INSTALL_DIR"
  mkdir -p "$DIR" || fail "无法创建 $DIR"
elif [ -n "$CURRENT" ] && writable "$(dirname "$CURRENT")"; then
  DIR="$(dirname "$CURRENT")"
elif writable /usr/local/bin; then
  DIR=/usr/local/bin
else
  DIR="$HOME/.local/bin"
  mkdir -p "$DIR" || fail "无法创建 $DIR"
fi

curl -fsSL "$SERVER/memogit/$NAME" -o "$TMP/memogit" 2>"$TMP/curl.err" ||
  fail "下载 $SERVER/memogit/$NAME 失败：$(cat "$TMP/curl.err")"

if command -v sha256sum >/dev/null 2>&1; then
  GOT="$(sha256sum "$TMP/memogit" | cut -d' ' -f1)"
else
  GOT="$(shasum -a 256 "$TMP/memogit" | cut -d' ' -f1)"
fi
[ "$GOT" = "$SUM" ] || fail "$NAME 校验失败（sha256 是 $GOT，应为 $SUM）"

chmod 755 "$TMP/memogit"
# Copy next to the target, then rename: never leave a half-written binary.
cp "$TMP/memogit" "$DIR/.memogit.new" && mv -f "$DIR/.memogit.new" "$DIR/memogit" ||
  fail "无法写入 $DIR/memogit"
echo "memogit install: installed $VERSION to $DIR/memogit" >&2

if [ "$(command -v memogit 2>/dev/null || true)" != "$DIR/memogit" ]; then
  echo "memogit install: warning: \`memogit\` on PATH is not $DIR/memogit; put $DIR first in PATH so the Stop hook runs this version" >&2
fi
run "$DIR/memogit" "$@"
