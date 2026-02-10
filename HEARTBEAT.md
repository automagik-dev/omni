# HEARTBEAT.md

## Rules for Heartbeat Self-Check
- Before working any item below, verify it's ACTUALLY still open (check git log, grep code)
- If an item is done, move it to Recently Completed and reply HEARTBEAT_OK
- Don't trust wish file statuses — verify against actual code/commits
- Run `git log --oneline -5` to catch recent changes you might not know about

## Urgent

- **Genie + Helena instances DOWN** — need QR re-scan (see HANDOFF.md)

## Next Actions

- [ ] Re-scan QR for Genie + Helena (HANDOFF.md steps)
- [ ] Add `~/.omni/bin` to prod user's PATH
- [ ] Merge `feat/medium-features` branch (C1-C7 code complete, needs PR review)
- [ ] Study Baileys LID addressing mode (partial research in docs/research/baileys/)
- [ ] Fix cognitive complexity lint errors (channels.ts:20, send.ts:26, nats/client.ts:22, session-cleaner.ts:24 — all >15 max) — blocks `make check`
- [ ] Clean 6 stale git stashes
- [ ] Commit dirty files: `memory/baileys-version-state.json`, `packages/core/src/logger/__tests__/logger.test.ts`
- [ ] Wire Scroll daily cron for README maintenance

## Periodic Checks

- Check for uncommitted changes in omni repo (`git status`)
- Check PM2 service health (`pm2 status`)
- Check paired node connectivity (Cegonha, Felipe-MacBook)
- **Check Baileys updates** — run `bash scripts/check-baileys-update.sh`, notify Felipe if new version

## Recently Completed

- [x] Fix PR #13 code review issues (4 criticals + importants)
- [x] Fix CLI sender field in JSON output (PR #18)
- [x] Fix `omni send` silent failure (PR #18)
- [x] Fix turbo typecheck pipeline (PR #19)
- [x] Fix UI typecheck errors (PR #19 — merged, `bun typecheck` passes)
- [x] Run `db:push` on prod (audit_logs + trigger_logs tables)
- [x] Deploy latest to production (c130656)
- [x] Install CLI on production (~/.omni/bin/omni)
- [x] Fix local dev PM2 services (were pointing to deleted worktree)
- [x] Fix NATS "consumer already exists" errors on restart (df31c0a)
- [x] Baileys Quick Wins B1-B6 (merged ff68219)
- [x] CLI DX Improvements A1-A5 (merged d8ecb90)
