---
name: omni
description: Always-on Omni router for messaging across WhatsApp, Telegram, Discord, Slack. Routes to omni-agent (verbs/replies), omni-setup (install/connect), or omni-ops (admin).
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Router

Pure dispatcher — probe health, match intent, load exactly one tier, act there.

Health probe: `omni auth status --json 2>/dev/null || echo "not running"`. Not running → load `omni-setup/SKILL.md` (Step 1). Running → match the tiers below in priority order; first hit wins.

## 1. Agent tier — send and receive

**Triggers:** say, speak, reply, respond, send, message, text, voice, TTS, react, imagine, film, music, media, image, audio, video, listen, transcribe, see, vision, sticker, poll, location, history, chat, conversation, turn-based, done, message search

**→ Load `omni-agent/SKILL.md`** — verb commands (`say`, `speak`, `imagine`, `film`, `music`, `react`, `see`, `listen`, `history`, `done`), send edge cases, messages/chats, turn lifecycle.

## 2. Setup tier — install and connect

**Triggers:** install, setup, get started, first time, fresh install, not installed, server not running, connect channel, connect WhatsApp, scan QR, pair, plug agent, start bridge, onboarding

**→ Load `omni-setup/SKILL.md`** — install → connect channel → plug agent (`omni connect`) → start bridge → verify. Canonical home for that flow and its troubleshooting.

## 3. Ops tier — platform administration

**Triggers:** instances, routes, routing, providers, config, settings, API keys, events, analytics, timeline, replay, journey, automations, triggers, workflows, webhooks, custom events, prompts, gate prompt, persons, contacts, presence, batch, extract, debug, admin, status, logs, restart, dead letters, payloads, access, allowlist

**→ Load `omni-ops/SKILL.md`** — keyword-routed index over `references/` for instances, routes, providers, config, events, automations, webhooks, prompts, persons, batch.

## Default

No match → `omni-agent/SKILL.md`. Most requests are about communicating, not configuring.

## Always

- Add `--json` to any command whose output you parse.
- Before sending, confirm the target instance is connected: `omni instances list --status connected --json`.
