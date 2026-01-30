# WISH: SDK Generation

> Auto-generate TypeScript SDK from OpenAPI spec with full type safety and excellent DX.

**Status:** REVIEW
**Created:** 2026-01-29
**Updated:** 2026-01-30
**Author:** WISH Agent
**Beads:** omni-v2-0cy

---

## Context

The API is shipped with a hand-written OpenAPI spec at `/api/v2/openapi.json`. This wish generates a TypeScript SDK from that spec, giving external consumers type-safe API access with full autocomplete.

**Current state (shipped with api-setup):**
- OpenAPI 3.1 spec at `/api/v2/openapi.json`
- Swagger UI at `/api/v2/docs`
- Routes: instances, messages, events, persons, access, settings, providers
- Auth: `x-api-key` header

**What this wish delivers:**
- `packages/sdk/` with generated types and client
- Nice wrapper class: `createOmniClient({ baseUrl, apiKey })`
- Full IDE autocomplete: `omni.instances.list()`, `omni.messages.send()`

Reference: `docs/sdk/auto-generation.md`, `docs/sdk/typescript-sdk.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | OpenAPI spec is exported from `packages/api/src/routes/openapi.ts` |
| **ASM-2** | Assumption | Spec is accurate enough to generate usable SDK |
| **DEC-1** | Decision | `openapi-typescript` for type generation |
| **DEC-2** | Decision | `openapi-fetch` for type-safe HTTP client |
| **DEC-3** | Decision | Wrapper class for nice DX (`omni.instances.list()`) |
| **DEC-4** | Decision | No CI/CD initially - local scripts only |
| **RISK-1** | Risk | Hand-written spec may drift from implementation - mitigate by testing SDK against live API |

---

## Scope

### IN SCOPE

- `packages/sdk/` package structure
- Type generation from OpenAPI spec
- `openapi-fetch` client setup
- Wrapper class with resource namespaces
- Error handling with typed errors
- Basic usage examples in README
- Generation script: `bun run generate:sdk`

### OUT OF SCOPE

- CI/CD automation (future wish)
- npm publishing (future wish)
- Python/Go SDKs (future wish)
- WebSocket client for real-time events (future wish)
- Migrating to `@hono/zod-openapi` for auto-generation (separate wish)

---

## Execution Group A: Package Setup & Type Generation

**Goal:** Create SDK package and generate TypeScript types from OpenAPI spec.

**Deliverables:**
- [ ] `packages/sdk/package.json` with dependencies
- [ ] `packages/sdk/tsconfig.json`
- [ ] `packages/sdk/src/types.generated.ts` - Generated from spec
- [ ] `scripts/generate-sdk.ts` - Generation script
- [ ] Root `package.json` script: `generate:sdk`

**Acceptance Criteria:**
- [ ] `bun run generate:sdk` fetches spec and generates types
- [ ] Generated types match API schemas (Instance, Event, Person, etc.)
- [ ] Package compiles with `bun run build`

**Validation:**
```bash
bun run generate:sdk
cat packages/sdk/src/types.generated.ts | head -50
cd packages/sdk && bun run build
```

---

## Execution Group B: Client Wrapper

**Goal:** Create developer-friendly wrapper around generated types.

**Deliverables:**
- [ ] `packages/sdk/src/client.ts` - OmniClient class
- [ ] `packages/sdk/src/errors.ts` - Typed error classes
- [ ] `packages/sdk/src/index.ts` - Public exports
- [ ] Resource namespaces: instances, messages, events, persons, access, settings, providers

**Acceptance Criteria:**
- [ ] `createOmniClient({ baseUrl, apiKey })` creates client
- [ ] `omni.instances.list()` returns typed paginated response
- [ ] `omni.instances.get(id)` returns typed Instance
- [ ] `omni.instances.create(data)` sends POST with typed body
- [ ] `omni.messages.send({ instanceId, to, text })` works
- [ ] Errors thrown as `OmniApiError` with code, message, details
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
const instance = await omni.instances.get(instances.items[0].id);
```

---

## Execution Group C: Testing & Documentation

**Goal:** Verify SDK works against live API and document usage.

**Deliverables:**
- [ ] `packages/sdk/src/__tests__/client.test.ts` - Integration tests
- [ ] `packages/sdk/README.md` - Usage documentation
- [ ] Export from monorepo: add to turbo.json if needed

**Acceptance Criteria:**
- [ ] Tests pass against running API
- [ ] README shows installation and basic usage
- [ ] All public types exported

**Validation:**
```bash
# Start API
make dev-api &

# Run SDK tests
cd packages/sdk && bun test

# Check exports
bun -e "import { createOmniClient } from './packages/sdk/src'; console.log(typeof createOmniClient)"
```

---

## Technical Notes

### Generation Script

```typescript
// scripts/generate-sdk.ts
import { $ } from 'bun';
import { mkdirSync, writeFileSync } from 'fs';
// Direct import - single source of truth, no server needed
import { openApiSpec } from '../packages/api/src/routes/openapi';

async function main() {
  console.log('Exporting OpenAPI spec...');
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/openapi.json', JSON.stringify(openApiSpec, null, 2));

  console.log('Generating TypeScript types...');
  await $`bunx openapi-typescript dist/openapi.json -o packages/sdk/src/types.generated.ts`;

  console.log('Done!');
}

main().catch(console.error);
```

### Client Structure

```typescript
// packages/sdk/src/client.ts
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './types.generated';
import { OmniApiError } from './errors';

export interface OmniClientConfig {
  baseUrl: string;
  apiKey: string;
}

export function createOmniClient(config: OmniClientConfig) {
  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('x-api-key', config.apiKey);
      return request;
    },
  };

  const client = createClient<paths>({ baseUrl: config.baseUrl });
  client.use(authMiddleware);

  return {
    instances: {
      list: async (params?) => {
        const { data, error } = await client.GET('/api/v2/instances', { params: { query: params } });
        if (error) throw OmniApiError.from(error);
        return data;
      },
      get: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/instances/{id}', { params: { path: { id } } });
        if (error) throw OmniApiError.from(error);
        return data;
      },
      create: async (body) => {
        const { data, error } = await client.POST('/api/v2/instances', { body });
        if (error) throw OmniApiError.from(error);
        return data;
      },
      // ... more methods
    },
    messages: {
      send: async (body) => {
        const { data, error } = await client.POST('/api/v2/messages', { body });
        if (error) throw OmniApiError.from(error);
        return data;
      },
    },
    // ... other resources

    // Raw client for advanced usage
    raw: client,
  };
}
```

---

## Dependencies

- `openapi-typescript` - Type generation
- `openapi-fetch` - Type-safe HTTP client

---

## Depends On

- `api-setup` ✅ (SHIPPED)

## Enables

- Type-safe API consumption
- External integrations
- CLI implementation (`packages/cli`)
- Future: Python/Go SDKs via openapi-generator
