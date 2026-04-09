# Wish: Remove Dead Baileys Logger Adapter from @omni/core

**Status:** DRAFT
**Slug:** remove-baileys-logger-from-core
**Date:** 2026-03-11
**Issue:** #90

---

## Summary

Delete `packages/core/src/logger/adapters/baileys.ts` — a Pino-compatible logger adapter specific to WhatsApp's Baileys library. This file is dead code: not exported from `@omni/core`'s index.ts, not imported by any package. `channel-whatsapp` already has its own working `createLogger()` in `socket.ts`. The council unanimously recommended deletion over relocation.

## Scope

### IN
- Delete `packages/core/src/logger/adapters/baileys.ts`
- Delete the now-empty `packages/core/src/logger/adapters/` directory
- Remove `package.json` export entry for `./logger/adapters/baileys` (lines 22-25)
- Remove `knip.json` ignore entry for `src/logger/adapters/baileys.ts` (line 29)
- Verify no imports reference this file anywhere in the monorepo

### OUT
- Baileys string references in core schemas (`'whatsapp-baileys'` in `ChannelTypeSchema`, event types, NATS subjects) — these are legitimate data model contracts, not code dependencies
- Channel-whatsapp's `socket.ts` `createLogger()` function — working code, unrelated
- Any refactoring of core logger infrastructure beyond removing the dead adapter
- Cleaning up other Baileys references in core (events/types.ts, types/channel.ts, etc.) — separate issue if needed

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Delete vs move | Delete | Council unanimous: code is dead, moving dead code doesn't give it purpose |
| Touch socket.ts? | No | channel-whatsapp has its own working logger; no changes needed |
| Clean up core schema refs? | No | `'whatsapp-baileys'` strings are type discriminators in the data model, not Baileys dependencies |
| Remove adapters/ dir? | Yes | Only contains baileys.ts; empty dir is noise |

## Success Criteria

- [ ] `packages/core/src/logger/adapters/baileys.ts` does not exist
- [ ] `packages/core/src/logger/adapters/` directory does not exist
- [ ] `packages/core/package.json` has no `./logger/adapters/baileys` export
- [ ] `knip.json` has no `src/logger/adapters/baileys.ts` ignore entry
- [ ] No broken imports anywhere in the monorepo (`grep -r "logger/adapters" packages/` returns empty)
- [ ] `make check` passes (lint + typecheck + tests)
- [ ] Core schema references to `'whatsapp-baileys'` string type are preserved
- [ ] `channel-whatsapp/src/socket.ts` is untouched

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| Hidden import we missed | Pre-verified with grep — zero imports found outside the file itself |
| Future need for the adapter | YAGNI — if needed later, write it in channel-whatsapp with actual requirements |

---

## Execution Groups

### Group 1: Delete Dead Code + Verify

**Goal:** Remove the dead Baileys logger adapter from core and confirm nothing breaks.

**Deliverables:**
- [ ] Delete file `packages/core/src/logger/adapters/baileys.ts`
- [ ] Delete empty directory `packages/core/src/logger/adapters/`
- [ ] Remove `./logger/adapters/baileys` export from `packages/core/package.json`
- [ ] Remove `src/logger/adapters/baileys.ts` ignore from `knip.json`
- [ ] Run grep to confirm no imports reference `logger/adapters/baileys` or `createBaileysLogger` or `createSilentLogger` from core
- [ ] Run `make check` to verify lint + typecheck + tests pass

**Acceptance:**
- File and directory are gone
- Zero grep hits for the deleted module path
- `make check` green

**Validation:**
```bash
# Verify deletion
test ! -f packages/core/src/logger/adapters/baileys.ts && echo "PASS: file deleted" || echo "FAIL: file exists"
test ! -d packages/core/src/logger/adapters && echo "PASS: dir deleted" || echo "FAIL: dir exists"

# Verify package.json + knip.json cleaned
grep -q "logger/adapters/baileys" packages/core/package.json && echo "FAIL: package.json export exists" || echo "PASS: package.json clean"
grep -q "logger/adapters/baileys" knip.json && echo "FAIL: knip ignore exists" || echo "PASS: knip.json clean"

# Verify no broken references
grep -r "logger/adapters" packages/ && echo "FAIL: references found" || echo "PASS: no references"
grep -r "createBaileysLogger\|createSilentLogger" packages/ && echo "FAIL: references found" || echo "PASS: no references"

# Verify schema refs preserved
grep -r "whatsapp-baileys" packages/core/src/schemas/ && echo "PASS: schema refs intact" || echo "FAIL: schema refs missing"

# Full check
make check
```

---

## Dependencies

```
Group 1 ← independent, single-group wish
```

No cross-wish dependencies.
