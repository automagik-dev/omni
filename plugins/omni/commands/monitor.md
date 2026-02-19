---
description: Instance health monitor — status, QR, connect/disconnect
arguments:
  - name: args
    description: Instance to monitor (e.g., <instance-id> or --all)
    required: false
---

# /omni:monitor — Instance Health Monitor

Monitor instance health — check connection status, display QR codes, and manage connections.

## Usage

$ARGUMENTS

## Examples

```bash
omni instances list --json | jq '.[] | {name, status}'
omni instances status my-whatsapp
omni instances qr my-whatsapp --watch
omni instances connect my-whatsapp
omni instances disconnect my-whatsapp
```
