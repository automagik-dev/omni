# WISH: WhatsApp Newsletters

> Handle WhatsApp Newsletter/Channel notifications properly.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-ucs

---

## Context

WhatsApp Channels (broadcast feature) send notifications that we currently log as invalid:

```json
{"level":40,"msg":"Invalid mex newsletter notification",...}
```

These are recurring and should be properly handled - either processed/stored or explicitly ignored.

---

## Scope

### IN SCOPE

- Parse newsletter notification format
- Suppress warning logs
- Optional: emit events for newsletter activity

### OUT OF SCOPE

- Full newsletter/channel feature support
- Sending to newsletters
- Newsletter management UI

---

## Execution

**Deliverables:**
- [ ] Parse newsletter notification format
- [ ] Add config flag to enable/disable processing
- [ ] Either ignore silently or emit event

**Acceptance Criteria:**
- [ ] No more warning logs for newsletters
- [ ] Option to process if desired
- [ ] Newsletter events available if enabled
