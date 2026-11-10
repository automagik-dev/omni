---
name: omni-instances
description: "Inspect and manage channel instances, connection health, pairing, sync, access, reply filters, and conversational bot behavior."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Instances

## When to Use

List accounts, monitor connection health, pair or reconnect a channel, sync contacts/groups, or configure a conversational bot's filters, debounce and access.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [instance operations](../omni-ops/references/instances.md). Discover current options with `omni instances --help` and `omni channels --help`.
2. Confirm the target with `omni instances list --json`; capture its current config with `omni instances get <id> --json` before changing anything. For provisioning or channel setup, inspect `omni channels add --help` and `omni setup agent --help`.
3. For bot behavior, configure instance routing, reply filters and debounce first. Consult [routes](../omni-ops/references/routes.md), [providers](../omni-ops/references/providers.md) and [automations](../omni-ops/references/automations.md) as needed; mock-test message-handling automations before enabling.
4. Verify one authorized channel end to end before adding more. After go-live, inspect `omni events analytics --since 1h --json` and `omni automations logs <id>`. Inspect `omni channels capabilities --help` for channel event guarantees.

## Rules

- Report before/after instance config, automation IDs with test output, and a fired-event log from real traffic. Formatting claims need a sent-and-observed message.
- If no intended connected instance exists, report it; do not create one unasked. If a required provider/agent is missing, stop and list available choices.
- If a bot loops or double-replies after one debounce/filter fix, disable its automation and report.
- Check the target server, reachability and credentials separately before proposing a restart. Local isolated runtime status is separate; discover it with `omni sandbox --help`.
