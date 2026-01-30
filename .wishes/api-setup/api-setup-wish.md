# WISH: API Setup

> Implement the Hono + tRPC HTTP API server with full CRUD operations, OpenAPI spec generation, and real-time WebSocket support.

**Status:** REVIEW
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-xtv

---

## Context

The API is the foundation for everything else. Channels consume it, SDKs are generated from it, the UI calls it. This must be complete and well-typed from day one.

Reference docs:
- `docs/api/design.md` - API design principles
- `docs/api/endpoints.md` - Full endpoint reference
- `docs/sdk/auto-generation.md` - SDK generation from OpenAPI

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `@omni/core` schemas exist and are usable |
| **ASM-2** | Assumption | `@omni/db` with Drizzle client is working |
| **ASM-3** | Assumption | NATS is available via PM2 (from foundation) |
| **DEC-1** | Decision | Use `@hono/zod-openapi` for route definitions |
| **DEC-2** | Decision | tRPC for internal/SDK use, REST for external |
| **DEC-3** | Decision | WebSocket on same server for real-time |
| **DEC-4** | Decision | API keys stored hashed, scoped permissions |
| **RISK-1** | Risk | Large scope - mitigate by implementing in groups |

---

## Scope

### IN SCOPE

- `packages/api/` package with Hono HTTP server
- All REST endpoints from `docs/api/endpoints.md`
- tRPC router for type-safe internal API
- OpenAPI 3.1 spec auto-generation
- Swagger UI at `/api/v2/docs`
- WebSocket endpoints for real-time events
- Authentication middleware (API key validation)
- Rate limiting middleware
- Health check endpoints
- Service context (db, eventBus) injection

### OUT OF SCOPE

- Actual channel implementations (separate wishes)
- CLI (separate wish)
- SDK wrapper code (sdk-generation wish)
- v1 compatibility layer (future wish if needed)
- MCP server (separate wish)

---

## Execution Group A: Core Infrastructure

**Goal:** Set up the API package with Hono, middleware, and foundational endpoints.

**Deliverables:**
- [ ] `packages/api/package.json` with dependencies
- [ ] `packages/api/tsconfig.json` extending root
- [ ] `packages/api/src/index.ts` - Server entry point
- [ ] `packages/api/src/app.ts` - Hono app creation
- [ ] `packages/api/src/middleware/auth.ts` - API key validation
- [ ] `packages/api/src/middleware/context.ts` - Inject db, eventBus, services
- [ ] `packages/api/src/middleware/error.ts` - Error handling
- [ ] `packages/api/src/middleware/rate-limit.ts` - Rate limiting
- [ ] `packages/api/src/routes/health.ts` - Health check endpoints
- [ ] `packages/api/src/services/index.ts` - Service layer setup

**Acceptance Criteria:**
- [ ] `bun run packages/api/src/index.ts` starts server on port 8881
- [ ] `GET /api/v2/health` returns status with db/nats checks
- [ ] Invalid API key returns 401
- [ ] Valid API key allows access
- [ ] Services (db, eventBus) available in route context

**Validation:**
```bash
bun run packages/api/src/index.ts &
sleep 2
curl -s http://localhost:8881/api/v2/health | jq .
curl -s -H "x-api-key: invalid" http://localhost:8881/api/v2/instances
curl -s -H "x-api-key: test-key" http://localhost:8881/api/v2/instances
kill %1
```

---

## Execution Group B: REST Routes & OpenAPI

**Goal:** Implement all REST endpoints with OpenAPI documentation.

**Deliverables:**
- [ ] `packages/api/src/routes/v2/instances.ts` - Full instance CRUD + status/qr/connect
- [ ] `packages/api/src/routes/v2/messages.ts` - Send text/media/reaction/location/contact
- [ ] `packages/api/src/routes/v2/events.ts` - List, get, timeline, search, analytics
- [ ] `packages/api/src/routes/v2/persons.ts` - Search, get, presence, timeline, link/unlink
- [ ] `packages/api/src/routes/v2/access.ts` - Access rules CRUD + check
- [ ] `packages/api/src/routes/v2/settings.ts` - Settings CRUD + history
- [ ] `packages/api/src/routes/v2/api-keys.ts` - API key management + audit
- [ ] `packages/api/src/routes/v2/services.ts` - Service management
- [ ] `packages/api/src/routes/v2/providers.ts` - Agent provider management
- [ ] `packages/api/src/openapi.ts` - OpenAPI spec generation + Swagger UI
- [ ] Service layer implementations for each route module

**Acceptance Criteria:**
- [ ] All endpoints from `docs/api/endpoints.md` implemented
- [ ] All endpoints have Zod schemas with `.describe()` for docs
- [ ] `GET /api/v2/openapi.json` returns valid OpenAPI 3.1 spec
- [ ] `GET /api/v2/docs` shows interactive Swagger UI
- [ ] Request validation rejects invalid inputs with clear errors
- [ ] Pagination works correctly with cursor-based pagination

**Validation:**
```bash
bun run packages/api/src/index.ts &
sleep 2
# Test OpenAPI spec
curl -s http://localhost:8881/api/v2/openapi.json | jq .info
# Test instances endpoint
curl -s -H "x-api-key: test-key" http://localhost:8881/api/v2/instances | jq .
# Test validation
curl -s -X POST -H "x-api-key: test-key" -H "Content-Type: application/json" \
  -d '{"name":""}' http://localhost:8881/api/v2/instances | jq .error
kill %1
```

---

## Execution Group C: Real-Time & tRPC

**Goal:** Add WebSocket endpoints for real-time updates and tRPC for type-safe SDK.

**Deliverables:**
- [ ] `packages/api/src/ws/events.ts` - Event stream WebSocket
- [ ] `packages/api/src/ws/instances.ts` - Instance status WebSocket
- [ ] `packages/api/src/ws/chats.ts` - Real-time chats WebSocket (messages, typing, presence)
- [ ] `packages/api/src/ws/logs.ts` - Real-time logs WebSocket
- [ ] `packages/api/src/trpc/router.ts` - tRPC router
- [ ] `packages/api/src/trpc/context.ts` - tRPC context
- [ ] `packages/api/src/trpc/index.ts` - tRPC integration with Hono

**Acceptance Criteria:**
- [ ] WebSocket at `/api/v2/ws/events` streams events in real-time
- [ ] WebSocket at `/api/v2/ws/chats/:instanceId` streams chat updates
- [ ] Typing indicators flow through WebSocket
- [ ] Presence updates flow through WebSocket
- [ ] tRPC client can call procedures with full type safety
- [ ] WebSocket handles reconnection gracefully

**Validation:**
```bash
bun run packages/api/src/index.ts &
sleep 2
# Test WebSocket (using websocat if available)
websocat ws://localhost:8881/api/v2/ws/events --header "x-api-key: test-key" &
# Or use a simple test script
bun run packages/api/test/ws-test.ts
kill %1
```

---

## Technical Notes

### Dependencies to Add

```json
{
  "dependencies": {
    "@hono/zod-openapi": "^0.18.0",
    "@hono/swagger-ui": "^0.4.0",
    "@trpc/server": "^11.0.0",
    "hono": "^4.6.0",
    "nats": "^2.28.0"
  }
}
```

### Service Layer Pattern

```typescript
// Each route module has a corresponding service
interface Services {
  instances: InstanceService;
  messages: MessageService;
  events: EventService;
  persons: PersonService;
  access: AccessService;
  settings: SettingsService;
}

// Injected via middleware
c.var.services.instances.list({ channel: ['whatsapp-baileys'] })
```

### Event Publishing

Routes should publish events for state changes:
```typescript
// On instance create
await eventBus.publish({
  type: 'channel.created',
  payload: { instanceId, channel, name }
});
```

### Real-Time Chat Features

Critical "feel alive" features:
- `chat.typing` - When user is typing
- `chat.presence` - Online/offline/composing
- `message.status` - sent/delivered/read
- `message.new` - New message received
- `media.processed` - Transcription/description ready

---

## Dependencies

- `@omni/core` - Schemas, types, event bus interface
- `@omni/db` - Database client

---

## Questions Resolved

1. **API versioning?** - URL versioning (`/api/v2/`)
2. **Auth mechanism?** - API key in `x-api-key` header
3. **Rate limiting?** - In-memory for now, Redis later if needed
4. **WebSocket auth?** - API key in query param or first message

---

## Next Wishes After This

After api-setup is complete:
- `channel-sdk` - Plugin interface for channels
- `nats-events` - EventBus implementation with NATS
- `sdk-generation` - Auto-generate TypeScript SDK from OpenAPI
