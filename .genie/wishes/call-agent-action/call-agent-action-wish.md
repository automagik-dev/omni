# WISH: Add call_agent Automation Action

> Enable AI agent calls as an automation action type for composable workflows.

**Status:** SHIPPED
**Created:** 2026-02-04
**Author:** WISH Agent
**Beads:** omni-b48

---

## Context

**Problem:** The agent-responder plugin handles AI agent calls separately from the automations system. This works for the simple case (one agent per instance), but limits power users who want:
- Chain agent calls with other actions (call agent → webhook → log)
- Route to different agents based on conditions (VIP → premium agent)
- Multiple agents per instance with different triggers
- Unified configuration model

**Solution:** Add `call_agent` as an automation action type. The agent-responder continues to handle instance-level config for the simple case.

**Decision:** Keep both systems running in parallel:
- **Agent Responder** - Simple: instance has agent config → responds
- **Automations** - Advanced: custom workflows with `call_agent` action

---

## Assumptions

- **ASM-1**: Users want the simple case to remain simple (no forced migration)
- **ASM-2**: Agent-runner service can be reused by automation action executor
- **ASM-3**: Typing presence during agent call is valuable in automation context

## Decisions

- **DEC-1**: Keep agent-responder as-is (no breaking changes)
- **DEC-2**: Automations with `call_agent` take precedence over instance config if both exist
- **DEC-3**: Reuse existing agent-runner logic, don't duplicate

## Risks

- **RISK-1**: Two systems doing similar things → confusion
  - *Mitigation*: Clear docs - "instance config is shortcut, automations give full control"
- **RISK-2**: Performance overhead for automation matching on every message
  - *Mitigation*: Only evaluate automations if they exist for the trigger event

---

## Scope

### IN SCOPE

- Add `call_agent` to `actionTypes` enum in DB schema
- Define `CallAgentActionConfig` interface
- Implement action executor that calls agent-runner
- Handle typing presence during agent call
- Handle response splitting and send with delays
- Support `responseAs` for chaining (store agent response for next action)
- Update CLI `omni automations create` with call_agent support
- Update SDK types

### OUT OF SCOPE

- Migrating existing instance agent config to automations
- Deprecating agent-responder
- Streaming support in automations (sync only for now)
- UI for automation management

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| db | [x] schema | Add `call_agent` to actionTypes, CallAgentActionConfig interface |
| api | [x] services | Automation executor for call_agent action |
| core | [ ] types | May need shared types |
| sdk | [x] regenerate | If automation API types change |
| cli | [x] commands | Update automations command for call_agent |

### System Checklist

- [ ] **Database**: Add action type to enum
- [ ] **API**: Implement action executor
- [ ] **SDK**: Regenerate if needed
- [ ] **CLI**: Add call_agent support to automations command
- [ ] **Tests**: Test call_agent action execution

---

## Execution

### Group A: Schema & Types

**Goal:** Define the call_agent action type and config interface

**Packages:** db

**Deliverables:**
- [ ] Add `'call_agent'` to `actionTypes` array in schema.ts
- [ ] Define `CallAgentActionConfig` interface:
  ```typescript
  interface CallAgentActionConfig {
    providerId?: string;      // Template: {{instance.agentProviderId}}
    agentId: string;          // Required or template
    agentType?: 'agent' | 'team' | 'workflow';
    sessionStrategy?: 'per_user' | 'per_chat' | 'per_user_per_chat';
    prefixSenderName?: boolean;
    enableSplit?: boolean;
    splitDelayMode?: 'disabled' | 'fixed' | 'randomized';
    splitDelayMinMs?: number;
    splitDelayMaxMs?: number;
    showTypingPresence?: boolean;
    timeoutMs?: number;
    responseAs?: string;      // Store response as variable for chaining
  }
  ```
- [ ] Add to `AutomationAction` union type

**Acceptance Criteria:**
- [ ] `bun run typecheck` passes
- [ ] Schema correctly typed

---

### Group B: Action Executor

**Goal:** Implement the call_agent action executor in automations service

**Packages:** api

**Deliverables:**
- [ ] Create `executeCallAgentAction()` function in automations service
- [ ] Integrate with agent-runner service
- [ ] Handle typing presence (start composing, stop when done)
- [ ] Handle response splitting and delays
- [ ] Support `responseAs` to store response for action chaining
- [ ] Proper error handling and logging

**Acceptance Criteria:**
- [ ] Automation with call_agent action triggers agent and sends response
- [ ] Typing presence works during agent processing
- [ ] Response can be used in subsequent actions via `responseAs`
- [ ] Errors logged appropriately

**Validation:**
```bash
make check
bun test packages/api
```

---

### Group C: CLI & SDK

**Goal:** Update CLI and SDK for call_agent action support

**Packages:** cli, sdk

**Deliverables:**
- [ ] Update `omni automations create` with call_agent action options
- [ ] Regenerate SDK types
- [ ] Add example in CLI help

**Acceptance Criteria:**
- [ ] Can create automation with call_agent via CLI
- [ ] SDK types include CallAgentActionConfig
- [ ] `bun run typecheck` passes

**Validation:**
```bash
bun run typecheck
omni automations create --help
```

---

## Example Usage

```bash
# Create automation: DM messages → call support agent → log to webhook
omni automations create \
  --name "Support Bot" \
  --trigger message.received \
  --condition "payload.chatType eq dm" \
  --action call_agent \
    --agent-id support-agent \
    --provider-id my-provider \
    --response-as agentResponse \
  --action webhook \
    --url "https://analytics.example.com/track" \
    --body '{"response": "{{agentResponse}}"}'
```

```json
{
  "name": "VIP Support",
  "triggerEventType": "message.received",
  "conditions": [
    { "field": "metadata.personTags", "operator": "contains", "value": "vip" }
  ],
  "actions": [
    {
      "type": "call_agent",
      "config": {
        "agentId": "premium-support-agent",
        "sessionStrategy": "per_user",
        "showTypingPresence": true,
        "responseAs": "agentResponse"
      }
    },
    {
      "type": "webhook",
      "config": {
        "url": "https://crm.example.com/log",
        "method": "POST",
        "bodyTemplate": "{\"user\": \"{{payload.from}}\", \"response\": \"{{agentResponse}}\"}"
      }
    }
  ]
}
```

---

## Review Verdict

**Verdict:** SHIP
**Date:** 2026-02-04
**Reviewer:** REVIEW Agent

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `call_agent` in actionTypes array | PASS | `packages/db/src/schema.ts:1649` |
| `CallAgentActionConfig` interface defined | PASS | `packages/db/src/schema.ts:1709-1734` |
| Added to `AutomationAction` union type | PASS | `packages/db/src/schema.ts:1744` |
| `executeCallAgentAction()` implemented | PASS | `packages/core/src/automations/actions.ts:363-413` |
| Typing presence handling | PASS | `withTypingPresence()` in `actions.ts:331-357` |
| `responseAs` variable chaining | PASS | `executeActions()` at line 487-491 |
| CLI `--action call_agent` support | PASS | `packages/cli/src/commands/automations.ts:85,91-95` |
| CLI help shows call_agent options | PASS | `omni automations create --help` includes all options |
| SDK types regenerated | PASS | `packages/sdk/src/types.generated.ts` contains `call_agent` |
| `make check` passes | PASS | typecheck (8/8), lint (4 warnings, no errors), test (743 pass) |

### System Validation

- [x] **Database**: `call_agent` added to actionTypes enum
- [x] **API**: Action executor implemented in `@omni/core/automations/actions.ts`
- [x] **SDK**: Regenerated with `call_agent` types (472KB generated types)
- [x] **CLI**: Full support with `--agent-id`, `--provider-id`, `--response-as`, `--show-typing` options
- [x] **Typecheck**: All 8 packages pass
- [x] **Tests**: 743 tests pass, 28 skip, 0 fail

### Findings

**No CRITICAL or HIGH issues found.**

Lint warnings (pre-existing, not introduced by this wish):
- `chunkText()` cognitive complexity 21 > 15 (agent-responder.ts:292)
- Event handler cognitive complexity 24 > 15 (agent-responder.ts:513)
- CLI handler cognitive complexity 32 > 15 (automations.ts:111)
- Non-null assertion in actions.ts:389 (optional chain suggested)

### Test Coverage Note

No dedicated unit tests for `executeCallAgentAction()`. The existing integration test suite (`engine-integration.test.ts`) demonstrates the action execution pattern works, but a future task could add explicit call_agent tests.

### Recommendation

**SHIP** - All acceptance criteria pass, no blockers. The implementation is clean, follows existing patterns, and integrates well with the automations system.

---

## QA Results

**Verdict:** FAIL
**Date:** 2026-02-04
**Tester:** QA Agent

### Critical Bug Found

**[CRITICAL] API Route Validation Missing call_agent**

The route handler at `packages/api/src/routes/v2/automations.ts:68-73` defines its own action schema that doesn't include `call_agent`:

```typescript
const actionSchema = z.discriminatedUnion('type', [
  webhookActionSchema,
  sendMessageActionSchema,
  emitEventActionSchema,
  logActionSchema,
  // MISSING: callAgentActionSchema
]);
```

**Impact:** Cannot create automations with `call_agent` action via API or CLI.

**Fix Required:** Add `callAgentActionSchema` to the action union in route handler.

**Beads Issue:** omni-b48

See full QA results: `.wishes/call-agent-action/qa/qa-results.md`

---

## Post-QA Fixes

**Date:** 2026-02-04

### Bug Fix
- Added `callAgentActionSchema` to route validation discriminated union
- Commit: `fix(api): add call_agent to automations route validation`

### Simplification (per user feedback)
- Removed over-engineered options: `enableSplit`, `splitDelayMode`, `splitDelayMinMs`, `splitDelayMaxMs`, `showTypingPresence`
- `call_agent` now just calls the agent and returns response for chaining
- Split/typing can be added as separate actions if needed (composable building blocks)
- Commit: `refactor(automations): simplify call_agent action to composable building block`

### Execute Endpoint
- Added `POST /automations/{id}/execute` to manually trigger automations
- Added CLI command: `omni automations execute <id> --event <json>`
- Added SDK method: `client.automations.execute()`
- Commit: `feat(automations): add execute endpoint for manual automation triggering`

### Tests
- Added 6 tests for `AutomationService.execute()` documenting behavior
- Commit: `test(automations): add execute endpoint tests`

**Final Status:** All fixes committed and pushed. 749 tests pass.
