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
  <a href="#ai-agents">AI Agents</a> •
  <a href="#cli-reference">CLI</a> •
  <a href="#rest-api">API</a> •
  <a href="#sdks">SDKs</a> •
  <a href="#development">Development</a>
</p>

---

Think of Omni as a deep-sea octopus. Each **channel** is a tentacle — WhatsApp, Discord, Telegram — reaching into a different messaging ecosystem. **Events** are nerve impulses flowing through NATS JetStream. The **core** is the brain — identity resolution, event routing, and a unified API that lets you treat all channels as one.

## Why Omni?

| | |
|---|---|
| 🔌 **One API, every channel** | Send a WhatsApp message, a Discord embed, and a Telegram photo with the same endpoint |
| ⚡ **Event-driven** | Every action produces an event. Subscribe, replay, automate |
| 🧬 **Identity graph** | Same person on WhatsApp and Discord? Omni knows |
| 🤖 **AI-native** | Agent providers, automations, built to be controlled by LLMs |
| 🔧 **Plugin architecture** | Build new channels with the Channel SDK |
| 📦 **Multi-SDK** | Auto-generated TypeScript, Python, and Go SDKs |

## Channels

| Channel | Status | Highlights |
|---------|--------|------------|
| **WhatsApp** (Baileys) | ✅ Stable | QR/phone pairing, media, reactions, groups, contacts, presence |
| **Discord** | ✅ Stable | Bots, embeds, polls, buttons, threads, slash commands |
| **Telegram** | ✅ New | Bot API, inline keyboards, groups, channels, threads, polls |
| WhatsApp Cloud API | 🔮 Planned | — |
| Slack | 🔮 Planned | — |

## Install

### Quickest (npm)

```bash
bun add -g @automagik/omni
omni install              # interactive wizard: sets up server + PM2
```

> **Migrating from `@omni/cli`?** Run `bun remove -g @omni/cli` first.

### Via install script (npm-first, git fallback)

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install-client.sh | bash
```

### Full server from source

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
```

Three modes: **CLI only** · **Full server** · **CLI + connect to remote**

<details>
<summary>Non-interactive & manual install</summary>

```bash
# CLI only (tries npm first, falls back to git clone)
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli

# CLI + connect to remote
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli https://your-omni-server.com

# Full server
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server
```

**Manual:**

```bash
git clone https://github.com/automagik-dev/omni.git && cd omni
make setup    # Install deps, create .env, start services
```

API runs at `http://localhost:8882` · Swagger docs at `/api/v2/docs` · API key printed in startup banner.

</details>

## Quick Start

```bash
# Authenticate
omni auth login --api-key <your-key>

# WhatsApp — scan QR
omni instances create --name "my-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch

# Discord — connect bot
omni instances create --name "my-discord" --channel discord
omni instances connect <id> --token "BOT_TOKEN"

# Telegram — connect bot
omni instances create --name "my-telegram" --channel telegram
omni instances connect <id> --token "BOT_TOKEN"

# Send messages
omni send --to "+5511999999999" --text "Hello from the deep 🐙"

# Browse conversations
omni chats list --unread --sort unread
```

## AI Agents

Connect any LLM provider and your instances become intelligent agents — responding to messages, reacting to events, across every channel.

```
Message received → NATS event → Agent Dispatcher → Provider (OpenAI/Agno/Webhook) → Humanized reply
```

```bash
# Connect a provider
omni providers create --name "my-llm" --schema openai --base-url "https://api.openai.com/v1" --api-key "sk-..."

# Bind to instance — it's now an agent
omni instances update <id> --agent-provider <provider-id>
```

| Trigger | When | Use Case |
|---------|------|----------|
| **DM** | Direct message | Always reply |
| **Mention** | @bot in group | Respond to mentions |
| **Reply** | Reply to bot's message | Continue thread |
| **Reaction** | Emoji on message | 👍 approve, 🔥 prioritize |

**Built-in:** message debouncing · per-user rate limits · access control · smart response chunking · typing presence · cross-channel identity · self-chat detection

<details>
<summary>Automations & event-driven workflows</summary>

```bash
# Auto-reply
omni automations create --name "welcome" \
  --trigger "message.received" \
  --action send_message --action-config '{"text":"Got it! 🐙"}'

# Webhook on connection
omni automations create --name "notify" \
  --trigger "instance.connected" \
  --action webhook --action-config '{"url":"https://your-app.com/hook"}'

# Route VIPs to a special agent
omni automations create --name "vip" \
  --trigger "message.received" \
  --condition '{"field":"payload.from","op":"in","value":["+551199..."]}' \
  --action call_agent --agent-id "vip-handler" --provider-id <id>
```

</details>

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  WhatsApp   │  │   Discord   │  │  Telegram   │     Tentacles
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┼────────────────┘
              ┌─────────▼─────────┐
              │   NATS JetStream  │                    Nerve System
              └─────────┬─────────┘
              ┌─────────▼─────────┐
              │     Omni Core     │                    Brain
              └─────────┬─────────┘
         ┌──────────────┼──────────────┐
   ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
   │  REST API  │ │    CLI    │ │ Dashboard  │        Interfaces
   └───────────┘ └───────────┘ └───────────┘
```

<details>
<summary>Project structure</summary>

```
packages/
├── core/               # Events, identity, schemas
├── db/                 # Drizzle ORM + PostgreSQL
├── api/                # Hono + tRPC + OpenAPI
├── channel-sdk/        # Plugin SDK
├── channel-whatsapp/   # Baileys
├── channel-discord/    # discord.js
├── channel-telegram/   # grammy
├── cli/                # `omni` command
├── media-processing/   # Media sync
├── sdk/                # TypeScript SDK
├── sdk-go/             # Go SDK
└── sdk-python/         # Python SDK
apps/
└── ui/                 # React + Vite + Tailwind
```

</details>

## CLI Reference

<details>
<summary><strong>Core commands</strong> — send, chats, messages, instances, channels, persons</summary>

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

#### `chats` — Manage conversations

```bash
omni chats list --unread --sort unread
omni chats messages <chatId> --limit 20 --rich
omni chats archive <chatId>
omni chats participants <chatId> --add "+5511999999999"
```

Subcommands: `list` · `get` · `create` · `update` · `delete` · `archive` · `unarchive` · `messages` · `participants` · `read`

#### `messages` — Search and manage

```bash
omni messages search "meeting tomorrow" --instance <id> --limit 10
omni messages read --chat <chatId> --instance <id>
```

#### `instances` — Channel connections

```bash
omni instances list
omni instances create --name "work-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch
omni instances connect <id> --token "BOT_TOKEN"    # Discord / Telegram
omni instances sync <id> --type all --depth 30
omni instances contacts <id> --limit 50
omni instances groups <id>
```

Subcommands: `list` · `get` · `create` · `delete` · `status` · `qr` · `pair` · `connect` · `disconnect` · `restart` · `logout` · `sync` · `syncs` · `update` · `contacts` · `groups` · `profile`

#### `persons` — Contact directory

```bash
omni persons search "John"
omni persons get <id>
omni persons presence <id>
```

</details>

<details>
<summary><strong>Management</strong> — keys, providers, automations, access, webhooks</summary>

#### `keys` — API key management

```bash
omni keys create --name "agent-key" --scopes "messages:*,instances:read"
omni keys list --status active
omni keys revoke <id> --reason "Compromised"
```

#### `providers` — AI/LLM providers

```bash
omni providers create --name "openai" --schema openai --api-key "sk-..."
omni providers list
omni providers test <id>
```

Schemas: `agnoos` · `a2a` · `openai` · `anthropic` · `webhook` · `custom`

#### `automations` — Event-driven workflows

```bash
omni automations create --name "Auto-reply" --trigger "message.received" \
  --action send_message --action-config '{"text":"Got it!"}'
omni automations list --enabled
omni automations test <id>
```

Actions: `webhook` · `send_message` · `emit_event` · `log` · `call_agent`

#### `access` — Access control

```bash
omni access create --type deny --instance <id> --phone "+1234567890" --action block
omni access list --instance <id>
omni access check --instance <id> --user "+1234567890"
```

Modes: `disabled` · `blocklist` · `allowlist`

#### `webhooks` — External event sources

```bash
omni webhooks create --name "github-events"
omni webhooks trigger --type "custom.event" --payload '{"key":"value"}'
```

</details>

<details>
<summary><strong>System</strong> — status, auth, config, events, batch, logs</summary>

```bash
omni status                                    # Health check
omni auth login --api-key <key>                # Authenticate
omni config set defaultInstance <id>           # CLI settings
omni events list --type "message.*" --since 2h # Event history
omni events replay --start --since 2024-01-01  # Replay events
omni batch create --instance <id> --type targeted_chat_sync --chat <chatId>
omni resync --instance <id>                    # History backfill
omni logs list --level error --limit 50        # Server logs
omni dead-letters list --limit 20              # Failed events
```

</details>

## REST API

| | |
|---|---|
| **Base URL** | `http://localhost:8882/api/v2` |
| **Docs** | [`/api/v2/docs`](http://localhost:8882/api/v2/docs) (Swagger UI) |
| **OpenAPI** | `/api/v2/openapi.json` |
| **Auth** | `x-api-key` header |

**20 endpoints:** `/auth` · `/instances` · `/messages` · `/chats` · `/events` · `/persons` · `/access` · `/settings` · `/providers` · `/automations` · `/webhooks` · `/keys` · `/logs` · `/batch-jobs` · `/dead-letters` · `/media` · `/metrics` · `/event-ops` · `/payloads`

## SDKs

<table>
<tr>
<td>

**TypeScript**
```typescript
import { createOmniClient } from '@omni/sdk';
const omni = createOmniClient({
  baseUrl: 'http://localhost:8882',
  apiKey: 'your-api-key',
});
await omni.messages.send({
  instanceId: '...',
  to: '+5511999999999',
  text: 'Hello from SDK!',
});
```

</td>
<td>

**Python**
```python
from omni import OmniClient
client = OmniClient(
  base_url="http://localhost:8882",
  api_key="your-api-key"
)
instances = client.instances.list()
```

**Go**
```go
client := omni.NewClient(
  "http://localhost:8882",
  "your-api-key",
)
instances, _ := client.Instances.List(ctx)
```

</td>
</tr>
</table>

Regenerate after API changes: `make sdk-generate`

## Web Dashboard

```bash
make dev-ui    # Dev → http://localhost:5173
make build-ui  # Prod → served by API on :8882
```

**Pages:** Dashboard · Instances · Chats · Chat View · Contacts · Persons · Providers · Automations · Access Rules · Batch Jobs · Dead Letters · Events · Logs · Settings

<details>
<summary>🔐 API Keys & Security</summary>

API key is generated on first boot (shown once in startup banner).

```bash
# Scoped keys
omni keys create --name "admin" --scopes "*"
omni keys create --name "reader" --scopes "messages:read,chats:read"
omni keys create --name "wa-only" --scopes "messages:*" --instances "uuid1,uuid2"
```

**Scopes:** `namespace:action` pattern — `messages:*`, `instances:read`, `*` for full access

**Namespaces:** `messages` · `chats` · `instances` · `persons` · `events` · `access` · `settings` · `providers` · `automations` · `webhooks` · `keys` · `logs` · `batch`

</details>

<details>
<summary>⚙️ Configuration & environment</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8882` | API server port |
| `DATABASE_URL` | `postgresql://...localhost:8432/omni` | PostgreSQL |
| `NATS_URL` | `nats://localhost:4222` | NATS connection |
| `OMNI_API_KEY` | *(auto)* | Override primary key |

Set `*_MANAGED=false` for external services. Full list in `.env.example`.

| Service | PM2 Name | Port |
|---------|----------|------|
| PostgreSQL | `omni-pgserve` | 8432 |
| NATS | `omni-nats` | 4222 |
| API | `omni-api` | 8882 |

</details>

## Development

```bash
make dev           # Start all services + API
make check         # typecheck + lint + test
make dev-ui        # UI dev server
make db-push       # Push schema changes
make db-studio     # Drizzle Studio
```

<details>
<summary>All make targets</summary>

```bash
make setup         # Full setup (deps + env + services)
make dev-api       # API only
make dev-services  # PostgreSQL + NATS via PM2
make typecheck     # TypeScript only
make lint          # Biome linter
make lint-fix      # Auto-fix
make test          # All tests
make test-api      # API tests
make test-file F=  # Specific test
make build         # Build all
make build-ui      # Build UI
make status        # Service status
make logs-api      # API logs
make restart-api   # Restart API
make db-reset      # Reset DB (DESTRUCTIVE)
make sdk-generate  # Regenerate SDKs
make cli ARGS=""   # Run CLI from source
make cli-link      # Install CLI globally
```

</details>

<details>
<summary>Building a channel plugin</summary>

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

</details>

## Tech Stack

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| HTTP | [Hono](https://hono.dev) |
| API | [tRPC](https://trpc.io) + OpenAPI |
| DB | PostgreSQL + [Drizzle](https://orm.drizzle.team) |
| Events | [NATS JetStream](https://nats.io) |
| Validation | [Zod](https://zod.dev) |
| Frontend | React + [Vite](https://vitejs.dev) + Tailwind |
| Monorepo | [Turborepo](https://turbo.build) |
| Linter | [Biome](https://biomejs.dev) |

---

<p align="center">
  <a href="LICENSE">MIT</a> — do whatever you want, just don't blame the octopus. 🐙
  <br/><br/>
  <sub>This README is maintained by <a href="docs/research/SQUAD.md">Scroll 📜</a>, an autonomous sub-agent of Omni.</sub>
</p>
