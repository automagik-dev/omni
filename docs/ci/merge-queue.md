---
title: "Merge queue on dev — combined-state gate"
created: 2026-09-08
tags: [ci, merge-queue, quality-gate]
status: current
---

# Merge queue on `dev` — the combined-state gate (#990)

> Decision record for issue #990, implemented in the PR that adds the
> `merge_group` triggers to `.github/workflows/ci.yml` and
> `.github/workflows/commitlint.yml`. The workflow side ships in-repo; the
> queue itself is a **one-time repository-settings change a human must make**
> (checklist below).

## The failure class

PRs #964 and #965 were each green in isolation but **broke `dev` in
combination**: one suite relied on the ambient global `fetch`, a sibling suite
replaced `globalThis.fetch`, and the merge product was red (fixed after the
fact in #963 by pinning native fetch). Per-PR CI cannot see this class *by
construction* — each PR is tested against the `dev` that existed when its run
started, never against `dev` + the other in-flight PRs it will actually land
with. PR #971's push-time sweep catches the breakage, but only **after** it is
already on `dev`.

## Decision: GitHub merge queue (option 2)

Issue #990 listed three options. The merge queue wins because the repo's CI is
already shaped for it:

1. **"Require branches to be up to date" (strict checks)** — rejected. With N
   concurrent auto-merge PRs every merge invalidates the other N−1, forcing a
   branch-update + full re-run storm per landing. The agent auto-merge flow
   would spend most of its time rebasing, and nothing ever tests more than one
   PR ahead.
2. **Merge queue** — chosen. The queue synthesizes a
   `gh-readonly-queue/dev/...` merge commit (PR + current `dev` + every PR
   queued ahead of it), runs the required checks on **that commit**, and only
   merges green groups. The combined state is tested before merge by
   construction. Crucially, `ci.yml` already routes non-`pull_request` events
   to the **full single-process sweep** (`bun test packages apps/ui`) — the
   only configuration where cross-file state leaks like the
   `globalThis.fetch` clash reproduce — so `merge_group` runs inherit exactly
   the right test mode with no new machinery. Batching also means one
   combined run can land several PRs.
3. **Speculative-merge sweep workflow** — rejected as primary. It re-implements
   the queue by hand (choose PRs, build the octopus merge, map failures back
   to a culprit, race against auto-merge landing PRs mid-run) and it reports
   *advisory* red after the fact rather than blocking the merge. The
   push-to-`dev` sweep already provides the after-the-fact backstop; it stays.

## What ships in-repo (this PR)

- `ci.yml` gains a `merge_group` trigger (`branches: [main, dev]`). All four
  jobs — Quality Gate, PostgreSQL Isolation Gate, Remote Media, Smoke Test —
  run on merge groups with no per-job changes needed:
  - The quality gate's test step split (`pull_request` → turbo-cached
    per-package run, everything else → single-process sweep) sends merge
    groups down the **sweep** path.
  - The migration contract gate's `github.base_ref` expressions fall through
    to `origin/dev` on merge groups (empty `base_ref`), which is the correct
    contract base.
  - `secrets-scan` skips (it is push-only and non-blocking by design).
  - The `ci-${{ github.ref }}` concurrency group is safe: each merge group
    has a unique `gh-readonly-queue/...` ref.
- `commitlint.yml` gains a `merge_group` trigger whose job **skips itself**
  on merge groups. Skipped satisfies a required check; without the trigger, a
  required "Commit Messages" check would stall every queue entry until the
  queue timed it out. The commits were already linted on the `pull_request`
  event, and the queue's synthesized merge commits are not conventional-commit
  input.

Nothing here can be exercised before the queue exists: `merge_group` only
fires for an enabled merge queue, and there is no local simulation. The
workflows were validated with `actionlint` and the release-workflow contract
gate; the first queued PR is the real test.

## One-time settings change (human, repo admin)

On <https://github.com/automagik-dev/omni/settings/branches>, edit the
protection rule for `dev` (it exists today with **no** required status
checks — verified 2026-09-08):

1. **Enable "Require status checks to pass before merging"** and select:
   - `Quality Gate (typecheck + lint + test)`
   - `PostgreSQL Isolation Gate (tenancy/RLS)`
   - `Remote Media (S3/MinIO integration)`
   - `Smoke Test (Fresh Environment)`
   - `Commit Messages` (optional but recommended — safe for the queue as of
     this PR)

   Leave **"Require branches to be up to date before merging" OFF** — the
   queue supersedes it, and strict mode would reintroduce option 1's re-run
   storm for entering the queue.
   Do **not** select any other check until its workflow also handles
   `merge_group`; a silent check blocks the queue.
2. **Enable "Require merge queue"** on the same `dev` rule.
   - Merge method: **merge commit** (matches the repo's merge-not-rebase
     convention).
   - Defaults are fine for the rest; "Only merge non-failing pull requests"
     stays on.
3. **Leave `main` untouched.** Promotion PRs are human-merged against `main`'s
   existing strict required checks; a queue there adds nothing and would
   insert queue-made merge commits into the carry-exact promotion path.

## Interactions with the existing flow (checked)

- **Auto-merge-when-green**: unchanged in spirit. With a queue enabled,
  `gh pr merge --auto` / "Merge when ready" **adds the PR to the queue**
  instead of merging directly. Agents keep issuing the same command.
- **Direct commits to `dev`** ("fixes = direct commit to dev"): a required
  merge queue rejects direct pushes from non-exempt users, but the `dev` rule
  has `enforce_admins` **disabled**, so repository admins — the accounts that
  make those direct pushes today — are exempt and keep the flow. Direct
  pushes bypass the queue and are backstopped by the existing push-event
  sweep, exactly as before.
- **`version.yml`**: fires on `pull_request: types: [closed]` for `dev`;
  queue-merged PRs still close normally, so per-merge dev versioning is
  unaffected.
- **Rolling promotion (`dev` → `main`)**: targets `main`, which gets no
  queue; unaffected.
- **The #996 HEAD^1 race** (auto-merge deleting `refs/pull/N/merge` mid-run)
  becomes rarer: queue merges happen after the merge-group run, not during
  the PR run.

## Verifying it caught the class

Re-run the #964+#965 narrative mentally against the queue: both PRs green,
both queued. The queue builds group 1 = `dev` + #964 (green, merges), then
group 2 = `dev` + #964 + #965. The single-process sweep on group 2 runs the
fetch-replacing suite and the ambient-fetch suite in one process and fails —
#965 is bounced out of the queue with a red merge-group run, `dev` stays
green, and the author gets the failure *before* merge instead of the
integration branch turning red after it.
