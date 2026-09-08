---
title: "CLI Design"
created: 2025-01-29
updated: 2026-09-08
tags: [cli, reference]
status: current
---

# CLI Design

> The Omni CLI is designed to be LLM-friendly — structured output, clear commands, and predictable behavior for AI agents.

> Related: [[endpoints|API Endpoints]], [[overview|Architecture Overview]]

## Installation

```bash
# End users: install globally with Bun
bun add -g @automagik/omni

# Repo development: build and link from source (symlinks into ~/.bun/bin)
make cli-link
```

## Configuration

```bash
# Set API key (stored in ~/.omni/config.json)
omni config set apiKey sk-omni-...

# Set API URL (the key is apiUrl, default http://localhost:8882)
omni config set apiUrl https://api.example.com

# Set default instance
omni config set defaultInstance <instance-id>

# View config
omni config list

# Environment variables (take precedence)
export OMNI_API_KEY=sk-omni-...
export OMNI_FORMAT=json
```

Valid config keys: `apiUrl`, `apiKey`, `defaultInstance`, `format` (`human`|`json`),
`showCommands`, `telemetry`, `updateChannel` (`latest`|`next`), and the local-runtime
namespace `server.port`, `server.databaseUrl`, `server.dataDir`, `server.logLevel`,
`server.nodeEnv`. There is no `baseUrl` key and no `OMNI_BASE_URL` variable.

### Multiple servers

The CLI keeps a named registry of Omni servers (managed only via `omni server`,
never `omni config set`):

```bash
omni server add prod https://api.example.com --api-key sk-omni-...
omni server list                # List registered servers
omni server use prod            # Switch the active server
omni server current             # Show the active server
omni server remove prod

# One-off: target a named server for a single command
omni instances list --server prod
```

## Command Structure

Commands have a visibility **category** (`core`, `standard`, `advanced`, `debug`)
and a help **group** (Core, Management, System). Grouped help shows everything
except `debug` commands; `omni --all` reveals those too.

### Core — messaging & conversation context

| Command | Description |
|---------|-------------|
| `send` | Send message (text, media, location, poll, embed, reaction, presence) |
| `say` | Send text to the open chat (verb command) |
| `react` | React to a message with an emoji (verb command) |
| `listen` | Transcribe audio to text (verb command) |
| `imagine` | Generate an image from a prompt (Gemini, verb command) |
| `film` | Generate a video from a prompt (Gemini Veo, verb command) |
| `music` | Generate music/audio from a prompt (Gemini Lyria, verb command) |
| `speak` | Synthesize text to speech and send as a voice note (verb command) |
| `see` | Describe an image or video via Gemini Vision (verb command) |
| `history` | Show recent messages in the open chat (verb command) |
| `open` / `close` | Set / clear the active chat context for verb commands |
| `use` | Set the active instance for verb commands |
| `where` | Show current context (instance, chat) |
| `done` | Close turn (send final message + emit `turn.done`) |
| `chats` | List and manage conversations |
| `messages` | Message actions (get, search, read, edit, delete, star/unstar) |
| `tts` | Text-to-speech operations |
| `voice` | Voice channel operations (join, stream, sessions) |
| `a2a` | A2A agent registry and JSON-RPC helpers |
| `schedule` | Schedule messages for later delivery |
| `media` | Browse and download media items |

### Management — configuration and setup

| Command | Description |
|---------|-------------|
| `channels` | Channel types, add instances, status overview |
| `instances` | Channel connections (WhatsApp, Discord, Slack, …) |
| `persons` | Contact directory |
| `agents` | AI agent entity management (incl. event manifests) |
| `providers` | AI/LLM provider configuration |
| `automations` | Event-driven workflows |
| `follow-up` | Idle-chat follow-up config (agents/instances/chats) |
| `slack` | Slack-only: open a DM by user id, search messages |
| `connect` | Connect an instance to a genie agent via NATS |
| `setup` | Compound setup (agent → provider → instance, any schema) |
| `routes` | Agent routing configuration |
| `keys` | API key management |
| `tenants` | Platform tenant control plane (multitenancy) |
| `trust` | Genie host fingerprint trust |
| `access` | Access control and permissions |
| `webhooks` | External event sources (webhook ingress) |
| `turns` | Admin turn management (list, close, stats) |

### System — status, runtime, and observability

| Command | Description |
|---------|-------------|
| `status` | API health and connection info |
| `config` | CLI settings (default instance, format) |
| `auth` | Authentication management |
| `events` | Event store: query, tail, trace, durable consumers |
| `server` | Registry of Omni servers to talk to (add, use, list) |
| `multitenancy` | Server multitenancy posture (read-only) |
| `settings` | Server settings |
| `batch` | Batch operations |
| `start` / `stop` / `restart` | Manage local Omni services (API + NATS) |
| `install` | Interactive setup wizard (bootstrap an Omni server) |
| `update` | Update the CLI to the latest version |
| `doctor` | Diagnose and repair the embedded omni runtime |
| `requirements` | Show declared peer-version requirements (pgserve, genie) |
| `prompts` | Manage LLM prompt overrides |
| `resync` | Trigger history backfill for instances |
| `replay` | Replay missed messages for an agent instance |
| `journey` | Message journey tracing & latency |

### Debug (shown with `omni --all`)

| Command | Description |
|---------|-------------|
| `logs` | System log viewer |
| `dead-letters` | Failed event management |
| `payloads` | Event payload inspection |
| `completions` | Shell completions |

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

## Schedule

Schedule messages for later delivery. `<chat>` is the platform chat id. Delivery
is native when the channel supports it (Slack `chat.scheduleMessage`, text-only);
otherwise a local sweeper (15s tick) sends it. Only messages scheduled through
Omni are listed.

```bash
omni schedule send <instance> <chat> "Reminder" --at 2026-09-09T14:00:00Z
omni schedule send <instance> <chat> "Soon" --at 30m          # 30m/2h/3d shorthand
omni schedule send <instance> <chat> "Hi" --at 2h --thread <ts>
omni schedule send <instance> <chat> "All" --at 1d --broadcast
omni schedule list <instance>              # List scheduled messages
omni schedule get <id>                     # Get one
omni schedule cancel <id>                  # Cancel before delivery
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
omni persons search "Example User"               # Search by name
omni persons search "+5511"                # Search by phone
omni persons get <id>                      # Get person details
omni persons presence <id>                # Cross-channel presence
```

## Events

The event store surface: query, live tail, tracing, durable consumers, and a
JSON Schema registry for custom event types.

```bash
# Query
omni events list                           # List recent events
omni events list --instance <id> --channel whatsapp
omni events list --type "message.*"        # Trailing-* prefix glob
omni events list --type message.received,message.sent  # Comma list
omni events list --since 2026-09-01 --until 2026-09-08 --limit 100
omni events get <id>                       # Get one event
omni events search "meeting"              # Search by content
omni events timeline <person-id>          # Cross-channel timeline
omni events metrics                       # Processing metrics
omni events analytics                     # Aggregated analytics

# Live tail (poll-based)
omni events stream --type "message.*"      # Live tail
omni events stream --ndjson --poll-ms 500  # NDJSON output, custom poll interval

# One-shot blocking wait (exits non-zero on timeout)
omni events wait --type message.received --filter instanceId=<id> --timeout 60

# Causation tracing: walks the causationId chain up to the root and
# breadth-first down, printed as an indented tree with corr= ids
omni events trace <id>

# Replay
omni events replay --start --since 2026-09-01 --types "message.received" --dry-run  # exact types only, no globs
omni events replay --status <id>           # Check a replay session
omni events replay --cancel <id>           # Cancel a replay session
```

### Durable consumers

Named, resumable cursors for tailing the event store. These are **Postgres
journal cursors** over `omni_events.journal_seq` — NOT NATS JetStream
consumers. Delivery is at-least-once, and each consumer name supports a single
follower (no consumer groups).

```bash
omni events consumers create my-bot --type "message.*" --filter instanceId=<id>
omni events consumers create audit --type "*" --from-beginning
omni events consumers ls                   # List consumers
omni events consumers inspect my-bot       # Cursor position, lag
omni events consumers rm my-bot            # Delete

# Durable tail through the consumer's stored cursor (acks as it goes)
omni events follow --consumer my-bot
omni events follow --consumer my-bot --no-ack      # Peek one page, no ack
omni events follow --consumer my-bot --until-idle  # Exit when caught up
```

### Schema registry

Register JSON Schemas for custom event types (validated at ingress when a
webhook source sets `--strict-schemas`).

```bash
omni events schema register custom.deploy --file ./deploy.schema.json --description "Deploy events"
omni events schema register custom.ping --schema '{"type":"object"}' --disabled
omni events schema list
omni events schema get custom.deploy
```

> [!note] Glob and emission caveats
> Type globs are trailing-`*` prefix only (`message.*`, not `*.received`), and
> are NOT supported in automation triggers or agent manifests. There is no
> `events emit` — manual emission goes through
> `omni webhooks trigger --type custom.x --payload '{...}'`.

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

`create`/`update` support `--transactional-emissions`: `emit_event` actions are
buffered and flushed in order only if the whole run succeeds. The `call_agent`
action also works chatless — an event can dispatch an agent without any chat
context.

## Agents

Agent entity CRUD plus event subscription manifests.

```bash
omni agents list|get|create|update|delete  # Entity management

# Event manifests (accepts/publishes), JSON or YAML
omni agents manifest get <agent-id>
omni agents manifest apply <agent-id> --file ./manifest.yaml

# Subscription graph: agent | consumes | produces | compiled
omni agents graph
omni agents graph --type message.received
```

Manifest semantics: `publishes` is enforced at emit time; `accepts` compiles
into managed automations.

## Providers

```bash
omni providers list                        # List AI providers
omni providers get <id>                    # Get details
omni providers create ...                 # Create provider
omni providers update <id> ...            # Update
omni providers delete <id>               # Delete
omni providers test <id>                 # Connectivity/health test
omni providers setup openclaw ...        # Guided OpenClaw setup wizard (the only wizard today)
omni providers agents <id>               # List provider agents
omni providers teams <id>                # List provider teams
omni providers workflows <id>            # List provider workflows
```

## Webhooks

External event sources: inbound webhooks land on the public unauthenticated
ingress endpoint `POST /api/v2/webhooks/ingress/:source` (signature required)
and become events on the bus.

```bash
omni webhooks list                         # List webhook sources
omni webhooks get <id>                     # Get details
omni webhooks delete <id>                 # Delete
omni webhooks trigger --type custom.x --payload '{...}'  # Manual event emission
omni webhooks heartbeat <source>          # Connector liveness ping

# Create with signature verification
omni webhooks create --name github \
  --signature-algorithm hmac-sha256 \
  --signature-header X-Hub-Signature-256 \
  --signature-prefix "sha256=" \
  --signature-secret-env GITHUB_WEBHOOK_SECRET

# Event type mapping: events are typed custom.<source>.<event>
omni webhooks create --name github --event-type-mapping '{"source":"header","header":"X-GitHub-Event"}'
omni webhooks create --name clickup --event-type-mapping '{"source":"body","path":"event"}'
omni webhooks create --name foo --event-type-mapping @mapping.json
```

Create flags:

| Flag | Purpose |
|------|---------|
| `--signature-algorithm` | `hmac-sha256` \| `hmac-sha1` \| `token-match` |
| `--signature-header` / `--signature-prefix` | Where/how the signature arrives |
| `--signature-secret` / `--signature-secret-env` / `--signature-secret-stdin` | Secret delivery options |
| `--idempotency-key-template` | Dedup key; placeholders `{source}`, `{sha256(body)}`, `{headers.<name>}`, `{payload.<dot.path>}` (numeric array indices OK); default `{source}:{sha256(body)}` |
| `--strict-schemas` | Reject payloads failing the registered JSON Schema |
| `--event-type-mapping <json\|@file>` | Derive event type from header or body path |
| `--expected-interval` | Connector liveness cadence; missed heartbeats emit `system.connector.stalled` / `.recovered` |

`update` adds the clearing flags `--clear-signature`, `--no-strict-schemas`,
`--clear-event-type-mapping`, `--clear-cadence`.

> Recipes: [[../runbooks/github-webhook-source|GitHub webhook source]],
> [[../runbooks/clickup-webhook-source|ClickUp webhook source]].

## Tenants

Platform tenant control plane. Requires a PLATFORM-class credential and
`OMNI_MULTITENANCY_ENABLED=true` on the server. All commands effectively
require `--reason` (3–500 chars, audited).

```bash
omni tenants list --reason "quarterly review"
omni tenants get <id> --reason "support case 123"
omni tenants create --slug acme --name "Acme" \
  --max-key-ttl 7776000 --max-key-rate 100 --max-key-budget 500 --reason "onboarding"  # TTL in seconds (90 days)
omni tenants suspend <id> --reason "billing hold"
omni tenants archive <id> --reason "offboarded"     # Terminal

omni tenants memberships list <tenant-id> --reason "..."
omni tenants memberships add|disable|status|role ...

# Plaintext key is printed exactly once. All of --principal, --membership,
# --role, --name, --scopes, --expires, --rate-limit, --budget are required,
# and the scopes/expiry must fit the role ceiling and tenant TTL policy.
omni tenants keys issue-root <tenant-id> \
  --principal <uuid> --membership <uuid> --role tenant-owner \
  --name root --scopes "tenant:*" --expires <iso-within-ttl> \
  --rate-limit 100 --budget 500 --reason "root key rotation"
```

```bash
# Read-only server tenancy posture (separate top-level command)
omni multitenancy status
```

## Slack

Slack-only helpers.

```bash
omni slack dm <instance> <userId>          # Resolve/open DM channel for a user (U…)
omni slack search <instance> <query>       # Search messages (requires user-token authMode)
```

## Journey

Message journey tracing with a T0–T11 latency breakdown.

```bash
omni journey show <correlationId>          # Timeline with timing bars
omni journey summary                       # Aggregated journey metrics
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
omni start / stop / restart               # Manage local services (API + NATS)
omni doctor                               # Diagnose/repair embedded runtime
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

# JSON (for parsing) — --json works with any command, in any position
omni instances list --json

# Use OMNI_FORMAT env var or `omni config set format json` for a default
export OMNI_FORMAT=json
```

## Global Options

```
Options:
  -V, --version     Show version
  --json            Output in JSON format (works with any command)
  --server <name>   Target a named server from the registry for this command
  --no-color        Disable colored output
  --all             Show all commands (including debug commands)
  -h, --help        Show help
```

There is no global `--api-url` / `--api-key` — targets come from the config
file, the server registry (`omni server`), or environment variables.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OMNI_API_KEY` | API key for authentication |
| `OMNI_FORMAT` | Default output format (`human` \| `json`) |
| `OMNI_INSTANCE` | Active instance for verb commands |
| `OMNI_CHAT` | Active chat for verb commands |
| `OMNI_CONFIG_DIR` | Config directory override (default `~/.omni`) |
| `OMNI_TELEMETRY` | Enable/disable error telemetry (`true` \| `false`) |

## Configuration File

Located at `~/.omni/config.json`:

```json
{
  "apiKey": "omni_sk_...",
  "apiUrl": "http://localhost:8882",
  "defaultInstance": "07a5178e-...",
  "format": "human"
}
```

Multi-server setups add a `servers` block (`active` pointer + named entries),
managed exclusively by `omni server` — never edit it via `omni config set`.
