# Wish: WhatsApp ↔ OpenClaw Integration Test (khal-whatsapp)

**Status:** IN_PROGRESS
**Slug:** `whatsapp-openclaw-integration-test`
**Created:** 2026-02-11
**Requested by:** Felipe

---

## Summary

Validate the existing OpenClaw provider integration end-to-end on WhatsApp by wiring the `khal-whatsapp` instance (`0567bded-23f6-439f-b49f-773fa7f47419`) to OpenClaw agent `khal`, then executing a full QA suite (functional, resilience, concurrency, and restart scenarios). If P0/P1 issues are found, fix them within this wish before close.

This is a **configuration + validation + hardening** wish, not a net-new provider build. The OpenClaw provider path already exists and is channel-agnostic; this wish proves production behavior on WhatsApp with real traffic patterns.

---

## Scope

### IN
- Wire `khal-whatsapp` instance to an OpenClaw provider + `agentId=khal`
- Confirm provider/gateway connectivity and dispatch path for WhatsApp messages
- Execute full QA matrix:
  - single-turn + multi-turn conversations
  - session continuity (`agent:khal:omni-<chatId>` behavior)
  - trash emoji session reset behavior
  - media-handling behavior (text + media placeholder semantics)
  - reconnect behavior after API restart
  - concurrent chats on same instance
  - latency/timeout behavior (ack timeout + accumulation timeout)
  - anti-bot safe send pacing adherence
- Collect evidence (logs, commands, outcomes, timings)
- Fix any P0/P1 issues discovered
- Document outcomes and residual issues

### OUT
- Building a new provider schema (already done by `openclaw-provider-integration`)
- Telegram onboarding changes (separate wish already covered)
- New channel plugin features unrelated to OpenClaw routing
- Large refactors for non-critical code quality nits (unless blocking P0/P1 fix)
- OpenClaw gateway protocol changes

---

## Decisions

- **DEC-1:** Target instance is `khal-whatsapp` only for this wish, to keep blast radius controlled.
- **DEC-2:** Agent target is explicitly `khal` (not `default`).
- **DEC-3:** Reuse existing OpenClaw provider if healthy; create a dedicated WhatsApp provider only if isolation is required.
- **DEC-4:** Treat this as a production-like validation: test realistic message cadence and preserve anti-bot protections.
- **DEC-5:** P0/P1 bugs found during execution are fixed inside the same wish; lower severity items are documented as follow-up issues.

---

## Risks & Mitigations

- **Risk:** WhatsApp anti-bot detection from burst test traffic.
  - **Mitigation:** enforce humanized pacing, avoid burst sends, observe PM2 logs while testing.
- **Risk:** Miswiring instance/provider causes silent fallback to legacy path.
  - **Mitigation:** verify `agentProviderId`, provider schema, and dispatch logs before tests.
- **Risk:** Restart/reconnect may expose token/session persistence gaps.
  - **Mitigation:** include restart scenario explicitly and validate reconnect state.
- **Risk:** Concurrent chat runs can interleave response accumulation incorrectly.
  - **Mitigation:** run deterministic concurrent test cases and verify runId/session isolation.

---

## Success Criteria

- [ ] `khal-whatsapp` is wired to OpenClaw provider with `agentId=khal` and confirmed active
- [ ] End-to-end WhatsApp → Omni → OpenClaw → Omni → WhatsApp round-trip works reliably
- [ ] Session continuity is confirmed across multi-turn same-chat interactions
- [ ] Session reset via trash emoji works correctly for WhatsApp chat context
- [ ] Restart/reconnect scenario passes without losing functional routing
- [ ] Concurrent chat test proves no cross-chat response leakage/interleaving
- [ ] P0/P1 defects discovered during testing are fixed and validated
- [ ] Final QA report produced with evidence and remaining non-critical follow-ups

---

## Execution Groups

### Group 1 — Wiring & Baseline Verification
**Goal:** Ensure `khal-whatsapp` is correctly configured for OpenClaw dispatch before QA execution.

**Deliverables**
- Confirm/create OpenClaw provider suitable for khal WhatsApp path
- Update `khal-whatsapp` instance:
  - `agentProviderId=<openclaw-provider-id>`
  - `agentId=khal`
- Validate connection and routing preconditions

**Acceptance Criteria**
- [x] Instance record reflects OpenClaw provider + `agentId=khal`
- [x] Provider connectivity test passes (verified via prod logs; CLI `providers test` has ws:// bug — see follow-up)
- [x] First smoke message returns from OpenClaw path (not legacy fallback) — traceId:325db37c, agentId:khal, durationMs:5992

**Validation Commands**
- `~/.omni/bin/omni providers list`
- `~/.omni/bin/omni instances get 0567bded-23f6-439f-b49f-773fa7f47419`
- `~/.omni/bin/omni instances status 0567bded-23f6-439f-b49f-773fa7f47419`
- API health checks + relevant PM2/API log grep for provider dispatch

**Likely Files Touched**
- No code expected (config-only); if needed:
  - `packages/api/src/plugins/agent-dispatcher.ts` (only if bug discovered)
  - operational docs/memory artifacts

---

### Group 2 — Full QA Matrix Execution (Functional + Resilience + Concurrency)
**Goal:** Execute comprehensive production-like validation on WhatsApp integration.

**Deliverables**
- Test suite execution log covering:
  1. single-turn message
  2. multi-turn session continuity
  3. trash emoji reset and post-reset behavior
  4. media input path behavior
  5. API restart + automatic recovery behavior
  6. concurrent chat dispatch isolation
  7. timeout/latency envelope checks
- Evidence bundle (commands + key logs + result table)

**Acceptance Criteria**
- [ ] All mandatory scenarios executed with PASS/FAIL outcome
- [ ] Any failing scenario has root cause identified
- [ ] No anti-bot safety regressions triggered during testing

**Validation Commands**
- `curl -s https://felipe.omni.namastex.io/api/v2/health`
- `pm2 logs omni-v2-api --nostream --lines 200`
- targeted log queries for `Agent response via IAgentProvider`, `openclaw`, `session reset`
- manual/automated send flows through existing WhatsApp instance

**Likely Files Touched**
- Test evidence docs under `docs/` or `memory/`
- No code unless defects found

---

### Group 3 — Fix Loop for P0/P1 Findings
**Goal:** Patch and verify any critical/high issues uncovered in Group 2.

**Deliverables**
- Implemented fixes for all discovered P0/P1 issues
- Regression validation for affected scenarios
- Clear changelog of what failed, what was fixed, and proof of fix

**Acceptance Criteria**
- [ ] No open P0/P1 defects remain for this integration path
- [ ] Re-run of failed scenarios now passes
- [ ] Typecheck/lint/tests pass for modified code scope

**Validation Commands**
- `make typecheck`
- `make lint`
- targeted `bun test <file>` for changed units
- re-run affected QA scenarios from Group 2

**Likely Files Touched**
- `packages/api/src/plugins/agent-dispatcher.ts`
- `packages/core/src/providers/openclaw/*`
- `packages/channel-whatsapp/src/plugin.ts`
- any additional touched test files

---

### Group 4 — Report, Handoff, and Follow-Ups
**Goal:** Close the wish with a crisp operational outcome and backlog items for non-critical improvements.

**Deliverables**
- Final report: verdict, test matrix, timings, fixes, residual risks
- Follow-up issue list for P2+ improvements (if any)

**Acceptance Criteria**
- [ ] Human-readable report is committed in-repo
- [ ] Follow-ups are clearly separated from shipped scope
- [ ] Ready-for-ops recommendation provided (GO / FIX-FIRST)

**Validation Commands**
- `git status`
- `git log --oneline -n 5`
- Optional: `bd create` for follow-ups and `bd sync`

**Likely Files Touched**
- `docs/reports/` (new report)
- `memory/2026-02-11.md` (session summary)

---

## Notes

- **BUG FOUND (P2):** `omni providers test` fails for `schema=openclaw` providers — CLI health check tries HTTP fetch on `ws://` URLs. Follow-up needed to add WS handshake check for OpenClaw providers.
- Existing baseline: OpenClaw integration merged in main (`e4b1cbb`) and verified on Telegram path.
- Current WhatsApp instances are mostly still on legacy/default provider wiring; this wish validates migration for `khal-whatsapp` first.
- Keep operational safety first: no aggressive automated bursts on WhatsApp.
