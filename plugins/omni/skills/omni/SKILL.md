---
name: omni
description: Always-on Omni router for any messaging task across WhatsApp, Telegram, Discord, Slack, including sending/receiving, instance/config management, events/analytics, and automations.
allowed-tools: Bash(omni *), Bash(jq *)
---

First, check if Omni is running: `omni auth status --json 2>/dev/null || echo "not running"`

If not running → load `omni-install/SKILL.md` and follow it.
If running → use `--json` by default for agent consumption. Verify instance/channel status before sending.

## Keyword → skill routing

- install, setup, fresh install, server not running, not installed → `omni-install/SKILL.md`
- send, message, text, TTS, voice, media, image, browse media, download media, reaction, sticker, poll, embed → `omni-send/SKILL.md`
- search messages, read messages, star, delete message → `omni-messages/SKILL.md`
- chats, conversations, list chats, chat history, participants, groups → `omni-chats/SKILL.md`
- events, analytics, replay, timeline, journey, latency, debug flow → `omni-events/SKILL.md`
- instances, connect, disconnect, QR, sync, resync, backfill, agent routing, reply filter, WhatsApp, Telegram, Discord → `omni-instances/SKILL.md`
- access, allowlist, blocklist, allow, deny, pairing requests, access control → `omni-instances/SKILL.md`
- automations, triggers, workflows → `omni-automations/SKILL.md`
- batch, transcribe, extract, audio, document → `omni-batch/SKILL.md`
- auth, config, keys, API keys, providers, default instance, dead letters, payloads, logs, completions, service management, start, stop, restart, update → `omni-config/SKILL.md`
- persons, contacts, person search, contact directory, presence → `omni-persons/SKILL.md`
- routes, routing, agent route, route resolution, route metrics → `omni-routes/SKILL.md`
- webhooks, webhook source, custom event, trigger event, event injection → `omni-webhooks/SKILL.md`
- prompts, LLM prompt, image prompt, gate prompt, prompt override → `omni-prompts/SKILL.md`
