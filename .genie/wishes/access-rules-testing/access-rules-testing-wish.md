# WISH: Access Rules Testing

> Test access rules API endpoints end-to-end.

**Status:** SHIPPED
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-m5n

---

## Context

Access rules (allowlist/blocklist) need end-to-end testing to verify functionality works correctly.

---

## Scope

### IN SCOPE

- Test allowlist mode (only listed allowed)
- Test blocklist mode (listed are blocked)
- Test rule CRUD operations
- Test rule matching logic

### OUT OF SCOPE

- New access rule features
- UI testing

---

## Execution

**Deliverables:**
- [x] Test allowlist mode
- [x] Test blocklist mode
- [x] Test rule CRUD operations
- [x] Test rule matching logic

**Acceptance Criteria:**
- [x] Allowlist correctly restricts access
- [x] Blocklist correctly blocks access
- [x] Rules can be created/updated/deleted
- [x] Matching works for JIDs/patterns

---

## Implementation Notes

- Access check integrated into `agent-responder.ts` before agent call
- CLI commands: `omni access list|create|delete|check`
- Supports: phonePattern (wildcards), platformUserId (Discord IDs), priority, silent_block
- Tested with Discord instance
