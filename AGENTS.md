# Omni repository contract

Omni is a Bun and TypeScript monorepo built around Hono, Drizzle, and NATS.

- Validate every external boundary with Zod.
- Represent state changes with events.
- Never edit a deployed migration or use `drizzle push` against shared or production databases.
- Change the schema and its generated SQL migration together.
- Inspect nearby code and established repository patterns before implementing.
- Do not start services, access databases or production systems, or send external messages without explicit approval.
- Prefer safe static gates for routine validation.
- Use a disposable database for database-backed or full integration tests.

## Design records

- Decisions live in `docs/rfcs/README.md`, the one index: RFCs, the frozen multitenancy `ADR-NNNN` keys, and earlier
  records. An RFC is short and links its Genie DESIGN and WISH; it never replaces them.
- Tracked by default, at any depth: `.genie/INDEX.md`, brainstorm `DRAFT.md`/`DESIGN.md`, and wish `*.md` (planning
  Markdown only). Everything else under `.genie` is ignored (runtime state, other brainstorm notes, wish JSON/YAML/
  scripts) and needs a deliberate forced add. Name-based exclusions (`.env*`, `credentials*`, `secrets*`, `*.pem`,
  `*.key`, `config.json`, `*.db*`, logs, caches) cover those non-Markdown files; a wish `.md` with any other name is
  tracked, so never write secrets into one. Files already tracked stay tracked.
- Code, commits and PRs cite `RFC-NNNN` or an ADR key, never a `.genie` path or a wish slug. Write IETF standards with
  a space ("RFC 4122").
- `make verify-rfcs` scans tracked files under `apps/ packages/ scripts/ docs/` only. It fails when one of these does
  not resolve to an index row or a tracked file, beyond the counted allowlist in `scripts/verify-rfcs.ts`: any
  `RFC-NNNN`; `ADR-NNNN` or `ADR-XXX-NNNN`; a `.genie/wishes|brainstorms/...` path, or `wishes|brainstorms/<slug>/...`
  at the start of a word; `wish <hyphenated-slug>`; `wish: <slug>`, ``wish `<slug>` `` or `wish **<slug>**`.
  Not covered: plain one-word `wish <word>` (read as prose), other files and directories, commits and PR bodies.

## Working across residences

Two teams, on two machines with two GitHub accounts, work this repo. Coordinate on GitHub only; there is no shared hc.
For claiming and coordination, GitHub issues, assignments and PR comments on automagik-dev/omni are owner-approved
(2026-11-03).

- Claim before you work: self-assign the GitHub issue before branching. For unplanned work, open an issue first
  (neutral wording) and self-assign it. Skip issues assigned to someone else; ask on the issue instead.
- Before branching, run `git fetch`, then check `gh pr list --state open` and `git ls-remote --heads origin` for the
  same files or area. If another claim or branch overlaps, coordinate on the issue or PR; do not start.
- Branch feature work from fresh `origin/dev`. A feature branch is any branch other than `dev` and `main`. Never push
  to a feature branch your team did not create. Never force-push or rebase a shared branch. This branch rule covers feature branches; the direct-to-`dev` fixes in
  `.claude/CLAUDE.md` still apply.
- Push and open a draft PR as early as the gate allows, so the other team sees the work. Link the issue.
- Merge only PRs your own team opened; review or merge another team's PR only if they ask on it. Comment "merging" on
  the PR before queueing it.
- Migration numbers: the "whoever merges second renumbers their own migration" rule (`.claude/CLAUDE.md`, parallel
  worktree numbering collisions) applies across teams too.
- Orchestrators: at the start of each assignment cycle, read open PRs and assigned issues and avoid overlap.
- Gate wrapper: on a host with a shared gate wrapper (a script that queues bun runs on host load), export
  `OMNI_GATE_WRAPPER` to its path before starting the bots, or have the orchestrator name it in every brief.
