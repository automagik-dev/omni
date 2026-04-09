# Wish: Fix CLI JSON output reliability + chats skill DX

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `fix-cli-json-reliability` |
| **Date** | 2026-04-09 |
| **Issues** | [#367](https://github.com/automagik-dev/omni/issues/367) |

## Summary

`omni chats messages <id> --json | jq` produces malformed/truncated JSON on large message sets, making `--json` unreliable for agent consumption. Additionally, the `/omni:chats` skill shows examples but doesn't auto-execute commands when arguments are provided, wasting tokens and requiring manual copy-paste.

## Scope

### IN
- Fix `output.list()` JSON mode to use `process.stdout.write()` instead of `console.log()` for reliable piped output
- Ensure all JSON-emitting code paths in `output.ts` flush correctly when piped
- Add a test reproducing the truncation with a large payload piped to a consumer
- Update `/omni:chats` skill to auto-execute searches when arguments are provided
- Default skill output to `--json | jq` with compact field selection

### OUT
- Changing the API response format or message schema
- Rewriting the table rendering (`printTable`)
- Adding new CLI commands or flags
- Fixing non-chats JSON output (address in follow-up if discovered)

## Decisions

| Decision | Rationale |
|----------|-----------|
| `process.stdout.write()` over `console.log()` for JSON | `console.log` adds a newline and may buffer differently in Bun when piped; `process.stdout.write()` + explicit `\n` gives us control over flushing |
| Keep `flushStdout()` at process exit, add inline flush for JSON | Belt-and-suspenders — the exit flush catches everything, but large JSON should also flush immediately |
| Skill changes are prompt-only | The skill file is a markdown prompt — no CLI code changes needed for the DX improvement |

## Success Criteria

- [ ] `omni chats messages <group-chat-id> --since 7d --json | jq .` produces valid JSON (no parse errors) with 500+ messages
- [ ] `omni chats messages <group-chat-id> --since 7d --json > /tmp/out.json && jq . /tmp/out.json` also valid
- [ ] `omni chats list --json | jq .` works correctly
- [ ] Existing table output (`omni chats list`) unchanged
- [ ] `bun test` passes (zero new failures)
- [ ] `bun run build` clean
- [ ] `/omni:chats` skill auto-executes when args provided (manual verification)

## Execution Strategy

### Wave 1 (parallel)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Fix `output.list()` JSON write + add flush |
| 2 | engineer | Update `/omni:chats` skill prompt |

### Wave 2 (after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Add test for large JSON piped output |
| review | reviewer | Review Groups 1-3 |

## Execution Groups

### Group 1: Fix output.list() JSON serialization

**Goal:** Replace `console.log(JSON.stringify(...))` with `process.stdout.write()` + flush in JSON mode to prevent truncation when piped.

**Deliverables:**
1. In `packages/cli/src/output.ts`, change `list()` function (line 136-138):
   - Replace `console.log(JSON.stringify(options?.rawData ?? items, null, 2))` with:
     ```typescript
     process.stdout.write(JSON.stringify(options?.rawData ?? items, null, 2) + '\n');
     ```
   - Remove the `biome-ignore` comment (no longer needed — not using `console.log`)
2. Apply the same pattern to `data()` function if it uses `console.log` for JSON
3. Apply to `raw()` function (line 269) — change `console.log(text)` to `process.stdout.write(text + '\n')`

**Acceptance Criteria:**
- [ ] `output.list()` uses `process.stdout.write` for JSON mode
- [ ] `output.data()` uses `process.stdout.write` for JSON mode
- [ ] `output.raw()` uses `process.stdout.write`
- [ ] No `biome-ignore` comments on the changed lines
- [ ] `bun run build` clean

**Validation:**
```bash
cd packages/cli && bun run build && bun test
```

**depends-on:** none

---

### Group 2: Update /omni:chats skill to auto-execute

**Goal:** Make the skill automatically run `omni chats list --search` when arguments are provided, defaulting to `--json | jq` for compact output.

**Deliverables:**
1. Update `plugins/omni/skills/omni-chats/SKILL.md` — add instruction block at the top:
   - When arguments are provided (e.g., `/omni:chats nmstx leadership`), auto-execute: `omni chats list --search "<args>" --json | jq -r '.[] | "\(.id) \(.name) | unread: \(.unreadCount) | last: \(.lastMessagePreview[:80])"'`
   - When no arguments, show the usage reference as today
   - For messages, use compact jq: `omni chats messages <id> --json | jq -r '.[] | "\(.timestamp[11:16]) \(.senderDisplayName): \(.textContent[:120])"'`

**Acceptance Criteria:**
- [ ] Skill prompt includes auto-execute instructions
- [ ] Default output format uses `--json | jq` with field selection
- [ ] Usage reference still available when no args provided

**Validation:**
```bash
# Verify skill file is valid markdown
cat plugins/omni/skills/omni-chats/SKILL.md | head -5
```

**depends-on:** none

---

### Group 3: Add piped JSON output test

**Goal:** Add a test that verifies large JSON output is valid when piped.

**Deliverables:**
1. Add test in `packages/cli/src/__tests__/output.test.ts`:
   - Generate a large array (1000+ items with multiline text fields)
   - Call `output.list()` in JSON mode
   - Capture stdout and verify `JSON.parse()` succeeds
   - Verify all items are present (no truncation)

**Acceptance Criteria:**
- [ ] Test exists and passes
- [ ] Test covers the multiline text content case (newlines in text fields)
- [ ] Test verifies no truncation on large payloads

**Validation:**
```bash
cd packages/cli && bun test output.test
```

**depends-on:** Group 1

---

## QA Criteria

- [ ] `omni chats messages <group-chat-id> --since 7d --json | jq length` returns a number (no parse errors)
- [ ] `omni chats list --json | jq '.[0].id'` returns a valid string
- [ ] Table output (`omni chats list`) visually unchanged
- [ ] `bun test` — zero new failures across all packages

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Malformation is in Bun runtime, not our code | Medium | The `process.stdout.write` change should be more reliable than `console.log` regardless; if Bun still truncates, file a Bun issue and add `--output <file>` flag as workaround |
| `process.stdout.write` behaves differently than `console.log` for encoding | Low | Both write to stdout fd; `process.stdout.write` just skips the extra newline formatting |
| Skill auto-execute may not work with all agent runtimes | Low | Skill is just a prompt — agents that don't support auto-execute will still see the usage reference |

---

## Files to Create/Modify

```
packages/cli/src/output.ts                          # Fix JSON write path
packages/cli/src/__tests__/output.test.ts           # Add large payload test
plugins/omni/skills/omni-chats/SKILL.md             # Auto-execute + jq default
```
