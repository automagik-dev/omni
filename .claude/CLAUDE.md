# Omni v2 - Development Guidelines

> Universal Event-Driven Omnichannel Platform

## Philosophy

Omni v2 is an **event-first, plugin-based** messaging platform. Every design decision prioritizes:

1. **Events as source of truth** - Every action produces an event
2. **Plugin isolation** - Channels are plugins, not core code
3. **Type safety** - End-to-end TypeScript with Zod schemas
4. **LLM-native** - Built for AI agent consumption

---

<EXTREMELY_IMPORTANT>
## Bun Ecosystem - Mandatory Compliance

This project uses **Bun exclusively**. You MUST follow these rules without exception.

### Command Reference

| Task | MUST Use | NEVER Use |
|------|----------|-----------|
| Install packages | `bun install`, `bun add` | `npm install`, `yarn add`, `pnpm add` |
| Run scripts | `bun run <script>` | `npm run`, `yarn`, `pnpm run` |
| Execute binaries | `bunx <cmd>` | `npx`, `yarn dlx`, `pnpm dlx` |
| Run TypeScript | `bun <file.ts>` | `node`, `ts-node`, `tsx` |
| Run tests | `bun test` | `jest`, `vitest`, `npm test` |
| Watch mode | `bun --watch` | `nodemon`, `ts-node-dev` |

### Prohibited Commands

You MUST NOT run any of these commands:
- ❌ `npm install` / `npm i` / `npm add`
- ❌ `npm run` / `npm test` / `npm start`
- ❌ `npx`
- ❌ `yarn` / `yarn add` / `yarn run`
- ❌ `pnpm` / `pnpm add` / `pnpm run`
- ❌ `node <file>` (use `bun <file>` instead)
- ❌ `ts-node` / `tsx` (use `bun` instead)

If you catch yourself about to run a prohibited command, STOP and use the Bun equivalent.

### Self-Check Before Every Command

Before executing ANY package manager or runtime command:
1. Verify you are using `bun`, not npm/yarn/pnpm/node
2. If a script or docs suggest npm commands, translate to Bun equivalents
3. If unsure, check the command table above
</EXTREMELY_IMPORTANT>

---

## Tech Stack (Locked Decisions)

| Category | Use This | Not This |
|----------|----------|----------|
| Runtime | Bun | Node.js |
| Language | TypeScript (strict) | JavaScript |
| HTTP Framework | Hono | Express, Fastify |
| Type-safe API | tRPC | GraphQL, REST-only |
| Database ORM | Drizzle | Prisma, TypeORM |
| Database | PostgreSQL | MySQL, MongoDB |
| Event Bus | NATS JetStream | Redis Pub/Sub, RabbitMQ |
| Validation | Zod | Joi, Yup |
| Monorepo | Turborepo | Nx, Lerna |
| Process Manager | PM2 | Forever, systemd |

## Project Structure

```
omni-v2/
├── packages/
│   ├── core/           # Events, identity, schemas (shared)
│   ├── api/            # HTTP API (Hono + tRPC + OpenAPI)
│   ├── channel-sdk/    # Plugin SDK for channel developers
│   ├── channel-*/      # Official channel implementations
│   ├── cli/            # LLM-optimized CLI
│   ├── sdk/            # Auto-generated TypeScript SDK
│   └── mcp/            # MCP Server for AI assistants
├── apps/
│   └── ui/             # React dashboard (migrated from v1)
├── docs/               # Documentation
├── scripts/            # Build, deploy, SDK generation
└── .claude/            # AI workflow configuration
```

## Where to Put Things

| What | Where | Why |
|------|-------|-----|
| Event definitions | `packages/core/src/events/` | Single source of truth |
| Zod schemas | `packages/core/src/schemas/` | Shared validation |
| Database schema | `packages/core/src/db/` | Drizzle schema |
| API endpoints | `packages/api/src/routes/` | HTTP handlers |
| tRPC routers | `packages/api/src/trpc/` | Type-safe internal API |
| Channel plugins | `packages/channel-*/` | Isolated per channel |
| Shared types | `packages/core/src/types/` | TypeScript interfaces |
| CLI commands | `packages/cli/src/commands/` | LLM-optimized CLI |

## Commands

```bash
# Development
make dev                 # Start all services in dev mode
make dev-api             # API only
make dev-nats            # NATS server only

# Database
make db-push             # Push schema changes
make db-migrate          # Run migrations
make db-studio           # Open Drizzle Studio

# Testing
make test                # Run all tests
make test-watch          # Watch mode

# Production
make build               # Build all packages
make start               # Start production
make stop                # Stop all services

# Utilities
make clean               # Clean build artifacts
make typecheck           # TypeScript check
make lint                # Run linter
```

## Code Patterns

### Event Publishing

```typescript
// Always publish events for state changes
await eventBus.publish({
  type: 'message.received',
  payload: {
    instanceId,
    channelType: 'whatsapp',
    message,
  },
  metadata: {
    correlationId: generateId(),
    timestamp: Date.now(),
  },
});
```

### Zod Schema First

```typescript
// Define schema once, derive types
export const MessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  sender: PersonReferenceSchema,
  timestamp: z.number(),
});

export type Message = z.infer<typeof MessageSchema>;
```

### Channel Plugin Pattern

```typescript
// Channel plugins implement the ChannelPlugin interface
export const whatsappPlugin: ChannelPlugin = {
  id: 'whatsapp-baileys',
  name: 'WhatsApp (Baileys)',

  async initialize(config) { /* ... */ },
  async sendMessage(instanceId, message) { /* ... */ },
  async handleWebhook(req) { /* ... */ },

  events: {
    'message.received': handleIncoming,
    'message.sent': handleOutgoing,
  },
};
```

### Error Handling

```typescript
// Use typed errors with context
import { OmniError, ErrorCode } from '@omni/core';

throw new OmniError({
  code: ErrorCode.CHANNEL_NOT_CONNECTED,
  message: 'WhatsApp instance not connected',
  context: { instanceId },
  recoverable: true,
});
```

## Distributed Documentation

Each package/directory should have its own CLAUDE.md with:
- Package-specific patterns
- Local conventions
- Integration notes

```
packages/core/CLAUDE.md      # Core package patterns
packages/api/CLAUDE.md       # API conventions
packages/channel-*/CLAUDE.md # Channel-specific notes
```

## Never Do

- Mix channel logic in core (channels are plugins)
- Skip event publishing for state changes
- Use raw SQL (use Drizzle)
- Add npm/yarn/pnpm dependencies
- Create REST endpoints without OpenAPI docs
- Skip Zod validation on external inputs
- Hardcode channel-specific behavior in core

## Workflow

This project uses the **WISH → FORGE → QA → REVIEW** paradigm:

1. **WISH** - Plan and document requirements
2. **FORGE** - Execute via specialist agents
3. **QA** - Integration testing (actually test the running system)
4. **REVIEW** - Validate against wish criteria

See `.claude/agents/` for available agents and their roles.

## Worker Orchestration (genie-cli)

The project uses **genie-cli** for tmux-based worker orchestration and LLM routing.

### Launch Claude

```bash
claudio                       # Launch with default LLM profile
claudio <profile>             # Launch with specific profile
```

### Worker Management (term)

```bash
# Spawn workers
term work <beads-id>          # Spawn worker bound to issue
term work next                # Work on next ready issue

# Monitor
term workers                  # List all workers and states
term dashboard --watch        # Live status dashboard

# Cleanup
term close <beads-id>         # Close issue + cleanup worker
term ship <beads-id>          # Close + merge to main

# Session management
term ls                       # List sessions
term read <session>           # Read session output
term exec <session> <cmd>     # Execute command in session
```

### Daemon

```bash
term daemon start             # Auto-sync beads across workers
```
