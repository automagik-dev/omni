# Providers — Agent Backends

Providers define how Omni reaches an agent backend. Schemas: `nats-genie`, `claude-code`, `a2a`, `ag-ui`, `agno`, `webhook`.

## One-step agent setup

`omni setup agent --help` wires provider + agent + instance binding and checks health. Inspect existing records first. A healthy provider does not prove a message was delivered. Use `omni agents manifest --help` for an agent's declared `accepts`/`publishes`; it is separate from provider connectivity. `omni a2a --help` covers A2A discovery/invocation.

## Commands

```bash
omni providers list --active --json
omni providers get <id> --json
omni providers test <id> --json                 # health check before assigning
omni providers update <id> --name "new-name" --timeout 120 --json
omni providers update <id> --active --json      # or --no-active
omni providers delete <id> --json
```

## Create by schema

```bash
omni providers create --name genie-prod --schema nats-genie \
  --agent-name omni-agent --target-agent team-lead --team-name "omni-{chat_id}" --json
omni providers create --name claude-local --schema claude-code \
  --project-path /home/user/project --max-turns 10 --permission-mode bypassPermissions --json
omni providers create --name a2a-svc --schema a2a --base-url https://a2a.example.com --api-key <key> --json
omni providers create --name agui-svc --schema ag-ui --base-url https://agui.example.com --api-key <key> --stream --json
omni providers create --name agno-prod --schema agno --base-url https://app.agno.com/v1/playground/agents --api-key <key> --json
omni providers create --name my-webhook --schema webhook --base-url https://api.example.com/chat --api-key <key> --json
```

Schema-specific flags: `--team-name` supports `{chat_id}`, `{thread_id}`, `{sender_id}` (nats-genie); `--model` and `--system-prompt` (claude-code).

## Agno-backed discovery

```bash
omni providers agents <id>       # agents exposed by an Agno provider
omni providers teams <id>
omni providers workflows <id>
```

## Pattern

```bash
omni providers test <id> --json | jq '{healthy: .success, latency: .latencyMs}'
```
