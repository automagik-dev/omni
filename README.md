<!-- ci: re-trigger @latest publish for v2.260624.4 (rolling promotion #730 rebased a [skip ci] head, skipping the main CI → version.yml @latest publish) -->
<p align="center">
  <picture>
    <img src=".github/assets/omni-header-2.png" alt="Omni — One API, Every Channel" width="800" />
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/version-2.260530.1-8b5cf6?style=flat-square" alt="v2.260530.1" />
  <img src="https://img.shields.io/badge/channels-9-25D366?style=flat-square" alt="9 channels" />
  <img src="https://img.shields.io/badge/event%20bus-NATS%20JetStream-27AAE1?style=flat-square" alt="NATS JetStream" />
</p>

<p align="center"><strong>Universal event-driven omnichannel messaging platform</strong></p>
<p align="center">One API to send, receive, route, and automate messages across WhatsApp, Discord, Slack, Telegram, and more.<br/>CLI-first. Event-driven. Built for AI agents.</p>

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

Think of Omni as a deep-sea octopus. Each **channel** is a tentacle reaching into a different messaging ecosystem. **Events** are nerve impulses flowing through NATS JetStream. The **core** is the brain: identity resolution, event routing, and a unified API that lets you treat every channel as one system.

## Why Omni?

| | |
|---|---|
| 🔌 **One API, every channel** | Send WhatsApp, Discord, Slack, Telegram, and other channel messages with one interface |
| ⚡ **Event-driven** | Every action produces an event. Subscribe, replay, automate |
| 🧬 **Identity graph** | Resolve the same person across channels and instances |
| 🤖 **AI-native** | Provider bindings, response gates, session strategies, automations, and agent dispatch |
| 🔧 **Plugin architecture** | Build channels and integrations with the Channel SDK |
| 📦 **SDKs** | TypeScript SDK, plus generated Python/Go clients for API consumers |

## Channels

| Channel | Status | Highlights |
|---------|--------|------------|
| **WhatsApp** (Baileys) | ✅ Stable | QR/phone pairing, media, reactions, groups, contacts, presence |
| **WhatsApp Cloud API** (Meta) | ✅ Available | Embedded Signup OAuth, templates HSM, webhook (HMAC-SHA256), media, location, reactions |
| **Discord** | ✅ Stable | Bots, embeds, polls, buttons, threads, slash commands |
| **Slack** | ✅ Available | Bot/App token support |
| **Telegram** | ✅ Available | Bot API, inline keyboards, groups, channels, threads, polls |
| **A2A** | ✅ Available | Agent-to-agent channel integrations |
| **Gupshup** | ✅ Available | Custom Integration webhook support |
| **H3rmes** (Mutant) | ✅ Available | Brazilian WhatsApp gateway — JWT auth, media, templates, interactive, Pix-ready webhook shapes |
| **Twilio WhatsApp** | ✅ Available | Twilio sender, webhook, and signature validation support |

## Install

### Global CLI package

```bash
bun add -g @automagik/omni
omni install              # bootstrap the local server/runtime with PM2
```

> **Migrating from `@omni/cli`?** Run `bun remove -g @omni/cli` first.

### Via install script

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash
```

### Full server from source

```bash
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server
```

Supported script modes: **CLI only** (`--cli`) and **Full server** (`--server`).

<details>
<summary>Non-interactive & manual install</summary>

```bash
# CLI only
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --cli

# Full server
curl -fsSL https://raw.githubusercontent.com/automagik-dev/omni/main/install.sh | bash -s -- --server

# Connect the CLI to a remote server after install
omni auth login --api-url https://your-omni-server.example.com --api-key <your-api-key>
```

**Manual:**

```bash
git clone https://github.com/automagik-dev/omni.git && cd omni
make setup    # install deps, create .env, start services
```

API runs at `http://localhost:8882` · Swagger docs at `/api/v2/docs` · API key is printed in the startup banner.

</details>

## Quick Start

```bash
# Authenticate
omni auth login --api-key <your-api-key>

# WhatsApp — scan QR
omni instances create --name "my-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch

# Discord — connect bot
omni instances create --name "my-discord" --channel discord --discord-token <discord-bot-token>
omni instances connect <id>

# Telegram — connect bot
omni instances create --name "my-telegram" --channel telegram --telegram-token <telegram-bot-token>
omni instances connect <id>

# Send messages
omni send --to "+15555550100" --text "Hello from the deep 🐙"

# Browse conversations
omni chats list --unread --sort unread
```

## AI Agents

Connect an agent provider and your instances can respond to messages, react to events, and route conversations across channels.

```text
Message received → NATS event → Agent Dispatcher → Provider → Response gate → Channel reply
```

```bash
# Create a provider
omni providers create \
  --name "my-agent" \
  --schema webhook \
  --base-url "https://agent.example.com/webhook" \
  --api-key <provider-api-key>

# Bind it to an instance
omni instances update <id> --agent-provider <provider-id>
```

Provider schemas: `agno` · `webhook` · `openclaw` · `ag-ui` · `claude-code` · `a2a` · `nats-genie`

| Trigger | When | Use Case |
|---------|------|----------|
| **DM** | Direct message | Always reply |
| **Mention** | @bot in group | Respond to mentions |
| **Reply** | Reply to bot's message | Continue thread |
| **Reaction** | Emoji on message | Approvals, priority, lightweight workflows |

**Built-in:** message debouncing · per-user rate limits · access control · response gates · smart chunking · typing presence · cross-channel identity · self-chat detection

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
  --action webhook --action-config '{"url":"https://your-app.example.com/hook"}'

# Route important senders to a dedicated agent
omni automations create --name "priority-route" \
  --trigger "message.received" \
  --condition '{"field":"payload.from","op":"in","value":["+15555550100"]}' \
  --action call_agent --agent-id "priority-handler" --provider-id <provider-id>
```

</details>

## Architecture

```text
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  WhatsApp   │  │   Discord   │  │    Slack    │  │  Telegram   │  Tentacles
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┴────────────────┴────────────────┘
                         ┌─────────▼─────────┐
                         │   NATS JetStream  │             Nerve system
                         └─────────┬─────────┘
                         ┌─────────▼─────────┐
                         │     Omni Core     │             Brain
                         └─────────┬─────────┘
              ┌────────────────────┼────────────────────┐
        ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
        │  REST API │        │    CLI    │        │ Dashboard │ Interfaces
        └───────────┘        └───────────┘        └───────────┘
```

<details>
<summary>Project structure</summary>

```text
packages/
├── core/                    # Events, identity, schemas
├── db/                      # Drizzle ORM + PostgreSQL
├── api/                     # Hono + tRPC + OpenAPI
├── channel-sdk/             # Plugin SDK
├── channel-whatsapp/        # WhatsApp Baileys
├── channel-discord/         # Discord
├── channel-slack/           # Slack
├── channel-telegram/        # Telegram
├── channel-gupshup/         # Gupshup
├── channel-twilio-whatsapp/ # Twilio WhatsApp
├── channel-a2a/             # A2A channel
├── cli/                     # `omni` command
├── media-processing/        # Media sync and extraction
├── sdk/                     # TypeScript SDK
├── sdk-go/                  # Go SDK
└── sdk-python/              # Python SDK
apps/
└── ui/                      # React + Vite + Tailwind dashboard
```

</details>

## CLI Reference

<details>
<summary><strong>Core commands</strong> — send, chats, messages, instances, persons</summary>

#### `send` — Send messages

```bash
omni send --to "+15555550100" --text "Hello!"
omni send --to "+15555550100" --media ./photo.jpg --caption "Check this out"
omni send --to "+15555550100" --reaction "👍" --message <message-id>
omni send --to "+15555550100" --sticker ./sticker.webp
omni send --to "+15555550100" --contact --name "Example User" --phone "+15555550101"
omni send --to "+15555550100" --location --lat 37.7749 --lng -122.4194 --address "San Francisco"
omni send --to "discord-channel-id" --poll "Favorite color?" --options "Red,Blue,Green"
omni send --to "discord-channel-id" --embed --title "Alert" --description "Server rebooting" --color "#ff0000"
omni send --to "+15555550100" --presence typing
```

#### `chats` — Manage conversations

```bash
omni chats list --unread --sort unread
omni chats messages <chat-id> --limit 20 --rich
omni chats archive <chat-id>
omni chats participants <chat-id> --add "+15555550100"
```

#### `messages` — Search and manage

```bash
omni messages search "meeting tomorrow" --instance <id> --limit 10
omni messages read --chat <chat-id> --instance <id>
```

#### `instances` — Channel connections

```bash
omni instances list
omni instances create --name "work-whatsapp" --channel whatsapp-baileys
omni instances qr <id> --watch
omni instances create --name "ops-slack" --channel slack --slack-bot-token <bot-token> --slack-app-token <app-token>
omni instances connect <id>
omni instances sync <id> --type all --depth 30
omni instances contacts <id> --limit 50
omni instances groups <id>
```

Run `omni instances --help` for the full channel-specific command list.

#### `persons` — Contact directory

```bash
omni persons search "Example User"
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

#### `providers` — AI/agent providers

```bash
omni providers create --name "webhook-agent" --schema webhook --base-url "https://agent.example.com" --api-key <provider-api-key>
omni providers list
omni providers test <id>
```

Schemas: `agno` · `webhook` · `openclaw` · `ag-ui` · `claude-code` · `a2a` · `nats-genie`

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
omni access create --type deny --instance <id> --phone "+15555550100" --action block
omni access list --instance <id>
omni access check --instance <id> --user "+15555550100"
```

Modes: `disabled` · `blocklist` · `allowlist`

#### `webhooks` — External event sources

```bash
omni webhooks create --name "github-events"
omni webhooks trigger --type "custom.event" --payload '{"key":"value"}'
```

</details>

<details>
<summary><strong>System</strong> — update, status, doctor, auth, config, events, logs</summary>

```bash
omni update -y                                  # update CLI; restart only services that were already online
omni update -y --no-restart                     # update CLI only; skip restarts and API-port health check
omni status                                     # verify runtime health
omni doctor                                     # diagnose embedded runtime issues
omni doctor --fix                               # repair safe runtime drift in-place
omni auth login --api-key <your-api-key>        # authenticate
omni config set defaultInstance <id>            # CLI settings
omni events list --type "message.*" --since 2h  # event history
omni events replay --start --since 2024-01-01   # replay events
omni batch create --instance <id> --type targeted_chat_sync --chat <chat-id>
omni resync --instance <id>                     # history backfill
omni logs list --level error --limit 50         # server logs
omni dead-letters list --limit 20               # failed events
```

`omni update` can exit non-zero after install only when restart runs (services were already online): in that path it checks API health on the configured API port and fails on restart or health-check errors.

`omni doctor --fix` never deletes database data. It repairs safe runtime drift such as PM2 state, stored env, and CLI config; destructive cleanup remains manual.

</details>

## REST API

| | |
|---|---|
| **Base URL** | `http://localhost:8882/api/v2` |
| **Docs** | [`/api/v2/docs`](http://localhost:8882/api/v2/docs) (Swagger UI) |
| **OpenAPI** | `/api/v2/openapi.json` |
| **Auth** | `x-api-key` header |

Main API groups include: `/auth`, `/instances`, `/messages`, `/chats`, `/events`, `/persons`, `/access`, `/settings`, `/providers`, `/automations`, `/webhooks`, `/keys`, `/logs`, `/batch-jobs`, `/dead-letters`, `/media`, `/metrics`, `/event-ops`, `/payloads`, `/agents`, `/agent-state`, `/agent-tasks`, `/conversations`, `/context`, `/turns`, `/trust`, `/voice`, `/follow-up`, and `/handoffs`.

## SDKs

### TypeScript

```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8882',
  apiKey: '<your-api-key>',
});

await omni.messages.send({
  instanceId: '<instance-id>',
  to: '+15555550100',
  text: 'Hello from SDK!',
});
```

### Python and Go

Generated Python and Go clients live in `packages/sdk-python` and `packages/sdk-go`. They are useful for API consumers, but the TypeScript SDK is the primary maintained SDK for this release.

Regenerate SDKs after API changes:

```bash
make sdk-generate
```

## Web Dashboard

```bash
make dev-ui    # Dev → http://localhost:5173
make build-ui  # Prod → served by API on :8882
```

Pages: Dashboard · Instances · Chats · Chat View · Contacts · Persons · Providers · Automations · Access Rules · Batch Jobs · Dead Letters · Events · Logs · Settings

<details>
<summary>🔐 API Keys & Security</summary>

API key is generated on first boot and shown once in the startup banner.

```bash
omni keys create --name "admin" --scopes "*"
omni keys create --name "reader" --scopes "messages:read,chats:read"
omni keys create --name "channel-only" --scopes "messages:*" --instances "uuid1,uuid2"
```

Scopes use the `namespace:action` pattern: `messages:*`, `instances:read`, `*` for full access.

Namespaces include: `messages`, `chats`, `instances`, `persons`, `events`, `access`, `settings`, `providers`, `automations`, `webhooks`, `keys`, `logs`, and `batch`.

</details>

<details>
<summary>⚙️ Configuration & environment</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8882` | API server port |
| `DATABASE_URL` | `postgresql://...localhost:8432/omni` | PostgreSQL |
| `NATS_URL` | `nats://localhost:4222` | NATS connection |
| `OMNI_API_KEY` | *(auto)* | Override primary key |

Set `*_MANAGED=false` for external services. Full list: `.env.example`.

| Service | PM2 Name | Port |
|---------|----------|------|
| PostgreSQL | `omni-pgserve` | 8432 |
| NATS | `omni-nats` | 4222 |
| API | `omni-api` | 8882 |

</details>

## Development

```bash
make dev           # Start all services + API
make dev-ui        # Start dashboard dev server
make test          # Run test suite
make typecheck     # TypeScript checks
make lint          # Biome lint
make sdk-generate  # Regenerate SDKs from OpenAPI
```

<details>
<summary>Configuration and environment</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8882` | API server port |
| `DATABASE_URL` | `postgresql://user:password@localhost:8432/omni` | PostgreSQL connection |
| `NATS_URL` | `nats://localhost:4222` | NATS connection |
| `OMNI_API_KEY` | auto-generated | Override primary API key |

Set `*_MANAGED=false` for external services. Full list in `.env.example`.

| Service | PM2 Name | Port |
|---------|----------|------|
| PostgreSQL | `omni-pgserve` | 8432 |
| NATS | `omni-nats` | 4222 |
| API | `omni-api` | 8882 |

</details>

## Channel SDK

```typescript
import { BaseChannelPlugin } from '@omni/channel-sdk';
import type { InstanceConfig, OutgoingMessage } from '@omni/channel-sdk';

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
</p>
