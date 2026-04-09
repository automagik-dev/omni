# Wish: Omni Skills Sync — Close Gaps Between Skills and CLI Reality

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `omni-skills-sync` |
| **Date** | 2026-03-17 |

## Summary
The Omni plugin skills are stale — 2 entire skill categories are missing (agents, providers), 3 skills are incomplete (chats, instances, config), and 20+ new CLI flags/commands from recent work (attention system, auto-ack, mention resolver, genie provider v2) are undocumented. This wish syncs all skills to match the current CLI surface.

## Scope

### IN
- Create `omni-agents` skill — `omni agents list|get|create|delete`
- Create `omni-providers` skill — `omni providers list|get|create|update|delete|setup|test`
- Update `omni-chats` skill — add attention system: `--pending`, `--attention`, `--label`, `--hidden`, `hide`, `unhide`, `label`, `unlabel`, pagination metadata
- Update `omni-instances` skill — add auto-ack options: `--reaction-ack`, `--ack-timeout`, `--agent-ack-message`, session strategies, debounce options, message format mode
- Update `omni-send` skill — document @name mention auto-resolution on WhatsApp, short ID resolution
- Update `omni-config` skill — add genie/a2a/ag-ui/claude-code provider schemas, reference omni-providers skill
- Update `omni-events` skill — clarify replay standalone command

### OUT
- Creating new CLI commands (skills document existing commands only)
- Modifying any TypeScript code
- Changing the omni plugin router skill (already correct)
- Updating skills that are already complete: omni-messages, omni-persons, omni-prompts, omni-routes, omni-webhooks, omni-batch, omni-install, omni-automations

## Decisions

| Decision | Rationale |
|----------|-----------|
| Separate agents and providers skills | They're distinct CLI namespaces with their own CRUD. Mixing them into omni-config is confusing. |
| Update existing skills in-place | Don't create new skills for attention/auto-ack — they belong in chats/instances. |
| Derive docs from `--help` output | Single source of truth is the CLI. Skills must match `--help` exactly. |

## Success Criteria
- [ ] `omni-agents` SKILL.md exists with list/get/create/delete coverage
- [ ] `omni-providers` SKILL.md exists with list/get/create/update/delete/setup/test coverage
- [ ] `omni-chats` SKILL.md includes hide/unhide/label/unlabel and --pending/--attention/--label/--hidden flags
- [ ] `omni-instances` SKILL.md includes --reaction-ack, --ack-timeout, --agent-ack-message, debounce, format mode
- [ ] `omni-send` SKILL.md documents @name mention resolution and short ID support
- [ ] `omni-config` SKILL.md references genie/a2a/ag-ui/claude-code provider schemas
- [ ] `omni-events` SKILL.md clarifies replay command location
- [ ] Every documented command in every skill can be verified by running `omni <command> --help`

## Execution Groups

### Group 1: Create Missing Skills
**Goal:** Create the 2 missing skill files from scratch.

**Deliverables:**
1. `plugins/omni/skills/omni-agents/SKILL.md` — full coverage of `omni agents` subcommand: list (with --provider, --inactive-only, --limit), get, create (with --name, --provider, --model, --type), delete
2. `plugins/omni/skills/omni-providers/SKILL.md` — full coverage of `omni providers` subcommand: list, get, create (with all schema options: genie, claude-code, a2a, ag-ui, openclaw, webhook), update, delete, setup wizard, test

**Acceptance criteria:**
- Both SKILL.md files exist
- All commands match `omni agents --help` and `omni providers --help` output
- Include examples with real flags and expected output

**Validation:**
```bash
test -f plugins/omni/skills/omni-agents/SKILL.md && \
test -f plugins/omni/skills/omni-providers/SKILL.md && \
grep -q "agents list" plugins/omni/skills/omni-agents/SKILL.md && \
grep -q "providers create" plugins/omni/skills/omni-providers/SKILL.md && \
grep -q "genie" plugins/omni/skills/omni-providers/SKILL.md && \
echo "PASS"
```

**depends-on:** none

---

### Group 2: Update Chats Skill
**Goal:** Add attention system commands and filters to omni-chats skill.

**Deliverables:**
1. Add `--pending`, `--attention`, `--label <name>`, `--hidden` flags to list section
2. Add `omni chats hide <id>` / `unhide <id>` commands
3. Add `omni chats label <id> <name>` / `unlabel <id> <name>` commands
4. Document pagination metadata (`Showing X of Y chats`)
5. Document `--type` defaulting to no limit behavior

**Acceptance criteria:**
- All 4 new flags documented with descriptions
- hide/unhide/label/unlabel commands documented with examples
- Pagination info documented

**Validation:**
```bash
grep -q "pending" plugins/omni/skills/omni-chats/SKILL.md && \
grep -q "attention" plugins/omni/skills/omni-chats/SKILL.md && \
grep -q "hide" plugins/omni/skills/omni-chats/SKILL.md && \
grep -q "label" plugins/omni/skills/omni-chats/SKILL.md && \
echo "PASS"
```

**depends-on:** none

---

### Group 3: Update Instances & Send Skills
**Goal:** Add auto-ack, mention resolver, and new instance options.

**Deliverables:**
1. Update `omni-instances` SKILL.md:
   - Add `--agent-ack-message` option (configurable pre-dispatch auto-reply)
   - Add `--reaction-ack`, `--reaction-ack-emoji`, `--ack-timeout` options
   - Add `--agent-session-strategy per_user_per_chat` option
   - Add `--message-format-mode convert|passthrough`
   - Add debounce options: `--debounce-mode`, `--debounce-min`, `--debounce-max`, `--debounce-group`
2. Update `omni-send` SKILL.md:
   - Document @name mention auto-resolution on WhatsApp (e.g., `@Felipe` → resolved to JID)
   - Document short ID resolution for `--to` (e.g., `--to c14b05ff` resolves like `omni chats messages`)

**Acceptance criteria:**
- Instances skill has auto-ack, debounce, format mode options
- Send skill documents @name mention and short ID support

**Validation:**
```bash
grep -q "agent-ack-message\|agentAckMessage\|auto.ack" plugins/omni/skills/omni-instances/SKILL.md && \
grep -q "mention\|@name" plugins/omni/skills/omni-send/SKILL.md && \
grep -q "short.*[Ii][Dd]\|short.id" plugins/omni/skills/omni-send/SKILL.md && \
echo "PASS"
```

**depends-on:** none

---

### Group 4: Update Config & Events Skills
**Goal:** Add missing provider schemas and fix stale references.

**Deliverables:**
1. Update `omni-config` SKILL.md:
   - Add genie, a2a, ag-ui, claude-code provider schemas
   - Reference `omni-providers` skill for full provider management
   - Remove duplicate provider docs (point to omni-providers)
2. Update `omni-events` SKILL.md:
   - Clarify that `omni replay` is a standalone command (not under events)
   - Document correct replay syntax

**Acceptance criteria:**
- Config skill references genie/a2a/claude-code schemas
- Events skill has correct replay documentation

**Validation:**
```bash
grep -q "genie" plugins/omni/skills/omni-config/SKILL.md && \
grep -q "a2a\|ag-ui\|claude-code" plugins/omni/skills/omni-config/SKILL.md && \
echo "PASS"
```

**depends-on:** none

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| CLI flags may change again before skills are published | Low | Skills are in the plugin repo, easy to update. Derive from --help output. |
| Some flags exist in code but aren't wired to CLI yet | Low | Only document flags that `--help` shows |
| Provider schemas differ between create and update | Medium | Document both create and update flows separately in omni-providers |
