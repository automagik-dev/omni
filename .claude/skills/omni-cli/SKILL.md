---
name: omni-cli
description: |
  Expert knowledge of the Omni v2 CLI for managing omnichannel messaging.
  Use when interacting with WhatsApp, Discord, Slack, Telegram instances,
  sending messages (text, media, TTS voice notes), managing chats, querying events,
  configuring automations, or debugging the Omni platform. Includes TTS synthesis,
  --json mode, smart ID resolution, batch operations, and LLM-optimized workflows.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni CLI - Complete Reference

The Omni CLI is an **LLM-optimized** command-line interface for the Omni v2 platform. Every command supports `--json` output for agent consumption and scripting.

## Core Philosophy

**Event-First Design** - The platform is built around events. Messages, state changes, and actions all produce events that can be queried, replayed, and analyzed.

**LLM-Native** - Structured JSON output, smart ID resolution, helpful errors, and batch operations designed for AI agent workflows.

**Type-Safe** - Built with TypeScript, uses auto-generated SDK from OpenAPI spec.

---

## Quick Start

```bash
# Authentication
omni auth login --api-key sk_xxx --api-url http://localhost:8882

# Check status
omni status

# List instances
omni instances list

# Send a text message
omni send --to +<phone-number> --text "Hello from Omni!" --instance <id>

# Send TTS voice note (NEW!)
omni send --to +<phone-number> --tts "Hello, this is synthesized speech!" --instance <id>

# List TTS voices
omni tts voices

# List recent chats
omni chats list --instance <id> --unread

# Get JSON output (works with ANY command)
omni chats list --json | jq '.[].id'
```

---

## Global Features

### Universal JSON Output

**The `--json` flag works with EVERY command** - it's processed early before command parsing:

```bash
# Human-friendly tables
omni instances list

# Machine-readable JSON (for agents and scripts)
omni instances list --json

# Combine with jq for filtering
omni instances list --json | jq '.[] | select(.status=="connected")'
```

**Output Format Priority:**
1. `--json` flag (highest)
2. `OMNI_FORMAT` environment variable
3. `~/.omni/config.json` format setting
4. TTY auto-detection

### Smart ID Resolution

You don't need full UUIDs. The CLI matches intelligently:

```bash
# Full UUID
omni instances get 00000000-1111-2222-3333-444444444444

# UUID prefix (minimum 2 hex chars)
omni instances get c3a4f

# Exact name match (case-insensitive)
omni instances get cezar-personal

# Substring name match
omni instances get personal
```

**Helpful errors on ambiguity:**
```
✗ Ambiguous ID prefix "c3a4" matches 3 instances:
  c3a4f123  cezar-personal
  c3a41abc  team-support
  c3a4edef  customer-service
```

### Duration Parsing

Time-based filters accept human-friendly formats:

```bash
--since 7d        # 7 days ago
--since 24h       # 24 hours ago
--since 30m       # 30 minutes ago
--since 1w        # 1 week ago
--since 1m        # 1 month ago
--until 2d        # Until 2 days ago

# Also accepts ISO timestamps
--since 2026-01-01T00:00:00Z
```

---

## Command Categories

### 🔵 Core Messaging

| Command | Description |
|---------|-------------|
| `omni send` | Send any message type (text, media, TTS voice notes, reactions, polls, embeds) |
| `omni chats` | Manage conversations (list, create, archive, mute, participants) |
| `omni messages` | Search messages, mark as read, batch operations |
| `omni tts` | Text-to-speech operations (list voices, send voice notes) |

### 🟢 Instance Management

| Command | Description |
|---------|-------------|
| `omni instances` | Manage channel connections (WhatsApp, Discord, Slack, Telegram) |
| `omni persons` | Contact directory and presence |
| `omni media` | Browse and download media files |

### 🟡 Data & Events

| Command | Description |
|---------|-------------|
| `omni events` | Event history, replay, analytics, timelines |
| `omni journey` | Message journey tracing (latency, stages) |

### 🟠 Configuration

| Command | Description |
|---------|-------------|
| `omni config` | CLI settings (API URL, default instance, format) |
| `omni auth` | Authentication (login, logout, status) |
| `omni status` | System health check |
| `omni providers` | AI/LLM provider configuration |
| `omni keys` | API key management |
| `omni automations` | Event-driven workflows |
| `omni webhooks` | Webhook management |
| `omni agent-routes` | Agent routing configuration |
| `omni prompts` | LLM prompt overrides |
| `omni settings` | Server-wide settings |
| `omni access` | Permissions and access control |

### 🔴 Batch & Processing

| Command | Description |
|---------|-------------|
| `omni batch` | Batch media processing (transcription, text extraction) |
| `omni resync` | Trigger history backfill |

### ⚫ Debug (Hidden - use `omni --all` to see)

| Command | Description |
|---------|-------------|
| `omni logs` | System logs with module filtering |
| `omni dead-letters` | Failed message queue |
| `omni payloads` | Raw event payloads |
| `omni completions` | Shell completions (bash, zsh, fish) |

---

## Essential Commands Deep-Dive

### `omni send` - Universal Message Sender

**The `omni send` command handles ALL message types** through options (no subcommands):

#### Text Messages

```bash
omni send --to +<phone-number> --text "Hello!" --instance <id>

# Reply to specific message
omni send --to +<phone-number> --text "Got it!" --reply-to msg_abc --instance <id>
```

#### TTS Voice Notes (Text-to-Speech)

```bash
# Send TTS voice note (uses instance default voice)
omni send --to +<phone-number> --tts "Hello, this is synthesized speech!" --instance <id>

# Override voice for this message
omni send --to +<phone-number> --tts "Custom voice test" --voice-id xWdpADtEio43ew1zGxUQ --instance <id>

# Response includes audio metadata:
# {
#   "messageId": "3EB0...",
#   "status": "sent",
#   "audioSizeKb": 22.85,
#   "durationMs": 2514
# }
```

#### Media Messages

```bash
# Image with caption
omni send --to +<phone-number> --media ./photo.jpg --caption "Check this out" --instance <id>

# Voice note (audio sent as voice)
omni send --to +<phone-number> --media ./audio.mp3 --voice --instance <id>

# Video
omni send --to +<phone-number> --media ./video.mp4 --instance <id>

# Document
omni send --to +<phone-number> --media ./report.pdf --instance <id>
```

#### Reactions

```bash
omni send --to +<phone-number> --reaction "👍" --message msg_abc --instance <id>
```

#### Stickers

```bash
omni send --to +<phone-number> --sticker https://example.com/sticker.webp --instance <id>
```

#### Contact Cards

```bash
omni send --to +<phone-number> --contact \
  --name "Felipe Silva" \
  --phone +<phone-number> \
  --email felipe@example.com \
  --instance <id>
```

#### Location

```bash
omni send --to +<phone-number> --location \
  --lat -23.5505 \
  --lng -46.6333 \
  --address "São Paulo, Brazil" \
  --instance <id>
```

#### Polls (Discord)

```bash
omni send --to channel-id --poll "Where should we have lunch?" \
  --options "Pizza,Sushi,Tacos,Burgers" \
  --multi-select \
  --duration 24 \
  --instance <discord-id>
```

#### Embeds (Discord)

```bash
omni send --to channel-id --embed \
  --title "System Alert" \
  --description "Database backup completed successfully" \
  --color "#00ff00" \
  --url "https://status.example.com" \
  --instance <discord-id>
```

#### Presence Indicators

```bash
# Show "typing..." indicator
omni send --to +<phone-number> --presence typing --instance <id>

# Show "recording audio..." indicator
omni send --to +<phone-number> --presence recording --instance <id>

# Clear presence
omni send --to +<phone-number> --presence paused --instance <id>
```

---

### `omni chats` - Conversation Management

**Subcommands:** `list`, `get`, `create`, `update`, `delete`, `archive`, `unarchive`, `messages`, `participants`, `read`, `disappearing`, `pin`, `unpin`, `mute`, `unmute`

#### Listing Chats

```bash
# All chats for instance
omni chats list --instance <id>

# Only unread chats
omni chats list --instance <id> --unread

# Sort by activity (most recent first)
omni chats list --instance <id> --sort activity --verbose

# Get full details (includes participant info, media counts)
omni chats list --instance <id> --verbose

# JSON output for scripting
omni chats list --instance <id> --json | jq '.[] | {id, name, unreadCount}'
```

#### Chat Details

```bash
omni chats get <chat-id> --instance <id>
```

#### Create Chat

```bash
omni chats create --instance <id> \
  --external-id "whatsapp:+<phone-number>" \
  --channel whatsapp
```

#### Browse Messages

```bash
# Recent messages in chat
omni chats messages <chat-id> --limit 50

# Search within chat
omni chats messages <chat-id> --search "invoice" --limit 100

# Time-based filtering
omni chats messages <chat-id> --since 7d

# Media-only filters
omni chats messages <chat-id> --audio-only
omni chats messages <chat-id> --images-only
omni chats messages <chat-id> --videos-only

# Compact display (less details)
omni chats messages <chat-id> --compact

# Truncate long messages
omni chats messages <chat-id> --truncate 100
```

**Rich Message Display:**
- Shows audio transcriptions when available
- Displays media type icons (🎤 audio, 📷 image, 🎥 video)
- Formats timestamps ("5m ago", "yesterday", "Mon 14:30")
- Includes sender names and message descriptions

#### Mark as Read

```bash
# Mark entire chat as read
omni chats read <chat-id> --instance <id>
```

#### Disappearing Messages

```bash
# Enable disappearing messages (24 hours)
omni chats disappearing <chat-id> --instance <id> --duration 24h

# Disable (duration 0)
omni chats disappearing <chat-id> --instance <id> --duration 0
```

#### Pin/Unpin

```bash
omni chats pin <chat-id> --instance <id>
omni chats unpin <chat-id> --instance <id>
```

#### Mute/Unmute

```bash
omni chats mute <chat-id> --instance <id>
omni chats unmute <chat-id> --instance <id>
```

#### Archive/Unarchive

```bash
omni chats archive <chat-id> --instance <id>
omni chats unarchive <chat-id> --instance <id>
```

#### Delete

```bash
omni chats delete <chat-id> --instance <id>
```

---

### `omni instances` - Channel Management

**The most feature-rich command** - manages WhatsApp, Discord, Slack, Telegram connections.

**Subcommands:** `list`, `get`, `create`, `delete`, `status`, `whoami`, `qr`, `pair`, `connect`, `disconnect`, `restart`, `logout`, `sync`, `syncs`, `update`, `contacts`, `groups`, `profile`, `check`, `update-bio`, `block`, `unblock`, `blocklist`, `update-picture`, `remove-picture`, `group-update-picture`, `group-create`, `group-invite`, `group-revoke-invite`, `group-join`, `privacy`, `reject-call`

#### List Instances

```bash
omni instances list
omni instances list --json | jq '.[] | {id, name, channelType, status}'
```

#### Create Instance

```bash
omni instances create --channel whatsapp --name "My WhatsApp"
```

#### QR Code (WhatsApp)

```bash
# Display QR code
omni instances qr <id>

# Auto-refresh until connected
omni instances qr <id> --watch

# Get base64 encoded (for web display)
omni instances qr <id> --base64
```

#### Pairing Code (WhatsApp alternative to QR)

```bash
omni instances pair <id>
# Returns an 8-digit code to enter in WhatsApp settings
```

#### Connection Management

```bash
omni instances connect <id>
omni instances disconnect <id>
omni instances restart <id>
omni instances logout <id>    # Clears session data
```

#### Status & Info

```bash
omni instances status <id>
omni instances whoami <id>     # Shows phone number and profile
```

#### Sync Operations

```bash
# Start sync (messages from last 7 days)
omni instances sync <id> --type messages --depth 7d

# Download media during sync
omni instances sync <id> --type messages --depth 7d --download-media

# Sync everything (messages, contacts, groups)
omni instances sync <id> --type all

# Check sync status
omni instances syncs <id>

# Get specific sync job details
omni instances syncs <id> <job-id>
```

#### Contacts & Groups

```bash
# List contacts
omni instances contacts <id> --limit 100

# Search contacts
omni instances contacts <id> --search "Felipe"

# Paginated results (cursor-based)
omni instances contacts <id> --cursor <token>

# List groups
omni instances groups <id>

# Search groups
omni instances groups <id> --search "team"
```

#### User Profiles

```bash
# Get any user's profile
omni instances profile <id> <user-id>

# Check if phone number exists on WhatsApp
omni instances check <id> +<phone-number>
```

#### WhatsApp Status (Bio)

```bash
omni instances update-bio <id> "Available 🟢"
```

#### Blocking

```bash
omni instances block <id> <contact-id>
omni instances unblock <id> <contact-id>
omni instances blocklist <id>
```

#### Profile Pictures

```bash
# Update your profile picture
omni instances update-picture <id> ./photo.jpg

# Remove profile picture
omni instances remove-picture <id>

# Update group picture
omni instances group-update-picture <id> <group-jid> ./photo.jpg
```

#### Group Management

```bash
# Create group
omni instances group-create <id> --name "Team Chat" --participants "+55119999,+55118888"

# Get invite link
omni instances group-invite <id> <group-jid>

# Revoke and regenerate invite link
omni instances group-revoke-invite <id> <group-jid>

# Join via invite code
omni instances group-join <id> <invite-code>
```

#### Privacy Settings

```bash
omni instances privacy <id>
# Shows: lastSeen, profilePicture, status, readReceipts, groupAdd settings
```

#### Call Rejection

```bash
omni instances reject-call <id> <call-id>
```

---

### `omni events` - Event History & Replay

**Subcommands:** `list`, `search`, `timeline`, `replay`, `analytics`

#### List Events

```bash
omni events list --limit 100
omni events list --since 24h --json
```

#### Search Events

```bash
omni events search "error" --since 7d
omni events search "message.received" --type <event-type>
```

#### Person Timeline

```bash
omni events timeline <person-id>
# Shows all activity for a specific person
```

#### Event Replay

**Replay past events** - useful for testing, debugging, or reprocessing:

```bash
# Start replay from 7 days ago
omni events replay --start --since 7d

# Replay with time boundaries
omni events replay --start --since 7d --until 1d

# Replay at 2x speed
omni events replay --start --since 24h --speed 2.0

# Dry run (see what would replay without executing)
omni events replay --start --since 7d --dry-run

# Check replay status
omni events replay --status <session-id>

# List all replay sessions
omni events replay --list

# Cancel replay
omni events replay --cancel <session-id>
```

#### Analytics

```bash
# Last 7 days
omni events analytics --since 7d

# Specific instance
omni events analytics --instance <id> --since 30d

# All-time stats
omni events analytics --instance <id> --all-time
```

**Returns:**
- Total messages
- Success rate (percentage, correctly calculated)
- Average processing time (null if not available)
- Error stages breakdown
- Message types distribution

**Note:** Analytics now returns proper success rates and valid JSON with `null` for unavailable metrics.

---

### `omni automations` - Event-Driven Workflows

**Subcommands:** `list`, `get`, `create`, `update`, `delete`, `enable`, `disable`, `test`, `execute`, `logs`

#### Create Automation

```bash
# Simple agent automation
omni automations create \
  --name "Support Bot" \
  --trigger message.received \
  --action call_agent \
  --agent-id support-agent \
  --response-as agentResponse

# With conditions
omni automations create \
  --name "Urgent Filter" \
  --trigger message.received \
  --action call_agent \
  --agent-id urgent-handler \
  --condition '[{"field":"messageType","operator":"equals","value":"text"}]' \
  --condition-logic "and"

# Forward action
omni automations create \
  --name "Forward to Team" \
  --trigger message.received \
  --action forward \
  --action-config '{"targetChat":"team-chat-id"}'
```

#### Manage Automations

```bash
omni automations list
omni automations get <id>
omni automations enable <id>
omni automations disable <id>
omni automations delete <id>
```

#### Testing

```bash
# Dry run test
omni automations test <id>

# Execute manually
omni automations execute <id>

# View logs
omni automations logs <id>
```

---

### `omni batch` - Batch Media Processing

**Subcommands:** `list`, `create`, `status`, `cancel`, `estimate`

#### Create Batch Job

```bash
# Transcribe audio messages from last 30 days
omni batch create --instance <id> --type transcribe \
  --chat <chat-id> --days 30 --limit 100

# Extract text from all media types
omni batch create --instance <id> --type extract-text \
  --content-types audio,image,video --days 7

# Process documents only
omni batch create --instance <id> --type extract-text \
  --content-types document --chat <chat-id>
```

**Content Types:** `audio`, `image`, `video`, `document`

#### Cost Estimation

```bash
omni batch estimate --instance <id> --type transcribe --days 7
# Returns: estimated item count, cost, processing time
```

#### Monitor Jobs

```bash
# Get job status
omni batch status <job-id>

# Auto-refresh status every 2 seconds
omni batch status <job-id> --watch --interval 2000

# List all jobs
omni batch list

# Cancel running job
omni batch cancel <job-id>
```

---

## Configuration & Setup

### Authentication

```bash
# Login
omni auth login --api-key sk_xxx --api-url http://localhost:8882

# Check auth status
omni auth status

# Logout
omni auth logout
```

**Config file location:** `~/.omni/config.json` (mode 0o600 - user-readable only)

### CLI Configuration

```bash
# Set default instance (no need to pass --instance every time)
omni config set defaultInstance <id>

# Set API URL
omni config set apiUrl http://localhost:8882

# Set default output format
omni config set format json

# View all config
omni config list

# Get specific value
omni config get defaultInstance

# Remove setting
omni config unset defaultInstance
```

**Available Config Keys:**
- `apiUrl` - API endpoint (default: http://localhost:8882)
- `apiKey` - Authentication token
- `defaultInstance` - Default instance ID for commands
- `format` - Output format (`human` or `json`)
- `showCommands` - Command visibility (`all` or `core,standard,advanced,debug`)

**Environment Variable Overrides:**
```bash
export OMNI_FORMAT=json
export OMNI_SHOW_COMMANDS=all
```

### System Status

```bash
omni status
```

**Shows:**
- Config directory path
- API URL and reachability
- Authentication status
- Key validity and scopes
- Default instance
- Output format (auto-detected from TTY)

---

## TTS (Text-to-Speech)

### Overview

The CLI supports ElevenLabs text-to-speech synthesis for sending voice notes without recording.

### List Available Voices

```bash
# Human-readable list
omni tts voices

# Output:
# VOICEID               NAME                                    CATEGORY
# --------------------  --------------------------------------  ------------
# xWdpADtEio43ew1zGxUQ  Matheus Santos - Friendly and Calm      professional
# pNInz6obpgDQGcFmaJgB  Adam - Dominant, Firm                   premade
# ...

# JSON mode
omni tts voices --json | jq '.[] | {voiceId, name, category}'
```

### Send TTS Messages

```bash
# Basic TTS (uses instance default voice)
omni send --to +5511999 --tts "Hello, this is a voice note!" --instance <id>

# Override voice for specific message
omni send --to +5511999 --tts "Custom voice" --voice-id pNInz6obpgDQGcFmaJgB --instance <id>

# Response includes audio metadata
{
  "messageId": "3EB0...",
  "status": "sent",
  "audioSizeKb": 22.85,      # Audio file size
  "durationMs": 2514,         # Audio duration
  "timestamp": 1770959118964
}
```

### TTS Best Practices

1. **Voice Selection**: Use `omni tts voices` to find appropriate voices for your use case
2. **Text Length**: Keep TTS text reasonable (< 500 chars for best quality)
3. **Add Emotion**: Use emotion tags like `[excited]`, `[calm]`, `[apologetic]` for better delivery
4. **Pacing**: Use ellipses `...` for pauses, dashes `—` for dramatic effect
5. **Emphasis**: CAPITALIZE words for vocal intensity and emphasis
6. **Normalize Text**: Expand abbreviations ("Dr." → "Doctor"), spell out numbers
7. **Instance Config**: Configure default voice in instance settings for consistent voice
8. **Cost Awareness**: TTS synthesis consumes ElevenLabs credits
9. **Language Support**: Use multilingual voices for non-English text

**Emotion Examples:**
```bash
# Excited announcement
omni send --to <phone> --tts "[excited] Great news! Your order shipped!" --instance <id>

# Calm reassurance
omni send --to <phone> --tts "[calm] Everything is under control … we'll handle this." --instance <id>

# Professional with emphasis
omni send --to <phone> --tts "This is VERY important — please review immediately." --instance <id>
```

**For complete TTS emotion guide and advanced techniques, see [TTS-GUIDE.md](TTS-GUIDE.md)**

### TTS in Message Search

TTS voice notes appear in search with transcriptions:

```bash
omni messages search "hello" --since 1h

# Output:
# CHAT           TIME              TYPE   CONTENT
# -------------  ----------------  -----  ---------------------------
# John Doe       Feb 13, 02:05 AM  audio  [transcription] Hello there!
```

---

## JSON Field Mappings

### Messages JSON Structure

When using `--json` with messages, the field names differ from human display:

```bash
omni chats messages <chat-id> --json | jq '.[] | {
  sender: .senderDisplayName,      # NOT .from
  type: .messageType,               # text, audio, image, video, etc.
  text: .textContent,               # NOT .content
  transcription: .transcription,    # For audio messages
  media: .mediaUrl,                 # Media download URL
  time: .platformTimestamp          # NOT .timestamp
}'
```

**Key Fields:**
- `senderDisplayName` - Sender's display name
- `messageType` - Message type (text, audio, image, video, sticker, reaction)
- `textContent` - Text content (null for non-text messages)
- `transcription` - Audio transcription (if processed)
- `imageDescription` - AI-generated image description
- `videoDescription` - AI-generated video description
- `mediaUrl` - Media file URL
- `platformTimestamp` - Message timestamp from platform
- `receivedAt` - When Omni received the message

### Response Wrapper Structure

**All JSON responses are wrapped:**

```json
{
  "success": true,
  "message": "Operation completed",
  "data": {
    // Actual response data here
  }
}
```

**For scripting, access `.data`:**

```bash
omni send --to +5511999 --text "Hi" --json | jq '.data.messageId'
```

---

## Advanced Workflows

### Scripting with JSON + jq

#### Find All Unread Chats

```bash
omni chats list --instance <id> --json | \
  jq '.[] | select(.unreadCount > 0) | {id, name, unreadCount}'
```

#### Extract Message IDs from Send

```bash
# Correct way to extract message ID
msg_id=$(omni send --to +5511999 --text "Hi" --json | jq -r '.data.messageId')

# Use in follow-up command
omni send --to +5511999 --reaction "👍" --message "$msg_id"
```

#### List TTS Messages with Transcriptions

```bash
omni chats messages <chat-id> --json | \
  jq '.[] | select(.messageType == "audio" and .transcription != null) | {
    sender: .senderDisplayName,
    transcription,
    time: .platformTimestamp
  }'
```

#### Get All Connected Instances

```bash
omni instances list --json | \
  jq '.[] | select(.status == "connected") | .id' | \
  while read id; do
    echo "Instance: $id"
    omni chats list --instance "$id" --unread --json | jq length
  done
```

#### Find Messages Mentioning Keywords

```bash
omni messages search "urgent" --since 7d --json | \
  jq '.[] | {id, content, from: .sender.displayName, timestamp}'
```

#### Export Chat History

```bash
chat_id="<chat-id>"
omni chats messages "$chat_id" --limit 1000 --json > "chat_${chat_id}_export.json"
```

#### Batch Mark Messages as Read

```bash
# Get all unread message IDs
msg_ids=$(omni messages search "" --since 7d --json | \
  jq -r '.[] | select(.isRead == false) | .id' | \
  tr '\n' ',' | \
  sed 's/,$//')

# Mark them all as read
omni messages read --batch --instance <id> --ids "$msg_ids"
```

#### Monitor Instance Health

```bash
#!/bin/bash
while true; do
  omni instances list --json | \
    jq -r '.[] | "\(.name): \(.status)"'
  sleep 60
done
```

#### Auto-reply to Mentions

```bash
# Find messages mentioning "@bot"
omni messages search "@bot" --since 1h --json | \
  jq -r '.[] | .id' | \
  while read msg_id; do
    omni send --reply-to "$msg_id" --text "Got your message!" --instance <id>
  done
```

### Message Listening & Monitoring

The CLI doesn't have built-in streaming, but the skill includes **ready-to-use bash scripts** in `scripts/` for monitoring messages and events.

**🎯 For Agent Workflows:** Use `wait-for-message.sh` - it's one-shot, background-friendly, and perfect for event-driven automation.

#### Available Scripts

| Script | Purpose | Best For | Usage |
|--------|---------|----------|-------|
| **wait-for-message.sh** ⭐ | Wait for one message then exit | **Agent workflows, event-driven automation** | `./wait-for-message.sh <chat-id>` |
| **listen-chat.sh** | Listen to single chat continuously | Interactive debugging | `./listen-chat.sh <instance> <chat-id>` |
| **listen-multi-chat.sh** | Monitor multiple chats | Continuous monitoring | `./listen-multi-chat.sh <instance> <chat-1> <chat-2>` |
| **listen-events.sh** | Event stream monitor | Event debugging | `./listen-events.sh <instance>` |
| **auto-reply-bot.sh** | Keyword auto-reply | Bot automation | `./auto-reply-bot.sh <instance> <keyword> <reply>` |
| **keyword-watcher.sh** | Multi-keyword bot | Bot automation | `./keyword-watcher.sh <instance>` |
| **notify-on-message.sh** | Desktop notifications | Personal alerts | `./notify-on-message.sh <instance> <chat-id>` |

All scripts are in: `.claude/skills/omni-cli/scripts/`

#### Quick Start

```bash
# Navigate to scripts directory
cd ~/.claude/skills/omni-cli/scripts/

# Event-driven workflow (RECOMMENDED for agents)
./wait-for-message.sh <chat-id>

# Listen to a chat (interactive debugging)
./listen-chat.sh cezar-personal <recipient-id>@s.whatsapp.net

# Auto-reply to "help" keyword with TTS
./auto-reply-bot.sh cezar-personal help \
  "[cheerful] Thanks for your message! A team member will respond shortly." true

# Monitor events
./listen-events.sh cezar-personal 5

# Desktop notifications
./notify-on-message.sh cezar-personal <recipient-id>@s.whatsapp.net
```

**For event-driven agent workflows**, use `wait-for-message.sh` with the Bash tool's `run_in_background` parameter:

```python
Bash(
    command="cd .claude/skills/omni-cli/scripts && ./wait-for-message.sh <chat-id>",
    run_in_background=True
)
```

When a message arrives, the task completes and you get notified - perfect for "wake up on message" patterns.

#### Customizing Listeners

Scripts include clearly marked sections for adding custom actions:

```bash
# ⚡ ADD YOUR ACTION HERE ⚡
# Examples:
# - Auto-reply
# - Log to database
# - Trigger webhooks
# - Send notifications
```

#### Running in Background

```bash
# With tmux
tmux new -s listener
./listen-chat.sh cezar-personal <recipient-id>@s.whatsapp.net
# Detach: Ctrl+B then D

# Or nohup
nohup ./listen-events.sh cezar-personal > listener.log 2>&1 &
```

See **scripts/README.md** for full documentation, systemd service examples, and advanced customization patterns.

---

## Debugging & Troubleshooting

### Message Journey Tracing

```bash
omni journey <message-id>
```

**Shows:**
- Event timeline
- Latency breakdown
- Processing stages
- Errors or bottlenecks

Use this when messages aren't delivering or processing slowly.

### System Logs

```bash
# Recent logs (info level and above)
omni logs --limit 100

# Debug logs from specific module
omni logs debug --modules core

# All debug logs
omni logs debug
```

### Dead Letter Queue

```bash
# List failed messages
omni dead-letters list

# Get failure details
omni dead-letters get <id>

# Retry failed message
omni dead-letters retry <id>
```

### Raw Event Payloads

```bash
# List raw payloads
omni payloads list --type message.received

# Get specific payload
omni payloads get <id>
```

---

## Tips & Best Practices

### 1. Always Use JSON for Scripting

```bash
# Bad (fragile, depends on table formatting)
omni instances list | grep "connected"

# Good (reliable, structured)
omni instances list --json | jq '.[] | select(.status == "connected")'
```

### 2. Set Default Instance

If you work with one instance most of the time:

```bash
omni config set defaultInstance <id>
# Now you can skip --instance on most commands
omni send --to +5511999 --text "Hi!"
```

### 3. Use Smart ID Resolution

```bash
# Instead of full UUIDs
omni instances get 00000000-1111-2222-3333-444444444444

# Use prefix or name
omni instances get c3a4f
omni instances get personal
```

### 4. Combine Commands

```bash
# Create chat, then send welcome message
chat_id=$(omni chats create --instance <id> --external-id "whatsapp:+55119999" --channel whatsapp --json | jq -r .data.id)
omni send --to "$chat_id" --text "Welcome! How can I help?" --instance <id>
```

### 5. Use Batch Operations

```bash
# Instead of looping through messages one-by-one
omni messages read --batch --instance <id> --chat <chat-id> --ids id1,id2,id3
```

### 6. Leverage Event Replay for Testing

```bash
# Test changes by replaying past events
omni events replay --start --since 1h --dry-run
```

### 7. Monitor with Watch Flags

```bash
# QR code with auto-refresh
omni instances qr <id> --watch

# Batch job monitoring
omni batch status <job-id> --watch --interval 2000
```

---

## Common Use Cases

### Setting Up WhatsApp Instance

```bash
# 1. Create instance
instance_id=$(omni instances create --channel whatsapp --name "My WhatsApp" --json | jq -r .data.id)

# 2. Get QR code (watch until connected)
omni instances qr "$instance_id" --watch

# 3. Check connection
omni instances status "$instance_id"

# 4. Set as default
omni config set defaultInstance "$instance_id"

# 5. Sync recent messages
omni instances sync "$instance_id" --type messages --depth 30d
```

### Building a Support Bot

```bash
# Create automation that routes support messages
omni automations create \
  --name "Support Router" \
  --trigger message.received \
  --action call_agent \
  --agent-id support-classifier \
  --response-as classification \
  --condition '[{"field":"chat.tags","operator":"contains","value":"support"}]'
```

### Exporting Chat Analytics

```bash
#!/bin/bash
instance_id="<your-instance>"

# Get analytics
omni events analytics --instance "$instance_id" --since 30d --json > analytics.json

# List top 10 most active chats
omni chats list --instance "$instance_id" --json | \
  jq 'sort_by(.messageCount) | reverse | .[0:10] | .[] | {name, messageCount, lastMessageAt}'
```

### Monitoring Unread Messages

```bash
#!/bin/bash
while true; do
  unread=$(omni chats list --instance <id> --unread --json | jq length)
  echo "Unread chats: $unread"

  if [ "$unread" -gt 0 ]; then
    omni chats list --instance <id> --unread --json | \
      jq '.[] | {name, unreadCount}'
  fi

  sleep 30
done
```

---

## Supporting Resources

For detailed command references, examples, and advanced patterns, see:

- [examples.md](examples.md) - Real-world workflows and scripts
- [reference/commands.md](reference/commands.md) - Complete command option reference
- [reference/api-mapping.md](reference/api-mapping.md) - How CLI maps to SDK/API

---

## Quick Reference Card

```bash
# MESSAGING
omni send --to <phone> --text "..." --instance <id>
omni send --to <phone> --tts "Voice note!" --instance <id>
omni send --to <phone> --media ./file.jpg --instance <id>
omni send --to <phone> --reaction "👍" --message <msg-id> --instance <id>

# TTS
omni tts voices
omni send --to <phone> --tts "Hello" --voice-id <id> --instance <id>

# CHATS
omni chats list --instance <id> --unread
omni chats messages <chat-id> --since 7d --search "keyword"
omni chats read <chat-id> --instance <id>

# INSTANCES
omni instances list
omni instances qr <id> --watch
omni instances sync <id> --type messages --depth 30d

# EVENTS
omni events search "error" --since 24h
omni events replay --start --since 1h --dry-run
omni events analytics --since 7d

# CONFIG
omni config set defaultInstance <id>
omni auth login --api-key sk_xxx
omni status

# JSON OUTPUT (works everywhere!)
<any-command> --json | jq '.data'  # Note: responses wrapped in .data
```

---

**Remember:** The CLI is designed for both human use (colored tables, helpful errors) and agent use (JSON output, batch operations, smart resolution). Always use `--json` when scripting or building automations.
