---
name: omni-config
description: |
  Operate Omni configuration and access surfaces: CLI config/auth, providers, API keys, and server settings.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Config

Use this for runtime configuration and access management (not infrastructure bootstrap).

## Auth and status

```bash
omni auth login --api-key <key> --api-url http://localhost:8882 --json
omni auth status --json
omni auth logout --json
omni status --json
```

## CLI config

```bash
omni config list --json
omni config get defaultInstance --json
omni config set defaultInstance <id> --json
omni config set format json --json
omni config unset defaultInstance --json
```

## Providers

```bash
omni providers list --json
omni providers get <id> --json
omni providers create \
  --name "openclaw-prod" \
  --schema openclaw \
  --base-url wss://gateway.example/ws \
  --api-key <key> \
  --default-agent-id <agentId> \
  --json
omni providers test <id> --json
omni providers agents <id> --json
omni providers teams <id> --json
omni providers workflows <id> --json
omni providers delete <id> --force --json
```

## API keys

```bash
omni keys create --name "agent-key" --scopes messages:read,instances:write --instances <id1,id2> --json
omni keys list --status active --limit 50 --json
omni keys get <id> --json
omni keys update <id> --rate-limit 120 --expires 2026-12-31T23:59:59Z --json
omni keys revoke <id> --reason "rotation" --json
omni keys delete <id> --json
```

## Server settings

```bash
omni settings list --json
omni settings list --category ai --json
omni settings get <key> --json
omni settings set <key> <value> --reason "ops update" --json
```

## Notes

- Prefer `--json` + `jq` for automation-safe parsing.
- `omni providers setup` is interactive; avoid it in automated agent flows.
