# QA Results: Add call_agent Automation Action

**Verdict:** FAIL
**Date:** 2026-02-04
**Tester:** QA Agent

## Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| API | 0 | 1 | 0 |
| CLI | 0 | 1 | 0 |
| Integration | N/A | N/A | N/A |
| Regression | 743 | 0 | 28 |

## Test Results

### API Tests

- [ ] **FAIL** POST /api/v2/automations with `call_agent` action
  - Expected: 201 Created
  - Actual: 400 with `Invalid discriminator value. Expected 'webhook' | 'send_message' | 'emit_event' | 'log'`

```bash
curl -X POST http://localhost:8881/api/v2/automations \
  -H "x-api-key: $OMNI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QA Test Agent Bot",
    "triggerEventType": "message.received",
    "actions": [{"type": "call_agent", "config": {"agentId": "test-agent"}}],
    "enabled": false
  }'
```

Response:
```json
{"success":false,"error":{"issues":[{"code":"invalid_union_discriminator","options":["webhook","send_message","emit_event","log"],"path":["actions",0,"type"],"message":"Invalid discriminator value. Expected 'webhook' | 'send_message' | 'emit_event' | 'log'"}],"name":"ZodError"}}
```

### CLI Tests

- [ ] **FAIL** `omni automations create --action call_agent`
  - Expected: Automation created
  - Actual: `Failed to create automation:` (API returns 400)

- [x] **PASS** CLI help shows call_agent options correctly

### Regression Tests

- [x] **PASS** `make test` - 743 tests pass, 0 fail
- [x] **PASS** API health check
- [x] **PASS** Other automation action types work (webhook, send_message, emit_event, log)

## Critical Bug Found

### [CRITICAL] API Route Validation Missing call_agent

**Location:** `packages/api/src/routes/v2/automations.ts:68-73`

**Problem:** The route handler defines its own action schema that doesn't include `call_agent`:

```typescript
const actionSchema = z.discriminatedUnion('type', [
  webhookActionSchema,
  sendMessageActionSchema,
  emitEventActionSchema,
  logActionSchema,
  // MISSING: callAgentActionSchema
]);
```

**Impact:**
- Cannot create automations with `call_agent` action via API
- Cannot create automations with `call_agent` action via CLI (uses API)
- Feature is unusable despite code implementation being complete

**Fix Required:**
1. Add `callAgentActionSchema` to the action union in route handler
2. Ensure it matches the schema in `packages/api/src/schemas/openapi/automations.ts`

**Evidence:**
- API response captured above
- OpenAPI schema at `packages/api/src/schemas/openapi/automations.ts:57-86` correctly includes `CallAgentActionSchema`
- DB schema at `packages/db/src/schema.ts:1649` includes `call_agent`
- Core executor at `packages/core/src/automations/actions.ts:363-413` implements `executeCallAgentAction`

## Verdict Details

**QA FAIL** - Critical functionality broken:
- The `call_agent` action type cannot be used because the API route validation rejects it
- All other components (DB schema, OpenAPI schema, core executor, CLI options, SDK types) are correctly implemented
- Only the route handler validation schema was missed

## Recommendation

1. Fix the route validation schema in `packages/api/src/routes/v2/automations.ts`
2. Re-run QA to verify fix
3. Then proceed to `/review`
