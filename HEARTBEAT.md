# HEARTBEAT.md

## Urgent

- **Genie + Helena instances DOWN** — need QR re-scan (see HANDOFF.md)
- Anti-bot fix deployed (PR #12) — humanized delays on all actions
- 3/5 instances connected (felipe-pessoal, namastex, charlinho OK)

## Next Actions

- [ ] Re-scan QR for Genie + Helena (HANDOFF.md steps)
- [ ] Run `bun run db:push` on prod (audit_logs table missing)
- [ ] Helena group: `omni instances group-create 910ab957... --subject "C-Level Namastex" --participants ...`
- [ ] Fix CI/CD Jenkins auto-deploy (didn't trigger on PR #12)
- [ ] Study Baileys LID addressing mode

## Periodic Checks

- Check for uncommitted changes in omni repo (`git status`)
- Check PM2 service health (`pm2 status`)
- Check paired node connectivity (Cegonha, Felipe-MacBook)
