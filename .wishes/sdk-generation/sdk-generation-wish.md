# WISH: SDK Generation

> Auto-generate TypeScript SDK from OpenAPI spec with full type safety and excellent DX.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-0cy

---

## Context

The SDK is auto-generated from OpenAPI. Define schemas once in Zod, get types and client for free. SDK consumers get full autocomplete and type safety.

Reference: `docs/sdk/auto-generation.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | API is running with OpenAPI spec at `/api/v2/openapi.json` |
| **DEC-1** | Decision | `openapi-typescript` for type generation |
| **DEC-2** | Decision | `openapi-fetch` for type-safe client |
| **DEC-3** | Decision | Wrapper class for nice DX (omni.instances.list()) |
| **DEC-4** | Decision | Event types also exported for NATS subscribers |

---

## Scope

### IN SCOPE

- `packages/sdk/` package
- OpenAPI spec extraction script
- Type generation from spec
- Type-safe fetch client generation
- Nice wrapper class (`createOmniClient`)
- Event type exports (for NATS subscribers)
- JSDoc from Zod `.describe()`
- Example usage
- Published to npm

### OUT OF SCOPE

- Python SDK (future, via openapi-generator)
- Go SDK (future, via openapi-generator)
- WebSocket client wrapper (future enhancement)

---

## Execution Group A: Type Generation

**Goal:** Generate TypeScript types from OpenAPI spec.

**Deliverables:**
- [ ] `packages/sdk/package.json`
- [ ] `packages/sdk/tsconfig.json`
- [ ] `scripts/generate-sdk.ts` - Generation script
- [ ] `packages/sdk/src/types.generated.ts` - Generated types
- [ ] `packages/sdk/src/events.ts` - Event type re-exports
- [ ] Build script in package.json

**Acceptance Criteria:**
- [ ] `bun run generate:sdk` extracts OpenAPI spec
- [ ] Types generated match API schemas exactly
- [ ] JSDoc comments preserved from Zod `.describe()`
- [ ] Event types exported for NATS consumers

**Validation:**
```bash
bun run generate:sdk
cat packages/sdk/src/types.generated.ts | head -100
```

---

## Execution Group B: Client Wrapper

**Goal:** Create nice DX wrapper around generated types.

**Deliverables:**
- [ ] `packages/sdk/src/client.ts` - Main client class
- [ ] `packages/sdk/src/index.ts` - Public exports
- [ ] Method wrappers for all endpoints
- [ ] Error handling
- [ ] Auth middleware

**Acceptance Criteria:**
- [ ] `createOmniClient({ baseUrl, apiKey })` creates client
- [ ] `omni.instances.list()` returns typed response
- [ ] `omni.messages.send({ instanceId, to, text })` works
- [ ] Errors are properly typed and thrown
- [ ] Full autocomplete in IDEs

**Validation:**
```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8881',
  apiKey: 'test-key',
});

// Should have full autocomplete
const instances = await omni.instances.list();
await omni.messages.send({
  instanceId: instances.items[0].id,
  to: '+1234567890',
  text: 'Hello!',
});
```

---

## Execution Group C: CI/CD & Publishing

**Goal:** Automate generation and publishing.

**Deliverables:**
- [ ] `.github/workflows/sdk.yml` - CI workflow
- [ ] Auto-regenerate on schema changes
- [ ] Auto-publish to npm on release
- [ ] Version sync with API

**Acceptance Criteria:**
- [ ] Push to main with schema changes triggers regeneration
- [ ] SDK version matches API version
- [ ] Published to npm as `@omni/sdk`
- [ ] README with usage examples

**Validation:**
```bash
# Simulate CI
bun run generate:sdk
bun run build
bun run test
```

---

## Technical Notes

### Generation Script

```typescript
// scripts/generate-sdk.ts
import { $ } from 'bun';

// 1. Generate OpenAPI spec from code
await $`bun run packages/api/src/openapi-export.ts > dist/openapi.json`;

// 2. Generate types
await $`bunx openapi-typescript dist/openapi.json -o packages/sdk/src/types.generated.ts`;

// 3. Build SDK
await $`cd packages/sdk && bun run build`;
```

### Client Structure

```typescript
// packages/sdk/src/client.ts
export function createOmniClient(config: OmniClientConfig) {
  const client = createClient<paths>({ baseUrl: config.baseUrl });
  client.use(authMiddleware(config.apiKey));

  return {
    instances: {
      list: (params?) => client.GET('/api/v2/instances', { params }),
      get: (id) => client.GET('/api/v2/instances/{id}', { params: { path: { id } } }),
      create: (data) => client.POST('/api/v2/instances', { body: data }),
      // ...
    },
    messages: {
      send: (data) => client.POST('/api/v2/messages', { body: data }),
      // ...
    },
    events: {
      list: (params?) => client.GET('/api/v2/events', { params }),
      // ...
    },
    // ...
  };
}
```

### Event Types Export

```typescript
// packages/sdk/src/events.ts
// Re-export event types for NATS consumers

export type {
  MessageReceivedEvent,
  MessageSentEvent,
  MessageStatusEvent,
  IdentityResolvedEvent,
  MediaProcessedEvent,
  ChannelConnectedEvent,
  ChannelDisconnectedEvent,
} from '@omni/core/events';
```

---

## Dependencies

- `openapi-typescript`
- `openapi-fetch`
- `@omni/core` (for event types)

---

## Depends On

- `api-setup` (for OpenAPI spec)

## Enables

- Type-safe API consumption
- External integrations
- CLI implementation
