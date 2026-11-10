---
name: omni-config
description: "Configure CLI defaults, server credentials, API keys and settings; inspect service health, logs, dead letters, payloads, trust, tenancy and audit."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Config

## When to Use

Configure an existing server or CLI defaults, diagnose auth/health, inspect logs or failed events, or administer an explicitly authorized trust/tenant setting.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [configuration operations](../omni-ops/references/config.md).
2. Read `omni --help`, choose the group for the requested setting, then inspect its help and the relevant action's help before using a reference example. Check the selected server, reachability and credentials separately.
3. For trust, tenancy or audit, discover the corresponding group in installed help and inspect the current posture before the requested operation.
4. Verify authorized changes with a follow-up read; report the actual result.

## Rules

- Use protected input or a secret manager for credentials; never request keys in chat or paste values into commands.
- Remote server registry entries and local `server.*` runtime settings are distinct. An auth failure does not authorize installing or restarting services.
- Scope/trust changes are not credential troubleshooting shortcuts. Discovery does not authorize repairs or destructive actions.
