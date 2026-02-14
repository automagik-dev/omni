#!/usr/bin/env bash
# Listen for new messages in a specific chat
# Usage: ./listen-chat.sh <instance-id> <chat-id>

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <instance-id> <chat-id> [poll-interval-seconds]"
  echo ""
  echo "Example:"
  echo "  $0 <instance-id> <chat-id>@s.whatsapp.net"
  echo "  $0 <instance-id> <chat-id>@s.whatsapp.net 5"
  exit 1
fi

INSTANCE_ID="$1"
CHAT_ID="$2"
POLL_INTERVAL="${3:-2}"  # Default 2 seconds
LAST_MSG_ID=""

echo "👂 Listening for new messages in $CHAT_ID..."
echo "   Instance: $INSTANCE_ID"
echo "   Poll interval: ${POLL_INTERVAL}s"
echo ""

while true; do
  # Get latest message (chat ID already contains instance info)
  latest=$(omni chats messages "$CHAT_ID" --limit 1 --json 2>/dev/null || true)

  if [ -n "$latest" ] && [ "$latest" != "null" ]; then
    current_id=$(echo "$latest" | jq -r '.[0].id // empty')

    # Check if we have a new message
    if [ -n "$current_id" ] && [ "$current_id" != "$LAST_MSG_ID" ]; then
      # Extract message details
      sender=$(echo "$latest" | jq -r '.[0].senderDisplayName')
      text=$(echo "$latest" | jq -r '.[0].textContent // empty')
      type=$(echo "$latest" | jq -r '.[0].messageType')
      is_from_me=$(echo "$latest" | jq -r '.[0].isFromMe')

      timestamp=$(date '+%H:%M:%S')

      # Display with emoji based on direction
      if [ "$is_from_me" = "true" ]; then
        icon="📤"
      else
        icon="💬"
      fi

      echo "[$timestamp] $icon New $type from $sender"

      # Only show text if it exists
      if [ -n "$text" ]; then
        echo "   📝 $text"
      fi

      # ⚡ ADD YOUR ACTION HERE ⚡
      # Examples:
      # - Auto-reply: omni send --to "$CHAT_ID" --text "Got it!" --instance "$INSTANCE_ID"
      # - Log to file: echo "[$timestamp] $sender: $text" >> message-log.txt
      # - Webhook: curl -X POST https://your-webhook.com -d "{\"message\": \"$text\"}"
      # - Desktop notification: notify-send "Message from $sender" "$text"

      LAST_MSG_ID="$current_id"
    fi
  fi

  sleep "$POLL_INTERVAL"
done
