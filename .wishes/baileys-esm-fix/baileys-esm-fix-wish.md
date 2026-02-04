# WISH: Baileys ESM Fix

> Fix Baileys/Node.js ESM compatibility for WhatsApp plugin.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-9q2

---

## Context

**Problem:**
```
SyntaxError: The requested module './newsletter.js' does not provide
an export named 'makeNewsletterSocket'
```

Baileys v7.0.0-rc.9 has ESM export issues when running under Node.js (tsx). Works fine under Bun due to more permissive module resolution.

**Why Node.js is Needed:**
- Bun's WebSocket implementation is incomplete
- Pairing codes don't work properly under Bun
- Some Baileys features rely on WebSocket events not implemented in Bun

---

## Scope

### IN SCOPE

- Fix Baileys ESM exports for Node.js
- Ensure both Bun and Node.js work

### OUT OF SCOPE

- Bun WebSocket fixes (upstream issue)
- Baileys fork maintenance

---

## Execution

**Approaches:**
1. Pin to compatible Baileys version
2. Patch imports at build time
3. Use dynamic imports with error handling
4. Fork Baileys with fixed exports

**Deliverables:**
- [ ] Identify root cause in Baileys exports
- [ ] Implement fix or workaround
- [ ] Test under both Bun and Node.js

**Acceptance Criteria:**
- [ ] `bun run` works (current)
- [ ] `tsx` / Node.js works (fixed)
- [ ] Pairing codes work under Node.js
