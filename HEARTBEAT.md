# HEARTBEAT.md

## Urgent

- **ALL PRs MERGED** (#6, #7, #9, #10, #11) — 23 WhatsApp features shipped to main
- Production deploy needed — SSH access to `10.114.1.118` still blocked
- Helena profile rename pending deploy: `omni instances update 910ab957 --profile-name "Helena"`
- Gemini security suggestion (SSRF on mediaUrl) — file as issue later

## Next Actions

- [ ] Deploy to production (needs SSH access to 10.114.1.118)
- [ ] Helena rename: `omni instances update 910ab957 --profile-name "Helena"`
- [ ] Helena group: `omni instances group-create 910ab957... --subject "C-Level Namastex" --participants ...`
- [ ] Study Baileys LID addressing mode

## Periodic Checks

- Check for uncommitted changes in omni repo (`git status`)
- Check PM2 service health (`pm2 status`)
- Check paired node connectivity (Cegonha, Felipe-MacBook)
