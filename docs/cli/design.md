---
title: "CLI Design"
created: 2025-01-29
updated: 2026-02-09
tags: [cli, reference]
status: current
---

# CLI Design

> The Omni CLI is designed to be LLM-friendly — structured output, clear commands, and predictable behavior for AI agents.

> Related: [[endpoints|API Endpoints]], [[overview|Architecture Overview]]

## Installation

```bash
# Build and link globally
make cli-link

# Binary location
~/.omni/bin/omni
```

## Configuration

```bash
# Set API key (stored in ~/.omni/config.json)
omni config set apiKey sk-omni-...

# Set base URL
omni config set baseUrl https://api.example.com

# Set default instance
omni config set instance <instance-id>

# View config
omni config list

# Environment variables (take precedence)
export OMNI_API_KEY=sk-omni-...
export OMNI_BASE_URL=https://api.example.com
```

## Command Structure

Commands are grouped into three categories:

### Core

| Command | Description |
|---------|-------------|
| `send` | Send message (text, media, location, poll, embed, reaction, presence) |
| `chats` | List and manage conversations |
| `messages` | Message actions (search, read receipts) |

### Management

| Command | Description |
|---------|-------------|
| `instances` | Channel connections (WhatsApp, Discord) |
| `persons` | Contact directory |
| `automations` | Event-driven workflows |
| `providers` | AI/LLM providers configuration |
| `access` | Access control and permissions |
| `webhooks` | Webhook management |

### System

| Command | Description |
|---------|-------------|
| `status` | API health and connection info |
| `config` | CLI settings (default instance, format) |
| `events` | Query message history |
| `auth` | Authentication management |
| `settings` | Server settings |
| `batch` | Batch operations |
| `keys` | API key management (hidden) |
| `logs` | System log viewer (hidden) |
| `dead-letters` | Failed event management (hidden) |
| `payloads` | Event payload inspection (hidden) |
| `completions` | Shell completions (hidden) |

> Hidden commands are shown with `omni --all`

---

## Send

The unified `send` command uses flags (not positional args):

```bash
# Text message
omni send --to +5511999 --text "Hello!"

# Media message
omni send --to +5511999 --media ./photo.jpg --caption "Check this"

# Voice note
omni send --to +5511999 --media ./audio.ogg --voice

# Reaction
omni send --to +5511999 --reaction "👍" --message msg_abc

# Sticker
omni send --to +5511999 --sticker https://example.com/sticker.webp

# Contact card
omni send --to +5511999 --contact --name "John" --phone "+1234" --email "j@x.com"

# Location
omni send --to +5511999 --location --lat -23.55 --lng -46.63 --address "São Paulo"

# Poll (Discord)
omni send --to #channel --poll "Lunch?" --options "Pizza,Sushi,Tacos" --multi-select

# Embed (Discord)
omni send --to #channel --embed --title "Update" --description "v2.0 released" --color 0x00ff00

# Presence indicator
omni send --to +5511999 --presence typing

# Override default instance
omni send --instance <id> --to +5511999 --text "Hi"

# Reply to a message
omni send --to +5511999 --text "Reply" --reply-to <message-id>
```

## Chats

```bash
omni chats list                             # List all chats
omni chats list --instance <id>             # Filter by instance
omni chats list --search "Group"            # Search by name
omni chats get <chat-id>                    # Get chat details
omni chats create --instance <id> ...       # Create chat record
omni chats update <id> --name "New Name"    # Update chat
omni chats delete <id>                      # Soft-delete chat
omni chats archive <id>                     # Archive chat
omni chats unarchive <id>                   # Unarchive chat
omni chats messages <chat-id>              # Get chat messages
omni chats messages <id> --limit 50         # With limit
omni chats participants <id>               # List participants
omni chats participants <id> --add <user>  # Add participant
omni chats read <id>                       # Mark chat as read
```

## Messages

```bash
omni messages search "meeting"              # Search across chats
omni messages search "meeting" --chat <id>  # Search within chat
omni messages read <message-id>            # Mark as read
omni messages read --batch --chat <id> --ids id1,id2  # Batch read
```

## Instances

```bash
omni instances list                         # List all instances
omni instances list --channel whatsapp-baileys  # Filter by channel
omni instances get <id>                     # Get instance details
omni instances create --name my-wa --channel whatsapp-baileys  # Create
omni instances update <id> --agent-timeout 90  # Update
omni instances delete <id>                  # Delete
omni instances status <id>                  # Connection status
omni instances qr <id>                     # Show QR code
omni instances qr <id> --terminal          # Display in terminal
omni instances pair <id> --phone +5511999  # Pairing code auth
omni instances connect <id>                # Connect
omni instances disconnect <id>             # Disconnect
omni instances restart <id>                # Restart connection
omni instances logout <id>                 # Logout (clear session)
omni instances sync <id> --type messages   # Start sync
omni instances syncs <id>                  # List sync jobs
omni instances syncs <id> <job-id>        # Get sync job status
omni instances contacts <id>              # List contacts
omni instances groups <id>                # List groups
omni instances profile <id> <userId>      # Get user profile
```

## Persons

```bash
omni persons search "Felipe"               # Search by name
omni persons search "+5511"                # Search by phone
omni persons get <id>                      # Get person details
omni persons presence <id>                # Cross-channel presence
```

## Events

```bash
omni events list                           # List recent events
omni events list --instance <id>           # Filter by instance
omni events list --since 2025-01-01        # Date range
omni events list --limit 100               # Limit results
omni events search "meeting"              # Search by content
omni events timeline <person-id>          # Cross-channel timeline
omni events metrics                       # Processing metrics
omni events replay                        # Manage replay sessions
```

## Automations

```bash
omni automations list                      # List automations
omni automations get <id>                  # Get details
omni automations create ...               # Create automation
omni automations update <id> ...          # Update
omni automations delete <id>              # Delete
omni automations enable <id>              # Enable
omni automations disable <id>             # Disable
omni automations test <id>               # Test with mock event
omni automations execute <id>            # Execute with real event
omni automations logs <id>               # Execution logs
```

## Providers

```bash
omni providers list                        # List AI providers
omni providers get <id>                    # Get details
omni providers create ...                 # Create provider
omni providers update <id> ...            # Update
omni providers delete <id>               # Delete
omni providers health <id>              # Health check
```

## Webhooks

```bash
omni webhooks list                         # List webhook sources
omni webhooks get <id>                     # Get details
omni webhooks create ...                  # Create source
omni webhooks update <id> ...             # Update
omni webhooks delete <id>                # Delete
omni webhooks trigger ...                # Trigger custom event
```

## Access

```bash
omni access list                           # List rules
omni access list --instance <id>           # Filter by instance
omni access create deny ...               # Create deny rule
omni access create allow ...              # Create allow rule
omni access delete <id>                   # Delete rule
omni access check <instance> <user>       # Check access
```

## Settings

```bash
omni settings list                         # List all settings
omni settings list --category media        # Filter by category
omni settings get GROQ_API_KEY             # Get setting
omni settings set GROQ_API_KEY gsk_...    # Set setting
```

## System

```bash
omni status                                # API health check
omni auth validate                        # Validate API key
omni logs                                 # View recent logs
omni logs error                           # Filter by level
omni logs --modules api,whatsapp          # Filter by module
omni batch list                           # List batch jobs
omni dead-letters list                    # List failed events
omni dead-letters stats                   # Dead letter statistics
omni dead-letters retry <id>             # Retry failed event
```

---

## Output Formats

```bash
# Default: human-readable with colors
omni instances list

# JSON (for parsing)
omni instances list --format json

# Use OMNI_FORMAT env var for default
export OMNI_FORMAT=json
```

## Global Options

```
Options:
  -V, --version     Show version
  --no-color        Disable colored output
  --all             Show all commands (including hidden)
  -h, --help        Show help
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OMNI_API_KEY` | API key for authentication |
| `OMNI_BASE_URL` | Base URL of Omni server |
| `OMNI_FORMAT` | Default output format |
| `OMNI_NO_COLOR` | Disable colored output |

## Configuration File

Located at `~/.omni/config.json`:

```json
{
  "apiKey": "omni_sk_...",
  "baseUrl": "http://localhost:8881",
  "instance": "07a5178e-...",
  "format": "human"
}
```
