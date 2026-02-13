# Wish: trigger_logs Writer (Cross-Provider Observability)

**Status:** DRAFT
**Beads:** omni-6ek
**Slug:** `trigger-logs-writer`
**Created:** 2026-02-10

---

## Summary

Implement a generic, cross-provider INSERT path for `trigger_logs` so every agent dispatch (provider or legacy) is recorded with duration, outcome, and correlation identifiers.

---

## Why

- `trigger_logs` table exists but is effectively unused
- OpenClaw integration introduced richer observability expectations (traceId, runId, sessionKey), but logging must be consistent across *all* providers

---

## Scope

### IN
- Write `trigger_logs` rows for:
  - Provider path (`IAgentProvider.trigger()`)
  - Legacy path (`agentRunner.run()`)
  - Reaction triggers
- Ensure correlation fields exist (e.g., `traceId`, `instanceId`, `providerId`, `chatId`, `senderId`, `runId` if available)
- Add an index strategy if needed (e.g., `traceId`, `instanceId`, time)

### OUT
- Dashboards/UI (separate wish)

---

## Acceptance Criteria

- [ ] Every agent response attempt produces a `trigger_logs` row
- [ ] `responded`, `respondedAt`, `durationMs`, and `error` set consistently
- [ ] Provider metadata stored in JSONB (runId, sessionKey, agentId, wsRequestId if available)
- [ ] Backwards compatible: no behavior change besides recording logs
- [ ] Tests: unit test for insert call + at least one integration test (or DB mock)

---

## Execution Plan

- Add a small service in API package: `recordTriggerLog({ ... })`
- Call it in both dispatch paths (provider + legacy)
- Ensure errors don’t block sending a reply (log insert failures are non-fatal)

---

## Origin

This was identified during OpenClaw provider review: comments referenced trigger_logs, but no INSERT logic existed.
