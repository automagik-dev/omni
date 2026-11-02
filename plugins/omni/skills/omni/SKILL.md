---
name: omni
description: Always-on Omni router for messaging across WhatsApp, Telegram, Discord, Slack. Routes to omni-agent (verbs/replies), omni-setup (install/connect), or omni-ops (admin).
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Router

Match the request, load one tier, and use the installed CLI's help for its options (`omni --help`, then `omni <group> --help`). These instructions describe CLI 2.261102.x.

## Target and credentials

For an existing Omni, inspect `omni server current --json` / `omni server list --json` first. Select it with `omni server use <name>` or global `--server <name>`. `omni status --json` checks reachability; `omni auth status --json` checks the selected credentials. Missing credentials, a scope denial, and an unreachable server are different problems; none alone means a new server should be installed.

`omni server add <name> <url>` only registers the URL. The CLI still needs an API key; it cannot sign itself in through a device code. `claim`, `approve`, and bare `connect` are operator actions requiring an existing key with `auth:admin`, not agent self-service. See the setup skill for the working paths.

## 1. Agent tier — send and receive

**Triggers:** say, speak, reply, respond, send, message, text, voice, TTS, react, imagine, film, music, media, image, audio, video, listen, transcribe, see, vision, sticker, poll, location, history, chat, conversation, turn-based, done, message search

**→ Load `omni-agent/SKILL.md`** — verb commands, send edge cases, messages/chats and turn lifecycle. For scheduled delivery, audio/media tools or A2A discovery, also consult `omni schedule --help`, `omni voice --help`, `omni media --help` or `omni a2a --help` as appropriate.

## 2. Setup tier — install and connect

**Triggers:** install, setup, sandbox, desktop, first time, server not running, connect channel, scan QR, pair, plug agent, bridge, claim, approve, device link

**→ Load `omni-setup/SKILL.md`** — choose an existing server or install a local runtime, connect a channel, configure an agent, verify. Device approval and channel pairing are separate operations.

## 3. Ops tier — platform administration

**Triggers:** instances, channels, capabilities, routes, providers, agents, manifest, config, server, settings, auth, API keys, events, consumers, schema, analytics, replay, journey, automations, connectors, sources, webhooks, heartbeat, prompts, persons, contacts, batch, audit, trust, tenants, multitenancy, turns, follow-up, slack, logs, dead letters, payloads, access

**→ Load `omni-ops/SKILL.md`** — keyword-routed references and discovery paths for the management groups.

## Default

For an uncovered capability, inspect `omni --help` and the relevant group's help. Use the agent tier when the request is to communicate; do not reinterpret an unfamiliar administration request as a send.

## Always

- Add `--json` to output you parse; never print keys or config secrets.
- Confirm the target instance is connected before sending: `omni instances list --status connected --json`.
- Discovery does not authorize sending, granting access or changing a runtime. Follow the user's scope and the ops ground rules.
