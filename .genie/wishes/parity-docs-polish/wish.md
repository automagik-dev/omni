# Wish: Parity Docs Polish (Cross-links + Dependency Map)

**Status:** READY  
**Slug:** `parity-docs-polish`  
**Created:** 2026-02-13  
**Depends on:** `channel-parity-telegram-whatsapp`  
**Complexity:** S  

---

## Problem

The parity audit shipped with strong content, but navigation is rough:

1. Audit notes are not linked from the parity matrix
2. There’s no dependency graph across the follow-up wishes
3. The matrix doesn’t link back to each wish stub, making it harder to jump from a gap → execution plan

These are LOW-severity gaps from review, but they slow down execution.

---

## Scope

### IN
- Add cross-links between:
  - `docs/channel-parity/telegram-whatsapp.md`
  - `.genie/wishes/channel-parity-telegram-whatsapp/audit-notes.md`
  - the 8 follow-up wish stubs (`parity-*`, `baileys-resilience`)
- Add a simple dependency section to the matrix:
  - Recommended ordering (e.g. streaming before interactive UI)
  - Explicit prereqs (if any)
- Add a “Next Steps” section to the matrix:
  - quick wins (S)
  - biggest impact (L)

### OUT
- Any implementation work on the channel plugins
- Changing capability semantics or the channel SDK
- Creating new wishes beyond navigation/polish

---

## Acceptance Criteria

- [ ] Matrix doc links to audit notes and each follow-up wish
- [ ] Audit notes link back to the matrix doc
- [ ] Matrix includes a dependency / recommended ordering section
- [ ] `make check` passes

---

## Execution Groups

### Group A — Doc Navigation (P0)
- Add links + table of contents improvements

**Validation:** `make check`
