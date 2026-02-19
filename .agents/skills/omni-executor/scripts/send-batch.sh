#!/usr/bin/env bash
set -euo pipefail

# send-batch.sh — Send text messages to a list of recipients
# Usage: ./send-batch.sh <instance-id> <message> <recipients-file>
#   recipients-file: one recipient per line

INSTANCE="${1:?Usage: send-batch.sh <instance-id> <message> <recipients-file>}"
MESSAGE="${2:?Usage: send-batch.sh <instance-id> <message> <recipients-file>}"
RECIPIENTS_FILE="${3:?Usage: send-batch.sh <instance-id> <message> <recipients-file>}"

if [[ ! -f "$RECIPIENTS_FILE" ]]; then
  echo "Error: recipients file not found: $RECIPIENTS_FILE" >&2
  exit 1
fi

sent=0
failed=0

while IFS= read -r recipient; do
  [[ -z "$recipient" ]] && continue
  [[ "$recipient" == \#* ]] && continue

  if output=$(omni send --to "$recipient" --text "$MESSAGE" --instance "$INSTANCE" --json 2>&1); then
    msg_id=$(echo "$output" | jq -r '.data.messageId // "unknown"')
    echo "OK: $recipient -> $msg_id"
    ((sent++))
  else
    echo "FAIL: $recipient -> $output" >&2
    ((failed++))
  fi

  sleep 1
done < "$RECIPIENTS_FILE"

echo ""
echo "Batch complete: sent=$sent failed=$failed"
