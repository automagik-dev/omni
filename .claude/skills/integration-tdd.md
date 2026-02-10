---
name: integration-tdd
description: Use when implementing API/service changes - enforces test-driven development for integration tests using existing fixtures
---

# Integration Test-Driven Development

## Overview

For API and service changes, write integration tests FIRST using existing fixtures.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

## When to Use

**Always for:**
- New API endpoints
- Service layer changes
- Event handlers
- Database operations
- Channel integrations

**Existing fixtures available:**
- API test helpers in `packages/api/src/__tests__/`
- Database fixtures and factories
- Event bus mocks
- Channel simulators

## The Cycle

```
RED → GREEN → REFACTOR
```

### 1. RED - Write Failing Test

Write integration test using existing fixtures:

```typescript
// packages/api/src/__tests__/integration/feature.test.ts
import { createTestContext } from '../helpers';

describe('Feature', () => {
  it('should do expected behavior', async () => {
    const ctx = await createTestContext();

    const result = await ctx.api.post('/api/v2/feature', {
      // request body
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      // expected response
    });
  });
});
```

### 2. Verify RED

```bash
bun test packages/api/src/__tests__/integration/feature.test.ts
```

**Confirm:**
- Test fails (not errors)
- Failure is because feature is missing
- NOT because of typos or test bugs

**Test passes immediately?** You're testing existing behavior. Fix the test.

### 3. GREEN - Minimal Implementation

Write the simplest code to make the test pass:

```typescript
// Only implement what the test requires
// No extra features, no "improvements"
```

### 4. Verify GREEN

```bash
bun test packages/api/src/__tests__/integration/feature.test.ts
```

**Confirm:**
- Test passes
- Other tests still pass
- No errors or warnings

### 5. REFACTOR

After green only:
- Remove duplication
- Improve names
- Extract helpers

**Keep tests green throughout refactoring.**

## Red Flags

- Writing implementation before test
- Test passes on first run (didn't see it fail)
- Skipping the verify steps
- "I'll add tests later"
- Mocking everything instead of using fixtures

## Mock Boundary Rule

**Never mock away the boundary you're supposed to test.**

When code publishes an event that a downstream consumer processes, you MUST verify:
1. The payload is **valid for the consumer** (not just that publish was called)
2. IDs passed across boundaries match their target schema (UUID column = UUID value)
3. Auth headers match what the receiving service expects
4. DB rows are created before referencing them

### Anti-Pattern: Mock Hides Real Bug

```typescript
// BAD: Mocks eventBus, never checks if jobId is valid for sync_jobs.id (UUID column)
const mockEventBus = { publishGeneric: mock(async () => ({ id: 'test-id' })) };
// Test passes! But live system crashes: "invalid input syntax for type uuid"

// GOOD: Use the real service that creates the DB row + publishes event
const job = await services.syncJobs.create({ instanceId, channelType, type });
// Test verifies jobId is a UUID that the sync-worker can actually look up
expect(body.data.jobId).toMatch(/^[0-9a-f-]{36}$/);
```

### Anti-Pattern: Wrong Auth Header

```typescript
// BAD: Test doesn't verify the auth header format against the API middleware
headers: { Authorization: `Bearer ${apiKey}` }  // API expects x-api-key!

// GOOD: Check how other commands in the same codebase send auth, be consistent
headers: { 'x-api-key': apiKey }  // Matches what API middleware reads
```

### Rule of Thumb

If your code **sends data to another component** (event, HTTP call, DB query), your test must verify the data is **valid for the receiving component**, not just that it was sent.

## Why Integration TDD (Not Unit TDD)

Unit tests with mocks often become flaky because:
- Mocks drift from real implementations
- Agents create brittle mock setups
- Tests pass but real integration fails
- **Mocked boundaries hide type mismatches** (string vs UUID, wrong headers)

Integration tests with fixtures:
- Test real behavior
- Use actual database, events, services
- Fixtures maintained alongside code
- Catch real integration issues

## Available Test Helpers

Check these locations for existing fixtures:

```
packages/api/src/__tests__/
├── helpers/           # Test context, API helpers
├── fixtures/          # Data factories
└── integration/       # Integration test examples

packages/core/src/__tests__/
├── events/            # Event test helpers
└── fixtures/          # Core data fixtures
```

## Verification Checklist

Before marking implementation complete:

- [ ] Integration test exists
- [ ] Watched test fail before implementing
- [ ] Test failed for expected reason (feature missing)
- [ ] Wrote minimal code to pass
- [ ] All tests pass (`make test`)
- [ ] No flaky behavior

## Integration with Workflow

- `/forge` should use this for API/service changes
- `/qa` validates the integration tests actually work
- `/review` checks that tests exist and are meaningful
