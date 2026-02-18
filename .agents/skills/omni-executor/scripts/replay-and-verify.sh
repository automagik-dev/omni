#!/usr/bin/env bash
set -euo pipefail

# replay-and-verify.sh — Start an event replay and poll until complete
# Usage: ./replay-and-verify.sh <since> [--dry-run]

SINCE="${1:?Usage: replay-and-verify.sh <since> [--dry-run]}"
DRY_RUN="${2:-}"

EXTRA_FLAGS=""
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  EXTRA_FLAGS="--dry-run"
fi

echo "Starting replay since $SINCE $EXTRA_FLAGS..."
output=$(omni events replay --start --since "$SINCE" $EXTRA_FLAGS --json 2>&1) || {
  echo "Error starting replay: $output" >&2
  exit 1
}

session_id=$(echo "$output" | jq -r '.data.sessionId // .sessionId // empty')
if [[ -z "$session_id" ]]; then
  echo "Replay started (no session ID returned — may be dry-run)"
  echo "$output" | jq .
  exit 0
fi

echo "Replay session: $session_id"

while true; do
  status_output=$(omni events replay --status "$session_id" --json 2>&1) || {
    echo "Error checking status: $status_output" >&2
    exit 1
  }

  state=$(echo "$status_output" | jq -r '.data.state // .state // "unknown"')
  progress=$(echo "$status_output" | jq -r '.data.progress // .progress // "N/A"')

  echo "State: $state | Progress: $progress"

  case "$state" in
    completed|done)
      echo "Replay completed successfully."
      echo "$status_output" | jq .
      exit 0
      ;;
    failed|error)
      echo "Replay failed." >&2
      echo "$status_output" | jq . >&2
      exit 1
      ;;
    *)
      sleep 5
      ;;
  esac
done
