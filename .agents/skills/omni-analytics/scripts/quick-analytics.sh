#!/usr/bin/env bash
set -euo pipefail

# quick-analytics.sh — Run analytics for an instance and output a JSON summary
# Usage: ./quick-analytics.sh <instance-id> [since]

INSTANCE_ID="${1:?Usage: quick-analytics.sh <instance-id> [since]}"
SINCE="${2:-7d}"

echo "Fetching analytics for instance $INSTANCE_ID (since $SINCE)..."

output=$(omni events analytics --instance "$INSTANCE_ID" --since "$SINCE" --json 2>&1) || {
  echo "Error fetching analytics: $output" >&2
  exit 1
}

echo "$output" | jq '{
  totalMessages: .totalMessages,
  successRate: .successRate,
  avgProcessingTime: .avgProcessingTime,
  errorStages: .errorStages,
  messageTypes: .messageTypes
}'
