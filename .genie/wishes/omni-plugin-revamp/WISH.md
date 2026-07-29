# Wish: Omni Plugin Revamp — genie-shape simplification

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `omni-plugin-revamp` |
| **Date** | 2026-07-29 |
| **Author** | Felipe Rosa |
| **Appetite** | medium |
| **Branch** | `wish/omni-plugin-revamp` |
| **Repos touched** | omni |
| **Design** | [DESIGN.md](../../brainstorms/omni-plugin-revamp/DESIGN.md) |

## Summary

The omni Claude Code plugin has rotted since its single bulk commit on
2026-07-04: it teaches genie v4 commands that no longer exist, ships 11 slash
commands that duplicate the omni-ops references 1:1, stacks two routing layers,
and carries two agents that are only prose pointers. This wish restructures it
to the genie plugin shape — one router plus flat peer skills, CLI-only — and
encodes that shape in CI gates so it cannot silently rot again.

## Scope

### IN

- Delete `plugins/omni/commands/` (all 11 command files)
- Collapse routing: the `omni` router dispatches directly to peer skills;
  `omni-ops` becomes references, not a second router
- Rewrite `omni-setup` against the real genie v5 surface
  (`genie omni serve|status|inbox|handshake`) in discover-ground-truth style
- Fold `omni-bot-framework` and `omni-automation-builder` into skills; keep
  `omni-feature-implementor`
- Fold `plugins/omni/rules/omni-agent.md` into the omni-agent skill; delete it
- Simplify the SessionStart hook to a probe (no auto-install); shrink
  `omni-runner.js` to ≤ 80 lines
- Enrich `plugin.json`: repository, license, keywords; no `mcpServers` key
- CI anti-rot gates: skills lint (size, frontmatter, grammar) + fresh-install
  smoke that builds the CLI from source and checks every named subcommand
  against `omni --help`
- Repo-root `.claude/skills/*.md` flat files → loadable `<name>/SKILL.md` dirs
  or deleted; wire or delete orphaned `.claude/hooks/wish-validator.md`
- Delete the three stale MCP claims: the `## MCP Integration` section and the
  `MCP Tools` diagram box in `docs/architecture/overview.md`, and the
  `packages/mcp/` row in `.claude/CLAUDE.md`
- Migration note mapping each removed command to its router phrase

### OUT

- MCP entirely — no server written, exposed, or planned (CLI-only decision;
  zero `mcp` paths exist on `origin/dev`)
- `packages/cli/src/commands/connect.ts` genie-v4 contract bug — product code,
  ships as its own `fix(cli)`
- Any behavior change to the omni product API or CLI
- Canonical-dir + mirror sync layer (genie needs it; omni has one consumer)
- khal-ui, docs site, marketplace mechanics

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Delete all 11 slash commands | User decision. Genie ships zero; removes ~280 lines duplicating references 1:1. |
| 2 | SessionStart hook: probe only, no auto-install | User decision. Keeps the signal, drops a 430-line shim that installs software silently. |
| 3 | CLI-only: no MCP, now or planned | User decision after learning `packages/mcp` does not exist. One surface is the simpler contract. |
| 4 | Single skill location + CI gates, no mirror sync | Omni skills have exactly one consumer. |
| 5 | Fold the two pointer-agents; keep `omni-feature-implementor` | The first two point into omni-ops; the third covers repo-internal dev no skill does. |
| 6 | Discover ground truth via `--help` at use time | Hardcoded command lists are the rot vector that broke omni-setup. |
| 7 | Keep `allowed-tools` frontmatter | Functional permission-prompt UX, not metadata bloat. |
| 8 | CI builds the CLI from `packages/cli` | The gate cannot depend on the auto-installer this wish deletes. |
| 9 | Router skill exempt from the operational grammar check | Genie's own router uses a routing shape; the gate must not fight it. |

## Simplicity Case

- **Simplest complete design:** delete the duplicated surfaces, rewrite the one
  stale skill, and add a lint plus a smoke test. Everything else is subtraction.
- **Added machinery:** two CI gates. Justified by present evidence — the plugin
  rotted undetected for ~3 weeks, and the survey found wrong instructions
  shipping to users today. Nothing else is added.
- **Deferred until measured:** canonical-dir/mirror sync (trigger: a second
  consumer of omni skills appears); an MCP server (trigger: an explicit user
  need — currently CLI-only by decision).
- **Complexity removed:** 11 command files, one routing layer, two agents, one
  rules file, ~350 lines of the hook shim, three false MCP doc claims.

## Dependencies

**depends-on:** none
**blocks:** none

## Success Criteria

- [ ] `plugins/omni/commands/` does not exist; plugin loads without it
- [ ] Every peer `SKILL.md` is ≤ 100 lines, carries only `name`, `description`,
      and (where it shells out) `allowed-tools`, and uses
      `When to Use → Flow → Rules`; the router is exempt from the grammar check
- [ ] `rg -n "genie serve|genie dir|genie ls --source"` over `plugins/omni/`
      returns zero hits
- [ ] No skill hardcodes an `omni` subcommand list; each discovers via `--help`
- [ ] `plugins/omni/agents/` contains exactly `omni-feature-implementor`;
      `plugins/omni/rules/` is gone
- [ ] `omni-runner.js` performs no installation and is ≤ 80 lines
- [ ] `plugin.json` has repository, license, keywords, and no `mcpServers` key
- [ ] `rg -i mcp docs/architecture/overview.md .claude/CLAUDE.md plugins/omni/`
      returns zero hits
- [ ] `.claude/skills/` contains only loadable `<name>/SKILL.md` dirs (or is
      empty); no orphaned hook docs
- [ ] The new CI job fails on: over-budget skill, malformed frontmatter, a named
      subcommand absent from `omni --help`, or smoke failure
- [ ] A migration note maps each of the 11 removed commands to its router phrase

## Execution Strategy

Groups 1 and 2 both write the same four `SKILL.md` files — group 1 moves
structure and folds content in, group 2 then rewrites that content against
ground truth — so they are serialized, not parallel. Group 3 touches
`scripts/`, `.claude-plugin/`, `docs/`, and root `.claude/` only, so it runs
alongside them. Group 4 must observe the final tree and runs last.

### Wave 1 (parallel)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | 2 (+1 prompt-skill change, +1 no deterministic test) | `engineer-standard` / medium | Delete commands, collapse routing, fold agents and rules |
| 3 | engineer | 1 (+1 no deterministic test) | `engineer-trivial` / low | Hook simplification, plugin.json metadata, stale MCP doc deletion, root `.claude/` cleanup |

### Wave 2 (after group 1)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | 3 (+1 prompt-skill change, +1 no deterministic test, +1 cross-repo contract) | `engineer-standard` / high | Rewrite omni-setup against genie v5; discover-ground-truth pass over the collapsed skill tree |

### Wave 3 (after groups 1, 2, 3)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 4 | engineer | 3 (+1 CI work, +1 multi-package, +1 prompt-skill change) | `engineer-standard` / high | Skills lint + fresh-install smoke CI job, migration note |

Complexity scoring rubric: score each group independently and record the total plus a short rationale in **Complexity**. Add:

- **+2** each for orchestration / agent-lifecycle / routing; cost / model / escalation; stateful work; subjective acceptance.
- **+1** each for multi-package work; OTel-label dependency; no deterministic test; prior rework; prompt-skill change; CI / release work.

Route the total in **Model** by portable role and reasoning effort: **0–1** →
`engineer-trivial` / low; **2–3** → `engineer-standard` / medium or high;
**4–6** → `engineer-complex` / high; **7+** → `engineer-complex` plus an
independent `final-gate` at the highest justified effort. Codex maps these to
the `genie_*` profiles; other runtimes use their matching native roles. Keep
model and effort in runtime session/agent configuration, never skill frontmatter.

## Execution Groups

### Group 1: Delete duplicated surfaces

**Goal:** Remove the command layer, the second routing layer, and the two
pointer-agents so skills are the only surface.

**Deliverables:**
1. `plugins/omni/commands/` deleted (all 11 files)
2. `plugins/omni/skills/omni/SKILL.md` router dispatches directly to peer
   skills; `omni-ops/SKILL.md` demoted to references consumed by peers
3. `omni-bot-framework` and `omni-automation-builder` folded into the skills
   they pointed at; both agent files deleted
4. `plugins/omni/rules/omni-agent.md` folded into the omni-agent skill; the
   `rules/` directory deleted

**Acceptance Criteria:**
- [ ] `plugins/omni/commands/` and `plugins/omni/rules/` do not exist
- [ ] `plugins/omni/agents/` contains exactly `omni-feature-implementor.md`
- [ ] No skill routes to another router — the `omni` router names peer skills
- [ ] No content lost: the intent each deleted command served is answerable from
      a peer skill — enumerated in the group 4 migration note, which must list
      all 11 with a non-empty replacement phrase

**Validation:**
```bash
test ! -d plugins/omni/commands && test ! -d plugins/omni/rules &&
  test "$(ls plugins/omni/agents | wc -l)" -eq 1
```

**depends-on:** none

---

### Group 2: Rewrite against real ground truth

**Goal:** Make every skill's factual claims true today and self-correcting
tomorrow. Runs after group 1 so it rewrites the collapsed tree, not a moving one.

**Deliverables:**
1. `omni-setup` rewritten against `genie omni serve|status|inbox|handshake`,
   with the genie contract version it was written against stated inline
2. Every skill converted to discover-ground-truth style — read `omni --help` /
   `genie omni --help` at use time instead of hardcoding subcommand lists
3. NATS topic table verified against the genie v5 bridge, or dropped
4. All peer skills conform to `When to Use → Flow → Rules` and the ≤ 100-line
   budget; long material moved to `references/`

**Acceptance Criteria:**
- [ ] `rg -n "genie serve|genie dir|genie ls --source" plugins/omni/` → zero hits
- [ ] Every `genie`/`omni` subcommand named in a skill exists in the
      corresponding `--help` output
- [ ] Every peer `SKILL.md` ≤ 100 lines with the operational grammar
- [ ] Frontmatter is `name` + `description` (+ `allowed-tools` where it shells out)

**Validation:**
```bash
bash -c '! rg -q "genie serve|genie dir|genie ls --source" plugins/omni/ || exit 1
for f in plugins/omni/skills/*/SKILL.md; do
  [ "$(wc -l < "$f")" -le 100 ] || { echo "over budget: $f"; exit 1; }
done'
```

Note: the budget loop passes today (skills are 38–98 lines) — the grep is the
load-bearing half here. Frontmatter shape and the subcommand-exists-in-`--help`
criterion are mechanically enforced by group 4's lint, which is why group 4
carries this group's remaining acceptance evidence.

**depends-on:** 1

---

### Group 3: Hook, manifest, and stale-doc cleanup

**Goal:** Strip the auto-installer, complete the manifest metadata, and delete
every doc claim about software omni does not ship.

**Deliverables:**
1. `omni-runner.js` reduced to a health probe that prints the install command;
   no installation performed; ≤ 80 lines
2. `plugin.json` gains repository, license, keywords; no `mcpServers` key
3. `docs/architecture/overview.md`: `## MCP Integration` section and the
   `MCP Tools` box in the architecture diagram (line ~46) deleted
4. `.claude/CLAUDE.md`: `packages/mcp/` row removed from the structure table
5. Repo-root `.claude/skills/*.md` converted to `<name>/SKILL.md` dirs or
   deleted; `.claude/hooks/wish-validator.md` wired or deleted

**Acceptance Criteria:**
- [ ] `omni-runner.js` ≤ 80 lines and contains no install/exec of a package manager
- [ ] `rg -i mcp docs/architecture/overview.md .claude/CLAUDE.md` → zero hits
      claiming a shipped omni MCP server
- [ ] No flat `.md` files directly under `.claude/skills/`
- [ ] SessionStart still reports CLI presence/absence on a fresh session

**Validation:**
```bash
[ "$(wc -l < plugins/omni/scripts/omni-runner.js)" -le 80 ] &&
  ! rg -qi "mcp" docs/architecture/overview.md &&
  ! rg -qi "mcp" .claude/CLAUDE.md &&
  ! ls .claude/skills/*.md 2>/dev/null | grep -q .
```

**depends-on:** none

---

### Group 4: Anti-rot CI gates and migration note

**Goal:** Make the new shape mechanically enforced so the next drift fails CI
instead of reaching users.

**Deliverables:**
1. Skills lint script: size budget, frontmatter shape, operational grammar for
   peers (router exempt), no hardcoded subcommand lists
2. Fresh-install smoke: builds the CLI from `packages/cli`, loads the plugin,
   resolves the router, and asserts every subcommand named in a skill appears
   in `omni --help`
3. `package.json` declares `skills:lint` and `plugin:smoke` script aliases for
   the two scripts above
4. Both wired into a CI job on PRs touching `plugins/omni/**`
5. Migration note (CHANGELOG + plugin README) mapping each of the 11 removed
   commands to its router phrase, all 11 with a non-empty replacement

**Acceptance Criteria:**
- [ ] The lint fails on a deliberately over-budget skill (proven by a temporary
      edit, reverted)
- [ ] The smoke fails on a deliberately invented subcommand (proven, reverted)
- [ ] The job runs on PRs touching `plugins/omni/**` and passes on the final tree
- [ ] The migration note lists all 11 removed commands with replacements

**Validation:**
```bash
bun scripts/skills-lint.ts && bun scripts/plugin-smoke.ts &&
  bun run skills:lint && bun run plugin:smoke
```

**depends-on:** 1, 2, 3

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] Functional: in a fresh Claude Code session with the plugin enabled, asking
      to send a message and to list instances both resolve through the router
      without any slash command
- [ ] Integration: `omni-setup`'s documented flow completes against a real genie
      v5 install (`genie omni handshake` path works as written)
- [ ] Regression: SessionStart still reports CLI status; no session errors from
      the removed auto-install path

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users with `/send` muscle memory lose commands | Medium | Router answers the same intents; migration note maps every removed command to its phrase |
| genie v5 surface drifts again (other repo) | Medium | Discover-ground-truth style; smoke shells `genie omni --help` when genie is present; skill states the contract version |
| Dropping auto-install changes fresh-install UX | Low | Probe prints the exact install command; README quickstart covers it |
| NATS topic table may be wrong for the v5 bridge | Low | Verify during rewrite; drop the table if unverifiable |
| Group 4's smoke needs a built CLI in CI | Low | Decision 8: build from `packages/cli` (`make cli-build`) |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review — 2026-07-29 — SHIP

Reviewer: plan-reviewer-ac0c4527 (loop 2, independent of the author).

Loop 1 returned FIX-FIRST on three gaps, all resolved and re-verified:

1. **[HIGH] groups 1 and 2 were not disjoint** — both write the same four
   `SKILL.md` files while the wish claimed they ran in parallel. Resolved by
   serializing: Wave 1 is groups 1 and 3, Wave 2 is group 2 (`depends-on: 1`),
   Wave 3 is group 4. Group 3 confirmed genuinely disjoint.
2. **[HIGH] group 3 carried an always-pass validation** — `rg -q "packages/mcp"`
   never matched, since the real row is `└── mcp/` at `.claude/CLAUDE.md:195`,
   so deliverable 4 could be skipped with the gate still green. Now
   `! rg -qi "mcp"`, proven to fail today.
3. **[MEDIUM] group 4 invoked script aliases nothing created** — `skills:lint`
   and `plugin:smoke` are now a declared deliverable with `package.json` in
   Files to Create/Modify.

All four group validations were executed by the reviewer and exit 1 today for
the correct reason. Design fidelity holds against all 11 DESIGN.md criteria; no
placeholders; ordering sound.

Two LOW notes carried into execution (non-blocking): group 3 deliverable 2
(`plugin.json` metadata) has no mechanical check in its own validation block —
success criterion only; and group 3's acceptance text still says "zero hits
claiming a shipped MCP server" while its validation is the stricter flat grep.
The validation governs, so there is no escape hatch.

---

## Files to Create/Modify

```
plugins/omni/commands/                      DELETE (11 files)
plugins/omni/rules/omni-agent.md            DELETE
plugins/omni/agents/omni-bot-framework.md   DELETE
plugins/omni/agents/omni-automation-builder.md DELETE
plugins/omni/agents/omni-feature-implementor.md KEEP
plugins/omni/skills/omni/SKILL.md           REWRITE (router → peers)
plugins/omni/skills/omni-agent/SKILL.md     REWRITE (+ folded rules)
plugins/omni/skills/omni-setup/SKILL.md     REWRITE (genie v5)
plugins/omni/skills/omni-ops/               DEMOTE to references
plugins/omni/scripts/omni-runner.js         SHRINK (probe only, ≤80 lines)
plugins/omni/.claude-plugin/plugin.json     MODIFY (metadata, no mcpServers)
docs/architecture/overview.md               MODIFY (delete MCP section + diagram box)
.claude/CLAUDE.md                           MODIFY (drop packages/mcp row)
.claude/skills/*.md                         CONVERT or DELETE
.claude/hooks/wish-validator.md             WIRE or DELETE
scripts/skills-lint.ts                      CREATE
scripts/plugin-smoke.ts                     CREATE
package.json                                MODIFY (skills:lint, plugin:smoke)
.github/workflows/ci.yml                    MODIFY (plugin gate job)
CHANGELOG.md / plugins/omni/README.md       MODIFY (migration note)
```
