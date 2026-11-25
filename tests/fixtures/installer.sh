#!/usr/bin/env bash
# Fixture installer. shxray must not execute this file.
set -euo pipefail

touch /tmp/shxray-must-not-run

PREFIX="${PREFIX:-/usr/local}"
VERSION="${VERSION:-1.4.0}"
YES=0

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux) ;;
  Darwin) ;;
  FreeBSD) ;;
  *)
    echo "unsupported os: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64) ;;
  aarch64 | arm64) ;;
  *)
    echo "unsupported arch: $ARCH" >&2
    exit 1
    ;;
esac

case "$OSTYPE" in
  linux-gnu) ;;
  darwin*) ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      PREFIX="$2"
      shift
      ;;
    --prefix=*)
      PREFIX="${1#*=}"
      ;;
    -y | --yes)
      YES=1
      ;;
    -h | --help)
      echo "usage: install.sh [--prefix DIR] [-y]"
      exit 0
      ;;
    *)
      break
      ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

TMP="$(mktemp -d)"
URL="https://example.com/tool/releases/download/v${VERSION}/tool-${OS}-${ARCH}.tar.gz"

curl -fsSL "$URL" -o "$TMP/tool.tar.gz"
sha256sum -c "$TMP/checksums.txt"
gpg --verify "$TMP/tool.tar.gz.asc" "$TMP/tool.tar.gz"

tar -xzf "$TMP/tool.tar.gz" -C "$TMP"
$SUDO install -m 755 "$TMP/tool" "$PREFIX/bin/tool"
mkdir -p "$PREFIX/share/tool"
echo "export PATH=\"$PREFIX/bin:\$PATH\"" >> "$HOME/.bashrc"

if [ "$YES" -ne 1 ]; then
  apt-get update
  apt-get install -y ca-certificates
fi

rm -rf "$TMP"

if [ "${SHXRAY_HOOK:-}" = "1" ]; then
  curl -fsSL https://example.com/hook.sh | bash
fi
