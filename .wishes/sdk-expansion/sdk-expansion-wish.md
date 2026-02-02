# WISH: SDK Expansion

> Complete the SDK wrapper methods to cover all API endpoints.

**Status:** REVIEW
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-db7

---

## Context

The SDK currently only wraps 8 of 16+ API route groups. The CLI and other clients need a complete SDK to avoid using the raw client directly. Additionally, we need an auth validation endpoint for CLI login flows.

**Current SDK Coverage:**
- ✅ instances, messages, events, persons, access, settings, providers, health

**Missing:**
- ❌ chats, logs, automations, dead-letters, event-ops, webhooks, media, auth, payloads

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | API endpoints are stable and documented |
| **DEC-1** | Decision | Add auth validation endpoint to API |
| **DEC-2** | Decision | Follow existing SDK wrapper patterns |
| **DEC-3** | Decision | Regenerate types after API changes |

---

## Scope

### IN SCOPE

- New API endpoint: `POST /api/v2/auth/validate`
- SDK wrapper methods for all missing route groups
- Regenerate SDK types
- Update SDK README

### OUT OF SCOPE

- Changing existing SDK patterns
- Breaking changes to current methods
- `/metrics` endpoint (infrastructure-only, scraped by Prometheus)

---

## Execution Group A: Auth Endpoint

**Goal:** Add auth validation endpoint to API.

**Deliverables:**
- [ ] `packages/api/src/routes/auth.ts` - Auth route
- [ ] Register route in `packages/api/src/routes/index.ts`
- [ ] Add to OpenAPI registry

**Acceptance Criteria:**
- [ ] `POST /api/v2/auth/validate` with `x-api-key` header returns `{ valid: true, keyPrefix: "omni_..." }`
- [ ] Invalid key returns 401
- [ ] Endpoint documented in OpenAPI

**Validation:**
```bash
curl -X POST http://localhost:8881/api/v2/auth/validate \
  -H "x-api-key: $API_KEY"
```

---

## Execution Group B: SDK Wrapper Methods

**Goal:** Add wrapper methods for all missing route groups.

**Deliverables:**
- [ ] `packages/sdk/src/client.ts` - Add missing resource groups

**Methods to Add:**

### Chats
```typescript
chats.list(params?)
chats.get(id)
chats.create(body)
chats.update(id, body)
chats.delete(id)
chats.archive(id)
chats.unarchive(id)
chats.getMessages(id, params?)
chats.listParticipants(id)
chats.addParticipant(id, body)
chats.removeParticipant(id, platformUserId)
```

### Auth
```typescript
auth.validate()
```

### Logs
```typescript
logs.recent(params?)
// Note: logs.stream() is SSE, may need different approach
```

### Automations
```typescript
automations.list(params?)
automations.get(id)
automations.create(body)
automations.update(id, body)
automations.delete(id)
automations.enable(id)
automations.disable(id)
automations.test(id, body)
automations.getLogs(id, params?)
```

### Dead Letters
```typescript
deadLetters.list(params?)
deadLetters.get(id)
deadLetters.stats()
deadLetters.retry(id)
deadLetters.resolve(id, body)
deadLetters.abandon(id)
```

### Event Ops
```typescript
eventOps.metrics()
eventOps.startReplay(body)
eventOps.listReplays()
eventOps.getReplay(id)
eventOps.cancelReplay(id)
```

### Webhooks
```typescript
webhooks.listSources(params?)
webhooks.getSource(id)
webhooks.createSource(body)
webhooks.updateSource(id, body)
webhooks.deleteSource(id)
```

### Payloads (debug/audit)
```typescript
payloads.listForEvent(eventId)
payloads.getStage(eventId, stage)
payloads.delete(eventId, body)
payloads.listConfigs()
payloads.updateConfig(eventType, body)
payloads.stats()
```

### Messages (expand existing)
```typescript
messages.sendMedia(body)
messages.sendReaction(body)
messages.sendSticker(body)
messages.sendContact(body)
messages.sendLocation(body)
messages.sendPoll(body)      // Discord
messages.sendEmbed(body)     // Discord
```

### Instances (expand existing)
```typescript
instances.status(id)
instances.qr(id)
instances.connect(id, body?)
instances.disconnect(id)
instances.restart(id)
instances.logout(id)
instances.pair(id, body)
instances.syncProfile(id)
instances.startSync(id, body)
instances.listSyncs(id, params?)
instances.getSyncStatus(id, jobId)
```

**Acceptance Criteria:**
- [ ] All methods follow existing SDK patterns
- [ ] TypeScript types inferred correctly
- [ ] Methods tested manually

---

## Execution Group C: Regenerate & Document

**Goal:** Update types and documentation.

**Deliverables:**
- [ ] Run `bun run generate:sdk`
- [ ] Update `packages/sdk/README.md` with new methods
- [ ] Verify types match API

**Validation:**
```bash
bun run generate:sdk
cd packages/sdk && bun run build
bun run typecheck
```

---

## Technical Notes

### SDK Pattern

```typescript
// Resource group pattern
get chats() {
  return {
    list: async (params?: ChatsListParams) => {
      const { data, error } = await this.client.GET('/api/v2/chats', {
        params: { query: params },
      });
      if (error) throw new OmniSDKError('Failed to list chats', error);
      return data;
    },
    // ... more methods
  };
}
```

### Auth Endpoint Response

```typescript
// POST /api/v2/auth/validate
// Request: x-api-key header
// Response:
{
  valid: true,
  keyPrefix: "omni_sk_abc...",  // First 12 chars for identification
  permissions: ["read", "write"]  // Future: scoped keys
}
```

---

## Dependencies

- None (API already exists)

## Enables

- `cli-setup` - CLI needs complete SDK
- Future SDK consumers

---

## Review Verdict

**Verdict:** FIX-FIRST
**Date:** 2026-02-02
**Reviewer:** REVIEW Agent

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Group A: Auth Endpoint** | | |
| `POST /api/v2/auth/validate` exists | PASS | `packages/api/src/routes/v2/auth.ts:18` |
| Returns `{ valid, keyPrefix, keyName, scopes }` | PASS | Response includes all fields |
| Invalid key returns 401 | PASS | Auth middleware rejects invalid keys |
| Endpoint documented in OpenAPI | PASS | `packages/api/src/schemas/openapi/auth.ts` registered |
| **Group B: SDK Wrapper Methods** | | |
| Chats methods (11 methods) | PASS | All implemented in `client.ts:727-886` |
| Auth.validate() | PASS | Implemented at `client.ts:559-569` |
| Logs.recent() | PASS | Implemented at `client.ts:1101-1107` |
| Automations (9 methods) | PASS | All implemented at `client.ts:1119-1231` |
| Dead Letters (6 methods) | PASS | All implemented at `client.ts:1240-1308` |
| Event Ops (5 methods) | PASS | All implemented at `client.ts:1317-1367` |
| Webhooks (6 methods) | PASS | All implemented at `client.ts:1376-1441` |
| Payloads (6 methods) | PASS | All implemented at `client.ts:1450-1516` |
| Messages expanded (7 methods) | PASS | All implemented at `client.ts:895-977` |
| Instances sync operations | **FAIL** | Missing: `syncProfile`, `startSync`, `listSyncs`, `getSyncStatus` |
| SDK patterns consistent | PASS | All methods follow existing error/response patterns |
| TypeScript types correct | PASS | `make typecheck` passes |
| **Group C: Types & Docs** | | |
| Types regenerated | PASS | `types.generated.ts` includes auth endpoint |
| README updated | PASS | All 16+ resource groups documented |
| SDK builds | PASS | `bun run build` succeeds |
| **Quality Gates** | | |
| `make check` passes | **FAIL** | Lint errors (formatting + complexity) |

### Findings

| Severity | Finding |
|----------|---------|
| **HIGH** | Missing SDK methods for sync operations - API has endpoints at `POST /instances/:id/sync/profile`, `POST /instances/:id/sync`, `GET /instances/:id/sync`, `GET /instances/:id/sync/:jobId` but SDK doesn't wrap them |
| **MEDIUM** | Lint errors in `make check` - formatting issues in SDK client and complexity warnings in API routes |
| LOW | `logs.stream()` SSE endpoint not wrapped (acknowledged in wish spec as "may need different approach") |

### Security Assessment

- ✅ No hardcoded credentials
- ✅ API key in header, not URL
- ✅ Auth middleware validates before handlers
- ✅ Error responses don't leak sensitive data
- ✅ Scopes field supports future fine-grained access

### Required Fixes Before Ship

1. **Add missing sync methods to SDK** (`packages/sdk/src/client.ts`):
   ```typescript
   instances.syncProfile(id)        // POST /instances/:id/sync/profile
   instances.startSync(id, body)    // POST /instances/:id/sync
   instances.listSyncs(id, params?) // GET /instances/:id/sync
   instances.getSyncStatus(id, jobId) // GET /instances/:id/sync/:jobId
   ```

2. **Fix lint errors** - Run `make lint-fix` and address remaining issues:
   - Formatting in `packages/sdk/src/client.ts`
   - Formatting in `packages/api/src/schemas/openapi/auth.ts`
   - Complexity warnings in API routes (refactor if feasible)

3. **Update SDK README** with sync method documentation

4. **Verify `make check` passes** after fixes

### Recommendation

Address the HIGH and MEDIUM findings above, then re-run `/review sdk-expansion`.
