# Wish: OpenClaw Provider — Review Fixes Before Merge

**Status:** DRAFT
**Slug:** `openclaw-provider-review-fixes`
**Created:** 2026-02-10
**Depends on:** `openclaw-provider-integration` implementation branch `feat/openclaw-provider`

---

## Summary

Apply the independent 3-way review findings (Ink, Pearl, Coral) to harden the OpenClaw provider implementation before merging to `dev`.

---

## Scope

### IN
- OpenClaw client/provider fixes:
  - Two-phase timeout: apply 10s send-ack budget to `chatSend()` acknowledgement, not only `waitForReady()`
  - Fix time-to-first-delta (TTFD) calculation
  - Improve chatId sanitization (strip control chars, length cap)
  - Add real `wsRequestId` correlation (WS frame id) and log it
  - Make `request()` timeout configurable per request
- API/dispatcher fixes:
  - Provider dispatch must not drop media-only messages (pass files or add placeholder)
  - Provider dispatch errors must fall back to legacy (wrap provider dispatch in try/catch)
  - Use `Promise.allSettled()` (or equivalent) for shutdown + add top-level timeout
  - Add test helper to reset module-level caches (test isolation)
- Wiring fixes:
  - DEC-12: remove/guard DB duplicated `providerSchemas` so it cannot drift
  - Fix minor JSDoc mismatch for `agentTimeoutMs`

### OUT
- Phase 2 Session Observatory work (separate wish)
- trigger_logs writer (separate wish)

---

## Acceptance Criteria

- [ ] `make check` passes
- [ ] Independent review findings above are addressed
- [ ] No provider token leaks into logs
- [ ] Media-only messages are handled deterministically on provider path
- [ ] Provider failures degrade to legacy path (no user-visible crash)

---

## Execution Plan

1. Patch `OpenClawClient.request()` to accept optional `timeoutMs`
2. Ensure provider passes `sendAckTimeoutMs` into `chatSend()` request timeout
3. Capture `sendTimestamp` and compute TTFD correctly
4. Strengthen chatId sanitization + length cap
5. Expose WS req frame id as `wsRequestId` for logging
6. Update dispatcher provider path to handle mediaFiles + fallback on provider exceptions
7. Update cleanup to `allSettled` + top-level timeout
8. Add cache reset helper for tests
9. Fix DB schema drift guard for provider schemas

---

## Notes

This wish is directly driven by the independent 3-opus review.
