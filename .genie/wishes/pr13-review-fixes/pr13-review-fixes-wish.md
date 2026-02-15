# WISH: PR #13 Review Fixes — Agent Dispatcher Bugs

> Fix 3 bugs found by Codex and Gemini code review on PR #13 (feat/omnichannel-agent-platform).

**Status:** SHIPPED
**Created:** 2026-02-09
**Author:** WISH Agent
**Beads:** omni-blj

---

## Problem Statement

PR #13 introduced the agent-dispatcher plugin with multi-event triggering. Code review by Codex and Gemini found 3 bugs ranging from missing NATS subscriptions to platform-specific blind spots and a memory leak.

## Assumptions

- **ASM-1**: The `reaction.removed` event already exists in the NATS event bus and follows the same payload shape as `reaction.received` (`ReactionReceivedPayload`).
- **ASM-2**: Telegram's `rawPayload.isMention` is a boolean set by the Telegram channel plugin when the bot is mentioned.
- **ASM-3**: The `ReactionDedup.seen` Map uses insertion-order iteration (JS Map spec), so evicting `keys().next().value` removes the oldest entry.

## Decisions

- **DEC-1**: All fixes scoped to `packages/api/src/plugins/agent-dispatcher.ts` only. No schema, event, or test file changes.
- **DEC-2**: `reaction.removed` subscription reuses `shouldProcessReaction` and `processReactionTrigger` with `rawEvent` set to `'reaction.removed'`.
- **DEC-3**: `messageCounters` cleanup uses an `onEvict` callback pattern — when a `seen` entry is deleted, extract the `messageId` from the key and decrement/delete the counter.

## Risks

- **RISK-1**: If `reaction.removed` events have a different payload shape than `reaction.received`, the subscription handler will fail silently. **Mitigation**: The handler already has try/catch with logging.
- **RISK-2**: Other platforms (Discord, Slack) may have their own mention detection patterns. **Mitigation**: Out of scope — this fix addresses Telegram only per review finding.

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| api | [x] plugins | agent-dispatcher.ts only |

### System Checklist

- [ ] **Events**: No new event types (reaction.removed already defined)
- [x] **Database**: No changes
- [x] **SDK**: No changes
- [x] **CLI**: No changes
- [ ] **Tests**: Existing tests should still pass; no new tests in scope

---

## Scope

### IN SCOPE

1. **Fix 1 (P1)**: Add NATS subscription for `reaction.removed` events in `setupAgentDispatcher()`
2. **Fix 2 (P2)**: Add Telegram `rawPayload.isMention` check in `buildMessageContext()`
3. **Fix 3 (P2)**: Fix `messageCounters` memory leak in `ReactionDedup` class

### OUT OF SCOPE

- New test files
- Changes to any other file
- Discord/Slack mention detection
- Schema or type changes
- Event bus changes

---

## Execution Group A: Agent Dispatcher Bug Fixes

**Goal:** Fix all 3 review findings in agent-dispatcher.ts

**Packages:** api

**Deliverables:**

- [ ] **Fix 1**: Add `reaction.removed` subscription (line ~931, after `reaction.received` subscription block)
  - Subscribe to `'reaction.removed'` with same handler pattern as `reaction.received`
  - Use durable name `'agent-dispatcher-reaction-removed'`
  - Pass `'reaction.removed'` as the `rawEvent` to `processReactionTrigger`
  - Update `shouldProcessReaction` call to check `instanceTriggersOnEvent(instance, 'reaction.removed')`

- [ ] **Fix 2**: Honor Telegram mentions (line ~272, `buildMessageContext`)
  - After the existing `mentionedJids` check, add: `|| rawPayload.isMention === true`
  - This makes `mentionsBot` true when either WhatsApp `mentionedJids` match OR Telegram `isMention` is set

- [ ] **Fix 3**: Fix memory leak in `ReactionDedup` (line ~163, eviction block)
  - When evicting a `seen` entry, parse the `messageId` from the composite key (`messageId:emoji:userId`)
  - Decrement the counter in `messageCounters` for that messageId
  - Delete the counter entry if it reaches 0

**Acceptance Criteria:**

- [ ] `reaction.removed` events are subscribed to and dispatched
- [ ] Telegram bot mentions are detected via `rawPayload.isMention`
- [ ] `messageCounters` entries are cleaned up when corresponding `seen` entries are evicted
- [ ] `make typecheck` passes
- [ ] `make lint` passes
- [ ] Existing tests pass (`make test-api`)

**Validation:**

```bash
make typecheck
make lint
make test-api
```
