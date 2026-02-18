---
description: Automation wizard — create event-driven workflows and test with dry-run
arguments:
  - name: args
    description: Automation options (e.g., create --name "Bot" --trigger message.received --action call_agent)
    required: false
---

# /omni:automate — Automation Wizard

Create and test event-driven automations using the omni CLI.

## Usage

$ARGUMENTS

## Examples

```bash
omni automations create --name "Support Bot" --trigger message.received --action call_agent --agent-id support
omni automations test <id> --dry-run
omni automations list --json
omni automations logs <id>
```
