# HEARTBEAT.md

## Urgent

- **Genie + Helena instances DOWN** — need QR re-scan (see HANDOFF.md)

## Next Actions

- [ ] Re-scan QR for Genie + Helena (HANDOFF.md steps)
- [ ] Add `~/.omni/bin` to prod user's PATH
- [ ] Fix NATS "consumer already exists" errors on restart
- [ ] Study Baileys LID addressing mode

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
- [x] Run `db:push` on prod (audit_logs + trigger_logs tables)
- [x] Deploy latest to production (c130656)
- [x] Install CLI on production (~/.omni/bin/omni)
- [x] Fix local dev PM2 services (were pointing to deleted worktree)
