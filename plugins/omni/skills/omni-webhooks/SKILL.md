---
name: omni-webhooks
description: "Manage custom webhook ingress, external event sources, connectors and event triggers."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Webhooks

## When to Use

Configure an external event source or connector, or ingest a custom webhook event.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [webhook operations](../omni-ops/references/webhooks.md).
2. Discover installed options with `omni webhooks --help`, `omni connectors --help` or `omni sources --help` for the requested integration.
3. Inspect existing registrations, make the authorized change, then verify saved config and an authorized event's observed result.

## Rules

- Preserve source credentials and target boundaries; registering a source does not prove event delivery.
- Triggering an event or invoking a connector action can cause real downstream effects.
