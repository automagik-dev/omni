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
- [agent-routes](#omni-agent-routes) - Agent routing
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
- `--duration <time>` - Duration before messages disappear (e.g., "24h", "7d", "0" to disable)

**Example:**
```bash
# Enable 24h disappearing messages
omni chats disappearing chat_abc --instance inst_123 --duration 24h

# Disable
omni chats disappearing chat_abc --instance inst_123 --duration 0
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
omni instances pair inst_123
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
- `--list` - List all replay sessions
- `--cancel <id>` - Cancel replay session

**Examples:**
```bash
# Start replay
omni events replay --start --since 7d --until 1d --speed 2.0

# Dry run
omni events replay --start --since 1h --dry-run

# Check status
omni events replay --status session_abc

# List sessions
omni events replay --list

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

This reference continues with all remaining commands. The full document would be quite long - would you like me to continue with the rest, or is this format and level of detail what you're looking for?
