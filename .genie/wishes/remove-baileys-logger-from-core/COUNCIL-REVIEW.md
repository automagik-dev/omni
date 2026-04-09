# Council Review: Issue #90 — Move Baileys Logger Adapter

**Date:** 2026-03-11
**Consensus:** Strong (unanimous on deletion)
**Votes:** 0 APPROVE, 2 MODIFY, 2 REJECT (all reject the proposed move; recommend deletion instead)

## Members Invoked
- **Questioner** (Ryan Dahl): Challenge assumptions, foundational simplicity
- **Architect** (Linus Torvalds): Systems thinking, long-term stability
- **Simplifier** (TJ Holowaychuk): Complexity reduction, deletion over addition
- **Ergonomist** (Sindre Sorhus): Developer experience, API clarity

## Perspectives

### Questioner
**Vote: REJECT** (the move)
- The code is dead — moving dead code doesn't make it less dead. YAGNI.
- The two logger approaches are incompatible patterns (core bridges unified logger vs socket.ts uses raw pino).
- Audit remaining Baileys references in core separately — may be legitimate channel type identifiers.

### Architect
**Vote: MODIFY**
- Delete the dead adapter file entirely. It was never adopted — the abstraction was wrong.
- Socket.ts's `createLogger()` is a local implementation detail — leave as-is.
- Preserve `'whatsapp-baileys'` string references in core schemas — they're type identifiers, not implementation coupling.

### Simplifier
**Vote: REJECT** (the move)
- Delete outright. Moving creates ongoing maintenance liability for unused code.
- Socket.ts already has working Baileys logger creation with better suppression logic.
- Remove the `adapters/` directory if it becomes empty.

### Ergonomist
**Vote: MODIFY**
- Don't move dead code — consolidate the pattern. Choose which approach wins, delete the other.
- Baileys type references in core are correct — they're contracts, not dependencies.
- Make the architectural decision explicit so future developers understand why.

## Key Themes
1. **Delete dead code, don't relocate it.** The file is unused and unexported.
2. **Socket.ts already solves the problem.** Channel-whatsapp has its own working logger.
3. **Baileys string references in core are correct.** Data model contracts, not Baileys dependencies.
4. **Scope to just the logger file.** Don't batch unrelated cleanup into this issue.

## Recommendation
Delete `packages/core/src/logger/adapters/baileys.ts` entirely. Clean up the empty `adapters/` directory. Leave socket.ts and core schema references untouched.
