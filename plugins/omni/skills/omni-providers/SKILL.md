---
name: omni-providers
description: |
  Manage AI/agent providers: list, get, create (genie, claude-code, a2a, ag-ui, agno, openclaw, webhook schemas), update, delete, setup wizards, health test, and Agno resource listing.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Providers

## List providers

```bash
omni providers list --json
omni providers list --active --json
```

### List options

| Flag | Description |
|------|-------------|
| `--active` | Show only active providers |

## Get provider details

```bash
omni providers get <id> --json
```

Returns full provider record including schema, config, active status, and linked agents.

## Create provider

Each provider has a `--schema` that determines which options apply.

### Agno provider

```bash
omni providers create --name "agno-prod" --schema agno \
  --base-url https://app.agno.com/v1/playground/agents \
  --api-key <key> --json
```

### Webhook provider

```bash
omni providers create --name "my-webhook" --schema webhook \
  --base-url https://api.example.com/chat \
  --api-key <key> --timeout 30 --stream --json
```

### OpenClaw provider

```bash
omni providers create --name "openclaw-agent" --schema openclaw \
  --base-url wss://gateway.openclaw.dev \
  --api-key <token> --default-agent-id <agentId> --json
```

### A2A provider

```bash
omni providers create --name "a2a-service" --schema a2a \
  --base-url https://a2a.example.com \
  --api-key <key> --timeout 120 --json
```

### AG-UI provider

```bash
omni providers create --name "ag-ui-service" --schema ag-ui \
  --base-url https://ag-ui.example.com \
  --api-key <key> --stream --json
```

### Claude Code provider

```bash
omni providers create --name "claude-code-local" --schema claude-code \
  --project-path /home/user/my-project \
  --max-turns 10 --permission-mode bypassPermissions \
  --model claude-sonnet-4-6 --system-prompt "You are a helpful assistant" --json

# API key is optional if ANTHROPIC_API_KEY env var is set
omni providers create --name "claude-code-keyed" --schema claude-code \
  --project-path /home/user/project --api-key <key> --json
```

### Genie provider

```bash
omni providers create --name "genie-teamlead" --schema genie \
  --agent-name "omni-agent" --target-agent "team-lead" \
  --team-name "omni-{chat_id}" --json
```

### Create options (all schemas)

| Flag | Schema | Description |
|------|--------|-------------|
| `--name <name>` | all | Provider name (unique) |
| `--schema <schema>` | all | `agno`, `webhook`, `openclaw`, `ag-ui`, `claude-code`, `a2a`, `genie` |
| `--base-url <url>` | all except genie | API base URL (`ws://` or `wss://` for openclaw) |
| `--api-key <key>` | all | API key (optional for claude-code if env var set) |
| `--description <desc>` | all | Provider description |
| `--timeout <seconds>` | all | Default timeout in seconds (default: 60) |
| `--stream` | all | Enable streaming by default |
| `--default-agent-id <id>` | openclaw | Default agent ID (required) |
| `--project-path <path>` | claude-code | Project directory path (required) |
| `--max-turns <number>` | claude-code | Max conversation turns |
| `--permission-mode <mode>` | claude-code | `default`, `acceptEdits`, `bypassPermissions`, `plan` |
| `--model <model>` | claude-code | Model override |
| `--system-prompt <prompt>` | claude-code | System prompt prepended to agent |
| `--agent-name <name>` | genie | Agent identity / "from" field (required) |
| `--target-agent <name>` | genie | Target agent inbox to deliver to (required) |
| `--team-name <template>` | genie | Team name template, supports `{chat_id}`, `{thread_id}`, `{sender_id}` (default: `omni-{chat_id}`) |

## Update provider

```bash
omni providers update <id> --name "new-name" --json
omni providers update <id> --base-url https://new.url --api-key <newKey> --json
omni providers update <id> --timeout 120 --stream --json
omni providers update <id> --no-stream --json
omni providers update <id> --active --json
omni providers update <id> --no-active --json

# Update genie-specific options
omni providers update <id> --agent-name "new-agent" --target-agent "new-target" --team-name "custom-{chat_id}" --json

# Update claude-code-specific options
omni providers update <id> --project-path /new/path --max-turns 20 --permission-mode plan --model claude-sonnet-4-6 --json

# Raw schema config override (advanced)
omni providers update <id> --schema-config '{"projectPath":"/custom","maxTurns":5}' --json
```

### Update options

| Flag | Description |
|------|-------------|
| `--name <name>` | Provider name |
| `--base-url <url>` | API base URL |
| `--api-key <key>` | API key |
| `--description <desc>` | Provider description |
| `--timeout <seconds>` | Default timeout in seconds |
| `--stream` / `--no-stream` | Enable/disable streaming |
| `--active` / `--no-active` | Set provider active/inactive |
| `--agent-name <name>` | Agent identity (genie) |
| `--target-agent <name>` | Target agent inbox (genie) |
| `--team-name <template>` | Team name template (genie) |
| `--project-path <path>` | Project directory path (claude-code) |
| `--max-turns <number>` | Max conversation turns (claude-code) |
| `--permission-mode <mode>` | Permission mode (claude-code) |
| `--model <model>` | Model override (claude-code) |
| `--system-prompt <prompt>` | System prompt (claude-code) |
| `--schema-config <json>` | Raw schemaConfig as JSON (overrides individual schema flags) |

## Delete provider

```bash
omni providers delete <id> --json
omni providers delete <id> --force --json
```

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation prompt |

## Setup wizards

Interactive wizards that guide you through provider configuration.

### OpenClaw setup

```bash
omni providers setup openclaw
omni providers setup openclaw --gateway-url wss://gateway.openclaw.dev \
  --gateway-token <token> --agent-id <agentId> --name "my-openclaw" \
  --instance-id <uuid> --non-interactive
```

| Flag | Description |
|------|-------------|
| `--gateway-url <url>` | Gateway WebSocket URL |
| `--gateway-token <token>` | Gateway authentication token |
| `--agent-id <agentId>` | Default agent ID |
| `--name <name>` | Provider name (default: `openclaw-<agent-id>`) |
| `--instance-id <uuid>` | Omni instance UUID for the openclaw channel account |
| `--account-name <name>` | Account name in openclaw.json (default: agent-id) |
| `--plugin-path <path>` | Path to omni.ts plugin entry (auto-detected from CWD) |
| `--skip-openclaw-config` | Skip openclaw.json updates entirely |
| `--non-interactive` | Error on missing required flags instead of prompting |

### Genie setup

```bash
omni providers setup genie
omni providers setup genie --agent-name "omni-agent" --target-agent "team-lead" \
  --team-name "omni-{chat_id}" --instance-id <uuid> --non-interactive
```

| Flag | Description |
|------|-------------|
| `--agent-name <name>` | Agent identity / "from" field |
| `--target-agent <name>` | Target agent inbox to deliver messages to |
| `--team-name <template>` | Team name template (supports `{chat_id}`, `{thread_id}`, etc.) |
| `--agent-role <role>` | Registered genie dir agent name (default: `team-lead`) |
| `--name <name>` | Provider name (default: `genie-<agent-name>`) |
| `--base-url <url>` | Base URL (default: `file:///home/genie/.claude/teams`) |
| `--instance-id <uuid>` | Omni instance UUID to auto-assign provider |
| `--non-interactive` | Error on missing required flags instead of prompting |

## Test provider health

```bash
omni providers test <id> --json
```

Sends a health-check request to the provider and reports whether it is reachable and responding correctly.

## Agno resource listing

For Agno-schema providers, list remote resources:

```bash
# List agents registered in the Agno platform
omni providers agents <id> --json

# List teams
omni providers teams <id> --json

# List workflows
omni providers workflows <id> --json
```

## Notes

- Providers define *how* to reach an AI service. Agents (see `omni agents`) define *who* is responding.
- Each provider has a schema that determines its configuration shape (connection params, auth, etc.).
- The `genie` schema enables Claude Code team inbox integration — messages are delivered to a named agent via the genie orchestrator.
- The `claude-code` schema runs a local Claude Code subprocess with a configured project path and permission mode.
- The `a2a` schema implements the Agent-to-Agent protocol for inter-agent communication.
- The `ag-ui` schema implements the AG-UI protocol for agent-UI communication.
- Use `omni providers setup` for guided, interactive provider creation.
- Use `omni providers test <id>` to verify connectivity before assigning to routes or instances.
