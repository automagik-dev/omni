<p align="center">
  <picture>
    <img src=".github/assets/omni-header-2.png" alt="Omni — One API, Every Channel" width="800" />
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/version-2.0.0-8b5cf6?style=flat-square" alt="v2.0.0" />
  <img src="https://img.shields.io/badge/channels-3-25D366?style=flat-square" alt="Channels" />
  <img src="https://img.shields.io/badge/event%20bus-NATS%20JetStream-27AAE1?style=flat-square" alt="NATS" />
</p>

<p align="center"><strong>Universal event-driven omnichannel messaging platform</strong></p>
<p align="center">One API to send and receive messages across WhatsApp, Discord, Telegram, and more.<br/>CLI-first. Event-driven. Built for AI agents.</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#cli-command-reference">CLI</a> •
  <a href="#rest-api">API</a> •
  <a href="#sdks">SDKs</a> •
  <a href="#web-dashboard">Dashboard</a> •
  <a href="#development">Development</a>
</p>

---

Think of Omni as a deep-sea octopus. Each **channel** is a tentacle — WhatsApp, Discord, Telegram — reaching into a different messaging ecosystem. **Events** are the nerve impulses that flow through the organism: every message received, every reaction sent, every connection made pulses through NATS JetStream and can trigger automations, notify webhooks, or wake up AI agents. The **core** is the brain — identity resolution, event routing, and a unified API that lets you treat all channels as one.

## Why Omni?

- **One API, every channel** — Send a WhatsApp message, a Discord embed, and a Telegram photo with the same endpoint
- **Event-driven by default** — Every action produces an event. Subscribe, replay, automate
- **Identity graph** — Same person on WhatsApp and Discord? Omni knows. Cross-channel person resolution
- **AI-native** — Agent providers, event-driven automations, built to be controlled by LLMs
- **Plugin architecture** — Build new channel integrations with the Channel SDK
- **CLI-first** — 20+ command groups, designed for both humans and AI agents
- **Multi-SDK** — Auto-generated TypeScript, Python, and Go SDKs from OpenAPI
- **Web Dashboard** — React UI for visual management of everything

## Channels

| Channel | Status | Features |
|---------|--------|----------|
| **WhatsApp** (Baileys) | ✅ Stable | QR/phone pairing, text, media, stickers, contacts, location, polls, reactions, typing, read receipts, reply, edit, delete, forward |
| **Discord** | ✅ Stable | Bots, text, media, embeds, polls, buttons, select menus, modals, reactions, stickers, slash commands, threads, DMs, guilds, webhooks |
| **Telegram** | ✅ New | Bot API (grammy), text, photos, audio, video, documents, stickers, contacts, location, polls, reactions, inline keyboards, bot commands, groups, channels, threads, typing, reply, edit, delete, forward |
| WhatsApp Cloud API | 🔮 Planned | — |
| Slack | 🔮 Planned | — |

## Install

One command — interactive wizard handles the rest:

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
```

| Mode | What it does |
|------|-------------|
| **CLI only** | Install the `omni` binary to control a remote server |
| **Full server** | Clone repo, install deps, start PostgreSQL + NATS + API |
| **CLI + connect** | Install CLI and configure remote server URL + API key |

### Non-interactive

```bash
# CLI only
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli

# CLI + connect to remote
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli https://your-omni-server.com

# Full server
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server
```

### Manual Setup

```bash
# Prerequisites: Bun (https://bun.sh), PM2 (bun add -g pm2)
git clone https://github.com/automagik-dev/omni.git
cd omni
make setup    # Install deps, create .env, start services
```

The API runs at `http://localhost:8882` with Swagger docs at `/api/v2/docs`.

Your primary API key is printed in the startup banner — save it.

```bash
make logs-api   # Find your key in startup output
```

## Quick Start

```bash
# Authenticate
omni auth login --api-key <your-key>

# WhatsApp — create instance and scan QR
omni instances create --name "my-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch

# Discord — connect a bot
omni instances create --name "my-discord" --channel discord
omni instances connect <id> --token "BOT_TOKEN"

# Telegram — connect a bot
omni instances create --name "my-telegram" --channel telegram
omni instances connect <id> --token "BOT_TOKEN"

# Send messages across any channel
omni send --to "+5511999999999" --text "Hello from the deep 🐙"
omni send --to "discord-channel-id" --embed --title "Alert" --description "Tentacle deployed"

# Browse conversations
omni chats list --unread --sort unread
omni chats messages <chatId> --limit 20 --rich
```

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  WhatsApp   │  │   Discord   │  │  Telegram   │  ← Tentacles (Channel Plugins)
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
              ┌─────────▼─────────┐
              │    NATS JetStream  │  ← Nerve System (Event Bus)
              └─────────┬─────────┘
                        │
              ┌─────────▼─────────┐
              │     Omni Core     │  ← Brain (Identity, Routing, Schemas)
              └─────────┬─────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
   ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
   │  REST API  │ │    CLI    │ │ Dashboard  │  ← Interfaces
   │ (Hono+tRPC)│ │ (omni)   │ │ (React)    │
   └───────────┘ └───────────┘ └───────────┘
```

## Project Structure

```
omni/
├── packages/
│   ├── core/               # Events, identity, schemas (shared foundation)
│   ├── db/                 # Database schema (Drizzle ORM + PostgreSQL)
│   ├── api/                # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/        # Plugin SDK for building channel integrations
│   ├── channel-whatsapp/   # WhatsApp plugin (Baileys)
│   ├── channel-discord/    # Discord plugin (discord.js)
│   ├── channel-telegram/   # Telegram plugin (grammy)
│   ├── cli/                # CLI (`omni` command)
│   ├── media-processing/   # Media handling and sync
│   ├── sdk/                # Auto-generated TypeScript SDK
│   ├── sdk-go/             # Auto-generated Go SDK
│   └── sdk-python/         # Auto-generated Python SDK
├── apps/
│   └── ui/                 # React dashboard (Vite + Tailwind)
└── scripts/                # Build, deploy, SDK generation
```

## CLI Command Reference

### Core

#### `send` — Send messages

```bash
omni send --to "+5511999999999" --text "Hello!"
omni send --to "+5511999999999" --media ./photo.jpg --caption "Check this out"
omni send --to "+5511999999999" --reaction "👍" --message <messageId>
omni send --to "+5511999999999" --sticker ./sticker.webp
omni send --to "+5511999999999" --contact --name "John" --phone "+1234567890"
omni send --to "+5511999999999" --location --lat -23.55 --lng -46.63 --address "São Paulo"
omni send --to "discord-channel-id" --poll "Favorite color?" --options "Red,Blue,Green"
omni send --to "discord-channel-id" --embed --title "Alert" --description "Server rebooting" --color "#ff0000"
omni send --to "+5511999999999" --presence typing
```

**Flags:** `--to`, `--text`, `--media`, `--caption`, `--voice`, `--reaction`, `--message`, `--sticker`, `--contact`, `--name`, `--phone`, `--email`, `--location`, `--lat`, `--lng`, `--address`, `--poll`, `--options`, `--multi-select`, `--duration`, `--embed`, `--title`, `--description`, `--color`, `--url`, `--presence` (typing|recording|paused), `--reply-to`

#### `chats` — Manage conversations

```bash
omni chats list --unread --sort unread
omni chats messages <chatId> --limit 20 --rich
omni chats archive <chatId>
omni chats participants <chatId> --add "+5511999999999"
omni chats read <chatId>
```

**Subcommands:** `list`, `get`, `create`, `update`, `delete`, `archive`, `unarchive`, `messages`, `participants`, `read`

**Key flags:** `--instance`, `--channel`, `--search`, `--archived`, `--unread`, `--sort`, `--limit`, `--before`, `--after`, `--rich`, `--media-only`, `--add`, `--remove`, `--role`

#### `messages` — Search and manage messages

```bash
omni messages search "meeting tomorrow" --instance <id> --limit 10
omni messages read --chat <chatId> --instance <id>
omni messages read --batch --ids "id1,id2,id3"
```

**Subcommands:** `search`, `read`

**Key flags:** `--instance`, `--chat`, `--since`, `--type`, `--limit`, `--batch`, `--ids`

#### `instances` — Channel connections

```bash
omni instances list
omni instances create --name "work-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch
omni instances pair <id> --phone "+5511999999999"
omni instances connect <id> --token "BOT_TOKEN"    # Discord / Telegram
omni instances sync <id> --type all --depth 30
omni instances contacts <id> --limit 50
omni instances groups <id>
omni instances status <id>
```

**Subcommands:** `list`, `get`, `create`, `delete`, `status`, `qr`, `pair`, `connect`, `disconnect`, `restart`, `logout`, `sync`, `syncs`, `update`, `contacts`, `groups`, `profile`

**Key flags:** `--name`, `--channel` (whatsapp-baileys|discord|telegram), `--base64`, `--watch`, `--phone`, `--token`, `--force-new-qr`, `--type` (profile|messages|contacts|groups|all), `--depth`, `--download-media`, `--status`, `--limit`, `--cursor`, `--guild`, `--agent-provider`, `--agent`

#### `channels` — Channel setup

```bash
omni channels list
omni channels status
```

**Subcommands:** `list`, `status`

#### `persons` — Contact directory

```bash
omni persons search "John"
omni persons get <id>
omni persons presence <id>
```

**Subcommands:** `search`, `get`, `presence`

### Management

#### `keys` — API key management

```bash
omni keys create --name "agent-key" --scopes "messages:*,instances:read"
omni keys create --name "scoped" --scopes "messages:read" --instances "uuid1,uuid2" --rate-limit 100
omni keys list --status active
omni keys revoke <id> --reason "Compromised"
omni keys delete <id>
```

**Subcommands:** `create`, `list`, `get`, `update`, `revoke`, `delete`

**Key flags:** `--name`, `--scopes`, `--instances`, `--description`, `--rate-limit`, `--expires`, `--status`, `--reason`

#### `providers` — AI/LLM providers

```bash
omni providers create --name "openai" --schema openai --api-key "sk-..."
omni providers list
omni providers test <id>
omni providers agents <id>       # List agents (Agno)
omni providers teams <id>        # List teams (Agno)
```

**Subcommands:** `list`, `get`, `create`, `test`, `agents`, `teams`, `workflows`, `delete`

**Key flags:** `--name`, `--schema` (agnoos|a2a|openai|anthropic|custom), `--base-url`, `--api-key`, `--description`, `--timeout`, `--stream`, `--active`, `--force`

#### `automations` — Event-driven workflows

```bash
omni automations create --name "Auto-reply" --trigger "message.received" \
  --action send_message --action-config '{"text":"Got it!"}'
omni automations list --enabled
omni automations test <id> --event '{"type":"message.received","payload":{...}}'
omni automations enable <id>
omni automations disable <id>
omni automations logs <id>
```

**Subcommands:** `list`, `get`, `create`, `update`, `delete`, `enable`, `disable`, `test`, `execute`, `logs`

**Actions:** `webhook`, `send_message`, `emit_event`, `log`, `call_agent`

**Key flags:** `--name`, `--trigger`, `--action`, `--action-config`, `--condition`, `--condition-logic`, `--priority`, `--disabled`, `--agent-id`, `--provider-id`, `--response-as`

#### `access` — Access control rules

```bash
omni access create --type deny --instance <id> --phone "+1234567890" --action block --reason "Spam"
omni access list --instance <id>
omni access check --instance <id> --user "+1234567890"
omni access delete <id>
```

**Subcommands:** `list`, `create`, `delete`, `check`

**Key flags:** `--type` (allow|deny), `--instance`, `--phone`, `--user`, `--priority`, `--action` (block|silent_block|allow), `--reason`, `--message`, `--channel`

Access control supports three modes: `disabled` (open), `blocklist` (deny-listed users blocked), and `allowlist` (only approved users allowed).

#### `webhooks` — External event sources

```bash
omni webhooks create --name "github-events" --description "GitHub webhook receiver"
omni webhooks list
omni webhooks trigger --type "custom.event" --payload '{"key":"value"}'
```

**Subcommands:** `list`, `get`, `create`, `update`, `delete`, `trigger`

**Key flags:** `--name`, `--description`, `--headers`, `--enable`, `--disable`, `--type`, `--payload`, `--instance`, `--correlation-id`

### System

#### `status` — Health check

```bash
omni status
```

Shows config directory, API URL, auth status, default instance, API health, and auth validation.

#### `auth` — Authentication

```bash
omni auth login --api-key <key> --api-url http://localhost:8882
omni auth status
omni auth logout
```

#### `config` — CLI settings

```bash
omni config list
omni config set defaultInstance <id>
omni config set format json
omni config set apiUrl http://your-server:8882
```

**Keys:** `apiUrl`, `apiKey`, `defaultInstance`, `format`

#### `events` — Event history and replay

```bash
omni events list --instance <id> --type "message.*" --since 2h --limit 50
omni events search "error" --since 24h
omni events timeline <personId>
omni events metrics
omni events replay --start --since 2024-01-01 --types "message.*" --speed 10
omni events replay --status <sessionId>
omni events replay --cancel <sessionId>
```

**Subcommands:** `list`, `search`, `timeline`, `metrics`, `replay`

**Key flags:** `--instance`, `--channel`, `--type`, `--since`, `--until`, `--limit`, `--start`, `--types`, `--speed`, `--dry-run`, `--status`, `--cancel`

#### `settings` — Server settings

```bash
omni settings list --category general
omni settings get <key>
```

#### `batch` — Media processing jobs

```bash
omni batch estimate --instance <id> --type targeted_chat_sync --chat <chatId>
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId> --content-types "image,video"
omni batch create --instance <id> --type time_based_batch --days 7
omni batch status <jobId> --watch
omni batch cancel <jobId>
omni batch list --status running
```

**Subcommands:** `list`, `create`, `status`, `cancel`, `estimate`

**Key flags:** `--instance`, `--type` (targeted_chat_sync|time_based_batch), `--chat`, `--days`, `--limit`, `--content-types` (audio|image|video|document), `--force`, `--watch`, `--interval`, `--status`

#### `resync` — History backfill

```bash
omni resync --instance <id>
```

Triggers a history backfill for the specified instance.

#### `logs` — Server logs

```bash
omni logs list --level error --limit 50
```

#### `dead-letters` — Failed event inspection

```bash
omni dead-letters list --limit 20
```

## REST API

| | |
|---|---|
| **Base URL** | `http://localhost:8882/api/v2` |
| **Docs** | `/api/v2/docs` (Swagger UI) |
| **OpenAPI spec** | `/api/v2/openapi.json` |
| **Auth** | `x-api-key` header or `?api_key=` query param |
| **Health** | `/api/v2/health` (no auth required) |

### Endpoints

`/auth` · `/instances` · `/messages` · `/chats` · `/events` · `/persons` · `/access` · `/settings` · `/providers` · `/automations` · `/webhooks` · `/keys` · `/logs` · `/batch-jobs` · `/dead-letters` · `/media` · `/metrics` · `/event-ops` · `/payloads`

### Response Format

```json
{ "data": { ... } }                                  // Single object
{ "items": [...], "meta": { "total": 42 } }          // Lists
{ "error": { "code": "...", "message": "..." } }      // Errors
```

## SDKs

### TypeScript

```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8882',
  apiKey: 'your-api-key',
});

const instances = await omni.instances.list();

await omni.messages.send({
  instanceId: '...',
  to: '+5511999999999',
  text: 'Hello from SDK!',
});
```

### Python

```python
from omni import OmniClient

client = OmniClient(base_url="http://localhost:8882", api_key="your-api-key")
instances = client.instances.list()
```

### Go

```go
client := omni.NewClient("http://localhost:8882", "your-api-key")
instances, _ := client.Instances.List(ctx)
```

Regenerate SDKs after API changes:

```bash
make sdk-generate
```

## Web Dashboard

```bash
make dev-ui    # Vite dev server → http://localhost:5173
```

For production, the API serves the built UI on a single port:

```bash
make build-ui      # Build to apps/ui/dist
make restart-api   # API serves UI on :8882
```

**Pages:** Dashboard · Instances · Instance Detail · Chats · Chat View · People · Contacts · Providers · Automations · Batch Jobs · Access Rules · Dead Letters · Events · Logs · Voices · Settings

## API Keys & Security

### Primary Key

Generated on first boot and printed in the startup banner. It's only shown once.

### Scoped Keys

```bash
# Full access
omni keys create --name "admin" --scopes "*"

# Read-only agent
omni keys create --name "reader" --scopes "messages:read,chats:read,instances:read"

# Instance-restricted
omni keys create --name "wa-only" --scopes "messages:*" --instances "uuid1,uuid2"

# Rate-limited with expiry
omni keys create --name "temp" --scopes "messages:read" --rate-limit 60 --expires "2025-12-31"
```

### Scope System

Pattern: `namespace:action`

| Pattern | Meaning |
|---------|---------|
| `*` | Full access |
| `messages:*` | All message operations |
| `messages:read` | Read messages only |
| `instances:write` | Create/modify instances |

**Namespaces:** `messages`, `chats`, `instances`, `persons`, `events`, `access`, `settings`, `providers`, `automations`, `webhooks`, `keys`, `logs`, `batch`

**Lifecycle:** create → use → update → revoke → delete

## Configuration

### Environment Variables

Copy `.env.example` to `.env` (done automatically by `make install`).

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8882` | API server port |
| `API_HOST` | `0.0.0.0` | API bind address |
| `API_MANAGED` | `true` | PM2 manages the API |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:8432/omni` | PostgreSQL connection |
| `PGSERVE_MANAGED` | `true` | PM2 manages pgserve |
| `PGSERVE_PORT` | `8432` | PostgreSQL port |
| `NATS_URL` | `nats://localhost:4222` | NATS connection |
| `NATS_MANAGED` | `true` | PM2 manages NATS |
| `NATS_PORT` | `4222` | NATS port |
| `OMNI_API_KEY` | *(auto-generated)* | Override primary API key |

Set `*_MANAGED=false` to use externally managed services.

### Service Control

| Service | PM2 Name | Default Port |
|---------|----------|-------------|
| PostgreSQL | `omni-pgserve` | 8432 |
| NATS JetStream | `omni-nats` | 4222 |
| API Server | `omni-api` | 8882 |

```bash
make status            # View all services
make restart-api       # Restart API
make restart-nats      # Restart NATS
make restart-pgserve   # Restart PostgreSQL
make logs-api          # Tail API logs
make logs              # Tail all logs
make stop              # Stop everything
```

## Development

### Prerequisites

- [Bun](https://bun.sh) (runtime — **not** Node.js)
- [PM2](https://pm2.keymetrics.io/) (`bun add -g pm2`)

### Commands

```bash
make dev               # Start all services + API
make dev-api           # Start just the API
make dev-services      # Start PostgreSQL + NATS + API via PM2
make check             # All checks: typecheck + lint + test
make typecheck         # TypeScript only
make lint              # Biome linter
make lint-fix          # Auto-fix lint issues
make test              # All tests
make test-api          # API tests only
make test-file F=path  # Specific test file
```

### Database

```bash
make db-push           # Push schema changes (dev)
make db-studio         # Open Drizzle Studio
make db-reset          # Reset database (DESTRUCTIVE)
```

### Building a Channel Plugin

Use the Channel SDK to add new tentacles:

```typescript
import { BaseChannelPlugin } from '@omni/channel-sdk';

export class MyPlugin extends BaseChannelPlugin {
  readonly id = 'my-channel';
  readonly name = 'My Channel';
  readonly version = '1.0.0';
  readonly capabilities = { /* ... */ };

  async connect(instanceId: string, config: InstanceConfig) { /* ... */ }
  async disconnect(instanceId: string) { /* ... */ }
  async sendMessage(instanceId: string, message: OutgoingMessage) { /* ... */ }
}
```

**Git hooks** (auto-installed):
- **Pre-commit:** `make lint` — blocks commits with lint errors
- **Pre-push:** `make typecheck` — blocks pushes with type errors

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Bun](https://bun.sh) |
| HTTP Framework | [Hono](https://hono.dev) |
| Type-safe API | [tRPC](https://trpc.io) + OpenAPI |
| Database | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team) |
| Event Bus | [NATS JetStream](https://nats.io) |
| Validation | [Zod](https://zod.dev) |
| Frontend | React + [Vite](https://vitejs.dev) + Tailwind CSS |
| Monorepo | [Turborepo](https://turbo.build) |
| Process Manager | [PM2](https://pm2.keymetrics.io) |
| Linter | [Biome](https://biomejs.dev) |

## License

[MIT](./LICENSE) — do whatever you want, just don't blame the octopus. 🐙
