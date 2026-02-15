#!/usr/bin/env bash
# Cleanup test instances that weren't properly deleted

set -e

echo "🧹 Cleaning up test instances..."

# Get all test instance IDs
TEST_IDS=$(omni instances list | awk '/test-instance|test-routes|test-lid/ {print $1}')

if [ -z "$TEST_IDS" ]; then
  echo "✓ No test instances to clean up"
  exit 0
fi

# Count them
COUNT=$(echo "$TEST_IDS" | wc -l)
echo "Found $COUNT test instances to delete"

# Delete each one
echo "$TEST_IDS" | while read -r id; do
  if [ -n "$id" ]; then
    echo "  Deleting $id..."
    omni instances delete "$id" || echo "  ⚠ Failed to delete $id"
  fi
done

echo "✓ Cleanup complete!"
