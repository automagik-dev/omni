# WISH: API Key Security

> Add API key expiration and revocation support.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-axi

---

## Context

Current security gaps:
- API keys never expire - compromised keys remain valid forever
- No revocation mechanism - can only delete keys

---

## Scope

### IN SCOPE

- API key expiration (optional expiresAt field)
- API key revocation (revokedAt field)
- Auth middleware updates

### OUT OF SCOPE

- Key rotation automation
- Rate limiting per key
- OAuth/JWT

---

## Execution

**Deliverables:**
- [ ] Add `expiresAt` column to api_keys table
- [ ] Add `revokedAt` column to api_keys table
- [ ] Update auth middleware to check expiration/revocation
- [ ] API endpoint to revoke keys
- [ ] API endpoint to create keys with expiration

**Acceptance Criteria:**
- [ ] Expired keys return 401
- [ ] Revoked keys return 401
- [ ] Can create keys with/without expiration
- [ ] Can revoke active keys
