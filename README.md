# Omni v2: Universal Event-Driven Omnichannel Platform

> **The universal translator for AI agents to communicate across any messaging platform.**

## Quick Start

```bash
# Prerequisites: Bun (https://bun.sh), PM2 (bun add -g pm2)

git clone https://github.com/namastexlabs/omni-v2.git
cd omni-v2

# One-command setup: install deps, create .env, start services, run API
make setup
```

That's it. The API will be running at `http://localhost:8882` with Swagger docs at `/api/v2/docs`.

On first boot, the API generates a primary API key and prints it in the startup banner. **Save it** — it's only shown once.

```bash
# Check the API logs for your key
make logs-api
```

## Step-by-Step Setup

If you prefer more control:

```bash
# 1. Install dependencies and create .env
make install

# 2. (Optional) Edit .env to customize ports or disable managed services
#    Defaults: API=8882, PostgreSQL=8432, NATS=4222

# 3. Start infrastructure (PostgreSQL + NATS + API via PM2)
make dev-services

# 4. Check everything is running
make status
```

### What `dev-services` starts (via PM2)

| Service | PM2 Name | Default Port | Controlled By |
|---------|----------|-------------|---------------|
| PostgreSQL (pgserve) | `omni-v2-pgserve` | 8432 | `PGSERVE_MANAGED=true` |
| NATS JetStream | `omni-v2-nats` | 4222 | `NATS_MANAGED=true` |
| API Server | `omni-v2-api` | 8882 | `API_MANAGED=true` |

Set any `*_MANAGED=false` in `.env` if you run that service externally.

### Service Control

```bash
make status            # View all services and URLs
make restart-api       # Restart API only
make restart-nats      # Restart NATS only
make restart-pgserve   # Restart PostgreSQL only
make logs-api          # Tail API logs
make logs              # Tail all logs
make stop              # Stop everything
```

## UI (Dashboard)

### Development

```bash
make dev-ui            # Vite dev server on http://localhost:5173
                       # Hot reload, proxies /api → localhost:8882
```

### Production Build

```bash
make build-ui          # Builds to apps/ui/dist
make restart-api       # API auto-detects dist/ and serves UI on :8882
```

In production, everything runs on a single port — the API serves the built UI as a SPA with client-side routing fallback. No separate web server needed.

## CLI

The CLI provides LLM-optimized access to the API.

```bash
# Run directly from source
make cli ARGS="--help"
make cli ARGS="messages list --limit 5"

# Build and link globally (recommended)
make cli-link          # Builds + links 'omni' command globally

# Then use anywhere
omni --help
omni auth login --api-key <your-key>
omni instances list
omni messages list --person "Mom" --format json
omni send --to "+1234567890" --text "Hello"
```

## SDK

Auto-generated TypeScript SDK from the OpenAPI spec:

```bash
make sdk-generate      # Regenerate types from current API schema
```

The SDK lives at `packages/sdk/` and is used by both the CLI and UI.

## Database

```bash
make db-push           # Push schema changes (development)
make db-studio         # Open Drizzle Studio (visual DB browser)
make db-reset          # Reset database (DESTRUCTIVE)
```

## Quality Checks

```bash
make check             # Run ALL checks (typecheck + lint + test)
make typecheck         # TypeScript only
make lint              # Biome linter
make lint-fix          # Auto-fix lint issues
make test              # Run all tests
make test-api          # API tests only
make test-file F=path  # Specific test file
```

**Git hooks** (auto-installed via `bun install`):
- **Pre-commit**: `make lint` — blocks commits with lint errors
- **Pre-push**: `make typecheck` — blocks pushes with type errors

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            OMNI v2                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   REST API   │    │   tRPC API   │    │  WebSocket   │          │
│  │   (Hono)     │    │ (Type-safe)  │    │ (Real-time)  │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                   │
│  ┌──────┴───────────────────┴───────────────────┴──────┐           │
│  │              EVENT BUS (NATS JetStream)              │           │
│  └──────┬───────────────────┬───────────────────┬──────┘           │
│         │                   │                   │                   │
│  ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐            │
│  │  IDENTITY   │    │    MEDIA    │    │    AGENT    │            │
│  │   GRAPH     │    │  PIPELINE   │    │   ROUTER    │            │
│  └─────────────┘    └─────────────┘    └─────────────┘            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                       CHANNEL PLUGINS                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │
│  │ WhatsApp │ │ WhatsApp │ │ Discord  │ │ Telegram │              │
│  │(Baileys) │ │ (Cloud)  │ │          │ │          │              │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                        DATA LAYER                                   │
│  ┌────────────────────────────┐  ┌────────────────────────────┐    │
│  │  PostgreSQL (Drizzle ORM)  │  │  NATS KV (Session State)   │    │
│  └────────────────────────────┘  └────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
omni-v2/
├── packages/
│   ├── core/              # Events, identity, schemas (shared)
│   ├── db/                # Database schema (Drizzle ORM)
│   ├── api/               # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/       # Plugin SDK for channel developers
│   ├── channel-whatsapp/  # WhatsApp (Baileys)
│   ├── channel-discord/   # Discord
│   ├── cli/               # LLM-optimized CLI
│   ├── sdk/               # Auto-generated TypeScript SDK
│   └── mcp/               # MCP Server for AI assistants
├── apps/
│   └── ui/                # React dashboard (Vite + Tailwind)
├── scripts/               # Build, deploy, SDK generation
├── docs/                  # Documentation
└── ecosystem.config.cjs   # PM2 configuration
```

## Environment Variables

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

## MCP Integration

Omni v2 includes a Model Context Protocol server for AI assistant integration:

```bash
bun run mcp:http    # HTTP mode for web clients
bun run mcp:stdio   # Stdio mode for Claude Desktop
```

Supports Claude Desktop, Cursor, VSCode, Windsurf, and any MCP-compatible client.

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

## All Make Commands

Run `make help` to see the full list. Key commands:

```
make setup           # Full setup (install + services + dev)
make dev             # Start services + API in watch mode
make dev-ui          # UI dev server (Vite :5173)
make dev-services    # Start PostgreSQL + NATS + API via PM2
make check           # All quality checks
make build-ui        # Build UI for production
make sdk-generate    # Regenerate SDK from OpenAPI
make cli-link        # Build + link CLI globally
make status          # Service status and URLs
make logs-api        # View API logs
make stop            # Stop all services
make reset           # Full clean and reinstall
```

## License

MIT License - see [LICENSE](./LICENSE) for details.
