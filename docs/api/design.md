---
title: "API Design"
created: 2025-01-29
updated: 2026-09-08
tags: [api, design]
status: current
---

# API Design

> The Omni v2 API is a REST + OpenAPI surface under `/api/v2`. Every route is described in the OpenAPI spec (`/api/v2/openapi.json`, Swagger UI at `/api/v2/docs`), and the TypeScript/Go/Python SDKs are generated from it.

> Related: [[endpoints|API Endpoints]], [[internal|Internal API]], [[v1-compatibility-layer|V1 Compatibility]]

## Design Principles

1. **v2 is the API** - `/api/v2` is the only mounted surface; a thin v1-compatibility shim exists solely for the dashboard migration (see [[v1-compatibility-layer|V1 Compatibility]])
2. **Type-Safe** - Zod validation on every external boundary; SDKs generated from OpenAPI
3. **Consistent** - Same patterns across all resources
4. **LLM-Friendly** - Structured responses, clear error messages
5. **Performant** - Pagination, filtering, sparse fieldsets
6. **Event-first** - State changes are journaled and published; the events surface (schemas, consumers, trace) is a first-class API

## API Structure

```
/api/v2/                           # REST API (x-api-key auth)
├── instances/                     # Instance management (+ supported-channels)
├── messages/                      # Send/receive, permalink, star, threads
├── chats/                         # Conversations, pin/archive, participants
├── events/                        # Journal queries, schemas, consumers, trace
├── persons/                       # Identity graph
├── automations/                   # Event-driven workflows
├── webhooks/                      # Webhook source configuration
├── scheduled-messages/            # Schedule for later delivery
├── providers/ keys/ access/ ...   # See the endpoints reference for all modules
└── platform/                      # Tenant control plane (flag-gated)

/api/v2/webhooks/ingress/:source   # Public signed ingress for external sources

/api/v2/channels/...               # Channel-specific webhook receivers:
├── gupshup/:instanceId/webhook
├── asc-flow/:instanceId/webhook
├── hermes/:instanceId/webhook
├── twilio-whatsapp/:instanceId/webhook
└── whatsapp-business/webhook      # Meta Cloud API (GET verify + POST)

/api/v2/instances/:id/telegram/webhook   # Telegram webhook receiver
```

The full module-by-module reference lives in [[endpoints|API Endpoints]] — this page covers the cross-cutting design only.

## Authentication

All API requests require the `x-api-key` header:

```bash
curl -H "x-api-key: omni_sk_..." http://localhost:8882/api/v2/instances
```

### Multiple API Keys with Scoped Permissions

Omni supports multiple API keys with granular permissions and full audit logging:

```typescript
// API Key structure
interface ApiKey {
  id: string;
  name: string;                    // Human-readable name
  keyPrefix: string;               // First 8 chars (for display)
  keySuffix: string;               // Last 4 chars (for display)
  scopes: string[];                // Permissions
  instanceIds: string[] | null;    // Restrict to instances (null = all)
  expiresAt: Date | null;          // Optional expiration
  createdAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  usageCount: number;
}
```

**Key Types:**
- **Admin keys** (`["*"]`) - Full access to all operations
- **Instance-scoped keys** - Restricted to specific instances
- **Read-only keys** (`["instances:read", "events:read"]`) - Query only
- **Send-only keys** (`["messages:send"]`) - Send messages, nothing else
- **Time-limited keys** - Auto-expire after set date

**Available Scopes** (`namespace:action` pattern):
| Scope | Description |
|-------|-------------|
| `*` | Full admin access |
| `instances:*` / `instances:read` / `instances:write` / `instances:delete` | Instance operations |
| `messages:*` / `messages:send` / `messages:read` | Message operations |
| `events:read` | Read events, traces, consumers |
| `persons:*` | Identity management |
| `access:*` | Access rule management |
| `settings:*` | Settings management |
| `keys:read` / `keys:write` | API key management |
| `admin:*` | Admin operations (keys, services) |
| `platform:*` | Platform tenant control plane (PLATFORM-class credentials only; see [[../deployment/platform-credential-bootstrap\|Platform Credential Bootstrap]]) |

**Audit Logging:**
Every API key usage is logged with timestamp, endpoint, IP address, user agent, and response status. See `GET /api/v2/keys/:id/audit`.

### Tenancy posture

`POST /api/v2/auth/validate` returns, for every authenticated caller, the server's tenancy posture (`multitenancyEnabled`, `controlPlaneMounted`, `dbEnforcement`) alongside the credential's class, tenant, role, and scopes. The CLI surfaces this in `omni status` and `omni multitenancy status`.

## Common Patterns

### Request Format

```typescript
// Query parameters (GET)
GET /api/v2/events?channel=whatsapp&limit=50&cursor=xxx

// JSON body (POST/PUT/PATCH)
POST /api/v2/messages/send
Content-Type: application/json
{
  "instanceId": "...",
  "to": "+1234567890",
  "text": "Hello!"
}
```

### Response Format

All responses follow this structure:

```typescript
// Success
{
  "data": { ... },           // For single resource
  "items": [ ... ],          // For collections
  "meta": {
    "total": 100,
    "cursor": "...",
    "hasMore": true
  }
}

// Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid phone number format",
    "details": {
      "field": "to",
      "received": "1234",
      "expected": "E.164 format"
    }
  }
}
```

### Pagination

Cursor-based pagination for all list endpoints:

```typescript
// First page
GET /api/v2/events?limit=50

// Response
{
  "items": [...],
  "meta": {
    "cursor": "eyJpZCI6IjEyMyIsInRzIjoiMjAyNS0wMS0wMSJ9",
    "hasMore": true
  }
}

// Next page
GET /api/v2/events?limit=50&cursor=eyJpZCI6IjEyMyIsInRzIjoiMjAyNS0wMS0wMSJ9
```

### Filtering

Standard filter parameters:

```typescript
GET /api/v2/events
  ?channel=whatsapp,discord     // Multiple values
  &eventType=message.*          // Comma lists; trailing-* prefix globs
  &since=2025-01-01T00:00:00Z   // ISO 8601
  &until=2025-01-31T23:59:59Z
  &personId=uuid
  &instanceId=uuid
  &limit=50
  &cursor=xxx
```

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | Key lacks permission |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMITED` | 429 | Too many requests |
| `CHANNEL_ERROR` | 502 | Channel (WhatsApp/Discord) error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## tRPC

A tRPC router exists in `packages/api/src/trpc/` for type-safe internal use, but it is not mounted as a public HTTP surface. External consumers use REST + the generated SDKs; the OpenAPI spec is the contract.

## Real-time

There is no general-purpose WebSocket subscription API. For real-time event consumption use:

- `omni events stream` / `omni events wait` — poll-based live tail and one-shot blocking wait over the journal
- **Durable consumers** — `POST /api/v2/events/consumers/:name/pull` supports server-side long-poll (`waitMs`), giving push-like latency with at-least-once delivery (see [[../runbooks/durable-consumers|Durable Consumers]])
- **Automations** — react to events server-side (`webhook`, `send_message`, `emit_event`, `call_agent` actions)

Scoped WebSocket endpoints exist for specific UI features (chat updates, log tailing, voice) — see `packages/api/src/ws/`.

## Rate Limiting

Default limits by endpoint category (see `packages/api/src/middleware/rate-limit.ts` for the source of truth):

| Endpoint | Limit | Window |
|----------|-------|--------|
| Messages (send) | 60 | 1 minute |
| Events (list) / webhook ingress | 100 | 1 minute |
| Instances (CRUD) | 30 | 1 minute |
| General | 1000 | 1 minute |

Rate limit headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1706745600
```

## Versioning

The API uses URL versioning:
- `/api/v2/` - Current stable (the only mounted surface)
- The v1-compatibility layer maps legacy dashboard calls onto v2 — see [[v1-compatibility-layer|V1 Compatibility]]

Breaking changes will be announced in advance via release notes.
