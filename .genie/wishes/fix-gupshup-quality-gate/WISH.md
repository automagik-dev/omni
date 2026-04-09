---
slug: fix-gupshup-quality-gate
title: "Fix PR #334 Gupshup channel Quality Gate — knip flagging zod as unused"
status: ready
priority: P2
github_issue: 331
github_pr: 334
---

## Context

PR #334 `feat/gupshup-channel` is open with ~8,767 lines across 30 files — full Gupshup WhatsApp BSP plugin (client, webhooks, senders, types, DB migration, CLI wiring, unit tests). Branch is substantially complete. One CI check is blocking merge:

**Failing:** `Quality Gate (typecheck + lint + test)` — https://github.com/automagik-dev/omni/actions/runs/23955704930/job/69873458089

All other checks pass: biome (836 files clean), smoke test, CodeRabbit, GitGuardian, commit lint.

## Root Cause

`knip` (dead code detector, run as part of Quality Gate) flags one unused dependency and several stale config hints:

```
Unused dependencies (1)
zod  packages/channel-gupshup/package.json:18:6

Configuration hints (9)
scripts/inbox-bridge.ts                        knip.json  Remove from ignore
src/trpc/**              packages/api          knip.json  Remove from ignore
@trpc/server             packages/api          knip.json  Remove from ignoreDependencies
@omni/channel-discord    packages/channel-sdk  knip.json  Remove from ignoreDependencies
@omni/channel-slack      packages/channel-sdk  knip.json  Remove from ignoreDependencies
@omni/channel-telegram   packages/channel-sdk  knip.json  Remove from ignoreDependencies
@omni/channel-whatsapp   packages/channel-sdk  knip.json  Remove from ignoreDependencies
src/index.ts             packages/cli          knip.json  Remove redundant entry pattern
src/index.ts             packages/channel-sdk  knip.json  Remove redundant entry pattern
```

The `zod` dep is declared in `packages/channel-gupshup/package.json` but nothing in the package imports it. The stale `scripts/inbox-bridge.ts` ignore entry is leftover from PR #333 which deleted that file.

## Scope

**IN scope:**
- Remove `zod` from `packages/channel-gupshup/package.json` **OR** actually use it for webhook payload validation (preferred — Gupshup webhooks should have schema validation for security). Decide based on plugin review.
- Clean up stale knip.json entries from PR #333 fallout (at minimum remove `scripts/inbox-bridge.ts` from ignore since that file no longer exists)
- Re-run knip locally to confirm clean
- Re-run full Quality Gate locally: `bun run build`, `bunx biome check .`, `bunx knip`, `bun test`
- Push fix to `feat/gupshup-channel` branch
- Wait for CI to go green
- Report back for final review

**OUT of scope:**
- Any functional changes to the Gupshup plugin itself (the 10 commits on the branch already cover all functionality)
- Other stale knip config hints beyond `scripts/inbox-bridge.ts` (leave for a separate cleanup wish unless they directly cause CI failure)
- Rebasing the branch — only push the fix commit on top

## Decision: zod usage

Recommendation: **USE zod** for Gupshup webhook payload validation, don't remove it. Gupshup webhooks carry untrusted user input and Omni should validate the shape before processing. Look at `packages/channel-gupshup/src/handlers/webhooks.ts` and add a Zod schema for the incoming payload. This also aligns with the rest of the codebase (Zod is used extensively in @omni/api for OpenAPI and validation).

If time is tight and the webhook handler already validates defensively, fall back to removing `zod` from package.json. Record the decision in the commit message.

## Execution Groups

### Group 1 — Knip Fix (engineer)
- Work in worktree off branch `feat/gupshup-channel` (already created branch; do NOT create a new one)
- Either add Zod validation to webhooks.ts (preferred) or remove zod from channel-gupshup/package.json
- Remove `scripts/inbox-bridge.ts` entry from root `knip.json` ignore list
- Run `bunx knip` locally — must exit 0 (no errors)
- Run `bun run build`, `bunx biome check .`, `bun test` — must all pass
- Commit with message: `fix(channel-gupshup): add zod webhook validation (resolves knip unused dep)` OR `chore(channel-gupshup): remove unused zod dep, clean stale knip entries`

### Group 2 — Push + CI Watch (reviewer)
- `git push origin feat/gupshup-channel` (the existing branch)
- `gh pr checks 334 --watch` — wait for Quality Gate to go green
- Update PR #334 body with a note about what was fixed
- Report PR URL + CI status back to omni

## Acceptance Criteria

- [ ] `bunx knip` exits 0 locally in the worktree
- [ ] `bun run build` clean
- [ ] `bunx biome check .` clean
- [ ] `bun test` — no new failures
- [ ] PR #334 Quality Gate shows SUCCESS after push
- [ ] Commit pushed to `feat/gupshup-channel` branch
- [ ] Report back to omni with PR URL and green CI

## Validation Commands

```bash
cd /home/genie/.genie/worktrees/omni/fix-gupshup-qg
bun install
bun run build
bunx biome check .
bunx knip
bun test
```

## Risk

- **Blast radius:** Only affects `packages/channel-gupshup/package.json` and root `knip.json`. Cannot break existing plugins.
- **Rollback:** Revert the single fix commit; PR #334 stays open for separate attention.

## References

- Issue: https://github.com/automagik-dev/omni/issues/331
- PR: https://github.com/automagik-dev/omni/pull/334
- Failing run: https://github.com/automagik-dev/omni/actions/runs/23955704930/job/69873458089
