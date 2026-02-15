# QA Results: Automation Condition Logic (OR Support)

**Verdict:** FAIL
**Date:** 2026-02-04
**Tester:** QA Agent

## Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| API | 3 | 1 | 0 |
| CLI | 1 | 0 | 0 |
| Integration | 0 | 1 | 0 |
| Regression | 756 | 0 | 28 |
| UI | N/A | N/A | N/A |

## Test Results

### API Tests
- [x] POST /api/v2/automations with `conditionLogic: "or"` → 201 + data includes conditionLogic ✓
- [x] GET /api/v2/automations/:id returns `conditionLogic` field ✓
- [x] POST /api/v2/automations/:id/execute works (manual execution) ✓
- [ ] **CRITICAL:** Engine doesn't use `conditionLogic` when evaluating conditions

### CLI Tests
- [x] `omni automations create --help` shows `--condition-logic` flag ✓

### Integration Tests
- [ ] **CRITICAL:** OR logic doesn't work in production - engine defaults to AND

### Regression Tests
- [x] `make test` passes (756 pass, 0 fail) ✓
- [x] SDK coverage 100% ✓

## Failures

### [CRITICAL] Engine doesn't pass conditionLogic to condition evaluator

**Test:** Create automation with OR conditions, verify it matches when ANY condition passes
**Expected:** Automation should trigger when text contains "help" OR "support"
**Actual:** Engine always uses AND logic (default) regardless of `conditionLogic` setting

**Root Cause Analysis:**
The automation engine at `packages/core/src/automations/engine.ts` calls `evaluateConditionsWithDetails()` without passing the `conditionLogic` parameter:

```typescript
// Line 371-374 - Missing conditionLogic parameter
const conditionResult = evaluateConditionsWithDetails(
  automation.triggerConditions,
  event.payload,  // <-- Missing: automation.conditionLogic
);
```

The function signature accepts `logic` as third parameter (defaults to 'and'):
```typescript
// conditions.ts line 198-201
export function evaluateConditionsWithDetails(
  conditions: AutomationCondition[] | null | undefined,
  payload: Record<string, unknown>,
  logic: ConditionLogic = 'and',  // <-- This needs to be passed
)
```

**Files to fix:**
1. `packages/core/src/automations/engine.ts` - Line 371-374 and Line 497-500
   - Pass `automation.conditionLogic ?? 'and'` as third parameter to `evaluateConditionsWithDetails()`

**Evidence:**
- API test confirms `conditionLogic: "or"` is stored correctly in database
- Unit tests for `evaluateConditions()` pass (OR logic works when parameter is passed)
- Integration test fails (engine doesn't pass the parameter)

## Recommendation

**Back to FORGE** - Fix the engine to pass `conditionLogic` to the condition evaluator.

The fix is simple (2 lines), but OR logic is non-functional without it.
