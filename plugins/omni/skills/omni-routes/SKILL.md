---
name: omni-routes
description: "Inspect and configure agent routing, reply filters, gates, scopes and route priority."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Routes

## When to Use

Inspect which agent handles a conversation or change an authorized routing rule, filter, gate, scope or priority.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [routing operations](../omni-ops/references/routes.md).
2. Read `omni --help`, then `omni routes --help` and the relevant action's help before using a reference example; inspect the current target and bindings before editing.
3. Apply the requested change and read the resulting configuration to verify it.

## Rules

- Resolve existing instance, provider and agent IDs; do not invent targets or broaden their access.
- Report the saved route/filter separately from any authorized, observed reply.
