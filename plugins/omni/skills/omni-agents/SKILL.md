---
name: omni-agents
description: |
  Manage AI agent entities: list with filtering, get details, create with provider/model/type, and soft-delete agents.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Agents

## List agents

```bash
omni agents list --json
omni agents list --provider claude --json
omni agents list --provider agno --json
omni agents list --provider openai --json
omni agents list --provider gemini --json
omni agents list --provider custom --json
omni agents list --provider omni-internal --json
omni agents list --inactive-only --json
omni agents list --limit 10 --json
omni agents list --provider claude --limit 5 --json
```

### List options

| Flag | Description |
|------|-------------|
| `--provider <provider>` | Filter by provider: `claude`, `agno`, `openai`, `gemini`, `custom`, `omni-internal` |
| `--inactive-only` | Show only inactive (soft-deleted) agents |
| `--limit <n>` | Max results (default: 50) |

## Get agent details

```bash
omni agents get <id> --json
```

Returns full agent record including name, provider, model, type, active status, and linked provider configuration.

## Create agent

```bash
# Basic assistant agent
omni agents create --name "Support Bot" --provider claude --model claude-sonnet-4-6 --json

# Specify agent type
omni agents create --name "Router" --provider claude --model claude-sonnet-4-6 --type assistant --json
omni agents create --name "Pipeline" --provider agno --model gpt-4o --type workflow --json
omni agents create --name "Squad" --provider agno --model gpt-4o --type team --json
omni agents create --name "Toolbox" --provider custom --model custom-v1 --type tool --json

# Link to an agent provider configuration
omni agents create --name "My Agent" --provider claude --model claude-sonnet-4-6 --agent-provider <providerId> --json
```

### Create options

| Flag | Description |
|------|-------------|
| `--name <name>` | Agent name |
| `--provider <provider>` | AI provider: `claude`, `agno`, `openai`, `gemini`, `custom`, `omni-internal` |
| `--model <model>` | Model identifier (e.g. `claude-sonnet-4-6`, `gpt-4o`) |
| `--type <type>` | Agent type: `assistant` (default), `workflow`, `team`, `tool` |
| `--agent-provider <agentProviderId>` | Link to an agent provider configuration |

## Delete agent

```bash
omni agents delete <id> --json
```

Soft-deletes the agent (sets inactive). The agent record is preserved but will no longer appear in default listings. Use `--inactive-only` on list to see deleted agents.

## Notes

- Agents are the identity layer — they represent an AI entity that can be assigned to routes and instances.
- Providers (see `omni providers`) define *how* to reach the underlying AI service; agents define *who* is responding.
- Deleting an agent is a soft-delete: the record stays but is marked inactive.
- Use `omni routes create --agent <agentId>` to assign an agent to a specific chat or user.
- Use `omni instances update <id> --agent <agentId>` to set a default agent on an instance.
