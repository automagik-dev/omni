# Wish: Agent Context Simplification — Prune Dead Files, Consolidate Truth

| Field | Value |
|-------|-------|
| **Status** | DONE |
| **Slug** | `md-simplification` |
| **Date** | 2026-03-26 |
| **Design** | N/A (audit-driven, no brainstorm needed) |

## Summary
The orchestrator root and repo root have accumulated 9+ `.md` files from the "personal assistant" era and early prototyping. Several are outdated (reference dead sub-agents, old tooling), redundant (SOUL.md repeats AGENTS.md), or misplaced (REQUIREMENTS.md belongs in repo docs, USER.md belongs in memory). The repo also carries 3 self-labeled DEPRECATED skill packages and a stale PLAN.md. This wish prunes dead weight, consolidates truth into fewer files, and removes references to tooling/agents that no longer exist.

## Audit Results

### Orchestrator Root (`/home/genie/agents/namastexlabs/omni/`)

| File | Size | Verdict | Reason |
|------|------|---------|--------|
| `AGENTS.md` | 5KB | **KEEP** | Core agent definition. This IS the agent. |
| `CLAUDE.md` | 11B | **KEEP** | Standard entry point (`@AGENTS.md`). |
| `HEARTBEAT.md` | 1.2KB | **KEEP** | Active heartbeat checklist. |
| `BOOTSTRAP.md` | 1.5KB | **DELETE** | Says "Delete this file" in its own text. Bootstrap is done. |
| `IDENTITY.md` | 1.4KB | **DELETE** | Persona fluff. Name/emoji already in AGENTS.md frontmatter. Octopus description duplicated in SOUL.md. |
| `SOUL.md` | 6.7KB | **PRUNE** | Massive overlap with AGENTS.md. References dead sub-agents (Scroll, Ink, Pearl, Coral). Group chat behavior irrelevant for technical orchestrator. Safety rules duplicated in agent-bible.md. Keep only unique behavioral rules not covered elsewhere. |
| `REQUIREMENTS.md` | 4.9KB | **DELETE** | System requirements belong in repo `docs/guides/install.md` (which already exists). Also says `npm install -g pm2` violating our own bun-only rule. |
| `TOOLS.md` | 1.3KB | **DELETE** | Mostly empty template. Browser automation and term CLI info is in rules/ already. |
| `USER.md` | 929B | **MOVE TO MEMORY** | User info about Felipe. References outdated "OpenClaw body" concept. This is memory, not agent config. |

### Repo Root (`repos/omni/`)

| File | Verdict | Reason |
|------|---------|--------|
| `AGENTS.md` | **KEEP** | Pointer to orchestrator (`@../../AGENTS.md`). |
| `CLAUDE.md` | **KEEP** | Pointer to orchestrator (`@../../AGENTS.md`). |
| `README.md` | **KEEP** | Project README. |
| `PLAN.md` | **DELETE** | Stale feature plan (Claude Code streaming) in Portuguese. Should have been a wish. Not actionable. |

### Repo `.agents/skills/` (3 packages, 9 files)

| Package | Verdict | Reason |
|---------|---------|--------|
| `omni-analytics/` | **DELETE** | Self-labeled `DEPRECATED`. Superseded by `plugins/omni/skills/omni-events`. |
| `omni-executor/` | **DELETE** | Self-labeled `DEPRECATED`. Superseded by `plugins/omni/skills/omni-send`. |
| `omni-orchestrator/` | **DELETE** | Self-labeled `DEPRECATED`. Superseded by `plugins/omni/skills/omni-instances`. |

### Repo `.claude/agents/` (review, not delete)

| File | Verdict | Reason |
|------|---------|--------|
| `spec-reviewer.md` | **REVIEW** | May be superseded by genie:reviewer. Keep if actively used by `.claude/settings.json`. |
| `quality-reviewer.md` | **REVIEW** | Same as above. |

### Repo `docs/README.md`

| Issue | Fix |
|-------|-----|
| References dead sub-agents (Scroll, Ink, Pearl, Coral) in "Maintained By" | Remove dead names, credit "Omni agent" only |

## Scope
### IN
- Delete 4 orchestrator files: `BOOTSTRAP.md`, `IDENTITY.md`, `REQUIREMENTS.md`, `TOOLS.md`
- Prune `SOUL.md` to ~30 lines: remove dead sub-agent references, group chat behavior, duplicated safety rules
- Move `USER.md` content to memory system, then delete file
- Delete repo `PLAN.md`
- Delete all 3 deprecated `.agents/skills/` packages (9 files)
- Update `docs/README.md` to remove dead sub-agent references
- Review `.claude/agents/` files against current workflow (keep if referenced, delete if orphaned)

### OUT
- The 44 files in `docs/` directory (separate wish — needs individual file-by-file audit against current code)
- `.claude/CLAUDE.md` (repo-level technical reference — accurate and valuable)
- `.claude/skills/` files (debug.md, frontend-design.md, verification-gate.md — all active)
- `README.md` (project README — essential)
- Any code changes

## Decisions
| Decision | Rationale |
|----------|-----------|
| Delete rather than archive | Git history preserves everything. Dead files in the tree confuse agents and waste context tokens. |
| Prune SOUL.md rather than delete | Some behavioral rules (decide-then-inform, platform formatting) aren't captured elsewhere. |
| Move USER.md to memory | User preferences belong in the memory system, not static files. Memory is queryable across conversations. |
| Don't touch docs/ yet | 44 files need individual audit against current code. That's a separate wish. |
| Delete .agents/skills/ entirely | They self-label as DEPRECATED. The replacement skills are already active in the genie plugin. |

## Success Criteria
- [ ] Orchestrator root has exactly 4 files: `AGENTS.md`, `CLAUDE.md`, `HEARTBEAT.md`, `SOUL.md`
- [ ] `SOUL.md` is under 40 lines and contains zero references to Scroll, Ink, Pearl, or Coral
- [ ] `SOUL.md` contains zero group chat behavior rules (those belong in a chatbot agent, not an orchestrator)
- [ ] Repo root has exactly 3 `.md` files: `AGENTS.md`, `CLAUDE.md`, `README.md`
- [ ] No `.agents/skills/` directory exists in the repo
- [ ] `docs/README.md` "Maintained By" section has no dead sub-agent names
- [ ] User info from `USER.md` is saved in memory system
- [ ] `bun run build` still passes (no broken imports referencing deleted files)
- [ ] No broken `@` references in remaining `.md` files

## Execution Strategy

### Wave 1 (parallel — independent file operations)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Delete dead orchestrator files + prune SOUL.md |
| 2 | engineer | Delete deprecated repo files + .agents/skills/ + update docs/README.md |

### Wave 2 (after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Move USER.md to memory + review .claude/agents/ |
| review | reviewer | Verify all deletions, no broken references |

## Execution Groups

### Group 1: orchestrator-cleanup
**Goal:** Remove dead files from orchestrator root, prune SOUL.md to essentials.
**Deliverables:**
1. Delete `BOOTSTRAP.md`, `IDENTITY.md`, `REQUIREMENTS.md`, `TOOLS.md`
2. Rewrite `SOUL.md` to keep ONLY:
   - Core identity (name, creature, 2-3 lines max)
   - "Decide then inform" behavioral rule
   - Platform formatting rules (Discord/WhatsApp)
   - Remove: group chat behavior, dead sub-agent references, duplicated safety rules, extended metaphors

**Acceptance Criteria:**
- [ ] Only `AGENTS.md`, `CLAUDE.md`, `HEARTBEAT.md`, `SOUL.md` remain in orchestrator root
- [ ] `SOUL.md` < 40 lines
- [ ] Zero references to Scroll, Ink, Pearl, Coral in any remaining file

**Validation:**
```bash
ls /home/genie/agents/namastexlabs/omni/*.md | wc -l  # Should be 4
wc -l /home/genie/agents/namastexlabs/omni/SOUL.md     # Should be < 40
grep -ri "scroll\|ink\|pearl\|coral" /home/genie/agents/namastexlabs/omni/*.md  # Should return nothing
```

**depends-on:** none

---

### Group 2: repo-cleanup
**Goal:** Delete deprecated files and skill packages from the repo.
**Deliverables:**
1. Delete `PLAN.md` from repo root
2. Delete entire `.agents/skills/` directory (all 3 deprecated packages)
3. Update `docs/README.md`: remove "Maintained By" section's dead sub-agent names (Scroll, Ink, Pearl, Coral), replace with "Maintained by the Omni development team"

**Acceptance Criteria:**
- [ ] `PLAN.md` does not exist in repo root
- [ ] `.agents/skills/` directory does not exist
- [ ] `docs/README.md` has no references to Scroll, Ink, Pearl, Coral

**Validation:**
```bash
test ! -f repos/omni/PLAN.md && echo "PASS"
test ! -d repos/omni/.agents/skills && echo "PASS"
grep -i "scroll\|ink\|pearl\|coral" repos/omni/docs/README.md  # Should return nothing
```

**depends-on:** none

---

### Group 3: memory-migration
**Goal:** Save USER.md content to memory system and review .claude/agents/.
**Deliverables:**
1. Create memory file for user info (Felipe: timezone, language, preferences)
2. Delete `USER.md` from orchestrator root
3. Check `.claude/settings.json` for references to spec-reviewer.md and quality-reviewer.md
4. If referenced: keep. If orphaned: delete with note in commit.

**Acceptance Criteria:**
- [ ] Memory file exists with Felipe's info
- [ ] `USER.md` deleted from orchestrator root
- [ ] `.claude/agents/` files are either confirmed active or deleted

**Validation:**
```bash
test ! -f /home/genie/agents/namastexlabs/omni/USER.md && echo "PASS"
ls /home/genie/.claude/projects/-home-genie-agents-namastexlabs-omni/memory/ | grep user
```

**depends-on:** Group 1 (to avoid git conflicts in orchestrator root)

---

## QA Criteria

_What must be verified after merge._

- [ ] `bun run build` passes in repo (no broken imports)
- [ ] `AGENTS.md` still loads correctly (no broken `@` references)
- [ ] `HEARTBEAT.md` still loads correctly
- [ ] No `.md` file references deleted files
- [ ] Memory system has user info preserved

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| SOUL.md pruning removes something valuable | Low | Git history preserves full content. Review diff before committing. |
| .claude/agents/ files might be actively referenced | Medium | Check settings.json before deleting. Keep if referenced. |
| docs/README.md links to .agents/skills/ | Low | The README uses Obsidian wikilinks to docs/ pages, not .agents/skills/. Verified in audit. |
| Some agent may reference deleted files by path | Low | Grep entire repo for file paths before deletion. |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Delete
```
# Orchestrator root
/home/genie/agents/namastexlabs/omni/BOOTSTRAP.md
/home/genie/agents/namastexlabs/omni/IDENTITY.md
/home/genie/agents/namastexlabs/omni/REQUIREMENTS.md
/home/genie/agents/namastexlabs/omni/TOOLS.md
/home/genie/agents/namastexlabs/omni/USER.md

# Repo root
repos/omni/PLAN.md

# Deprecated skill packages (9 files)
repos/omni/.agents/skills/omni-analytics/
repos/omni/.agents/skills/omni-executor/
repos/omni/.agents/skills/omni-orchestrator/
```

## Files to Modify
```
/home/genie/agents/namastexlabs/omni/SOUL.md          # Prune to ~30 lines
repos/omni/docs/README.md                              # Remove dead sub-agent names
```
