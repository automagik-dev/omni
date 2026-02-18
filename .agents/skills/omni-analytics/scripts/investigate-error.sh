#!/usr/bin/env bash
set -euo pipefail

# investigate-error.sh — Query events for errors in a time window and show timeline
# Usage: ./investigate-error.sh [since] [keyword]

SINCE="${1:-1h}"
KEYWORD="${2:-error}"

echo "Investigating errors since $SINCE (keyword: $KEYWORD)..."

output=$(omni events search "$KEYWORD" --since "$SINCE" --json 2>&1) || {
  echo "Error searching events: $output" >&2
  exit 1
}

count=$(echo "$output" | jq 'length')
echo "Found $count matching events."

if [[ "$count" -gt 0 ]]; then
  echo ""
  echo "Event breakdown by type:"
  echo "$output" | jq 'group_by(.type) | map({type: .[0].type, count: length}) | sort_by(-.count)'

  echo ""
  echo "Latest 5 events:"
  echo "$output" | jq '.[0:5] | .[] | {type, timestamp, status, id}'
fi
