---
description: List and manage Omni channel instances with connection status
arguments:
  - name: args
    description: Subcommand and options (e.g., list, connect <id>, status <id>)
    required: false
---

# /omni:instances — Instance Management

Manage channel connections (WhatsApp, Discord, Slack, Telegram) via the omni CLI.

## Usage

$ARGUMENTS

## Examples

```bash
omni instances list --json | jq '.[] | {id, name, status}'
omni instances connect my-whatsapp
omni instances status my-whatsapp
omni instances qr my-whatsapp --watch
```
