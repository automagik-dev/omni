# Omni

> One API to send and receive messages across WhatsApp, Discord, and more.
> CLI-first. Event-driven. Built for AI agents.

## Channels

| Channel | Status | Notes |
|---------|--------|-------|
| WhatsApp (Baileys) | **Stable** | QR pairing, full messaging, media sync |
| Discord | **Stable** | Bots, embeds, polls, reactions |
| WhatsApp Cloud API | Planned | — |
| Telegram | Planned | — |
| Slack | Planned | — |

## Install

One command — interactive wizard handles the rest:

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
```

The wizard offers three modes:

| Mode | What it does |
|------|-------------|
| **CLI only** | Install the `omni` command to control a remote server |
| **Full server** | Clone repo + install deps + start services locally |
| **CLI + connect** | Install CLI and configure a remote server URL + API key |

### Non-interactive

```bash
# CLI only (no prompts)
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli

# CLI + connect to remote server
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli https://your-omni-server.com

# Full server (no prompts)
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server
```

## Quick Start

After install, your API key is printed in the startup banner. **Save it** — it's only shown once.

```bash
# Authenticate
omni auth login --api-key <your-key>

# Create a WhatsApp connection and scan QR
omni instances create --name "my-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch

# Send your first message
omni send --to "+5511999999999" --text "Hello from Omni!"

# Or create a Discord connection
omni instances create --name "my-discord" --channel discord
omni instances connect <id> --token "BOT_TOKEN"
```

### Manual Setup

If you prefer full control:

```bash
# Prerequisites: Bun (https://bun.sh), PM2 (bun add -g pm2)
git clone https://github.com/automagik-dev/omni.git
cd omni

# One-command setup: install deps, create .env, start services
make setup
```

The API runs at `http://localhost:8882` with Swagger docs at `/api/v2/docs`.

Check the API logs for your key:

```bash
make logs-api
```

#### Step-by-step

```bash
make install           # Install dependencies, create .env
# (Optional) Edit .env to customize ports or disable managed services
make dev-services      # Start PostgreSQL + NATS + API via PM2
make status            # Verify everything is running
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
omni instances connect <id> --token "BOT_TOKEN"    # Discord
omni instances sync <id> --type all --depth 30
omni instances contacts <id> --limit 50
omni instances groups <id>
omni instances status <id>
```

**Subcommands:** `list`, `get`, `create`, `delete`, `status`, `qr`, `pair`, `connect`, `disconnect`, `restart`, `logout`, `sync`, `syncs`, `update`, `contacts`, `groups`, `profile`

**Key flags:** `--name`, `--channel` (whatsapp-baileys|discord), `--base64`, `--watch`, `--phone`, `--token`, `--force-new-qr`, `--type` (profile|messages|contacts|groups|all), `--depth`, `--download-media`, `--status`, `--limit`, `--cursor`, `--guild`, `--agent-provider`, `--agent`

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

## Web Dashboard

```bash
make dev-ui              # Vite dev server on http://localhost:5173
```

For production, build and serve from the API:

```bash
make build-ui            # Builds to apps/ui/dist
make restart-api         # API auto-serves UI on :8882
```

In production, everything runs on a single port — the API serves the built UI as a SPA.

**Features:** Instances, Chats, Contacts, Persons, Events, Automations, Providers, Access Rules, Batch Jobs, Dead Letters, Settings, Logs

## API Keys & Security

### Primary key

On first boot, the API generates a primary API key and prints it in the startup banner. Save it — it's only shown once.

```bash
make logs-api            # Find your key in the startup output
```

### Creating scoped keys

```bash
# Full access key for an admin
omni keys create --name "admin" --scopes "*"

# Read-only agent
omni keys create --name "reader" --scopes "messages:read,chats:read,instances:read"

# Restricted to specific instances
omni keys create --name "wa-only" --scopes "messages:*" --instances "uuid1,uuid2"

# Rate-limited with expiry
omni keys create --name "temp" --scopes "messages:read" --rate-limit 60 --expires "2025-12-31"
```

### Scope system

Scopes follow the pattern `namespace:action`:

| Pattern | Meaning |
|---------|---------|
| `*` | Full access (all scopes) |
| `messages:*` | All message operations |
| `messages:read` | Read messages only |
| `instances:write` | Create/modify instances |
| `keys:read` | List/view API keys |

Available namespaces: `messages`, `chats`, `instances`, `persons`, `events`, `access`, `settings`, `providers`, `automations`, `webhooks`, `keys`, `logs`, `batch`

### Key lifecycle

```
create → use → update (scopes, rate-limit, instances) → revoke → delete
```

- **Active** keys authenticate requests via `x-api-key` header
- **Revoked** keys are immediately denied; revocation is recorded with reason
- **Expired** keys are automatically denied after their expiry date
- Deleted keys are permanently removed

## SDK

Auto-generated TypeScript SDK from the OpenAPI spec:

```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8882',
  apiKey: 'your-api-key',
});

// List instances
const instances = await omni.instances.list();

// Send a message
await omni.messages.send({
  instanceId: '...',
  to: '+5511999999999',
  text: 'Hello from SDK!',
});

// Manage keys
const key = await omni.keys.create({ name: 'agent', scopes: ['messages:*'] });
```

Regenerate after API changes:

```bash
make sdk-generate
```

## REST API

- **Base URL:** `http://localhost:8882/api/v2`
- **Docs:** `/api/v2/docs` (Swagger UI)
- **OpenAPI spec:** `/api/v2/openapi.json`
- **Auth:** `x-api-key` header (or `?api_key=` query param)
- **Health:** `/api/v2/health` (no auth required)

**Endpoints:** `/auth`, `/instances`, `/messages`, `/chats`, `/events`, `/persons`, `/access`, `/settings`, `/providers`, `/automations`, `/webhooks`, `/keys`, `/logs`, `/batch-jobs`, `/dead-letters`, `/media`, `/metrics`, `/event-ops`, `/payloads`

**Response format:**

```json
{ "data": { ... } }                           // Single object
{ "items": [...], "meta": { "total": 42 } }   // Lists
{ "error": { "code": "...", "message": "..." } } // Errors
```

## Configuration

### Environment variables

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

Set any `*_MANAGED=false` in `.env` if you run that service externally.

### Service control

| Service | PM2 Name | Default Port | Controlled By |
|---------|----------|-------------|---------------|
| PostgreSQL (pgserve) | `omni-pgserve` | 8432 | `PGSERVE_MANAGED=true` |
| NATS JetStream | `omni-nats` | 4222 | `NATS_MANAGED=true` |
| API Server | `omni-api` | 8882 | `API_MANAGED=true` |

```bash
make status            # View all services and URLs
make restart-api       # Restart API only
make restart-nats      # Restart NATS only
make restart-pgserve   # Restart PostgreSQL only
make logs-api          # Tail API logs
make logs              # Tail all logs
make stop              # Stop everything
```

## Development

### Quality checks

```bash
make check             # All checks: typecheck + lint + test
make typecheck         # TypeScript only
make lint              # Biome linter
make lint-fix          # Auto-fix lint issues
make test              # Run all tests
make test-api          # API tests only
make test-file F=path  # Specific test file
```

**Git hooks** (auto-installed via `bun install`):
- **Pre-commit:** `make lint` — blocks commits with lint errors
- **Pre-push:** `make typecheck` — blocks pushes with type errors

### Database

```bash
make db-push           # Push schema changes (development)
make db-studio         # Open Drizzle Studio (visual DB browser)
make db-reset          # Reset database (DESTRUCTIVE)
```

### Project structure

```
packages/
├── core/              # Events, identity, schemas (shared)
├── db/                # Database schema (Drizzle ORM)
├── api/               # HTTP API (Hono + tRPC + OpenAPI)
├── channel-sdk/       # Plugin SDK for channel developers
├── channel-whatsapp/  # WhatsApp (Baileys)
├── channel-discord/   # Discord
├── cli/               # LLM-optimized CLI
└── sdk/               # Auto-generated TypeScript SDK
apps/
└── ui/                # React dashboard (Vite + Tailwind)
```

Run `make help` to see all available commands.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| HTTP | Hono |
| Type-safe API | tRPC + OpenAPI |
| Database | PostgreSQL + Drizzle ORM |
| Event Bus | NATS JetStream |
| Validation | Zod |
| Frontend | React + Vite + Tailwind |
| Monorepo | Turborepo |
| Process Manager | PM2 |
| Linter | Biome |

## License

MIT License — see [LICENSE](./LICENSE) for details.
