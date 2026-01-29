#!/bin/bash
#
# Download NATS server binary if not present
#
# Usage: ./scripts/ensure-nats.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$PROJECT_ROOT/bin"
NATS_BINARY="$BIN_DIR/nats-server"
NATS_VERSION="${NATS_VERSION:-v2.10.24}"

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

# Check if already exists and is executable
if [[ -x "$NATS_BINARY" ]]; then
  echo "NATS server already installed at $NATS_BINARY"
  "$NATS_BINARY" --version
  exit 0
fi

echo "Installing NATS server ${NATS_VERSION} for ${OS}/${ARCH}..."

# Create bin directory
mkdir -p "$BIN_DIR"

# Download URL
DOWNLOAD_URL="https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/nats-server-${NATS_VERSION}-${OS}-${ARCH}.tar.gz"

echo "Downloading from: $DOWNLOAD_URL"

# Download and extract
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_DIR/nats-server.tar.gz"
tar -xzf "$TEMP_DIR/nats-server.tar.gz" -C "$TEMP_DIR"

# Find and move the binary
EXTRACTED_BINARY=$(find "$TEMP_DIR" -name "nats-server" -type f | head -1)
if [[ -z "$EXTRACTED_BINARY" ]]; then
  echo "Error: Could not find nats-server binary in archive"
  exit 1
fi

mv "$EXTRACTED_BINARY" "$NATS_BINARY"
chmod +x "$NATS_BINARY"

echo "NATS server installed successfully!"
"$NATS_BINARY" --version
