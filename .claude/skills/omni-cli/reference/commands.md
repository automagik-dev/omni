# Omni CLI - Complete Command Reference

Exhaustive reference of all commands, subcommands, and options.

---

## Command Index

- [send](#omni-send) - Send messages
- [chats](#omni-chats) - Chat management
- [messages](#omni-messages) - Message operations
- [instances](#omni-instances) - Instance management
- [persons](#omni-persons) - Contact directory
- [media](#omni-media) - Media browsing
- [events](#omni-events) - Event system
- [journey](#omni-journey) - Message tracing
- [config](#omni-config) - CLI configuration
- [auth](#omni-auth) - Authentication
- [status](#omni-status) - System health
- [providers](#omni-providers) - AI providers
- [keys](#omni-keys) - API keys
- [automations](#omni-automations) - Workflows
- [webhooks](#omni-webhooks) - Webhooks
- [routes](#omni-routes) - Agent routing
- [access](#omni-access) - Access control
- [settings](#omni-settings) - Server settings
- [batch](#omni-batch) - Batch processing
- [prompts](#omni-prompts) - Prompt overrides
- [resync](#omni-resync) - History sync
- [logs](#omni-logs) - System logs
- [dead-letters](#omni-dead-letters) - Failed messages
- [payloads](#omni-payloads) - Raw payloads
- [completions](#omni-completions) - Shell completions

---

## omni send

Send any type of message through Omni.

### Options

#### Common
- `--instance <id>` - Instance ID (uses default if not specified)
- `--to <recipient>` - Recipient phone, chat ID, or channel ID

#### Text Messages
- `--text <text>` - Message content
- `--reply-to <id>` - Reply to specific message ID

#### Media Messages
- `--media <path>` - Path to image, video, audio, or document file
- `--caption <text>` - Caption for media message
- `--voice` - Send audio as voice note (applies voice formatting)

#### Reactions
- `--reaction <emoji>` - Emoji to react with
- `--message <id>` - Message ID to react to (required with --reaction)

#### Stickers
- `--sticker <url>` - Sticker URL or base64 data

#### Contact Cards
- `--contact` - Send contact card (enables contact mode)
- `--name <name>` - Contact name (required)
- `--phone <phone>` - Contact phone number
- `--email <email>` - Contact email address

#### Location
- `--location` - Send location (enables location mode)
- `--lat <latitude>` - Latitude coordinate (required)
- `--lng <longitude>` - Longitude coordinate (required)
- `--address <text>` - Location address or description

#### Polls (Discord)
- `--poll <question>` - Poll question
- `--options <a,b,c>` - Comma-separated poll options
- `--multi-select` - Allow multiple selections
- `--duration <hours>` - Poll duration in hours

#### Embeds (Discord)
- `--embed` - Send embed message
- `--title <title>` - Embed title
- `--description <desc>` - Embed description
- `--color <hex>` - Embed color (hex format: #RRGGBB)
- `--url <url>` - Embed URL

#### Presence Indicators
- `--presence <type>` - Presence indicator: `typing`, `recording`, or `paused`

### Examples

```bash
# Text message
omni send --to +<phone-number> --text "Hello!" --instance inst_123

# Image with caption
omni send --to +<phone-number> --media ./photo.jpg --caption "Check this" --instance inst_123

# Voice note
omni send --to +<phone-number> --media ./audio.mp3 --voice --instance inst_123

# Reaction
omni send --to +<phone-number> --reaction "👍" --message msg_abc --instance inst_123

# Contact card
omni send --to +<phone-number> --contact --name "John Doe" --phone +<contact-phone> --instance inst_123

# Location
omni send --to +<phone-number> --location --lat -23.5505 --lng -46.6333 --address "São Paulo" --instance inst_123

# Discord poll
omni send --to channel_123 --poll "Lunch?" --options "Pizza,Sushi,Tacos" --instance discord_inst

# Discord embed
omni send --to channel_123 --embed --title "Alert" --description "System updated" --color "#00ff00" --instance discord_inst
```

---

## omni chats

Manage conversations and chat metadata.

### Subcommands

#### `list`
List all chats for an instance.

**Options:**
- `--instance <id>` - Instance ID
- `--unread` - Only show chats with unread messages
- `--sort <field>` - Sort by: `activity` (default), `name`, `created`
- `--verbose` - Include full chat details

**Example:**
```bash
omni chats list --instance inst_123 --unread --sort activity
```

#### `get <id>`
Get detailed chat information.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats get chat_abc --instance inst_123
```

#### `create`
Create new chat record.

**Options:**
- `--instance <id>` - Instance ID (required)
- `--external-id <id>` - External identifier (e.g., "whatsapp:+<phone>")
- `--channel <type>` - Channel type: `whatsapp`, `discord`, `slack`, `telegram`

**Example:**
```bash
omni chats create --instance inst_123 --external-id "whatsapp:+<phone-number>" --channel whatsapp
```

#### `update <id>`
Update chat metadata.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID
- `--name <name>` - Chat display name
- `--tags <tag1,tag2>` - Comma-separated tags

**Example:**
```bash
omni chats update chat_abc --instance inst_123 --tags "support,urgent"
```

#### `delete <id>`
Delete a chat.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats delete chat_abc --instance inst_123
```

#### `archive <id>`
Archive a chat.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats archive chat_abc --instance inst_123
```

#### `unarchive <id>`
Restore archived chat.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats unarchive chat_abc --instance inst_123
```

#### `messages <id>`
List messages in a chat.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--limit <n>` - Maximum messages to return (default: 50)
- `--search <query>` - Search text within messages
- `--since <duration>` - Messages since duration (e.g., "7d", "24h")
- `--audio-only` - Only audio messages
- `--images-only` - Only image messages
- `--videos-only` - Only video messages
- `--compact` - Compact table display
- `--truncate <n>` - Truncate long messages to N characters

**Example:**
```bash
omni chats messages chat_abc --since 7d --search "invoice" --limit 100
```

#### `participants <id>`
Manage chat participants.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats participants chat_abc --instance inst_123
```

#### `read <id>`
Mark entire chat as read.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats read chat_abc --instance inst_123
```

#### `disappearing <id>`
Configure disappearing messages.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID (required)
- `--duration <time>` - Duration before messages disappear (e.g., "24h", "7d", "off" to disable; "0" also accepted)

**Example:**
```bash
# Enable 24h disappearing messages
omni chats disappearing chat_abc --instance inst_123 --duration 24h

# Disable
omni chats disappearing chat_abc --instance inst_123 --duration off  # 0 is also accepted
```

#### `pin <id>`
Pin chat on channel.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats pin chat_abc --instance inst_123
```

#### `unpin <id>`
Unpin chat.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats unpin chat_abc --instance inst_123
```

#### `mute <id>`
Mute chat notifications.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats mute chat_abc --instance inst_123
```

#### `unmute <id>`
Unmute chat notifications.

**Arguments:**
- `<id>` - Chat ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni chats unmute chat_abc --instance inst_123
```

---

## omni messages

Global message search and operations.

### Subcommands

#### `search <query>`
Search messages across all chats.

**Arguments:**
- `<query>` - Search query

**Options:**
- `--since <duration>` - Search within time window (e.g., "7d")
- `--chat <id>` - Limit to specific chat
- `--type <type>` - Message type: `text`, `image`, `audio`, `video`, `document`
- `--limit <n>` - Maximum results (default: 50)

**Example:**
```bash
omni messages search "invoice" --since 30d --type text --limit 100
```

#### `read <id>`
Mark message as read.

**Arguments:**
- `<id>` - Message ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni messages read msg_abc --instance inst_123
```

#### `read --batch`
Bulk mark messages as read.

**Options:**
- `--instance <id>` - Instance ID (required)
- `--chat <id>` - Chat ID (optional, for filtering)
- `--ids <id1,id2,id3>` - Comma-separated message IDs

**Example:**
```bash
omni messages read --batch --instance inst_123 --ids msg1,msg2,msg3
```

---

## omni instances

Manage channel instances (WhatsApp, Discord, Slack, Telegram).

This is the most comprehensive command with 30+ subcommands.

### Subcommands

#### `list`
List all instances.

**Example:**
```bash
omni instances list
omni instances list --json | jq '.[] | {name, status, channelType}'
```

#### `get <id>`
Get instance details.

**Arguments:**
- `<id>` - Instance ID, prefix, or name

**Example:**
```bash
omni instances get personal
omni instances get c3a4f
```

#### `create`
Create new instance.

**Options:**
- `--channel <type>` - Channel type: `whatsapp`, `discord`, `slack`, `telegram`
- `--name <name>` - Instance display name

**Example:**
```bash
omni instances create --channel whatsapp --name "Support WhatsApp"
```

#### `delete <id>`
Delete instance.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances delete inst_123
```

#### `status <id>`
Get connection status.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances status inst_123
```

#### `whoami <id>`
Show phone number and profile.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances whoami inst_123
```

#### `qr <id>`
Display QR code for WhatsApp.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--watch` - Auto-refresh until connected
- `--base64` - Output base64-encoded QR

**Example:**
```bash
omni instances qr inst_123 --watch
```

#### `pair <id>`
Request pairing code (alternative to QR).

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances pair inst_123 --phone +5511999999999
# --phone is required for phone pairing
# Returns 8-digit code to enter in WhatsApp settings
```

#### `connect <id>`
Connect instance.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances connect inst_123
```

#### `disconnect <id>`
Disconnect instance.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances disconnect inst_123
```

#### `restart <id>`
Restart instance.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances restart inst_123
```

#### `logout <id>`
Logout and clear session.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances logout inst_123
```

#### `sync <id>`
Start sync operation.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--type <type>` - Sync type: `messages`, `contacts`, `groups`, `all`
- `--depth <duration>` - History depth (e.g., "7d", "30d")
- `--download-media` - Download media files during sync

**Example:**
```bash
omni instances sync inst_123 --type messages --depth 30d --download-media
```

#### `syncs <id> [job-id]`
List or check sync jobs.

**Arguments:**
- `<id>` - Instance ID
- `[job-id]` - Optional: specific sync job ID

**Example:**
```bash
# List all syncs
omni instances syncs inst_123

# Check specific job
omni instances syncs inst_123 job_abc
```

#### `update <id>`
Update instance metadata.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--name <name>` - Update display name

**Example:**
```bash
omni instances update inst_123 --name "New Name"
```

#### `contacts <id>`
List contacts.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--search <query>` - Search contacts by name
- `--limit <n>` - Maximum results (default: 50)
- `--cursor <token>` - Pagination cursor

**Example:**
```bash
omni instances contacts inst_123 --search "Felipe" --limit 100
```

#### `groups <id>`
List groups.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--search <query>` - Search groups by name

**Example:**
```bash
omni instances groups inst_123 --search "team"
```

#### `profile <id> <userId>`
Get user profile.

**Arguments:**
- `<id>` - Instance ID
- `<userId>` - User ID to look up

**Example:**
```bash
omni instances profile inst_123 user_abc
```

#### `check <id> <phone>`
Check if phone number exists on WhatsApp.

**Arguments:**
- `<id>` - Instance ID
- `<phone>` - Phone number (E.164 format recommended)

**Example:**
```bash
omni instances check inst_123 +<phone-number>
```

#### `update-bio <id>`
Update WhatsApp status/bio.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--bio <text>` - New status text

**Example:**
```bash
omni instances update-bio inst_123 --bio "Available 🟢"
```

#### `block <id> <contactId>`
Block contact.

**Arguments:**
- `<id>` - Instance ID
- `<contactId>` - Contact ID to block

**Example:**
```bash
omni instances block inst_123 contact_abc
```

#### `unblock <id> <contactId>`
Unblock contact.

**Arguments:**
- `<id>` - Instance ID
- `<contactId>` - Contact ID to unblock

**Example:**
```bash
omni instances unblock inst_123 contact_abc
```

#### `blocklist <id>`
List blocked contacts.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances blocklist inst_123
```

#### `update-picture <id>`
Update profile picture.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--picture <path>` - Path to image file

**Example:**
```bash
omni instances update-picture inst_123 --picture ./avatar.jpg
```

#### `remove-picture <id>`
Remove profile picture.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances remove-picture inst_123
```

#### `group-update-picture <id> <groupJid>`
Update group picture.

**Arguments:**
- `<id>` - Instance ID
- `<groupJid>` - Group JID

**Options:**
- `--picture <path>` - Path to image file

**Example:**
```bash
omni instances group-update-picture inst_123 120363123456@g.us --picture ./group.jpg
```

#### `group-create <id>`
Create new group.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--name <name>` - Group name
- `--participants <phones>` - Comma-separated phone numbers

**Example:**
```bash
omni instances group-create inst_123 --name "Team Chat" --participants "+<phone>,+<phone2>"
```

#### `group-invite <id> <groupJid>`
Get group invite link.

**Arguments:**
- `<id>` - Instance ID
- `<groupJid>` - Group JID

**Example:**
```bash
omni instances group-invite inst_123 120363123456@g.us
```

#### `group-revoke-invite <id> <groupJid>`
Revoke and regenerate invite link.

**Arguments:**
- `<id>` - Instance ID
- `<groupJid>` - Group JID

**Example:**
```bash
omni instances group-revoke-invite inst_123 120363123456@g.us
```

#### `group-join <id> <code>`
Join group via invite code.

**Arguments:**
- `<id>` - Instance ID
- `<code>` - Invite code

**Example:**
```bash
omni instances group-join inst_123 ABC123DEF456
```

#### `privacy <id>`
Get privacy settings.

**Arguments:**
- `<id>` - Instance ID

**Example:**
```bash
omni instances privacy inst_123
```

#### `reject-call <id>`
Reject incoming call.

**Arguments:**
- `<id>` - Instance ID

**Options:**
- `--call-id <id>` - Call ID to reject

**Example:**
```bash
omni instances reject-call inst_123 --call-id call_abc
```

---

## omni events

Event history, replay, and analytics.

### Subcommands

#### `list`
List recent events.

**Options:**
- `--limit <n>` - Maximum events (default: 100)
- `--since <duration>` - Time window (e.g., "24h")

**Example:**
```bash
omni events list --limit 50 --since 24h
```

#### `search <query>`
Search events by content.

**Arguments:**
- `<query>` - Search query

**Options:**
- `--since <duration>` - Time window
- `--type <type>` - Event type filter

**Example:**
```bash
omni events search "error" --since 7d
```

#### `timeline <personId>`
Get person activity timeline.

**Arguments:**
- `<personId>` - Person ID

**Example:**
```bash
omni events timeline person_abc
```

#### `replay`
Event replay system.

**Replay Options:**
- `--start` - Start new replay session
- `--since <duration>` - Replay from time (required with --start)
- `--until <duration>` - Replay until time
- `--speed <multiplier>` - Playback speed (default: 1.0)
- `--dry-run` - Preview without executing
- `--status <id>` - Get replay session status
- `--cancel <id>` - Cancel replay session

**Examples:**
```bash
# Start replay
omni events replay --start --since 7d --until 1d --speed 2.0

# Dry run
omni events replay --start --since 1h --dry-run

# Check status
omni events replay --status session_abc

# Cancel
omni events replay --cancel session_abc
```

#### `analytics`
Event statistics.

**Options:**
- `--since <duration>` - Time window
- `--instance <id>` - Specific instance
- `--all-time` - All-time stats

**Example:**
```bash
omni events analytics --since 30d --instance inst_123
```

---

## omni routes

Manage agent routing configuration. Routes override the instance default provider for specific chats or users.

**Resolution order:** chat route > user route > instance default provider.

### Subcommands

#### `list`
List agent routes for an instance.

**Options:**
- `--instance <id>` - Instance ID
- `--scope <scope>` - Filter by scope: `chat` or `user`
- `--active` - Show only active routes

**Examples:**
```bash
# List all routes for an instance
omni routes list --instance inst_123

# List only active user-scoped routes
omni routes list --instance inst_123 --scope user --active
```

#### `get <routeId>`
Get agent route details.

**Arguments:**
- `<routeId>` - Route ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni routes get route_abc --instance inst_123
```

#### `create`
Create a new agent route.

**Options:**
- `--instance <id>` - Instance ID
- `--scope <scope>` - Route scope: `chat` or `user`
- `--chat <chatId>` - Chat UUID (required when scope=chat)
- `--person <personId>` - Person UUID (required when scope=user)
- `--agent <agentId>` - Agent UUID (FK to agents table)
- `--timeout <seconds>` - Agent timeout in seconds
- `--stream` / `--no-stream` - Enable/disable streaming responses
- `--prefix-sender` / `--no-prefix-sender` - Prefix messages with sender name
- `--wait-media` / `--no-wait-media` - Wait for media processing
- `--send-media-path` / `--no-send-media-path` - Include file path in media text
- `--gate` / `--no-gate` - Enable/disable LLM response gate
- `--gate-model <model>` - Response gate model
- `--gate-prompt <prompt>` - Response gate prompt
- `--reply-filter-mode <mode>` - Reply filter: `all` or `filtered`
- `--label <label>` - Human-readable label for this route
- `--priority <number>` - Priority (higher = higher priority, default: 0)
- `--inactive` - Create route as inactive

**Examples:**
```bash
# Route a specific user to a dev agent with streaming
omni routes create --instance inst_123 --scope user --person person_abc \
  --agent agent_dev --stream --label "Felipe → dev agent"

# Route a chat to a support agent with response gating
omni routes create --instance inst_123 --scope chat --chat chat_abc \
  --agent agent_support --gate --gate-prompt "Only allow helpful responses" \
  --reply-filter-mode filtered --priority 10

# Create an inactive route (for testing before activation)
omni routes create --instance inst_123 --scope user --person person_xyz \
  --agent agent_test --inactive --label "Test route"
```

#### `update <routeId>`
Update an existing agent route.

**Arguments:**
- `<routeId>` - Route ID

**Options:**
- `--instance <id>` - Instance ID
- `--agent <agentId>` - Agent UUID
- `--timeout <seconds>` - Agent timeout in seconds
- `--stream` / `--no-stream` - Enable/disable streaming
- `--prefix-sender` / `--no-prefix-sender` - Prefix messages with sender name
- `--wait-media` / `--no-wait-media` - Wait for media processing
- `--send-media-path` / `--no-send-media-path` - Include file path in media text
- `--gate` / `--no-gate` - Enable/disable response gate
- `--gate-model <model>` - Response gate model
- `--gate-prompt <prompt>` - Response gate prompt
- `--reply-filter-mode <mode>` - Reply filter: `all` or `filtered`
- `--label <label>` - Route label
- `--priority <number>` - Priority
- `--active` / `--inactive` - Activate or deactivate route

**Examples:**
```bash
# Activate a route and change its agent
omni routes update route_abc --instance inst_123 --active --agent agent_prod

# Disable streaming and enable gating
omni routes update route_abc --no-stream --gate --gate-model "claude-sonnet-4-20250514"
```

#### `delete <routeId>`
Delete an agent route.

**Arguments:**
- `<routeId>` - Route ID

**Options:**
- `--instance <id>` - Instance ID

**Example:**
```bash
omni routes delete route_abc --instance inst_123
```

#### `test`
Test route resolution for a given instance, chat, and/or person. Shows which agent would handle a message.

**Options:**
- `--instance <id>` - Instance ID
- `--chat <chatId>` - Chat UUID to test
- `--person <personId>` - Person UUID to test

**Examples:**
```bash
# Test which agent handles a specific user in a specific chat
omni routes test --instance inst_123 --chat chat_abc --person person_xyz

# Test user-level routing only
omni routes test --instance inst_123 --person person_abc
```

#### `metrics`
View route cache metrics (hit rate, cache size, etc.).

**Example:**
```bash
omni routes metrics
```

---

## omni providers

Manage AI/agent providers. Providers define how Omni connects to agent backends (Agno, Claude Code, Genie, OpenClaw, webhooks, AG-UI, A2A).

### Subcommands

#### `setup`
Interactive setup wizards for providers. Currently supports OpenClaw and Genie.

##### `setup openclaw`
Set up an OpenClaw provider (keypair generation + device pairing + provider creation).

**Options:**
- `--gateway-url <url>` - Gateway WebSocket URL (ws:// or wss://)
- `--gateway-token <token>` - Gateway authentication token
- `--agent-id <agentId>` - Default agent ID
- `--name <name>` - Provider name (default: openclaw-<agent-id>)
- `--instance-id <uuid>` - Omni instance UUID for the openclaw channel account
- `--account-name <name>` - Account name in openclaw.json (default: agent-id)
- `--plugin-path <path>` - Path to omni.ts plugin entry (auto-detected from CWD)
- `--skip-openclaw-config` - Skip openclaw.json updates entirely
- `--non-interactive` - Error on missing required flags instead of prompting

**Example:**
```bash
# Interactive wizard
omni providers setup openclaw

# Non-interactive with all flags
omni providers setup openclaw --gateway-url wss://gateway.openclaw.dev \
  --gateway-token tok_abc --agent-id my-agent --instance-id inst_123 --non-interactive
```

##### `setup genie`
Set up a Genie provider (Claude Code team inbox integration).

**Options:**
- `--agent-name <name>` - Agent identity / "from" field
- `--target-agent <name>` - Target agent inbox to deliver messages to
- `--team-name <template>` - Team name template (supports `{chat_id}`, `{thread_id}`, `{sender_id}`)
- `--agent-role <role>` - Registered genie dir agent name (default: team-lead)
- `--name <name>` - Provider name (default: genie-<agent-name>)
- `--base-url <url>` - Base URL (default: file:///home/genie/.claude/teams)
- `--instance-id <uuid>` - Omni instance UUID to auto-assign provider
- `--non-interactive` - Error on missing required flags instead of prompting

**Example:**
```bash
# Interactive wizard
omni providers setup genie

# Non-interactive setup
omni providers setup genie --agent-name sofia --target-agent sofia \
  --team-name "omni-{chat_id}" --instance-id inst_123 --non-interactive
```

#### `list`
List available providers.

**Options:**
- `--active` - Show only active providers

**Examples:**
```bash
omni providers list
omni providers list --active
```

#### `get <id>`
Get provider details.

**Arguments:**
- `<id>` - Provider ID

**Example:**
```bash
omni providers get prov_abc
```

#### `create`
Create a new AI provider.

**Options:**
- `--name <name>` - Provider name (unique)
- `--schema <schema>` - Provider schema: `agno`, `webhook`, `openclaw`, `ag-ui`, `claude-code`, `a2a`, `genie`
- `--base-url <url>` - API base URL (ws:// or wss:// for openclaw)
- `--api-key <key>` - API key (optional for claude-code if using env ANTHROPIC_API_KEY)
- `--description <desc>` - Provider description
- `--timeout <seconds>` - Default timeout in seconds (default: 60)
- `--stream` - Enable streaming by default
- `--default-agent-id <agentId>` - Default agent ID (required for openclaw)
- `--project-path <path>` - Project directory path (required for claude-code)
- `--max-turns <number>` - Max conversation turns (claude-code)
- `--permission-mode <mode>` - Permission mode: `default`, `acceptEdits`, `bypassPermissions`, `plan` (claude-code)
- `--model <model>` - Model override (claude-code)
- `--system-prompt <prompt>` - System prompt prepended to agent (claude-code)
- `--agent-name <name>` - Agent identity / "from" field (required for genie)
- `--target-agent <name>` - Target agent inbox to deliver to (required for genie)
- `--team-name <template>` - Team name template, supports `{chat_id}`, `{thread_id}`, `{sender_id}` (genie, default: omni-{chat_id})

**Examples:**
```bash
# Create a Genie provider
omni providers create --name "sofia-genie" --schema genie \
  --agent-name sofia --target-agent sofia --team-name "omni-{chat_id}"

# Create a Claude Code provider
omni providers create --name "code-assistant" --schema claude-code \
  --project-path /home/user/project --model claude-sonnet-4-20250514 \
  --permission-mode acceptEdits --max-turns 10

# Create an Agno provider
omni providers create --name "agno-prod" --schema agno \
  --base-url https://api.agno.dev --api-key sk_abc --stream

# Create a webhook provider
omni providers create --name "custom-webhook" --schema webhook \
  --base-url https://my-api.example.com/agent --timeout 120
```

#### `test <id>`
Test provider health (connectivity check).

**Arguments:**
- `<id>` - Provider ID

**Example:**
```bash
omni providers test prov_abc
```

#### `agents <id>`
List agents from an Agno provider.

**Arguments:**
- `<id>` - Provider ID

**Example:**
```bash
omni providers agents prov_abc
```

#### `teams <id>`
List teams from an Agno provider.

**Arguments:**
- `<id>` - Provider ID

**Example:**
```bash
omni providers teams prov_abc
```

#### `workflows <id>`
List workflows from an Agno provider.

**Arguments:**
- `<id>` - Provider ID

**Example:**
```bash
omni providers workflows prov_abc
```

#### `update <id>`
Update a provider.

**Arguments:**
- `<id>` - Provider ID

**Options:**
- `--name <name>` - Provider name
- `--base-url <url>` - API base URL
- `--api-key <key>` - API key
- `--description <desc>` - Provider description
- `--timeout <seconds>` - Default timeout in seconds
- `--stream` / `--no-stream` - Enable/disable streaming
- `--active` / `--no-active` - Set provider active/inactive
- `--agent-name <name>` - Agent identity (genie)
- `--target-agent <name>` - Target agent inbox (genie)
- `--team-name <template>` - Team name template (genie)
- `--project-path <path>` - Project directory path (claude-code)
- `--max-turns <number>` - Max conversation turns (claude-code)
- `--permission-mode <mode>` - Permission mode (claude-code)
- `--model <model>` - Model override (claude-code)
- `--system-prompt <prompt>` - System prompt (claude-code)
- `--schema-config <json>` - Raw schemaConfig as JSON (overrides individual schema flags)

**Examples:**
```bash
# Deactivate a provider
omni providers update prov_abc --no-active

# Update genie provider target
omni providers update prov_abc --target-agent new-agent --team-name "team-{sender_id}"

# Update claude-code model and timeout
omni providers update prov_abc --model claude-opus-4-20250514 --timeout 120

# Set raw schemaConfig JSON
omni providers update prov_abc --schema-config '{"agentName":"bot","targetAgent":"lead"}'
```

#### `delete <id>`
Delete a provider.

**Arguments:**
- `<id>` - Provider ID

**Options:**
- `--force` - Skip confirmation

**Example:**
```bash
omni providers delete prov_abc
omni providers delete prov_abc --force
```

---

## omni access

Manage access control rules (allow/deny lists). Controls who can interact with your instances.

### Subcommands

#### `list`
List access rules.

**Options:**
- `--instance <id>` - Filter by instance ID
- `--type <type>` - Filter by rule type: `allow` or `deny`

**Examples:**
```bash
# List all rules
omni access list

# List deny rules for a specific instance
omni access list --instance inst_123 --type deny
```

#### `create`
Create an access rule.

**Options:**
- `--type <type>` - Rule type: `allow` or `deny`
- `--instance <id>` - Instance ID (omit for global rule)
- `--phone <pattern>` - Phone pattern (supports `*` wildcard, e.g., `+55*`)
- `--user <id>` - Platform user ID (Discord ID, etc.)
- `--priority <n>` - Rule priority (higher = checked first)
- `--action <action>` - Action: `block`, `silent_block`, or `allow` (default: `block`)
- `--reason <text>` - Human-readable reason for the rule
- `--message <text>` - Custom message to send when blocked
- `--disabled` - Create rule in disabled state

**Examples:**
```bash
# Allow all Brazilian numbers
omni access create --type allow --instance inst_123 --phone "+55*" \
  --reason "Brazil office"

# Deny a specific user with a custom message
omni access create --type deny --instance inst_123 --phone "+15551234567" \
  --action block --message "Access restricted. Contact support." \
  --reason "Spam reports"

# Silent block (no message sent to blocked user)
omni access create --type deny --phone "+1900*" --action silent_block \
  --reason "Premium number range"

# Global allow rule for a Discord user
omni access create --type allow --user "discord_user_123" --priority 100
```

#### `delete <id>`
Delete an access rule.

**Arguments:**
- `<id>` - Rule ID

**Example:**
```bash
omni access delete rule_abc
```

#### `mode <instanceId> [mode]`
Get or set access control mode for an instance. When called without a mode argument, shows the current mode.

**Arguments:**
- `<instanceId>` - Instance ID
- `[mode]` - Access mode to set: `open`, `allowlist`, or `denylist`

**Examples:**
```bash
# Check current mode
omni access mode inst_123

# Set to allowlist (only allowed users can interact)
omni access mode inst_123 allowlist

# Set to open (everyone can interact, deny rules still apply)
omni access mode inst_123 open
```

#### `check`
Check if a user has access to an instance.

**Options:**
- `--instance <id>` - Instance ID
- `--user <id>` - Platform user ID to check
- `--channel <type>` - Channel type (default: `discord`)

**Example:**
```bash
omni access check --instance inst_123 --user "discord_user_456" --channel discord
```

#### `pending <instanceId>`
List pending pairing requests for an instance.

**Arguments:**
- `<instanceId>` - Instance ID

**Example:**
```bash
omni access pending inst_123
```

#### `approve <instanceId> <requestId>`
Approve a pairing request (adds user to allowlist).

**Arguments:**
- `<instanceId>` - Instance ID
- `<requestId>` - Pairing request ID

**Example:**
```bash
omni access approve inst_123 req_abc
```

#### `deny <instanceId> <requestId>`
Deny a pairing request.

**Arguments:**
- `<instanceId>` - Instance ID
- `<requestId>` - Pairing request ID

**Options:**
- `--reason <text>` - Reason for denial

**Example:**
```bash
omni access deny inst_123 req_abc --reason "Unknown user"
```

---

## omni keys

Manage API keys for authenticating with the Omni API.

### Subcommands

#### `create`
Create a new API key.

**Options:**
- `--name <name>` - Key name
- `--scopes <scopes>` - Comma-separated scopes (e.g., `messages:read,instances:write`)
- `--instances <ids>` - Comma-separated instance IDs to restrict access
- `--description <desc>` - Key description
- `--rate-limit <n>` - Rate limit (requests/minute)
- `--expires <date>` - Expiration date (ISO 8601)

**Examples:**
```bash
# Create a key scoped to specific instances
omni keys create --name "bot-key" --scopes "messages:read,messages:write" \
  --instances "inst_123,inst_456" --description "Bot integration key"

# Create a key with rate limit and expiration
omni keys create --name "temp-key" --rate-limit 60 --expires "2026-12-31T23:59:59Z"

# Create an unrestricted key
omni keys create --name "admin-key" --description "Full access admin key"
```

#### `list`
List API keys.

**Options:**
- `--status <status>` - Filter by status: `active`, `revoked`, `expired`
- `--limit <n>` - Max results

**Examples:**
```bash
omni keys list
omni keys list --status active --limit 10
```

#### `get <id>`
Get API key details.

**Arguments:**
- `<id>` - Key ID

**Example:**
```bash
omni keys get key_abc
```

#### `update <id>`
Update an API key.

**Arguments:**
- `<id>` - Key ID

**Options:**
- `--name <name>` - New key name
- `--description <desc>` - New description
- `--scopes <scopes>` - New scopes (comma-separated)
- `--instances <ids>` - New instance IDs (comma-separated, empty string to unrestrict)
- `--rate-limit <n>` - New rate limit
- `--expires <date>` - New expiration (ISO 8601, empty string to clear)

**Examples:**
```bash
# Restrict key to specific instances
omni keys update key_abc --instances "inst_123,inst_789"

# Remove instance restriction
omni keys update key_abc --instances ""

# Update rate limit and expiration
omni keys update key_abc --rate-limit 120 --expires "2027-06-30T00:00:00Z"
```

#### `revoke <id>`
Revoke an API key (soft-delete, key remains in records but stops working).

**Arguments:**
- `<id>` - Key ID

**Options:**
- `--reason <reason>` - Reason for revocation

**Example:**
```bash
omni keys revoke key_abc --reason "Compromised - rotating keys"
```

#### `delete <id>`
Permanently delete an API key (hard-delete, cannot be recovered).

**Arguments:**
- `<id>` - Key ID

**Example:**
```bash
omni keys delete key_abc
```
