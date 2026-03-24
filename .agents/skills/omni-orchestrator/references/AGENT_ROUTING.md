# Agent Routing Reference

Omni routes incoming messages to AI agents using a layered routing system. Routes can be scoped per-chat, per-user, or fall back to instance defaults. Access control rules determine who can interact with the bot.

## Route Resolution Order

When a message arrives, Omni resolves the agent in this order:

```
1. Chat route   — matches the specific chat (group or DM)
2. User route   — matches the specific person (sender)
3. Instance default — the agent assigned to the instance
```

The first match wins. Higher-priority routes within the same scope are checked first.

### Multi-Agent Pattern

A single WhatsApp number (instance) can route different users to different agents:

```
Instance (1 WhatsApp number)
  ├── Route: Felipe (user) → dev agent (debounce: off, ack: off)
  ├── Route: Antonio (user) → test agent B
  └── Default → production agent (instance defaults)
```

## Providers

Providers connect Omni to AI backends. Create a provider before assigning agents.

### Create a Provider

```bash
# Agno provider (hosted agents)
omni providers create --name "my-agno" --schema agno --base-url https://api.agno.com --api-key sk_xxx

# Claude Code provider (local)
omni providers create --name "claude-local" --schema claude-code \
  --project-path /home/user/my-project --permission-mode bypassPermissions

# Genie provider (agent orchestration)
omni providers create --name "my-genie" --schema genie \
  --agent-name "omni-relay" \
  --target-agent "sofia" \
  --team-name "omni-{chat_id}"
```

### Test a Provider

```bash
omni providers test <provider-id>
```

### List and Inspect Providers

```bash
omni providers list
omni providers get <provider-id>
```

### Genie Provider schemaConfig

The genie provider schema supports these fields:

| Field | Flag | Description |
|-------|------|-------------|
| `agentName` | `--agent-name` | Identity / "from" field for the agent sending messages |
| `targetAgent` | `--target-agent` | Target agent inbox to deliver messages to |
| `teamName` | `--team-name` | Team name template for session isolation |

The `teamName` field supports placeholders:

| Placeholder | Resolves to |
|-------------|-------------|
| `{chat_id}` | The chat UUID |
| `{thread_id}` | The thread/topic UUID |
| `{sender_id}` | The sender's person UUID |

```bash
# Example: each chat gets its own team
omni providers create --name "genie-prod" --schema genie \
  --agent-name "omni-relay" \
  --target-agent "sofia" \
  --team-name "omni-{chat_id}"

# Update an existing provider's genie config
omni providers update <id> --agent-name "new-relay" --target-agent "new-agent"

# Or set raw schemaConfig as JSON
omni providers update <id> --schema-config '{"agentName":"relay","targetAgent":"sofia","teamName":"omni-{chat_id}"}'
```

## Assigning an Agent to an Instance

Set the default agent for an instance:

```bash
# By agent FK (references agents table)
omni instances update <id> --agent-fk-id <agent-uuid>

# By provider
omni instances update <id> --agent-provider <provider-id>

# Set agent type
omni instances update <id> --agent-type agent    # or: team, workflow
```

### Agent Behavior Options

```bash
# Timeout (seconds before agent response times out)
omni instances update <id> --agent-timeout 120

# Streaming responses
omni instances update <id> --agent-stream-mode
omni instances update <id> --no-agent-stream-mode

# Session strategy
omni instances update <id> --agent-session-strategy per_user          # one session per sender
omni instances update <id> --agent-session-strategy per_chat          # one session per chat
omni instances update <id> --agent-session-strategy per_user_per_chat # one session per user+chat

# Prefix sender name in messages (useful for group chats)
omni instances update <id> --agent-prefix-sender-name
omni instances update <id> --no-agent-prefix-sender-name

# Wait for media processing before dispatching to agent
omni instances update <id> --agent-wait-for-media
omni instances update <id> --no-agent-wait-for-media

# Include file path in formatted media text
omni instances update <id> --agent-send-media-path
omni instances update <id> --agent-send-media-path-types image,video,document
```

## Routes

Routes override the instance default agent for specific chats or users.

### Create a Route

```bash
# Route a specific user to a different agent
omni routes create --instance <instance-id> \
  --scope user --person <person-uuid> \
  --agent <agent-uuid> \
  --label "Felipe → dev agent"

# Route a specific chat (group) to a different agent
omni routes create --instance <instance-id> \
  --scope chat --chat <chat-uuid> \
  --agent <agent-uuid> \
  --label "Support group → support agent"

# Route with custom settings (override instance defaults)
omni routes create --instance <instance-id> \
  --scope user --person <person-uuid> \
  --agent <agent-uuid> \
  --timeout 300 \
  --stream \
  --no-prefix-sender \
  --no-gate \
  --priority 10 \
  --label "Dev user — long timeout, no gate"
```

### Route Options

Routes can override these instance-level settings:

| Flag | Description |
|------|-------------|
| `--agent <uuid>` | Agent to route to |
| `--timeout <seconds>` | Agent timeout override |
| `--stream` / `--no-stream` | Streaming override |
| `--prefix-sender` / `--no-prefix-sender` | Sender name prefix |
| `--wait-media` / `--no-wait-media` | Wait for media processing |
| `--send-media-path` / `--no-send-media-path` | Include file path in media text |
| `--gate` / `--no-gate` | LLM response gate |
| `--gate-model <model>` | Gate model override |
| `--gate-prompt <prompt>` | Gate prompt override |
| `--reply-filter-mode <mode>` | Reply filter: `all` or `filtered` |
| `--priority <n>` | Higher number = higher priority |
| `--label <text>` | Human-readable label |
| `--inactive` | Create as inactive |

### List Routes

```bash
# All routes for an instance
omni routes list --instance <instance-id>

# Filter by scope
omni routes list --instance <instance-id> --scope user
omni routes list --instance <instance-id> --scope chat

# Active routes only
omni routes list --instance <instance-id> --active
```

### Update a Route

```bash
# Change the target agent
omni routes update <route-id> --agent <new-agent-uuid>

# Deactivate a route (keeps config, stops matching)
omni routes update <route-id> --inactive

# Reactivate
omni routes update <route-id> --active

# Change priority
omni routes update <route-id> --priority 20
```

### Delete a Route

```bash
omni routes delete <route-id>
```

### Test Route Resolution

Debug which agent would handle a message for a given instance, chat, and person:

```bash
# Test what agent resolves for a specific person in a specific chat
omni routes test --instance <instance-id> --chat <chat-uuid> --person <person-uuid>

# Test just person-level routing
omni routes test --instance <instance-id> --person <person-uuid>

# Test just chat-level routing
omni routes test --instance <instance-id> --chat <chat-uuid>
```

### Route Cache Metrics

```bash
omni routes metrics
```

## Access Control

Access control determines who can interact with the bot. Rules use phone patterns or platform user IDs.

### Access Modes

Set the access control mode for an instance:

```bash
# Allowlist mode — only explicitly allowed contacts can interact
omni access mode <instance-id> allowlist

# Blocklist mode — everyone allowed except explicitly blocked contacts
omni access mode <instance-id> blocklist

# Disabled — no access control, everyone can interact
omni access mode <instance-id> disabled

# Check current mode
omni access mode <instance-id>
```

### Create Access Rules

```bash
# Allow all Brazilian numbers
omni access create --type allow --instance <instance-id> --phone "+55*"

# Block a specific number
omni access create --type deny --instance <instance-id> --phone "+5511999999999"

# Block with a custom message sent to the blocked user
omni access create --type deny --instance <instance-id> \
  --phone "+1*" \
  --action block \
  --message "This service is not available in your region" \
  --reason "Geo-restriction"

# Silent block (no message sent)
omni access create --type deny --instance <instance-id> \
  --phone "+1*" \
  --action silent_block

# Rule for Discord user ID
omni access create --type allow --instance <instance-id> --user "123456789"

# Global rule (applies to all instances)
omni access create --type deny --phone "+0*" --reason "Invalid numbers"

# Set priority (higher = checked first)
omni access create --type allow --instance <instance-id> --phone "+5511999999999" --priority 100
```

### List Access Rules

```bash
# All rules
omni access list

# Rules for a specific instance
omni access list --instance <instance-id>

# Filter by type
omni access list --instance <instance-id> --type allow
omni access list --instance <instance-id> --type deny
```

### Check Access

```bash
# Check if a user has access
omni access check --instance <instance-id> --user "123456789" --channel discord
```

### Pairing Requests

When access mode is `allowlist`, unknown users trigger a pairing request:

```bash
# List pending pairing requests
omni access pending <instance-id>

# Approve a request (adds user to allowlist)
omni access approve <instance-id> <request-id>

# Deny a request
omni access deny <instance-id> <request-id>
```

### Delete an Access Rule

```bash
omni access delete <rule-id>
```

## Reply Filters

Control which messages the bot responds to:

```bash
# Respond to all messages
omni instances update <id> --reply-filter-mode all

# Filtered mode — only respond based on specific triggers
omni instances update <id> --reply-filter-mode filtered

# Configure filtered mode triggers
omni instances update <id> --reply-filter-mode filtered \
  --reply-on-dm \
  --reply-on-mention \
  --reply-on-reply \
  --no-reply-on-name

# Clear reply filter entirely
omni instances update <id> --clear-reply-filter
```

### Filter Trigger Options

| Flag | Description |
|------|-------------|
| `--reply-on-dm` / `--no-reply-on-dm` | Reply to direct messages |
| `--reply-on-mention` / `--no-reply-on-mention` | Reply when @mentioned |
| `--reply-on-reply` / `--no-reply-on-reply` | Reply when message is a reply to bot |
| `--reply-on-name` / `--no-reply-on-name` | Reply when bot name appears in text |
| `--reply-name-patterns <p1,p2>` | Custom name patterns (comma-separated) |

## Debounce

Debounce controls how long Omni waits before sending a message to the agent, batching rapid-fire messages together.

```bash
# Fixed delay — always wait this long
omni instances update <id> --debounce-mode fixed --debounce-min 5000

# Randomized delay — wait between min and max ms
omni instances update <id> --debounce-mode randomized --debounce-min 3000 --debounce-max 8000

# Disable debounce
omni instances update <id> --debounce-mode disabled

# Restart timer when user is still typing
omni instances update <id> --debounce-restart-on-typing

# Group chat debounce (separate from DM debounce)
omni instances update <id> --debounce-group 10000
```

## Response Gate

The response gate uses an LLM to evaluate whether the agent's response should be sent. Useful for safety filtering.

```bash
# Enable gate with defaults
omni instances update <id> --agent-gate

# Custom gate model and prompt
omni instances update <id> --agent-gate \
  --agent-gate-model "claude-sonnet-4-20250514" \
  --agent-gate-prompt "Only allow responses that are professional and on-topic"

# Disable gate
omni instances update <id> --no-agent-gate
```

Routes can also override gate settings:

```bash
omni routes create --instance <id> --scope user --person <person-uuid> \
  --agent <agent-uuid> --no-gate --label "Trusted user — skip gate"
```

## Reaction Acknowledgment

Send a reaction emoji when the bot receives a message (visual feedback):

```bash
# Enable reaction ack
omni instances update <id> --reaction-ack on

# Disable
omni instances update <id> --reaction-ack off

# Custom emoji per channel
omni instances update <id> --reaction-ack on --reaction-ack-emoji '{"whatsapp":"⏳","discord":"👀"}'

# Set ack timeout
omni instances update <id> --ack-timeout 30000
```

## Complete Multi-Agent Setup Example

Set up one WhatsApp number with different agents for different users:

```bash
# 1. Create providers
omni providers create --name "genie-prod" --schema genie \
  --agent-name "omni-relay" --target-agent "production-agent" \
  --team-name "prod-{chat_id}"

omni providers create --name "genie-dev" --schema genie \
  --agent-name "omni-relay" --target-agent "dev-agent" \
  --team-name "dev-{chat_id}"

# 2. Assign default agent to the instance (production)
omni instances update <instance-id> --agent-provider <prod-provider-id>

# 3. Set instance defaults
omni instances update <instance-id> \
  --debounce-mode fixed --debounce-min 5000 \
  --reaction-ack on \
  --access-mode allowlist \
  --agent-session-strategy per_user

# 4. Create user routes for developers (skip debounce and ack via route overrides)
omni routes create --instance <instance-id> \
  --scope user --person <felipe-person-uuid> \
  --agent <dev-agent-uuid> \
  --no-gate \
  --label "Felipe → dev agent"

omni routes create --instance <instance-id> \
  --scope user --person <antonio-person-uuid> \
  --agent <test-agent-uuid> \
  --label "Antonio → test agent"

# 5. Allow specific contacts
omni access create --type allow --instance <instance-id> --phone "+55*"

# 6. Verify route resolution
omni routes test --instance <instance-id> --person <felipe-person-uuid>
omni routes test --instance <instance-id> --person <antonio-person-uuid>
omni routes test --instance <instance-id> --person <random-person-uuid>
```
