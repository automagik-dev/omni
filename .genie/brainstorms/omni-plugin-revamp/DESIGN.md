# Design: Omni Plugin Revamp — genie-shape simplification

| Field | Value |
|-------|-------|
| **Slug** | `omni-plugin-revamp` |
| **Date** | 2026-07-28 |
| **WRS** | 100/100 |

## Problem

The omni Claude Code plugin (`plugins/omni/**`) has rotted since its single bulk
commit on 2026-07-04: its setup skill teaches genie v4 commands that no longer
exist, 11 slash commands (~280 lines) duplicate the omni-ops references 1:1,
two routing layers stack on each other, two of three agents are prose pointers,
and nothing mechanically prevents further drift. Plugin users get wrong
instructions today (`genie serve start` fails on genie v5), and every omni CLI
change silently invalidates hardcoded command lists.

## Scope

### IN

Primary surface is `plugins/omni/**`; the last two bullets also touch repo-root
`.claude/` and two doc files, because the same rot lives there.

- `plugins/omni/**`: skills, commands, agents, hooks, `plugin.json`
- Restructure to the genie plugin shape: one router skill (`omni`) + flat peer
  skills, each ≤ 100 lines (hard CI budget; aim lower), long material moved to
  `references/`. Section grammar per skill class, matching genie's actual
  practice: operational skills (omni-agent, omni-setup, ops peers) use
  `When to Use → Flow → Rules`; only audit-class skills (none planned today)
  use the Lens → Mandate → … audit grammar
- Delete all 11 slash commands (`commands/` directory removed)
- Rewrite `omni-setup` against the real genie v5 surface
  (`genie omni serve|status|inbox|handshake`), in discover-ground-truth style
  (read `omni --help` / `genie omni --help` at use time; never hardcode
  subcommand lists); verify the NATS topic table against the v5 bridge or drop it
- Fold `omni-bot-framework` and `omni-automation-builder` agents into the
  skills they point at; keep `omni-feature-implementor` (genuinely distinct:
  repo-internal platform development)
- Collapse the two routing layers: the `omni` router dispatches directly to
  peer skills; `omni-ops` becomes references consumed by those skills, not a
  second router
- Simplify the SessionStart hook: keep the health probe, remove auto-install
  (detect + one-line install hint); shrink `omni-runner.js` accordingly
- Fold `rules/omni-agent.md` (12 lines duplicating the omni-agent skill) into
  the omni-agent skill; delete the rules file
- Enrich `plugin.json` metadata: repository, license, keywords (genie parity)
- CI anti-rot gates: skills lint (size budget, frontmatter shape, section
  grammar) + fresh-install smoke (plugin loads, router resolves, every CLI
  subcommand a skill names exists in `omni --help` output)
- Repo-root `.claude/skills/*.md` flat files that never load: convert the ones
  worth keeping to `<name>/SKILL.md` dirs, delete the rest; wire or delete the
  orphaned `hooks/wish-validator.md`
- Delete the doc sections that describe an MCP server omni does not have:
  `docs/architecture/overview.md` "MCP Integration" (nine tools, HTTP/stdio,
  port 8882) and the `packages/mcp/` row in `.claude/CLAUDE.md`'s structure
  table — same doc-rot class as the genie-v4 commands this wish removes

### OUT
- MCP entirely — the plugin drives omni through the CLI and nothing else. No
  `packages/mcp` exists anywhere on `dev` (verified: `git ls-tree -r origin/dev`
  matches zero `mcp` paths), and the user's decision is CLI-only, so no MCP
  server is written, exposed, or planned. Instead this wish deletes the two
  places that document a server as if it ships: the MCP section of
  `docs/architecture/overview.md` and the `packages/mcp/` row in
  `.claude/CLAUDE.md`'s structure table.
- `packages/cli/src/commands/connect.ts` genie-v4 contract bug — product code,
  ships as its own `fix(cli)` commit/PR independent of this wish
- Any behavior change to the omni product API or CLI
- A canonical-dir + mirror sync layer (genie needs it because its skills ship
  to multiple tiers; omni's skills live only in the plugin — single location
  plus CI gates is simpler and sufficient)
- khal-ui, docs site, marketplace mechanics

## Approach

**Chosen: subtractive restructure to the genie shape, gated by CI.** Delete the
command layer, flatten routing to one router + peers, fold pointer-agents,
rewrite the one stale skill against v5, and encode the new shape in lint +
smoke gates so it cannot silently rot again.

Alternatives considered:
- *Incremental dedupe (keep commands, strip to pointers):* preserves `/send`
  muscle memory but keeps three surfaces (commands, router, references) that
  drift independently — rejected by the "delete all" decision.
- *Full genie clone incl. canonical/mirror sync:* the sync machinery earns its
  keep only when skills ship to multiple consumers; omni has one. Rejected as
  YAGNI.

Isolation: each peer skill has a single purpose describable in one sentence;
skills depend on the CLI contract (discovered at use time), never on each
other's internals; the smoke gate tests each skill's named surface
independently.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Delete all 11 slash commands | User decision. Genie ships zero; skills are the only surface; removes ~280 lines duplicating references 1:1. |
| 2 | Simplify SessionStart hook: probe only, no auto-install | User decision. Keeps fresh-session signal; removes a 430-line shim silently installing software. |
| 3 | CLI-only: no MCP, now or planned | The user first chose "add it" on my wrong premise that `packages/mcp` exists; once corrected they chose CLI-only. One surface (the CLI) is the simpler contract, and the stale docs claiming an MCP server get deleted here. |
| 4 | Single skill location + CI gates, no mirror sync | Omni skills have exactly one consumer (the plugin); sync machinery is YAGNI. |
| 5 | Fold bot-framework and automation-builder agents; keep feature-implementor | The first two are prose pointers into omni-ops; the third targets repo-internal dev work no skill covers. |
| 6 | `connect.ts` v4-contract bug ships separately | Product code bug with its own test surface; keeping the wish plugin-only keeps it reviewable. |
| 7 | Discover-ground-truth style everywhere | Hardcoded command lists are the rot vector that broke omni-setup; genie's `--help`-at-use-time pattern prevents recurrence. |
| 8 | Keep `allowed-tools` frontmatter | It is functional (permission-prompt UX), not metadata bloat; "minimal frontmatter" means `name`, `description`, and `allowed-tools` where the skill shells out — nothing else. |
| 9 | CI runs `omni --help` from source | The gate builds the CLI from `packages/cli` in-repo (`make cli-build` / `bun run`) instead of depending on a globally installed `omni`; no auto-installer needed in CI. |

## Risks & Assumptions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Users with `/send` etc. muscle memory lose commands | Medium | Router skill answers the same intents; CHANGELOG + README migration note mapping each removed command to its phrase. |
| 2 | genie v5 surface drifts again (lives in another repo) | Medium | Discover-ground-truth style + smoke gate shells `genie omni --help` when genie is present; skill states the contract version it was written against. |
| 3 | Dropping auto-install changes fresh-install UX | Low | Probe prints the exact install command; README quickstart covers it. |
| 4 | NATS topic table in omni-setup may be wrong for v5 bridge | Low | Verify against the v5 bridge during rewrite; drop the table if unverifiable (discover at runtime instead). |
| 5 | Removing `allowed-tools` would regress permission UX | Low | Decision 8: keep it. |

Assumptions: genie v5's `genie omni serve|status|inbox|handshake` is the stable
integration surface (confirmed in ../genie README and
src/term-commands/omni.ts).

## Success Criteria

- [ ] `plugins/omni/commands/` no longer exists; plugin loads cleanly without it
- [ ] Every `SKILL.md` under `plugins/omni/skills/` is ≤ 100 lines and carries
      only `name`, `description`, and (where it shells out) `allowed-tools`
      frontmatter. Peer skills use the operational grammar
      (`When to Use → Flow → Rules`); the router is exempt from the grammar
      check and uses a routing shape (intent table → rules), as genie's router
      does
- [ ] No skill or reference names a `genie` v4 command (`genie serve`,
      `genie dir`) — grep returns zero hits
- [ ] No skill hardcodes an `omni` subcommand list; each instructs discovering
      via `--help`
- [ ] Agents directory contains exactly `omni-feature-implementor`;
      `rules/omni-agent.md` is gone, its content folded into the omni-agent skill
- [ ] SessionStart hook performs no installation; probe script ≤ 80 lines
- [ ] `plugin.json` declares repository, license, keywords, and no `mcpServers`
      key; `rg -i mcp` over `plugins/omni/`, `docs/architecture/overview.md`,
      and `.claude/CLAUDE.md` returns zero hits claiming a shipped MCP server
- [ ] CI gate builds the CLI from `packages/cli` and fails on: over-budget
      skill, malformed frontmatter, a named CLI subcommand absent from
      `omni --help`, fresh-install smoke failure
- [ ] Repo-root `.claude/skills/` contains only loadable `<name>/SKILL.md` dirs
      (or is empty); no orphaned hook docs
- [ ] Migration note maps each of the 11 removed commands to its router phrase

## Next Step

After an independent design review returns SHIP, persist the evidence below and verify its content digest before running `wish`.

<!-- genie-design-review:start -->
## Design Review Evidence

- **Verdict:** SHIP
- **Reviewed content SHA-256:** `c81dc644dbb5d7d530d8b766578ba0ae0a34f6196afa3b7c49ce7a0d92c658b6`
- **Reviewer:** design-reviewer-ae3b4037
- **Reviewed at:** 2026-07-29T00:17:22.000Z
<!-- genie-design-review:end -->
