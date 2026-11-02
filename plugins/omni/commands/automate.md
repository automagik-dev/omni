---
description: Create, test, and manage event-driven Omni automations. Use when wiring trigger events (e.g., message.received) to actions like call_agent, webhook, or send_message.
arguments:
  - name: args
    description: Automation options (e.g., create --name "Bot" --trigger message.received --action call_agent)
    required: false
---

# /omni:automate — Automations

Use when events should drive actions: route messages to an agent, fire webhooks, auto-reply. Create disabled, mock-test, then enable.

## Usage

$ARGUMENTS

## Examples

```bash
omni automations create --name "Support Bot" --trigger message.received --action call_agent --agent-id <agent-id> --disabled
omni automations test <id> --event '{"type":"message.received","payload":{}}'   # dry run; do not add --execute unless real actions are authorized
omni automations logs <id> --limit 20
```

`test --event` accepts mock JSON or a real journaled event ID. It is a dry run unless `--execute` is supplied; `test --execute` and `execute` both run real actions. Enable resumes from now; disabled events are skipped unless explicitly replayed with `enable --replay-since`.

Use `omni automations scaffold --help`, `omni automations create --help` and `omni automations test --help` for definition files, ordered multi-actions, concurrency and transactional emissions. Conditions use payload dot paths (e.g. `content.type`) and `eq`, not `equals`. Details: omni-ops skill § Automations.
