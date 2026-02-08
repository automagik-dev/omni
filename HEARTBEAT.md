# HEARTBEAT.md

## Urgent

- **ALL PRs MERGED** (#6, #7, #9, #10) — 22 WhatsApp features shipped to main
- Production deploy needed — SSH access to `10.114.1.118` still blocked
- Helena profile rename pending deploy: `omni instances update 910ab957 --profile-name "Helena"`
- Helena wants `groupCreate` feature — not yet implemented
- Gemini security suggestion (SSRF on mediaUrl) — file as issue later

## Next Actions

- [ ] Deploy to production (needs SSH access)
- [ ] Implement `groupCreate` (plugin + API + CLI)
- [ ] Fix @ mentions (currently prepends, should be natural placement)
- [ ] Study Baileys LID addressing mode

## Periodic Checks

- Check for uncommitted changes in omni repo (`git status`)
- Check PM2 service health (`pm2 status`)
- Check paired node connectivity (Cegonha, Felipe-MacBook)
