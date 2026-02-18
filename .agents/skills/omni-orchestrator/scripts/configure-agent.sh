#!/usr/bin/env bash
set -euo pipefail

# configure-agent.sh — Configure agent routing and reply filters for an instance
# Usage: ./configure-agent.sh <instance-id> <provider-id> [whitelist|blacklist] [contacts...]

INSTANCE_ID="${1:?Usage: configure-agent.sh <instance-id> <provider-id> [whitelist|blacklist] [contacts...]}"
PROVIDER_ID="${2:?Usage: configure-agent.sh <instance-id> <provider-id> [whitelist|blacklist] [contacts...]}"
FILTER_MODE="${3:-}"
shift 3 2>/dev/null || true
CONTACTS=("$@")

echo "Configuring agent routing for instance: $INSTANCE_ID"
echo "Provider: $PROVIDER_ID"

omni instances update "$INSTANCE_ID" --agent-routing "{\"providerId\":\"$PROVIDER_ID\"}" || {
  echo "Error setting agent routing" >&2
  exit 1
}
echo "Agent routing configured."

if [[ -n "$FILTER_MODE" ]]; then
  contacts_json="[]"
  if [[ ${#CONTACTS[@]} -gt 0 ]]; then
    contacts_json=$(printf '%s\n' "${CONTACTS[@]}" | jq -R . | jq -s .)
  fi

  echo "Setting reply filter: $FILTER_MODE"
  omni instances update "$INSTANCE_ID" --reply-filter "{\"mode\":\"$FILTER_MODE\",\"contacts\":$contacts_json}" || {
    echo "Error setting reply filter" >&2
    exit 1
  }
  echo "Reply filter configured."
fi

echo ""
echo "Instance configuration complete."
omni instances status "$INSTANCE_ID"
