#!/bin/bash
#
# Download the pinned NATS server binary unless it is already installed
#
# Usage: ./scripts/ensure-nats.sh
#
# The release and each platform archive's size and sha256 come from the CLI's pin
# (packages/cli/src/nats-pin.json), the same one `omni install` uses. The archive
# is checked, size first, then sha256, before it is unpacked; a mismatch or a
# platform the pin has no checksum for exits non-zero and leaves nothing behind.
# A verified install leaves bin/nats-server.pin; a binary without the pinned
# marker is replaced, renamed over, so a refused archive leaves it as it was.
#
# NATS_RELEASE_BASE overrides where the archive comes from (a mirror, or a test).
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"
NATS_BINARY="$BIN_DIR/nats-server"
NATS_PIN="$PROJECT_ROOT/packages/cli/src/nats-pin.json"

# Detect OS and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)
    ARCH="amd64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# version, size and sha256 for this platform, from the pin (empty when it has none)
# shellcheck disable=SC2016 # the quoted text is JavaScript, not shell
read -r NATS_VERSION PINNED_SIZE PINNED_SHA256 < <(
  NATS_PIN="$NATS_PIN" PLATFORM="${OS}-${ARCH}" bun -e '
    const pin = await Bun.file(process.env.NATS_PIN).json();
    const asset = pin.platforms[process.env.PLATFORM];
    console.log(`v${pin.version} ${asset?.size ?? ""} ${asset?.sha256 ?? ""}`);
  '
)
if [[ -z "$PINNED_SHA256" ]]; then
  echo "Error: the NATS pin has no checksum for ${OS}-${ARCH}; not downloading it"
  exit 1
fi

# A binary already there is kept only when its marker says it is the pinned release.
MARKER="${NATS_VERSION#v} ${PINNED_SHA256}"
if [[ -x "$NATS_BINARY" && "$(cat "$NATS_BINARY.pin" 2>/dev/null)" == "$MARKER" ]]; then
  echo "NATS server ${NATS_VERSION} already installed at $NATS_BINARY"
  "$NATS_BINARY" --version
  exit 0
fi

echo "Installing NATS server ${NATS_VERSION} for ${OS}/${ARCH}..."

ARCHIVE="nats-server-${NATS_VERSION}-${OS}-${ARCH}.tar.gz"
NATS_RELEASE_BASE="${NATS_RELEASE_BASE:-https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}}"
DOWNLOAD_URL="${NATS_RELEASE_BASE}/${ARCHIVE}"

echo "Downloading from: $DOWNLOAD_URL"

# Download, check, and extract
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR" "$BIN_DIR/.nats-server.new" "$BIN_DIR/.nats-server.pin.new"' EXIT

curl -fsSL --retry 5 --retry-all-errors --retry-delay 10 --connect-timeout 10 "$DOWNLOAD_URL" -o "$TEMP_DIR/nats-server.tar.gz"

SIZE="$(wc -c <"$TEMP_DIR/nats-server.tar.gz" | tr -d ' ')"
if [[ "$SIZE" != "$PINNED_SIZE" ]]; then
  echo "Error: ${ARCHIVE} is ${SIZE} bytes, not the pinned ${PINNED_SIZE}; refusing it"
  exit 1
fi
SHA256="$(shasum -a 256 "$TEMP_DIR/nats-server.tar.gz" | awk '{print $1}')"
if [[ "$SHA256" != "$PINNED_SHA256" ]]; then
  echo "Error: ${ARCHIVE} has sha256 ${SHA256}, not the pinned ${PINNED_SHA256}; refusing it"
  exit 1
fi

tar -xzf "$TEMP_DIR/nats-server.tar.gz" -C "$TEMP_DIR"

# Find and move the binary
EXTRACTED_BINARY=$(find "$TEMP_DIR" -name "nats-server" -type f | head -1)
if [[ -z "$EXTRACTED_BINARY" ]]; then
  echo "Error: Could not find nats-server binary in archive"
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$EXTRACTED_BINARY"
# Beside the target first, so the rename over it stays on one file system.
mv "$EXTRACTED_BINARY" "$BIN_DIR/.nats-server.new"
mv -f "$BIN_DIR/.nats-server.new" "$NATS_BINARY"
printf '%s\n' "$MARKER" >"$BIN_DIR/.nats-server.pin.new"
mv -f "$BIN_DIR/.nats-server.pin.new" "$NATS_BINARY.pin"

echo "NATS server installed successfully!"
"$NATS_BINARY" --version
