#!/usr/bin/env bash
# Wait for ONE new message, then exit (wake up trigger)
# Usage: ./wait-for-message.sh <chat-id> [poll-interval] [timeout-seconds]

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <chat-id> [poll-interval-seconds] [timeout-seconds]"
  echo ""
  echo "Examples:"
  echo "  $0 <chat-id>                   # Wait forever"
  echo "  $0 <chat-id> 2 600             # Wait max 10 minutes"
  echo "  $0 <chat-id> 3 1800            # Wait max 30 minutes"
  exit 1
fi

CHAT_ID="$1"
POLL_INTERVAL="${2:-2}"     # Default 2 seconds
TIMEOUT="${3:-0}"           # Default 0 = no timeout (wait forever)

# Get current latest message ID
latest=$(omni chats messages "$CHAT_ID" --limit 1 --json 2>/dev/null || echo "[]")
LAST_MSG_ID=$(echo "$latest" | jq -r '.[0].id // empty')

START_TIME=$(date +%s)

echo "⏳ Waiting for new message in $CHAT_ID..."
echo "   Poll interval: ${POLL_INTERVAL}s"
if [ "$TIMEOUT" -gt 0 ]; then
  timeout_min=$((TIMEOUT / 60))
  echo "   Timeout: ${timeout_min}m (${TIMEOUT}s)"
else
  echo "   Timeout: none (wait forever)"
fi
echo "   Current message ID: ${LAST_MSG_ID:-none}"
echo ""

while true; do
  # Check timeout
  if [ "$TIMEOUT" -gt 0 ]; then
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
      echo "⏱️  TIMEOUT REACHED (${TIMEOUT}s)"
      echo "   No new message received within timeout period"
      echo ""
      echo "❌ Exiting - timeout"
      exit 1
    fi
  fi
  # Get latest message
  latest=$(omni chats messages "$CHAT_ID" --limit 1 --json 2>/dev/null || echo "[]")

  if [ -n "$latest" ] && [ "$latest" != "[]" ]; then
    current_id=$(echo "$latest" | jq -r '.[0].id // empty')

    # Check if we have a NEW message (different from starting point)
    if [ -n "$current_id" ] && [ "$current_id" != "$LAST_MSG_ID" ]; then
      sender=$(echo "$latest" | jq -r '.[0].senderDisplayName')
      text=$(echo "$latest" | jq -r '.[0].textContent // "(media)"')
      type=$(echo "$latest" | jq -r '.[0].messageType')

      echo "🔔 NEW MESSAGE DETECTED!"
      echo "   From: $sender"
      echo "   Type: $type"
      echo "   Content: $text"
      echo ""
      echo "✅ Exiting - wake up!"
      exit 0
    fi
  fi

  sleep "$POLL_INTERVAL"
done
