#!/usr/bin/env bash
set -euo pipefail

# setup-whatsapp.sh — Create a WhatsApp instance, display QR, and wait for connection
# Usage: ./setup-whatsapp.sh <instance-name>

INSTANCE_NAME="${1:?Usage: setup-whatsapp.sh <instance-name>}"

echo "Creating WhatsApp instance: $INSTANCE_NAME"
output=$(omni instances create --channel whatsapp --name "$INSTANCE_NAME" --json 2>&1) || {
  echo "Error creating instance: $output" >&2
  exit 1
}

instance_id=$(echo "$output" | jq -r '.data.id // .id // empty')
if [[ -z "$instance_id" ]]; then
  echo "Error: could not extract instance ID" >&2
  echo "$output" >&2
  exit 1
fi

echo "Instance created: $instance_id"
echo "Displaying QR code (scan with WhatsApp)..."
echo ""

omni instances qr "$instance_id" --watch || {
  echo "QR display ended." >&2
}

echo ""
echo "Checking connection status..."
status_output=$(omni instances status "$instance_id" --json 2>&1) || true
state=$(echo "$status_output" | jq -r '.data.state // .state // "unknown"')

if [[ "$state" == "connected" ]]; then
  echo "WhatsApp connected successfully!"
  omni config set defaultInstance "$instance_id"
  echo "Set as default instance."
else
  echo "Status: $state — you may need to re-scan the QR code."
fi
