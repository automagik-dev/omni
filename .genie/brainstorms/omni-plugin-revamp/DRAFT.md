# omni-plugin-revamp — DRAFT

WRS: ██████████ 100/100
 Problem ✅ | Scope ✅ | Decisions ✅ | Risks ✅ | Criteria ✅

Decisions resolved 2026-07-28 (user): delete all 11 commands; simplify hook
(probe only, no auto-install); add MCP server to plugin.json. Crystallized to
DESIGN.md.

## Problem

The omni Claude Code plugin (`plugins/omni/**`) has drifted since its one bulk
commit on 2026-07-04: its setup skill and the `omni connect` CLI command
hardcode genie v4 commands that no longer exist (`genie serve start`,
`genie dir add/ls`; the real v5 surface is `genie omni serve|status|inbox|handshake`),
its 11 slash commands (~280 lines) 1:1 duplicate the omni-ops references, it
carries two stacked routing layers and two agents that are prose pointers, and
nothing mechanically prevents further rot. The genie plugin (recently reviewed)
demonstrates the target shape.

## Scope

IN:
- `plugins/omni/**` — skills, commands, agents, hooks, plugin.json
- Adopting genie conventions: single router + flat peer skills (~50-line budget,
  uniform section grammar), long material in `references/`, anti-staleness by
  discovering ground truth (`omni --help`) instead of hardcoded command lists,
  minimal frontmatter
- Canonical-source + synced-mirror + CI gate (sync --check, skills lint,
  fresh-install smoke) if adopted
- Fixing or explicitly deprecating stale genie-v4 content in omni-setup
- Repo-root `.claude/skills/*.md` flat files that never load (fix or delete)

OUT (separate work):
- `packages/cli/src/commands/connect.ts` genie-v4 contract bug — product code,
  ships as its own fix(cli) (plugin wish depends on knowing the v5 surface but
  does not implement the CLI fix)
- Any change to the omni product API/CLI behavior itself
- khal-ui, docs site

## Decisions (open)

1. Slash commands: delete all (genie has zero) vs keep a minimal high-frequency
   set (send, trace/monitor?) — USER
2. SessionStart hook `omni-runner.js` (430-line node shim, auto-installs CLI):
   keep as-is / simplify / drop — USER
3. MCP server exposure in plugin.json (genie has it, omni doesn't) — USER
4. Canonical skills location: keep authoring under `plugins/omni/skills/`
   directly vs adopt genie's canonical-dir + mirror sync — lean: adopt only if
   omni skills are also consumed outside the plugin; otherwise single location
   + lint/smoke gates is simpler
5. Agents: fold omni-bot-framework + omni-automation-builder into skills;
   keep omni-feature-implementor (genuinely distinct, repo-internal dev) — lean yes

## Risks

- Users may have muscle memory / automation on the 11 slash commands — removal
  is a breaking UX change for plugin users
- omni-setup rewrite must match the real genie v5 handshake, which lives in a
  different repo and can drift again — mitigation: discover-ground-truth style
  plus a smoke test that shells `genie omni --help`
- The SessionStart hook auto-installs the CLI; dropping it changes fresh-install
  UX
- NATS topic table in omni-setup unverified against genie v5 bridge

## Criteria (to fill)

- (draft) fresh-install smoke: plugin loads, router skill resolves, no skill
  references a CLI subcommand that `omni --help`/`genie omni --help` does not list
- (draft) size budget: every SKILL.md under N lines, no commands/ file
  duplicating a reference
