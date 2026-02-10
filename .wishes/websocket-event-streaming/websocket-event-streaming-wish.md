# WISH: WebSocket Event Streaming

> Wire up existing WebSocket handlers to NATS EventBus, mount on the API server, and add SDK client support for real-time event consumption.

**Status:** DRAFT
**Created:** 2026-02-10
**Author:** WISH Agent
**Priority:** P4 (backlog)
**Beads:** omni-4ek

---

## Context

Omni v2 is an event-driven platform where "events are the source of truth." Yet clients can only access events via REST polling. This is the missing real-time delivery layer.

### What Exists Today

- **4 WebSocket handlers** in `packages/api/src/ws/` (events, chats, instances, logs) — written but **not mounted**
- **SSE log streaming** at `GET /api/v2/logs/stream` — fully working
- **NATS JetStream EventBus** — the backbone, already delivering events internally
- **API key auth** with scopes + instance isolation — production-ready on HTTP

### What's Broken / Missing

1. WS handlers are not mounted to the HTTP server
2. WS handlers use `unknown` types for WebSocket objects (no runtime selected)
3. `ws/events.ts` has partial auth; `ws/chats.ts` and `ws/instances.ts` have **zero auth**
4. No NATS → WebSocket fan-out (handlers have TODOs for EventBus integration)
5. SDK has no WebSocket or SSE client — only REST
6. **Server constraint**: API uses `node:http` createServer (not Bun.serve) for Baileys WS compatibility. Need `ws` library or Hono WS adapter for upgrade handling.

---

## Assumptions

- **ASM-1**: Runtime is Bun, but HTTP server uses `node:http` API (Baileys compatibility). PM2 launches with `bun --watch`.
- **ASM-2**: For WS server: evaluate Bun's native `Bun.serve()` websocket option vs `ws` library on `node:http`. Bun's `ws` compat layer has gaps (missing `upgrade`/`unexpected-response` events — already visible in Baileys warnings). May need to switch server to `Bun.serve()` with a fetch handler that delegates to Hono, or use `ws` library on the existing `node:http` server. Decision during implementation.
- **ASM-3**: API key auth on handshake is sufficient (no per-message re-auth needed)
- **ASM-4**: Connection limits per API key are needed but can be simple (in-memory counter)
- **ASM-5**: Python/Go SDKs are out of scope for initial implementation

## Decisions

- **DEC-1**: Use `ws` library for WebSocket upgrades on the existing Node.js HTTP server
- **DEC-2**: Auth happens once at upgrade time (API key from query param or header)
- **DEC-3**: Scope and instance filtering enforced on every subscription message
- **DEC-4**: SDK exposes a `realtime` namespace with typed event callbacks
- **DEC-5**: Keep existing SSE log stream as-is (it works, no need to replace)
- **DEC-6**: WebSocket paths: `/api/v2/ws/events`, `/api/v2/ws/chats`, `/api/v2/ws/instances`, `/api/v2/ws/logs`

## Risks

- **RISK-1**: Node.js HTTP + `ws` library adds a dependency. **Mitigation**: `ws` is the most battle-tested WS library in the Node ecosystem.
- **RISK-2**: Memory growth from idle connections. **Mitigation**: Heartbeat/ping every 30s, terminate stale connections after 90s no-pong.
- **RISK-3**: NATS fan-out could overwhelm slow clients. **Mitigation**: Per-connection send buffer limit, drop messages for slow consumers with a warning.

---

## Scope

### IN SCOPE

- Mount WebSocket handlers on the API server via `ws` library
- Add auth (API key validation + scope/instance enforcement) to all 4 handlers
- Wire NATS EventBus → WebSocket broadcast for events, chats, instances
- Wire core logger → WebSocket broadcast for logs
- Add connection management (heartbeat, limits, cleanup)
- Add `realtime` namespace to TypeScript SDK with reconnect logic
- Tests for auth, subscription filtering, and NATS→WS fan-out

### OUT OF SCOPE

- Python/Go SDK WebSocket clients (separate wish)
- Replacing SSE log stream (keep both)
- Client-to-server commands beyond subscribe/unsubscribe (no bidirectional RPC)
- Redis-backed connection state (in-memory is fine at current scale)
- Dashboard UI integration (separate wish)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| api | [x] server setup, [x] ws handlers, [x] middleware | Mount WS, add auth, wire NATS |
| core | [ ] events, [ ] schemas, [ ] types | No changes needed |
| sdk | [x] client, [x] new realtime module | Add WebSocket client |
| db | [ ] schema | No changes |
| cli | [ ] commands | No changes |

### System Checklist

- [ ] **Events**: No new event types — consuming existing ones
- [ ] **Database**: No schema changes
- [x] **SDK**: New `realtime` module in TypeScript SDK
- [ ] **CLI**: No changes
- [x] **Tests**: API package (ws auth, filtering, fan-out) + SDK package (client reconnect)

### Dependencies

- `ws` npm package (add to `packages/api`)

---

## Execution Group A: Server-Side WebSocket Infrastructure

**Goal:** Mount WebSocket handlers on the API server with proper auth and NATS integration.

**Packages:** `api`

**Deliverables:**

- [ ] Add `ws` dependency to `packages/api`
- [ ] Create WebSocket upgrade handler in `packages/api/src/ws/server.ts`
  - Intercept upgrade requests on `/api/v2/ws/*` paths
  - Validate API key (reuse `ApiKeyService.validate()`)
  - Check scopes (`events:read`, `messages:read`, `instances:read`, `logs:read`)
  - Enforce instance isolation on subscriptions
  - Store validated key data on the WebSocket connection object
- [ ] Refactor WS handlers to use typed `ws.WebSocket` instead of `unknown`
- [ ] Add auth to `ws/chats.ts` and `ws/instances.ts` (currently missing)
- [ ] Wire NATS EventBus subscriptions to WebSocket broadcast:
  - `ws/events.ts` → subscribe to `omni.events.>` subjects, filter by client subscriptions
  - `ws/chats.ts` → subscribe to message/typing/presence events, filter by chatId + instanceId
  - `ws/instances.ts` → subscribe to instance status events, filter by instanceId
  - `ws/logs.ts` → subscribe to core logger buffer, filter by level/service
- [ ] Add connection management:
  - Ping/pong heartbeat every 30s, disconnect after 90s no-pong
  - Max 10 concurrent WS connections per API key (configurable)
  - Graceful shutdown: close all WS connections on SIGTERM
- [ ] Mount in `packages/api/src/index.ts` `startServer()` function (attach to Node.js HTTP server)

**Acceptance Criteria:**

- [ ] `wscat -c "ws://localhost:8882/api/v2/ws/events?api_key=omni_sk_xxx"` connects successfully
- [ ] Connection rejected with 401 for invalid/missing API key
- [ ] Connection rejected with 403 for insufficient scopes
- [ ] Subscribe message receives filtered events from NATS in real-time
- [ ] Instance-scoped keys only receive events for their allowed instances
- [ ] Stale connections are cleaned up after 90s

**Validation:**

- `make check`
- `bun test packages/api/src/__tests__/ws-*.test.ts`

---

## Execution Group B: TypeScript SDK Real-Time Client

**Goal:** Add WebSocket client to the TypeScript SDK with reconnect, typed events, and ergonomic API.

**Packages:** `sdk`

**Deliverables:**

- [ ] Create `packages/sdk/src/realtime.ts` module
  - `OmniRealtimeClient` class with connect/disconnect/reconnect
  - Auto-reconnect with exponential backoff (1s → 2s → 4s → 8s → 30s max)
  - Typed event callbacks via `.on('message.new', (data) => ...)` pattern
  - Subscription management: `.subscribe({ instanceId, eventTypes })` / `.unsubscribe()`
- [ ] Create channel-specific convenience clients:
  - `events()` → `/api/v2/ws/events`
  - `chats(instanceId)` → `/api/v2/ws/chats`
  - `instances()` → `/api/v2/ws/instances`
  - `logs()` → `/api/v2/ws/logs`
- [ ] Integrate with existing `createOmniClient()`:
  ```typescript
  const omni = createOmniClient({ baseUrl, apiKey });
  const stream = omni.realtime.events();
  stream.on('message.received', (event) => { ... });
  stream.on('instance.connected', (event) => { ... });
  await stream.connect();
  ```
- [ ] Handle both browser (`WebSocket`) and Node.js (`ws`) environments
- [ ] Export types for all event payloads

**Acceptance Criteria:**

- [ ] SDK client connects to WS endpoint and receives events
- [ ] Auto-reconnects on disconnect with backoff
- [ ] Typed event callbacks with proper TypeScript inference
- [ ] Works in both Node.js/Bun and browser environments
- [ ] Clean disconnect with no leaked connections

**Validation:**

- `bun test packages/sdk`
- Manual test: run SDK client, send a message via REST, verify real-time delivery

---

## Execution Group C: Documentation & OpenAPI

**Goal:** Document WebSocket endpoints and update API docs.

**Packages:** `api` (OpenAPI spec), `docs`

**Deliverables:**

- [ ] Add WebSocket endpoint documentation to OpenAPI spec (as `x-websocket` extensions or separate doc)
- [ ] Document the subscribe/unsubscribe message protocol for each endpoint
- [ ] Add connection examples (wscat, JavaScript, TypeScript SDK)
- [ ] Document auth requirements and scope mappings
- [ ] Document rate limits and connection limits

**Acceptance Criteria:**

- [ ] Swagger UI shows WebSocket endpoints (or linked docs)
- [ ] Connection examples work copy-paste
- [ ] Auth requirements clearly documented

**Validation:**

- Manual review

---

## Protocol Reference

### Connection

```
GET /api/v2/ws/events?api_key=omni_sk_xxxxx
Connection: Upgrade
Upgrade: websocket
```

### Subscribe (client → server)

```json
{
  "type": "subscribe",
  "filters": {
    "instanceId": "inst_xxx",
    "eventTypes": ["message.received", "message.sent"]
  }
}
```

### Event (server → client)

```json
{
  "type": "message.received",
  "instanceId": "inst_xxx",
  "payload": { ... },
  "timestamp": "2026-02-10T12:00:00Z"
}
```

### Heartbeat (server → client)

```json
{ "type": "ping" }
```

Client responds: `{ "type": "pong" }`
