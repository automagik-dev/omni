---
name: omni
description: Always-on Omni router for messaging across WhatsApp, Telegram, Discord, Slack. Dispatches directly to communication, setup and operational peer skills.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Router

Match the request, load its peer skill directly, and use the installed CLI's help for its options (`omni --help`, then `omni <group> --help`). Use installed command help as the authority for current options. Peers execute their workflow; none is another router.

## Target and credentials

For an existing Omni, inspect `omni server current --json` / `omni server list --json` first. Select it with `omni server use <name>` or global `--server <name>`. `omni status --json` checks reachability; `omni auth status --json` checks the selected credentials. Missing credentials, a scope denial, and an unreachable server are different problems; none alone means a new server should be installed.

For sign-in, device approval, channel pairing or agent setup, load [omni-setup](../omni-setup/SKILL.md) for the current credential paths. Discovery does not grant operator authority.

## Intent → peer

Choose by the requested outcome. Connecting a new channel or wiring an agent is setup; inspecting or maintaining an existing instance is instance management.

| Intent / keywords | Load directly |
|-------------------|---------------|
| Send, reply, message search, chats, history, TTS, voices, media, reactions, conversation turns, schedule, voice sessions, Slack communication | [omni-agent](../omni-agent/SKILL.md) |
| Install, first-time setup, sandbox, desktop, connect channel, scan QR, pair, plug agent, bridge, claim, approve, device link | [omni-setup](../omni-setup/SKILL.md) |
| Instances, health monitor, reconnect/disconnect, sync, contacts/groups on an account, profile, debounce, access, reply filters, bot framework, multi-channel bot behavior, channel capabilities | [omni-instances](../omni-instances/SKILL.md) |
| Routes, routing rules, reply gates, scopes, priorities | [omni-routes](../omni-routes/SKILL.md) |
| Providers, schemas, agent definitions, accepts/publishes manifests, A2A discovery/invocation | [omni-providers](../omni-providers/SKILL.md) |
| Config, CLI defaults, server settings, auth, API keys, logs, dead letters, payloads, service health, doctor, audit, trust, tenants, multitenancy | [omni-config](../omni-config/SKILL.md) |
| Events, consumers, event contracts/schema, analytics, replay, trace, journey, metrics | [omni-events](../omni-events/SKILL.md) |
| Automations, automation builder, triggers, workflows, conditions, heartbeat, idle-chat follow-up | [omni-automations](../omni-automations/SKILL.md) |
| Webhooks, custom event ingress, connectors, GitHub/external sources | [omni-webhooks](../omni-webhooks/SKILL.md) |
| Prompts, LLM/gate/image/media-description/TTS prompt | [omni-prompts](../omni-prompts/SKILL.md) |
| Persons, identity search, phone, cross-channel contacts, presence, merge identity | [omni-persons](../omni-persons/SKILL.md) |
| Batch, historical transcription/extraction, bulk media processing, redownload, cost estimate | [omni-batch](../omni-batch/SKILL.md) |

## Default

For an uncovered capability, inspect `omni --help` and the relevant group's help. Use the agent peer when the request is to communicate; do not reinterpret an unfamiliar administration request as a send.

## Other surfaces

Use these discovery paths when a peer does not expand the requested capability; inspect the group help before acting.

| Surface | Discovery |
|---------|-----------|
| Isolated local runtime | `omni sandbox --help` |
| Integration accounts and subscriptions | `omni connectors --help` |
| GitHub and other external event sources | `omni sources --help` |
| Host fingerprint trust | `omni trust --help` |
| Tenant control plane | `omni tenants --help` |
| Multitenancy mode | `omni multitenancy --help` |
| Desktop app | `omni desktop --help` |
| Agent-to-agent discovery and invocation | `omni a2a --help` |
| Agent accepts/publishes declarations | `omni agents manifest --help` |
| Scheduled messages | `omni schedule --help` |
| Voice sessions | `omni voice --help` |
| Media browsing and downloads | `omni media --help` |
| Turn management | `omni turns --help` |
| Configuration audit | `omni audit --help` |
| Idle-chat follow-up | `omni follow-up --help` |
| Slack-specific operations | `omni slack --help` |
| Channel event guarantees | `omni channels capabilities --help` |
| Video generation | `omni film --help` |
| Music generation | `omni music --help` |

## Always

- Add `--json` to output you parse; never print keys or config secrets.
- Confirm the target instance is connected before sending: `omni instances list --status connected --json`.
- Discovery does not authorize sending, granting access or changing a runtime. Follow the user's scope and the ops ground rules.
