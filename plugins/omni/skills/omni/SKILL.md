---
name: omni
description: Always-on Omni router for any messaging task across WhatsApp, Telegram, Discord, Slack, including sending/receiving, instance/config management, events/analytics, and automations.
allowed-tools: Bash(omni *), Bash(jq *)
---

Omni is running. Don't install it. Check: `omni auth status`

Use `--json` by default for agent consumption. Before sending, verify instance/channel status (connected/ready).
Read the relevant SKILL.md below for the specific task before executing commands.

## Keyword → skill routing

- send, message, text, TTS, voice, media, image, reaction, sticker, poll, embed → `omni-send/SKILL.md`
- search messages, read messages, star, delete message → `omni-messages/SKILL.md`
- chats, conversations, list chats, chat history, participants, groups → `omni-chats/SKILL.md`
- events, analytics, replay, timeline, journey, latency, debug flow → `omni-events/SKILL.md`
- instances, connect, disconnect, QR, sync, agent routing, reply filter, WhatsApp, Telegram, Discord → `omni-instances/SKILL.md`
- automations, triggers, workflows → `omni-automations/SKILL.md`
- batch, transcribe, extract, audio, document → `omni-batch/SKILL.md`
- auth, config, providers, API key, default instance, webhooks → `omni-config/SKILL.md`
