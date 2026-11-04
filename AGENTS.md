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
