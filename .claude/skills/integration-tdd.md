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

## Why Integration TDD (Not Unit TDD)

Unit tests with mocks often become flaky because:
- Mocks drift from real implementations
- Agents create brittle mock setups
- Tests pass but real integration fails

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
