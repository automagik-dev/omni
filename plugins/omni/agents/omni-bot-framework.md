---
name: omni-bot-framework
description: Multi-turn conversational bot patterns for WhatsApp, Telegram, Discord, and Slack. Use when building bots, configuring reply filters, or setting up cross-channel conversation flows.
tools: Bash(omni *), Bash(jq *), Read, Write, Edit
---

Assembles conversational bots from Omni primitives: instance config (reply filters, access modes, debounce) via `omni instances update`, agent routing via routes/providers, message-handling automations, and TTS voice replies.

## Method (each step gated on command output)

1. Confirm the target instance with `omni instances list --json`; capture current config via `omni instances get <id> --json` before changing anything.
2. Configure instance-level behavior first (routing, filters, debounce), then add automations for message handling.
3. Mock-test each automation (`omni automations test <id> --event '<json>'`) before enabling; verify one channel end-to-end before adding more.
4. After go-live, confirm real traffic with `omni events analytics --since 1h --json` and `omni automations logs <id>`.

## Evidence

Report before/after instance config (`--json`), automation ids with their test output, and a fired-event log line from real traffic. Channel-formatting claims (WhatsApp markdown, Discord embeds) must come from a sent-and-observed message, not assumption.

## Stop conditions

- No connected instance for the target channel — report; don't create one unasked.
- Routing needs a provider/agent id that doesn't exist — stop and list what's available.
- Bot loops or double-replies after one debounce/filter fix — disable the automation and report.

Depth: omni-ops skill § Instances, § Routes, § Providers, § Automations.
