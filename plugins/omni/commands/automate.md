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

## Examples (verified)

```bash
omni automations create --name "Support Bot" --trigger message.received --action call_agent --agent-id support --disabled
omni automations test <id> --event '{"type":"message.received","payload":{}}'   # mock event — never fires live actions
omni automations logs <id> --limit 20
```

`test` is the safe mock run; `execute` actually runs actions. Conditions, condition-logic, priorities, enable/disable: omni-ops skill § Automations.
