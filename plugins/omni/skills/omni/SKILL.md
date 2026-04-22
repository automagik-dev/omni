---
name: omni
description: Always-on Omni router for messaging across WhatsApp, Telegram, Discord, Slack. Routes to omni-agent (verbs/replies), omni-setup (install/connect), or omni-ops (admin).
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Router

First, check if Omni is running: `omni auth status --json 2>/dev/null || echo "not running"`

If not running → load `omni-setup/SKILL.md` and follow Step 1 (install).
If running → match the user's intent against the keyword tiers below.

## Three-Tier Routing (priority order)

### 1. Agent tier — Send/Receive Messages

Most agent work is conversational. Match these keywords first.

**Keywords:** say, speak, imagine, react, history, done, reply, respond, send, message, text, voice, TTS, media, image, audio, listen, see, vision, transcribe, sticker, poll, location, chat, conversation, turn-based, WhatsApp reply, message search

**→ Load:** `omni-agent/SKILL.md`

Covers verbs (`omni say`, `omni speak`, `omni imagine`, `omni react`, `omni see`, `omni listen`, `omni history`, `omni done`), send edge cases (media, polls, locations, stickers), message search, chat operations, and turn-based lifecycle.

### 2. Setup tier — Install & Connect

For first-time installation, channel pairing, and getting an agent plugged in.

**Keywords:** install, setup, get started, first time, fresh install, server not running, not installed, connect channel, connect WhatsApp, scan QR, pair, plug agent, start bridge, configure, onboarding

**→ Load:** `omni-setup/SKILL.md`

4-step quick start: install → connect channel → plug agent → start bridge → verify.

### 3. Ops tier — Platform Administration

For infrastructure operations, debugging, analytics, and configuration.

**Keywords:** instances, routes, routing, providers, agent providers, config, settings, API keys, events, analytics, timeline, replay, journey, automations, triggers, workflows, webhooks, custom events, prompts, gate prompt, persons, contacts, presence, batch, transcribe, extract, debug, admin, status, logs, restart, dead letters, payloads, access, allowlist

**→ Load:** `omni-ops/SKILL.md`

Mini-router covering instances, routes, providers, config, events, automations, webhooks, prompts, persons, and batch processing.

## Default

If no keyword matches, default to **`omni-agent/SKILL.md`** — most users want to communicate, not configure.

## Always Use

- `--json` flag by default for agent consumption
- Verify instance/channel status before sending: `omni instances list --json`
