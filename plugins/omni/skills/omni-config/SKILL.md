---
name: omni-config
description: |
  Operate Omni configuration and access surfaces: CLI config/auth, providers, API keys, server settings, service management, logs, dead letters, payloads, and shell completions.
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

## Auth recovery

```bash
# Recover API key when keyValid shows "no" (requires local PM2 access)
omni auth recover --api-url http://localhost:8882 --json
# Generate a new key instead of recovering the existing one
omni auth recover --rotate --json
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

Available schemas: `agno`, `webhook`, `openclaw`, `claude-code`, `genie`, `a2a`, `ag-ui`

```bash
omni providers list --json
omni providers get <id> --json

# openclaw provider
omni providers create \
  --name "openclaw-prod" \
  --schema openclaw \
  --base-url wss://gateway.example/ws \
  --api-key <key> \
  --default-agent-id <agentId> \
  --json

# claude-code provider (runs Claude Code SDK locally)
omni providers create \
  --name "claude-dev" \
  --schema claude-code \
  --project-path /home/user/myproject \
  --max-turns 10 \
  --permission-mode acceptEdits \
  --model claude-opus-4-5 \
  --system-prompt "You are a helpful assistant." \
  --json

# agno / webhook providers (use --base-url and --api-key as needed)
omni providers create --name "agno-prod" --schema agno --base-url https://api.agno.com --api-key <key> --json

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

## Service management

```bash
omni start --json
omni stop --json
omni restart --json
omni update -y --no-restart --json
```

## Logs

```bash
omni logs
omni logs error --limit 50
omni logs --modules api,nats --follow
omni logs --process nats
```

Flags: `[level]` (debug, info, warn, error), `--modules <modules>`, `--limit <n>` (default: 100), `--process [service]` (default: api), `--follow`

## Dead letters

```bash
omni dead-letters list --status pending --limit 50 --json
omni dead-letters get <id> --json
omni dead-letters stats --json
omni dead-letters retry <id> --json
omni dead-letters resolve <id> --note "fixed manually" --json
omni dead-letters abandon <id> --json
```

## Payloads

```bash
omni payloads list <eventId> --json
omni payloads get <eventId> webhook_raw --json
omni payloads get <eventId> agent_response --json
omni payloads delete <eventId> --reason "cleanup" --json
omni payloads config --json
omni payloads config message.received --retention 30 --store-webhook true --json
omni payloads stats --json
```

Payload stages: `webhook_raw`, `agent_request`, `agent_response`, `channel_send`, `error`

## Shell completions

```bash
omni completions bash
omni completions zsh
omni completions fish
```

## Notes

- Prefer `--json` + `jq` for automation-safe parsing.
- `omni providers setup` is interactive; avoid it in automated agent flows.
- `omni auth recover` requires local PM2 access (run on the server hosting Omni).
