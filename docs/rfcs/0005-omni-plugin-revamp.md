---
rfc: "0005"
title: "Omni plugin revamp"
status: Draft
created: 2026-07-28
---
# RFC-0005: Omni plugin revamp

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | One discoverable, accurate CLI skill surface |
| Issue | [#1461](https://github.com/automagik-dev/omni/issues/1461) (subsequent drift repair) |
| Design | [DESIGN](../../.genie/brainstorms/omni-plugin-revamp/DESIGN.md), [WISH](../../.genie/wishes/omni-plugin-revamp/WISH.md) |
| Created | 2026-07-28 |

## Summary

The Claude Code plugin becomes one router and a set of short peer skills that
discover the installed CLI through help. Duplicated commands, pointer agents,
stale setup instructions and false MCP documentation are removed. Lint and smoke
checks keep the instructions aligned with the CLI they teach.

**Happy delivery:** ask the Omni plugin to connect an agent and follow working CLI instructions without being sent through duplicate commands or an automatic installer.

## Motivation

Users received instructions for retired Genie commands while multiple routing
layers repeated the same content. The owner chose a smaller CLI-only plugin,
with a mechanism to detect future instruction drift.

## Design

The router dispatches directly to operational peer skills. Each skill is at most
100 lines, with longer material in references and command discovery at use time.
The two pointer agents fold into skills; the distinct feature implementor stays.
All eleven slash commands and the duplicate rules surface are removed.

The WISH supersedes its original probe-only SessionStart design: #905 retired
the hook entirely and moved the health check to `genie doctor`. No hook is
reintroduced by this RFC. Loadable root skills and accurate documentation belong
to the same cleanup; product API/CLI behavior changes remain separate work.

## Contracts introduced

- Plugin skill entry points are the router and peers, replacing slash commands.
  A migration note maps each removed command to an intent the router handles.
- Skill front matter contains `name`, `description` and functional `allowed-tools`
  where needed; operational peers use When to Use, Flow and Rules.
- Plugin metadata gains repository/license/keywords. No MCP server is declared.
- CI uses the repository CLI to verify named examples, size/grammar/front matter
  and installation. It does not depend on a globally installed CLI.
- No public route, event, database column or CLI flag changes in this goal.
  Existing CLI callers retain their behavior; the plugin instructions adapt.

## Threat model

The plugin invokes the CLI under the user's local tool permissions. Skill text
does not grant server authority. The automatic installer is removed and the
retired hook stays absent. Actual operations still use the caller's credentials,
scopes and approval requirements; instruction cleanup does not widen them.

## Deliveries

1. Group 1: remove duplicate commands/routing/agents/rules (own issue/PR to identify).
   Acceptance: each old intent resolves through a single router to its peer.
   Rollback: restore instruction files; no stored product data changes.
2. Group 2: rewrite setup and peers against actual help (own issue/PR).
   Acceptance: the documented setup works against the installed CLI/Genie version.
   Rollback: revert instructions, preserving the retirement of obsolete hooks.
3. Group 3: metadata, root skill cleanup and false MCP claims (own issue/PR).
   Acceptance: the plugin loads and describes only the CLI surface it provides.
   Rollback: revert documentation/metadata; no database migration is involved.
4. Group 4: lint/smoke gates and migration note (own issue/PR).
   Acceptance: an invalid named command or over-budget skill fails the gate.
   Rollback: revert the gate change without reinstalling the removed auto-installer.

## Progress

The WISH still records APPROVED and its four groups; the supplied merged snapshot
does not identify a complete four-group delivery. It does record #1517 updating
plugin skills and #1570 guarding command examples against drift. #1586 separately
adds consumer scope support associated with #1461; it is not a plugin restructure.
The #905 hook retirement is recorded by the WISH, outside the snapshot's range.
These partial repairs must not be reported as completion of the whole goal.

## Open questions

No unresolved owner design question is recorded. The hook retirement is an
existing supersession, not an invitation to choose a new startup mechanism.

## Links

- [#1517](https://github.com/automagik-dev/omni/pull/1517), [#1570](https://github.com/automagik-dev/omni/pull/1570)
- [#1461](https://github.com/automagik-dev/omni/issues/1461)
- [RFC-0002](0002-paired-agents.md) — consumer authority is a separate contract
