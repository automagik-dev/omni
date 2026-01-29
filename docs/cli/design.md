# CLI Design

> The Omni CLI is designed to be LLM-friendly - structured output, clear commands, and predictable behavior for AI agents.

## Design Principles

1. **LLM-First** - Output is structured, parseable, and predictable
2. **Human-Friendly** - Also works well for humans with color and formatting
3. **Consistent** - Same patterns across all commands
4. **Scriptable** - Exit codes, JSON output, piping support
5. **Discoverable** - Built-in help and examples

## Installation

```bash
# npm
npm install -g @omni/cli

# Or run directly
npx @omni/cli --help
```

## Configuration

```bash
# Set API key (stored in ~/.omni/config.json)
omni config set apiKey sk-omni-...

# Set base URL
omni config set baseUrl https://api.example.com

# View config
omni config list

# Use environment variables (takes precedence)
export OMNI_API_KEY=sk-omni-...
export OMNI_BASE_URL=https://api.example.com
```

## Output Formats

Every command supports multiple output formats:

```bash
# Default: human-readable with colors
omni instances list

# JSON (for parsing)
omni instances list --format json

# JSON Lines (for streaming)
omni events list --format jsonl

# Table (compact)
omni instances list --format table

# Minimal (just IDs or values)
omni instances list --format minimal
```

## Global Options

```
Options:
  --format, -f    Output format (json|jsonl|table|minimal)
  --quiet, -q     Suppress non-essential output
  --verbose, -v   Show detailed output
  --help, -h      Show help
  --version       Show version
```

## Commands

### Instances

```bash
# List instances
omni instances list
omni instances list --channel whatsapp-baileys
omni instances list --status active
omni instances list --format json

# Get instance details
omni instances get <id>
omni instances get my-whatsapp --format json

# Create instance
omni instances create \
  --name my-whatsapp \
  --channel whatsapp-baileys \
  --agent-url https://my-agent.example.com/api \
  --agent-timeout 60

# Update instance
omni instances update <id> --agent-timeout 90

# Delete instance
omni instances delete <id>
omni instances delete <id> --force  # Skip confirmation

# Get status
omni instances status <id>

# Get QR code
omni instances qr <id>
omni instances qr <id> --terminal  # Display in terminal
omni instances qr <id> --save qr.png

# Restart
omni instances restart <id>

# Logout
omni instances logout <id>
```

### Messages

```bash
# Send text message
omni send <instance> <to> "Hello from CLI!"
omni send my-whatsapp +1234567890 "Hello!"

# Send with reply
omni send my-whatsapp +1234567890 "Replying to you" --reply-to <message-id>

# Send media
omni send my-whatsapp +1234567890 --image ./photo.jpg
omni send my-whatsapp +1234567890 --image ./photo.jpg --caption "Check this out"
omni send my-whatsapp +1234567890 --document ./report.pdf
omni send my-whatsapp +1234567890 --audio ./voice.ogg --voice-note

# Send from URL
omni send my-whatsapp +1234567890 --image-url https://example.com/image.jpg

# Send reaction
omni react my-whatsapp +1234567890 <message-id> 👍
```

### Events

```bash
# List events
omni events list
omni events list --channel whatsapp-baileys,discord
omni events list --since 2025-01-01
omni events list --until 2025-01-31
omni events list --content-type text,audio
omni events list --person <person-id>
omni events list --instance <instance-id>
omni events list --limit 100

# Get event
omni events get <id>

# Search events
omni events search "meeting tomorrow"
omni events search "meeting" --person <person-id>

# Timeline for a person (cross-channel)
omni events timeline <person-id>
omni events timeline <person-id> --channels whatsapp-baileys,discord
omni events timeline <person-id> --since 2025-01-01 --limit 50

# Export events
omni events export --since 2025-01-01 --format jsonl > events.jsonl
```

### Persons (Identity)

```bash
# Search persons
omni persons search "John"
omni persons search "+1234"  # By phone

# Get person
omni persons get <id>

# Get presence
omni persons presence <id>

# Get timeline
omni persons timeline <id>
omni persons timeline <id> --channels whatsapp-baileys,discord

# Link identities
omni persons link <identity-a> <identity-b>

# Unlink identity
omni persons unlink <identity-id> --reason "Wrong person"
```

### Access Rules

```bash
# List rules
omni access list
omni access list --instance <id>
omni access list --type deny

# Create rule
omni access create deny \
  --instance my-whatsapp \
  --phone-pattern "+1555*" \
  --message "Not allowed"

omni access create allow \
  --instance my-whatsapp \
  --person <person-id>

# Delete rule
omni access delete <rule-id>

# Check access
omni access check my-whatsapp +15551234567
```

### Settings

```bash
# List settings
omni settings list

# Get setting
omni settings get GROQ_API_KEY

# Set setting
omni settings set GROQ_API_KEY gsk_...

# Set multiple
omni settings set GROQ_API_KEY=gsk_... GEMINI_API_KEY=AIza...
```

### Channels

```bash
# List available channels
omni channels list

# Get channel info
omni channels info whatsapp-baileys
```

## LLM-Optimized Output

### JSON Format for Parsing

```bash
$ omni instances list --format json
{
  "items": [
    {
      "id": "abc123",
      "name": "my-whatsapp",
      "channel": "whatsapp-baileys",
      "status": "connected"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

### Minimal Format for Simple Extraction

```bash
# Just IDs
$ omni instances list --format minimal
abc123
def456
ghi789

# Use in scripts
$ for id in $(omni instances list --format minimal); do
    omni instances restart $id
  done
```

### Agent-Friendly Search Results

```bash
$ omni events search "meeting" --person abc123 --format agent

Found 3 events about "meeting":

[2025-01-15 10:30] (whatsapp) User: Can we schedule a meeting tomorrow?
[2025-01-15 10:31] (whatsapp) Assistant: Sure! How about 2pm?
[2025-01-15 14:00] (discord) User: Joining the meeting now

---
Context for LLM:
[2025-01-15T10:30:00Z] (whatsapp) User: Can we schedule a meeting tomorrow?
[2025-01-15T10:31:00Z] (whatsapp) Assistant: Sure! How about 2pm?
[2025-01-15T14:00:00Z] (discord) User: Joining the meeting now
```

## Interactive Mode

For complex operations:

```bash
$ omni interactive

omni> instances list
NAME          CHANNEL           STATUS
my-whatsapp   whatsapp-baileys  connected
my-discord    discord           connected

omni> send my-whatsapp +1234567890
Enter message (Ctrl+D to send):
Hello! This is a multi-line
message from the CLI.
^D
✓ Message sent (id: xyz789)

omni> exit
```

## Piping and Scripting

```bash
# Pipe events to jq
omni events list --format json | jq '.items[].textContent'

# Send to multiple recipients
cat numbers.txt | xargs -I {} omni send my-whatsapp {} "Broadcast message"

# Export and transform
omni events export --since 2025-01-01 --format jsonl | \
  jq -r 'select(.contentType == "text") | .textContent' > texts.txt

# Monitor instance status
watch -n 60 'omni instances status my-whatsapp --format json | jq .status'
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Authentication error |
| 4 | Resource not found |
| 5 | Validation error |
| 6 | Rate limited |
| 7 | Network error |

```bash
$ omni send invalid-instance +1234567890 "Hello"
Error: Instance not found: invalid-instance
$ echo $?
4
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OMNI_API_KEY` | API key for authentication |
| `OMNI_BASE_URL` | Base URL of Omni server |
| `OMNI_FORMAT` | Default output format |
| `OMNI_NO_COLOR` | Disable colored output |
| `OMNI_TIMEOUT` | Request timeout in ms |

## Shell Completion

```bash
# Bash
omni completion bash >> ~/.bashrc

# Zsh
omni completion zsh >> ~/.zshrc

# Fish
omni completion fish > ~/.config/fish/completions/omni.fish
```

## Examples for LLM Agents

### Get Context for a User

```bash
# Find the person
PERSON_ID=$(omni persons search "+1234567890" --format json | jq -r '.items[0].id')

# Get cross-channel timeline
omni events timeline $PERSON_ID --limit 20 --format agent
```

### Monitor and React

```bash
# Watch for new messages
omni events list --since "5 minutes ago" --instance my-whatsapp --format jsonl | \
  while read event; do
    CONTENT=$(echo $event | jq -r '.textContent')
    # Process with LLM...
  done
```

### Batch Operations

```bash
# Restart all disconnected instances
omni instances list --status disconnected --format json | \
  jq -r '.items[].id' | \
  xargs -I {} omni instances restart {}
```

## Configuration File

Located at `~/.omni/config.json`:

```json
{
  "apiKey": "sk-omni-...",
  "baseUrl": "https://api.example.com",
  "defaultFormat": "table",
  "timeout": 30000,
  "aliases": {
    "wa": "my-whatsapp",
    "dc": "my-discord"
  }
}
```

Use aliases:

```bash
omni send wa +1234567890 "Hello!"  # Expands to my-whatsapp
```
