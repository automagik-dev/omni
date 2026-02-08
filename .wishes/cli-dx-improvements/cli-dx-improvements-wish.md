# WISH: CLI DX Improvements (A1-A5)

> Five CLI-only improvements to make the developer experience smoother: better message display, whoami info, enhanced contacts/groups output, and events analytics.

**Status:** IN_PROGRESS
**Created:** 2026-02-08
**Author:** Omni + Guga
**Branch:** `feat/cli-dx-improvements`

---

## Context

The CLI is functional but has DX friction points identified by Guga's codebase analysis (docs/OMNI-LEARNINGS.md / BAILEYS-GAP-ANALYSIS.md). These are all CLI-only changes — no backend modifications needed.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Pre-built binary at `~/.omni/bin/omni` is the test target |
| **ASM-2** | Assumption | All API endpoints already exist and work correctly |
| **DEC-1** | Decision | Increase default truncation to 200 chars, add `--full` flag |
| **DEC-2** | Decision | Add phone number to `instances list` output (from status API) |
| **DEC-3** | Decision | Enhance existing `contacts` and `groups` commands (they exist, need polish) |
| **DEC-4** | Decision | Add `events analytics` command using existing `GET /events/analytics` |

---

## Scope

### IN SCOPE

- A1: `chats messages` — increase truncation to 200, add `--full` flag
- A2: `instances list` — add phone/owner column from status endpoint; add `instances whoami <id>` shorthand
- A3: `instances contacts` — enhance output formatting (currently basic)
- A4: `instances groups` — enhance output with JID column, better description display
- A5: `events analytics` — new command exposing `GET /events/analytics`

### OUT OF SCOPE

- Backend/API changes
- New API endpoints
- SDK changes
- Interactive prompts
- Command restructuring (e.g., `omni send text` subcommands)

---

## Success Criteria

- [ ] `omni chats messages <id> --full` shows full untruncated text
- [ ] `omni chats messages <id>` shows up to 200 chars by default (was 50)
- [ ] `omni instances list` shows phone number column
- [ ] `omni instances whoami <id>` shows phone/owner info
- [ ] `omni instances contacts <id>` has improved formatting
- [ ] `omni instances groups <id>` shows JID column
- [ ] `omni events analytics` shows event statistics
- [ ] `make typecheck` passes
- [ ] `make lint` passes

---

## Execution Groups

### Group 1: Message Display (A1)
**Files:** `packages/cli/src/commands/chats.ts`
**Tasks:**
- [ ] Change default truncation from 50 to 200 chars in `chats messages`
- [ ] Add `--full` / `--no-truncate` option
- [ ] When `--full` is set, show complete textContent without truncation

**Validation:**
```bash
cd packages/cli && bun run build && bun run typecheck
```

### Group 2: Instance Identity (A2)
**Files:** `packages/cli/src/commands/instances.ts`
**Tasks:**
- [ ] Enhance `instances list` to include phone/owner column (fetch status for each connected instance)
- [ ] Add `instances whoami <id>` command that shows ownerIdentifier, profileName, phone number parsed from JID

**Validation:**
```bash
cd packages/cli && bun run build && bun run typecheck
```

### Group 3: Contacts & Groups Polish (A3, A4)
**Files:** `packages/cli/src/commands/instances.ts`
**Tasks:**
- [ ] `instances contacts` — add search/filter option, better column formatting
- [ ] `instances groups` — add JID column, increase description truncation, add member count formatting

**Validation:**
```bash
cd packages/cli && bun run build && bun run typecheck
```

### Group 4: Events Analytics (A5)
**Files:** `packages/cli/src/commands/events.ts`
**Tasks:**
- [ ] Add `events analytics` command calling `GET /events/analytics`
- [ ] Display stats in formatted table (message counts by type, direction, channel)
- [ ] Add `--instance <id>` filter and `--since <duration>` filter

**Validation:**
```bash
cd packages/cli && bun run build && bun run typecheck
```
