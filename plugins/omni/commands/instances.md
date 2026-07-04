---
description: List and manage Omni channel instances with connection status. Use to discover instance IDs, check what is connected, or bring a new channel account online.
arguments:
  - name: args
    description: Subcommand and options (e.g., list, connect <id>, status <id>)
    required: false
---

# /omni:instances — Instance Management

Use to list, inspect, connect, or pair channel instances (WhatsApp, Telegram, Discord, Slack).

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni instances list --json | jq '.[] | {id, name, status}'
omni instances status <id>
omni instances pair <id> --phone +5511999999999   # pairing code — preferred over QR
```

Lifecycle, sync/backfill, contacts/groups, debounce, access control: omni-ops skill § Instances.
