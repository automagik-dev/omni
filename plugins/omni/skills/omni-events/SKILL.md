---
name: omni-events
description: "Inspect event activity, analytics, message journeys, causality, contracts, durable consumers and replay."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Events

## When to Use

Investigate what happened, trace a slow or failed message, inspect event contracts/consumers, or replay an authorized range.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [event operations](../omni-ops/references/events.md).
2. Read `omni --help`, then `omni events --help` or the group for the requested trace. Inspect the action's help before using a reference example. Use an event ID for event causality and a message correlation ID for a channel-message journey.
3. Inspect contracts and consumer state before changing them. Dry-run a large replay range first; verify the authorized result through status/log output.

## Rules

- A consumer pull can claim a lease even without acknowledgement; use consumer inspection for metadata-only reads.
- Do not widen a key's grants to reach an unscoped consumer. Event streaming and durable-consumer delivery have different effects.
