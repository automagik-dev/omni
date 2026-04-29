# Evidence — 559-close-contact

Verification log for the close-contact wish. Filled during implementation.

## Pre-implementation

- [ ] Design doc reviewed by Cezar
- [ ] Defaults for cooldown/escalation reviewed by ops
- [ ] Gupshup partner confirmed Journey terminal node in homolog

## Phase 1 — Backend Omni

### Type extensions
- [ ] `'CLOSE_CONTACT'` in `GupshupMsgType` union
- [ ] `canCloseContact` capability added to channel SDK
- [ ] `'contact_closed'` in `FollowUpDisarmReason`
- [ ] `ChatClosedPayload` event type registered

### Migration
- [ ] `close_contact_logs` table created
- [ ] Indexes on `(chat_uuid, outcome, sent_at DESC)` and `(instance_id, sent_at DESC)`
- [ ] Migration is forward-only (no data backfill)
- [ ] Migration runs cleanly on existing dev DB

### Code paths
- [ ] `senders/close-contact.ts` payload shape matches handoff convention
- [ ] Plugin dispatch branches on `meta?.isCloseContact === true`
- [ ] Capability gate in route returns 400 for non-Gupshup
- [ ] Outcome-conditional `closed` flag set correctly per outcome
- [ ] Escalation query bounded by `escalation_window`
- [ ] `chat.closed` event emitted with full payload
- [ ] Follow-up hook subscriber disarms with `'contact_closed'`
- [ ] Dispatcher gate: `closed === true` → skip permanently
- [ ] Dispatcher gate: `closeUntil` future → skip
- [ ] Dispatcher gate: `closeUntil` past → flip + proceed
- [ ] `/chats/:id/reopen-contact` requires admin scope
- [ ] CLI verb `omni close-contact` wired to endpoint

### Tests (acceptance)
- [ ] Sender payload shape unit test
- [ ] Lifecycle disarm reason `'contact_closed'` unit test
- [ ] Route happy paths (soft + hard outcome)
- [ ] Route escalation: 2× same outcome within window → terminal
- [ ] Route escalation reset: 2× same outcome past window → still soft
- [ ] Route capability gate: non-Gupshup → 400
- [ ] Dispatcher: `closed: true` → skip
- [ ] Dispatcher: `closeUntil` future → skip
- [ ] Dispatcher: `closeUntil` past → flip and proceed
- [ ] Follow-up hook fires on `chat.closed`
- [ ] Manual reopen clears all five settings fields
- [ ] Full @omni/api suite green

### Manual QA on homolog
- [ ] Send simulated lead → tool fires → `close_contact_logs` row exists
- [ ] Settings show `closeUntil ≈ now + 24h` for `redirected_sac`
- [ ] Wait > cooldown → next inbound → dispatcher reopens, agent responds
- [ ] Repeat within 7d → assert escalation → next inbound → no agent response
- [ ] `POST /chats/:id/reopen-contact` clears state

## Phase 2 — Tool agno-api (genie-hv-eugenia repo)

(filled separately when implementation lands)

## Phase 5 — QA scenarios

- [ ] `regression-005-cliente-atual-sac.yaml` passes
- [ ] `regression-007-close-contact-escalation.yaml` passes
- [ ] `regression-008-close-contact-cooldown-expiry.yaml` passes

## Phase 6 — Rollout

- [ ] Feature-flag enabled on Hapvida instance only
- [ ] 7-day monitor window of `close_contact_logs`
- [ ] Escalation rate sanity-check (no false-positives)
- [ ] Tune defaults if needed

## Sign-off

- [ ] Cezar review approved
- [ ] Pedro: merged to dev
- [ ] Pedro: promoted to prod
