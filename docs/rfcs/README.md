# Omni RFCs

This is the one index of Omni's design decisions. An RFC is a short record of one decision:
something that needs a decision before code, sets a public contract (route, event, schema, CLI
flag), or adds a trust boundary. Work already scoped as an issue ships as a plain fix and needs
no RFC.

The design work itself happens in Genie (`.genie/brainstorms/<slug>/DESIGN.md`, then
`.genie/wishes/<slug>/WISH.md`). Those files are tracked in git. An RFC links them; it never
copies or replaces them.

## Status values

The Status cell holds one word. Progress (deliveries merged, questions answered) goes in the RFC.

| Status | Meaning |
|---|---|
| Draft | Written, not yet accepted. Its open questions wait for the owner. A reserved number with no file yet is also Draft. |
| Accepted | The owner accepted it. Its deliveries are filed as issues and built in order. |
| Shipped | Every delivery merged. The RFC stays as the record of the design. |
| Parked | Not scheduled. It keeps its number and can be picked up again. |
| Superseded | Replaced by a later RFC or owner decision, named in the RFC. Kept as the record. |

## Process

1. Brainstorm in Genie. `.genie/INDEX.md` stays Genie's intake list (Raw, Simmering); an item
   that is Ready or Poured links its RFC.
2. When the DESIGN gets SHIP, a short RFC (about 60-150 lines) lands as a docs-only PR with the
   `no-release` label. It links the DESIGN and the WISH. Copy [the template](0000-template.md).
3. The owner accepts it; the RFC moves to Accepted.
4. Each delivery is one issue and one PR that closes it.
5. When the last delivery merges, the RFC moves to Shipped.

Security gaps are named by title only until their fix merges. Details go to a private advisory.

## Numbers and citations

- RFCs are numbered `RFC-NNNN`, a new namespace. The file is `docs/rfcs/NNNN-short-name.md`.
- The existing `ADR-NNNN` keys (full multitenancy) are frozen: they stay where they live and are
  never renumbered. The LID-first identity record also calls itself ADR-0003; this index names it
  `ADR-LID-0003` and the file keeps its name.
- Two open PRs can claim the same next number. Whoever merges second renumbers their own RFC,
  as with migrations.
- Code, commits and PRs cite `RFC-NNNN` (or an existing ADR key), never a `.genie` path or a
  wish slug.

`make verify-rfcs` (part of `make check` and CI) checks that index rows and files match, that
numbers are unique, and that each Status is one of the five words. It also scans the tracked
files under `apps/`, `packages/`, `scripts/` and `docs/`: every `RFC-NNNN`, `ADR-NNNN` or named
`ADR-XXX-NNNN`, every `.genie/wishes/...` or `.genie/brainstorms/...` path, and every wish slug
(`wish <hyphenated-slug>`, `wish: <slug>` or ``wish `<slug>` ``) must resolve to a row or a
tracked file. IETF standards written as `RFC-NNNN` (RFC-4122, UUIDs) are not Omni RFCs and the
index never uses their numbers; prefer "RFC 4122" with a space. Citations that were already
dangling when the gate landed are listed in `scripts/verify-rfcs.ts` with their count per file;
one more fails, and the list only shrinks.

## Index

| # | Title | Status | Milestone | Issue | Design |
|---|---|---|---|---|---|
| RFC-0001 | Omni chat threads (reserved: being rebuilt) | Draft | — | — | Not tracked; the design was lost and is being rebuilt |

## Earlier records

Decisions recorded before this index. They stay where they are.

| # | Title | Status | Milestone | Issue | Design |
|---|---|---|---|---|---|
| ADR-0001 | Ownership classes | Accepted | — | — | [ADR-0001](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0001-ownership-classes.md) |
| ADR-0002 | Person and platform identity split | Accepted | — | — | [ADR-0002](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0002-person-platform-identity-split.md) |
| ADR-0003 | Isolated auth bootstrap | Accepted | — | — | [ADR-0003](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0003-isolated-auth-bootstrap.md) |
| ADR-0004 | RLS transaction context and role split | Accepted | — | — | [ADR-0004](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0004-rls-transaction-context-and-role-split.md) |
| ADR-0005 | Platform admin access to a target tenant | Accepted | — | — | [ADR-0005](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0005-platform-admin-target-tenant-access.md) |
| ADR-0006 | Tenant key lineage, delegation and revocation | Accepted | — | — | [ADR-0006](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0006-tenant-key-lineage-delegation-revocation.md) |
| ADR-0007 | Mixed-version writer fence and rollback | Accepted | — | — | [ADR-0007](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0007-mixed-version-writer-fence-rollback.md) |
| ADR-0008 | Async storage cache context | Accepted | — | — | [ADR-0008](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0008-async-storage-cache-context.md) |
| ADR-0009 | Tenant egress broker and SSRF | Accepted | — | — | [ADR-0009](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0009-tenant-egress-broker-ssrf.md) |
| ADR-0010 | Shared runtime residual risk | Accepted | — | — | [ADR-0010](../../.genie/wishes/omni-full-multitenancy/adrs/ADR-0010-shared-runtime-residual-risk.md) |
| ADR-LID-0003 | LID-first identity | Shipped | — | #919 | [adr-0003-lid-first-identity.md](../architecture/adr-0003-lid-first-identity.md) |
| — | Paired agents | Accepted | — | — | [DESIGN](../../.genie/brainstorms/paired-agents/DESIGN.md), [slice 2 WISH](../../.genie/wishes/paired-agents-slice-2/WISH.md) |
| — | GitLab SDLC connector | Accepted | — | — | Not tracked yet (the owner decides, #1622) |
| — | Slack personal OAuth | Accepted | — | — | [DESIGN](../../.genie/brainstorms/slack-personal-oauth/DESIGN.md), [WISH](../../.genie/wishes/slack-personal-oauth/WISH.md) |
| — | Omni plugin revamp | Accepted | — | — | [DESIGN](../../.genie/brainstorms/omni-plugin-revamp/DESIGN.md), [WISH](../../.genie/wishes/omni-plugin-revamp/WISH.md) |

The multitenancy ADRs belong to the [full multitenancy wish](../../.genie/wishes/omni-full-multitenancy/WISH.md).
