---
name: omni-providers
description: "Manage agent providers, schemas, agent definitions, accepts/publishes manifests and A2A discovery."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Providers

## When to Use

Inspect or configure a provider, an agent definition, its manifest, or agent-to-agent discovery and invocation.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [provider operations](../omni-ops/references/providers.md).
2. Read `omni --help`, choose the group for the requested provider or agent operation, then inspect its help and the relevant action's help before using a reference example.
3. Inspect existing definitions before creating duplicates; verify the saved config and requested health checks after an authorized change.

## Rules

- Provider health alone does not prove channel replies work.
- Agent invocation and declaration changes require the same authorization as other real actions.
