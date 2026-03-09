---
name: omni-agent-setup
description: |
  End-to-end guide for connecting an AI agent to any Omni channel.
  Covers provider creation, instance assignment, reply filters, routing, and testing.
allowed-tools: Bash(omni *), Bash(jq *)
---

# /omni-agent-setup — Connect an Agent to a Channel

Step-by-step guide to route messages from any Omni channel (WhatsApp, Telegram, Discord, Slack) to an AI agent backend.

## When to Use

- Setting up a new bot/agent on a channel for the first time
- Switching which agent handles a channel
- Configuring how/when an agent replies (reply filters)
- Setting up per-chat or per-user routing to different agents

## Architecture

```
Channel (WhatsApp/Telegram/...)
  → Instance (connected account)
    → Reply Filter (when to activate agent)
      → Route Resolver (which agent handles this chat/user)
        → Provider (how to talk to the agent backend)
          → Agent processes message
            → Agent replies via omni send
```

## Flow

### 1. Choose a Provider Schema

| Schema | Backend | Use Case |
|--------|---------|----------|
| `genie` | Claude Code team inbox | Fire-and-forget to genie agents. Agent replies via `omni send`. |
| `claude-code` | Claude Code SDK | Native SDK integration. Runs agents in isolated sessions. |
| `agno` | AgnoOS platform | Self-hosted or cloud Agno agents. |
| `openclaw` | WebSocket gateway | Real-time WebSocket agent communication. |
| `webhook` | Any HTTP endpoint | Generic REST/webhook backends. |
| `a2a` | Agent-to-Agent | One Omni agent calling another Omni agent. |

### 2. Create the Provider

#### Genie Provider (Claude Code teams)

```bash
omni providers create \
  --name "Genie Team" \
  --schema genie \
  --schema-config '{
    "agentName": "omni",
    "targetAgent": "team-lead",
    "teamName": "genie"
  }' \
  --json
```

- `agentName`: identity of this provider when writing to inbox (appears as sender)
- `targetAgent`: which agent inbox to deliver to (e.g. `team-lead`, `ideias`)
- `teamName`: Claude Code team name (default: `genie`)

#### Claude Code Provider (SDK)

```bash
omni providers create \
  --name "My Project Agent" \
  --schema claude-code \
  --project-path /home/user/myproject \
  --max-turns 10 \
  --permission-mode acceptEdits \
  --model claude-sonnet-4-20250514 \
  --json
```

#### Agno Provider

```bash
omni providers create \
  --name "Support Agent" \
  --schema agno \
  --base-url https://api.agno.com \
  --api-key sk_xxx \
  --schema-config '{"agentId": "support-bot"}' \
  --json
```

#### Webhook Provider (generic HTTP)

```bash
omni providers create \
  --name "Custom Backend" \
  --schema webhook \
  --schema-config '{
    "url": "https://api.example.com/webhook",
    "method": "POST",
    "headers": {"Authorization": "Bearer xxx"},
    "waitForResponse": true,
    "timeoutMs": 30000
  }' \
  --json
```

#### OpenClaw Provider

```bash
omni providers create \
  --name "Sofia Gateway" \
  --schema openclaw \
  --base-url ws://127.0.0.1:18789 \
  --default-agent-id sofia \
  --json
```

Save the returned provider ID for the next step.

### 3. Select or Create an Instance

```bash
# List existing instances
omni instances list --json | jq '.[] | {id, name, channelType, status}'

# Or create a new one
omni instances create --channel telegram --name "My Telegram Bot" --json
omni instances create --channel whatsapp --name "My WhatsApp" --json
```

For WhatsApp, scan the QR code:
```bash
omni instances qr <instance-id> --watch
```

### 4. Assign Provider to Instance

```bash
omni instances update <instance-id> \
  --agent-provider <provider-id> \
  --json
```

Optional settings:
```bash
omni instances update <instance-id> \
  --agent-provider <provider-id> \
  --session-strategy per_chat \
  --stream true \
  --prefix-sender-name true \
  --json
```

- `--session-strategy`: `per_chat` (one session per conversation) or `per_user` (one per person)
- `--stream`: enable streaming responses
- `--prefix-sender-name`: prepend sender name to messages (useful in groups)

### 5. Configure Reply Filter

Controls **when** the agent responds.

```bash
# Reply to everything (DMs + groups)
omni instances update <instance-id> \
  --reply-filter-mode all \
  --json

# Reply only to DMs, mentions, and replies
omni instances update <instance-id> \
  --reply-filter-mode filtered \
  --on-dm true \
  --on-mention true \
  --on-reply true \
  --json

# Reply only when name patterns match (groups)
omni instances update <instance-id> \
  --reply-filter-mode filtered \
  --on-mention true \
  --name-patterns "@bot,hey bot" \
  --json
```

### 6. Advanced: Per-Chat or Per-User Routes

Override the instance default for specific chats or users:

```bash
# Route a specific chat to a different agent
omni routes create \
  --instance <instance-id> \
  --scope chat \
  --chat <chat-id> \
  --provider <other-provider-id> \
  --agent <agent-id> \
  --label "VIP Support" \
  --priority 10 \
  --json

# Route all conversations from a person
omni routes create \
  --instance <instance-id> \
  --scope user \
  --person <person-id> \
  --provider <provider-id> \
  --agent <agent-id> \
  --json

# Test which route resolves for a chat
omni routes test --instance <instance-id> --chat <chat-id> --json
```

Route priority: chat route > user route > instance default.

### 7. Test the Setup

```bash
# Test provider health
omni providers test <provider-id> --json

# Send a test message to yourself
omni send --to <your-number-or-chat> \
  --text "Testing agent setup" \
  --instance <instance-id>

# Check events to see if message was routed
omni events list --instance <instance-id> --type message.received --limit 5 --json

# Check agent task events
omni events list --type agent.task.completed --limit 5 --json
```

## Genie Provider: Complete Example

End-to-end setup for a genie agent on Telegram:

```bash
# 1. Create provider
PROVIDER=$(omni providers create \
  --name "Genie Team Lead" \
  --schema genie \
  --schema-config '{"agentName":"omni-telegram","targetAgent":"team-lead","teamName":"genie"}' \
  --json | jq -r '.id')

# 2. Assign to existing Telegram instance
omni instances update <telegram-instance-id> \
  --agent-provider $PROVIDER \
  --json

# 3. Reply to DMs only
omni instances update <telegram-instance-id> \
  --reply-filter-mode filtered \
  --on-dm true \
  --json

# 4. Test
omni providers test $PROVIDER --json
```

Messages flow: Telegram → Omni → `~/.claude/teams/genie/inboxes/team-lead.json` → Agent reads from inbox → Agent replies via `omni send`.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Agent not responding | `omni providers test <id>` — is provider healthy? |
| Agent responds to everything | Check reply filter: `omni instances get <id> --json \| jq '.agentReplyFilter'` |
| Wrong agent answers | Check routes: `omni routes test --instance <id> --chat <chat-id>` |
| Messages not arriving | Check events: `omni events list --instance <id> --type message.received --limit 5` |
| Provider create fails | Verify schema-config JSON matches the schema requirements |

## Notes

- The genie provider is **fire-and-forget**: it writes to the inbox and returns immediately. The agent replies asynchronously via `omni send`.
- Provider schemas are validated at creation time. Invalid `schema-config` will be rejected.
- Reply filters are instance-level. For per-chat control, use routes with `--gate` for LLM-based filtering.
- Always use `--json` + `jq` for automation-safe parsing in agent workflows.
