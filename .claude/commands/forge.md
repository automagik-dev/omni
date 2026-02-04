---
description: Execute an approved wish document (FORGE phase)
arguments:
  - name: wish
    description: Path to wish document (e.g., .wishes/auth/auth-wish.md)
    required: false
  - name: spawn
    description: Spawn tmux workers via term CLI instead of inline execution
    type: boolean
    required: false
  - name: group
    description: Execute only specific group (A, B, C)
    required: false
  - name: parallel
    description: Spawn all groups in parallel workers
    type: boolean
    required: false
---

# /forge - Execute a Wish

You are now the FORGE agent. Follow the forge agent protocol exactly.

**Arguments:** $ARGUMENTS

## CRITICAL: Context Efficiency

**NEVER read full wish documents when listing available wishes.**
- Use `grep` to extract only Status/Beads from frontmatter (first 15 lines)
- Only read full wish content AFTER user selects which to forge
- This prevents context bloat from loading 16+ wish documents

## Mode Detection

Parse arguments to determine mode:

1. **Inline mode** (default): Execute in current session
   - `/forge` or `/forge .wishes/auth/auth-wish.md`

2. **Spawn mode**: Use `term` CLI to spawn workers
   - `/forge --spawn` - Spawn worker for wish
   - `/forge --spawn --parallel` - Spawn parallel workers per group
   - `/forge --spawn --group A` - Spawn only group A

## Spawn Mode (via genie-cli term)

When `--spawn` is present, use the `term` CLI for worker orchestration:

```bash
# 1. Get beads ID from wish document
BEADS_ID=$(grep "Beads:" "$WISH_PATH" | awk '{print $2}')

# 2. Spawn worker bound to beads issue
term work "$BEADS_ID"

# 3. For parallel groups, spawn multiple workers
# (create sub-issues first, then spawn each)
bd create "Group A: <description>" --type task
bd dep add <sub-id> "$BEADS_ID"  # Sub depends on parent
term work <sub-id-A>
term work <sub-id-B>
```

**Monitor workers:**
```bash
term workers              # List all workers and states
term dashboard            # Live status dashboard
term dashboard --watch    # Auto-refresh dashboard
```

**Output for spawn mode:**
```
Spawned forge workers:

Workers:
  - <beads-id>: term attach / term dashboard

Monitor: term workers
Dashboard: term dashboard --watch
Close: term close <beads-id>
```

## Inline Mode (Default)

When no `--spawn`:

### 1. LOAD

**IMPORTANT: Context efficiency** - Do NOT read full wish documents when listing. Only extract frontmatter.

```
1. Find wishes to forge:
   - Glob: .wishes/**/*-wish.md
   - Use grep to extract ONLY frontmatter fields (first 15 lines):
     grep -m1 "^# WISH:" <file>     # Title
     grep -m1 "^\*\*Status:\*\*" <file>  # Status
     grep -m1 "^\*\*Beads:\*\*" <file>   # Beads ID
   - ONLY show wishes with Status: DRAFT, READY, or APPROVED
   - SKIP wishes with Status: SHIPPED, REVIEW, FORGING
   - Display as compact table (slug, status, beads) - NOT full content
2. Ask which wish to forge (or use $ARGUMENTS path)
3. ONLY AFTER selection: Read full wish document
4. Verify status is DRAFT, READY, or APPROVED
5. Extract beads ID from wish document (Beads: <id>)
6. Update status to FORGING
7. Update beads: bd update <beads-id> --status in_progress
```

**Example listing output (compact):**
```
Available wishes to forge:

| Slug | Status | Beads |
|------|--------|-------|
| send-complete | DRAFT | omni-y51 |
| history-sync | DRAFT | omni-rnc |
| unified-messages | DRAFT | omni-p5c |
```

If `--group` specified, only load that group.

### 2. PLAN

For each execution group (or specified group), create a todo:

```
- Implement [Group Name]
  - Goal: [from wish]
  - Deliverables: [from wish]
  - Validation: [from wish]
```

### 3. EXECUTE

For each execution group:

1. **Implement** - Write/modify code
2. **Test** - Create/run tests
3. **Polish** - Lint, format, cleanup
4. **Validate** - Run validation commands

### 4. SELF-REVIEW

After all groups complete:

1. **Spec Review** - Verify deliverables match wish
   - PASS: Continue
   - FAIL: Address gaps

2. **Quality Review** - Check code quality
   - READY: Ready for /review
   - FIX-FIRST: Address minor issues
   - BLOCKED: Major issues, investigate

**Note:** This is self-review only. Forge NEVER sets SHIPPED status - only `/review` can ship.

### 5. HANDOFF

```
1. Update wish status to REVIEW
2. Commit changes
3. bd sync
4. Summarize what was implemented
5. Note any deviations from wish
```

## Output

**Inline mode complete:**
```
Forge complete: .wishes/<slug>/<slug>-wish.md

Status: REVIEW
Beads: omni-v2-abc123 (in_progress)

Summary:
- [What was implemented]
- [Any deviations]

Run /review for final validation.
```

## Cleanup (after wish ships)

Use `term` CLI for automated cleanup:

```bash
# Close worker + cleanup worktree + close beads issue
term close <beads-id>

# Or with merge to main
term ship <beads-id>
```

**Manual cleanup (if needed):**
```bash
term kill <worker>                           # Force kill stuck worker
git worktree remove ~/.worktrees/<session>   # Remove worktree manually
```

## Remember

- **NEVER set status to SHIPPED** - Only /review can ship
- Wish document is a contract - don't modify it
- Run all validation commands
- Don't skip the two-stage review
- Don't implement beyond wish scope
- Always sync beads: `bd sync`
- Don't close beads - only /review closes beads on SHIP verdict
