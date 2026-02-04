# WISH: Add call_agent Automation Action

> Enable AI agent calls as an automation action type for composable workflows.

**Status:** REVIEW
**Created:** 2026-02-04
**Author:** WISH Agent
**Beads:** omni-uri

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
