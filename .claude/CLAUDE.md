# Omni v2 - Development Guidelines

> Universal Event-Driven Omnichannel Platform

## Philosophy

Omni v2 is an **event-first, plugin-based** messaging platform. Every design decision prioritizes:

1. **Events as source of truth** - Every action produces an event
2. **Plugin isolation** - Channels are plugins, not core code
3. **Type safety** - End-to-end TypeScript with Zod schemas
4. **LLM-native** - Built for AI agent consumption

## Bun Ecosystem (Mandatory)

**All JavaScript/TypeScript operations use Bun:**

```bash
# Package management
bun install              # Install dependencies
bun add <pkg>            # Add dependency
bun add -d <pkg>         # Add dev dependency

# Running code
bun run <script>         # Run package.json script
bun <file.ts>            # Run TypeScript directly

# Testing
bun test                 # Run tests
bun test --watch         # Watch mode

# Monorepo
bun install              # Install all workspace packages
```

**Never use:** `npm`, `yarn`, `pnpm`, `node` commands

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

This project uses the **WISH → FORGE → REVIEW** paradigm:

1. **WISH** - Plan and document requirements
2. **FORGE** - Execute via specialist agents
3. **REVIEW** - Validate against wish criteria

See `.claude/agents/` for available agents and their roles.
