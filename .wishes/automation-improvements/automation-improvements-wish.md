# WISH: Automation Condition Logic (OR Support)

> Add OR logic support for automation trigger conditions.

**Status:** REVIEW
**Created:** 2026-02-02
**Updated:** 2026-02-04
**Author:** WISH Agent
**Beads:** omni-agi

---

## Context

**Problem:** Automation conditions currently only support AND logic - all conditions must match. Users need OR logic for patterns like "trigger if message contains 'help' OR 'support' OR 'urgent'".

**Discovery:** During review, we found 3/4 original requirements were already implemented:
- ✅ Action chains (sequential execution with `responseAs` variable chaining)
- ✅ Error handling (continues to next action when one fails)
- ✅ Logging/audit trail (`automationLogs` table stores execution results)
- ❌ OR logic for conditions (only AND exists)

**Solution:** Add a `conditionLogic` field to automations. Simple approach - all conditions in an automation use the same logic (AND or OR).

---

## Assumptions

- **ASM-1**: Simple AND/OR per automation is sufficient (no nested groups needed)
- **ASM-2**: Default to 'and' for backwards compatibility
- **ASM-3**: Existing automations continue to work unchanged

## Decisions

- **DEC-1**: Add `conditionLogic` column with default 'and' (backwards compatible)
- **DEC-2**: Keep condition array structure unchanged
- **DEC-3**: No migration needed - existing automations use default 'and'

## Risks

- **RISK-1**: Users may want mixed AND/OR in same automation
  - *Mitigation*: Can add condition groups in future wish if needed

---

## Scope

### IN SCOPE

- Add `conditionLogic: 'and' | 'or'` field to automations schema
- Update condition evaluation to support OR logic
- Update API validation and OpenAPI docs
- Update CLI with `--condition-logic` flag
- Add tests for OR logic

### OUT OF SCOPE

- Nested condition groups (e.g., `(A AND B) OR (C AND D)`)
- UI for automation management
- Migration of existing automations

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| db | [x] schema | Add `conditionLogic` column |
| core | [x] types, [x] conditions | Add type, update evaluateConditions |
| api | [x] routes, [x] schemas | Add validation, OpenAPI |
| sdk | [x] regenerate | Schema changed |
| cli | [x] commands | Add `--condition-logic` flag |

### System Checklist

- [x] **Database**: Add `conditionLogic` column, run `make db-push`
- [x] **Core**: Update `evaluateConditions()` for OR logic
- [x] **API**: Add to route validation and OpenAPI schema
- [x] **SDK**: Regenerate after API changes
- [x] **CLI**: Add `--condition-logic` option to create command
- [x] **Tests**: Add OR logic tests to conditions.test.ts

---

## Execution

### Group A: Schema & Core Logic

**Goal:** Add conditionLogic field and implement OR evaluation

**Packages:** db, core

**Deliverables:**
- [x] Add `conditionLogic` column to `automations` table in schema.ts
- [x] Add `conditionLogic` to `Automation` type in core/types.ts
- [x] Update `evaluateConditions()` to accept logic parameter
- [x] Add tests for OR condition evaluation

**Acceptance Criteria:**
- [x] `make db-push` succeeds
- [x] `evaluateConditions([...], payload, 'or')` returns true if ANY condition matches
- [x] Default 'and' behavior unchanged
- [x] Tests pass

**Validation:**
```bash
make db-push
bun test packages/core/src/automations/__tests__/conditions.test.ts
```

---

### Group B: API & CLI

**Goal:** Expose conditionLogic through API and CLI

**Packages:** api, cli, sdk

**Deliverables:**
- [x] Add `conditionLogic` to route validation schema
- [x] Add to OpenAPI documentation
- [x] Add `--condition-logic <and|or>` to CLI create command
- [x] Regenerate SDK

**Acceptance Criteria:**
- [x] Can create automation with `conditionLogic: 'or'` via API
- [x] Can create automation with `--condition-logic or` via CLI
- [x] SDK types include `conditionLogic` field
- [x] `make check` passes

**Validation:**
```bash
make check
cd packages/sdk && bun run build
omni automations create --help | grep condition-logic
```

---

## Example Usage

```bash
# Create automation that triggers on ANY keyword match
omni automations create \
  --name "Support Keywords" \
  --trigger message.received \
  --condition-logic or \
  --condition '[{"field":"payload.text","operator":"contains","value":"help"},{"field":"payload.text","operator":"contains","value":"support"},{"field":"payload.text","operator":"contains","value":"urgent"}]' \
  --action log --action-config '{"level":"info","message":"Support keyword detected"}'
```

```json
{
  "name": "Support Keywords",
  "triggerEventType": "message.received",
  "conditionLogic": "or",
  "triggerConditions": [
    { "field": "payload.text", "operator": "contains", "value": "help" },
    { "field": "payload.text", "operator": "contains", "value": "support" },
    { "field": "payload.text", "operator": "contains", "value": "urgent" }
  ],
  "actions": [{ "type": "log", "config": { "level": "info", "message": "Support keyword detected" } }]
}
```
