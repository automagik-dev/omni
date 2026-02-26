---
name: omni-routes
description: |
  Manage agent routing rules: create per-chat or per-user routes to specific providers/agents, test route resolution, and view routing metrics.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Routes

## List routes

```bash
omni routes list --instance <id> --json
omni routes list --instance <id> --active --json
omni routes list --instance <id> --scope chat --json
omni routes list --instance <id> --scope user --json
```

## Get route

```bash
omni routes get <routeId> --instance <id> --json
```

## Create route

```bash
# Route a specific chat to an agent
omni routes create --instance <id> --scope chat --chat <chatId> --provider <providerId> --agent <agentId> --label "Support bot" --priority 10 --json

# Route all conversations from a person to an agent
omni routes create --instance <id> --scope user --person <personId> --provider <providerId> --agent <agentId> --json

# Create with gate and streaming options
omni routes create --instance <id> --scope chat --chat <chatId> --provider <providerId> --agent <agentId> --gate --gate-model <model> --gate-prompt "Only reply if relevant" --stream --timeout 60 --json

# Create as inactive (not yet active)
omni routes create --instance <id> --scope chat --chat <chatId> --provider <providerId> --agent <agentId> --inactive --json
```

## Update route

```bash
omni routes update <routeId> --instance <id> --label "New label" --priority 20 --json
omni routes update <routeId> --instance <id> --active --json
omni routes update <routeId> --instance <id> --inactive --json
omni routes update <routeId> --instance <id> --agent <newAgentId> --timeout 120 --json
omni routes update <routeId> --instance <id> --no-gate --no-stream --json
```

## Delete route

```bash
omni routes delete <routeId> --instance <id> --json
```

## Test resolution

```bash
# Test which route would be applied for a given chat
omni routes test --instance <id> --chat <chatId> --json

# Test for a specific person
omni routes test --instance <id> --person <personId> --json

# Test for both chat and person
omni routes test --instance <id> --chat <chatId> --person <personId> --json
```

## Metrics

```bash
omni routes metrics --json
```

## Notes

- Routes override instance-level agent config for matched chats or persons.
- Scope "chat" targets a specific conversation; "user" targets all conversations from a person.
- Higher `--priority` value wins when multiple routes could match.
- `--gate` enables an LLM-based filter that decides whether the agent should reply.
- `--reply-filter-mode` accepts `all` or `filtered`.
- `--agent-type` accepts `agent`, `team`, or `workflow` (default: `agent`).
