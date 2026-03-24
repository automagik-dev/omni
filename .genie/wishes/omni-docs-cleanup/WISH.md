# Wish: Complete Omni CLI Documentation + Skills Update

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `omni-docs-cleanup` |
| **Date** | 2026-03-24 |
| **Design** | [DESIGN.md](../../brainstorms/omni-docs-cleanup/DESIGN.md) |

## Summary
The Omni CLI has 25 command groups with ~100 subcommands but only 5 are documented. Agents and developers constantly make mistakes because they don't know what's available. Complete ALL 20 missing command sections in the CLI reference, rewrite the outdated AGENT_ROUTING skill, and create a multi-instance deployment guide. People (and agents) need to know what we're capable of.

## Scope
### IN
- Document ALL 20 missing command groups in `.claude/skills/omni-cli/reference/commands.md`
- Every subcommand gets a description, options list, and at least one practical example
- Rewrite `.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md` with current CLI syntax
- Create `docs/guides/multi-instance.md` for multi-Omni deployment
- Close #252 and #240

### OUT
- Global genie plugin skills (separate repo, different deployment)
- No code changes to the CLI itself
- No new CLI features
- No changes to the API
- Auto-generated OpenAPI docs (those are separate)

## Decisions
| Decision | Rationale |
|----------|-----------|
| Document ALL 20 command groups, not just top 5 | Partial docs are worse than no docs. Agents assume undocumented = nonexistent. |
| Practical examples for every subcommand | `--help` shows flags. Examples show intent. Agents copy examples. |
| Generate from `omni <cmd> --help` + cross-reference source | --help is auto-generated from code = single source of truth |
| Keep multi-instance guide despite route overrides | Different problems: multi-instance = full isolation, routes = config overrides. Both valid. |

## Success Criteria
- [ ] `commands.md` has documented sections for ALL 25 command groups (5 existing + 20 new)
- [ ] Every subcommand has at least one practical `bash` example
- [ ] `AGENT_ROUTING.md` uses current `omni routes` / `omni access` CLI commands (zero old JSON format)
- [ ] `AGENT_ROUTING.md` includes multi-agent routing example with route resolution order
- [ ] `AGENT_ROUTING.md` documents genie provider schemaConfig (agentName, targetAgent, teamName)
- [ ] `docs/guides/multi-instance.md` exists with PM2 template and env var reference
- [ ] Close GitHub issues #252 and #240

## Execution Strategy

### Wave 1 (parallel — Groups 1 and 3 touch different files)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | CLI reference: routes, providers, access, keys (high-impact commands) |
| 3 | engineer | AGENT_ROUTING.md rewrite + multi-instance guide |

### Wave 2 (after Group 1 — same file, must be sequential)
| Group | Agent | Description |
|-------|-------|-------------|
| 2 | engineer | CLI reference: all remaining 16 command groups |

## Execution Groups

### Group 1: cli-reference-high-impact
**Goal:** Document the 4 most-confused command groups with full examples.
**Deliverables:**
Add these sections to `.claude/skills/omni-cli/reference/commands.md`:

1. **`omni routes`** (7 subcommands: list, get, create, update, delete, test, metrics)
   - Key flags: --scope (chat|user), --chat, --person, --agent, --stream/--no-stream, --gate, --reply-filter-mode, --label, --priority
   - Examples: create user route, create chat route, test resolution, list with --json
2. **`omni providers`** (10 subcommands: setup, list, get, create, test, agents, teams, workflows, update, delete)
   - Key flags: --schema (agno|webhook|openclaw|ag-ui|claude-code|a2a|genie), --base-url, --api-key, --project-path, --agent-name, --target-agent, --team-name
   - Examples: create genie provider, create claude-code provider, test health
3. **`omni access`** (8 subcommands: list, create, delete, mode, check, pending, approve, deny)
   - Key flags: --type (allow|deny), --phone (wildcard), --user, --action (block|silent_block|allow), --message
   - Examples: set allowlist mode, create phone pattern rule, check user access, approve pairing
4. **`omni keys`** (6 subcommands: create, list, get, update, revoke, delete)
   - Examples: create scoped key with instanceIds, revoke key, list active keys

Follow the existing format in commands.md for send/chats/messages/instances/events.

**Acceptance Criteria:**
- [ ] routes section has all 7 subcommands documented with examples
- [ ] providers section has all 10 subcommands documented with examples
- [ ] access section has all 8 subcommands documented with examples
- [ ] keys section has all 6 subcommands documented with examples

**Validation:**
```bash
grep -c "^## omni\|^### omni\|^#### omni" /home/genie/.genie/worktrees/omni/omni-day/.claude/skills/omni-cli/reference/commands.md
```

**depends-on:** none

---

### Group 2: cli-reference-complete
> ⚠️ **Must run AFTER Group 1** — both groups write to the same `commands.md` file. Sequential to avoid merge conflicts.

**Goal:** Document ALL remaining 16 command groups.
**Deliverables:**
Add these sections to `.claude/skills/omni-cli/reference/commands.md`:

1. **`omni persons`** (3: search, get, presence)
2. **`omni media`** (2: list, download)
3. **`omni automations`** (10: list, get, create, update, delete, enable, disable, test, execute, logs)
4. **`omni webhooks`** (6: list, get, create, update, delete, trigger)
5. **`omni settings`** (3: list, get, set)
6. **`omni batch`** (5: list, create, status, cancel, estimate)
7. **`omni prompts`** (4: list, get, set, reset)
8. **`omni dead-letters`** (6: list, get, stats, retry, resolve, abandon)
9. **`omni payloads`** (4: list, get, delete, config)
10. **`omni journey`** (2: show, summary)
11. **`omni resync`** (standalone: --instance, --since, --all, --dry-run)
12. **`omni logs`** (standalone: level filter, --modules, --process, --follow)
13. **`omni config`** (4: list, get, set, unset)
14. **`omni auth`** (4: login, status, logout, recover)
15. **`omni status`** (standalone)
16. **`omni completions`** (standalone: bash, zsh, fish)

For each: run `omni <cmd> --help` and `omni <cmd> <sub> --help` to get accurate flags. Write 1-2 practical examples per subcommand.

**Acceptance Criteria:**
- [ ] All 16 command groups have complete sections
- [ ] Every subcommand has at least one example
- [ ] commands.md index at top matches all sections (all 25 command groups listed and linked)

**Validation:**
```bash
# Count total documented command groups — should be 25
grep -c "^## omni " /home/genie/.genie/worktrees/omni/omni-day/.claude/skills/omni-cli/reference/commands.md
```

**depends-on:** Group 1

---

### Group 3: routing-skill-and-guide
**Goal:** Rewrite AGENT_ROUTING.md with current syntax + create multi-instance guide.
**Deliverables:**
1. **Rewrite `.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md`:**
   - Remove ALL old JSON format examples (`--reply-filter '{"mode":"whitelist",...}'`, `--debounce '{"type":"group",...}'`)
   - Replace with current CLI commands:
     - `omni routes create --scope user --person X --agent Y` for routing
     - `omni access create --type allow --phone "+55*"` for access control
     - `omni access mode <id> allowlist` for access mode
     - `omni instances update <id> --debounce-mode fixed --debounce-min 15000` for debounce
   - Document route resolution order: chat route > user route > instance default
   - Add multi-agent pattern example:
     ```
     Instance (1 WhatsApp number)
       ├── Route: Felipe (user) → dev agent (debounce: off, ack: off)
       ├── Route: Antonio (user) → test agent B
       └── Default → production agent (instance defaults)
     ```
   - Document genie provider schemaConfig: agentName, targetAgent, teamName template with `{chat_id}`, `{thread_id}`, `{sender_id}` placeholders
   - Document `omni routes test --instance X --chat Y --person Z` for debugging route resolution

2. **Create `docs/guides/multi-instance.md`:**
   - When to use: fully isolated environments (separate DB, separate state)
   - PM2 ecosystem.config.js template with HOME, PGSERVE_PORT, API_PORT
   - Required setup: copy NATS binary per HOME dir
   - CLI usage with `--api-url` and `--api-key` per instance
   - Known limitations: multi-device routing unpredictability
   - Note: "For per-user config differences on the same number, consider route-level overrides instead — see `omni routes create --help`"

**Acceptance Criteria:**
- [ ] AGENT_ROUTING.md contains zero old JSON format examples
- [ ] AGENT_ROUTING.md uses `omni routes` and `omni access` commands
- [ ] AGENT_ROUTING.md includes multi-agent routing diagram
- [ ] AGENT_ROUTING.md documents genie provider schemaConfig fields
- [ ] docs/guides/multi-instance.md exists with PM2 template

**Validation:**
```bash
# No old JSON format remaining
! grep -q "reply-filter.*mode.*whitelist\|debounce.*type.*group\|debounce.*type.*delay" /home/genie/.genie/worktrees/omni/omni-day/.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md && echo "PASS"
```

**depends-on:** none

---

## QA Criteria

_What must be verified after merge._

- [ ] `commands.md` renders correctly as Markdown (no broken formatting)
- [ ] All example commands in docs are syntactically valid (can be copy-pasted)
- [ ] AGENT_ROUTING.md examples use real CLI flags that exist in current omni version
- [ ] multi-instance.md PM2 template has correct env var names

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| ~800 lines of new docs is a lot | Medium | Structured template keeps it consistent. All content generated from --help output. |
| Docs may become stale as CLI evolves | Low | commands.md lives next to code. PRs adding CLI commands should update docs. |
| Some commands have complex JSON flags | Low | Show JSON inline in examples, not "see API docs" |
| Multi-instance guide may reference route overrides not yet shipped | Low | Note says "consider route-level overrides" as future option |

## Files to Create/Modify

```
.claude/skills/omni-cli/reference/commands.md                          # Add 20 missing command sections
.agents/skills/omni-orchestrator/references/AGENT_ROUTING.md           # Full rewrite with current syntax
docs/guides/multi-instance.md                                          # New: multi-Omni deployment guide
```
