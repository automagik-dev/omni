---
description: Instance health monitor — status, QR, connect/disconnect. Use when an instance looks down, needs re-pairing, or you want a quick connection-state sweep.
arguments:
  - name: args
    description: Instance to monitor (e.g., <instance-id> or list)
    required: false
---

# /omni:monitor — Instance Health

Use when an instance looks down: sweep connection states, re-scan QR, reconnect or disconnect.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni instances list --json | jq '.[] | {name, status}'
omni instances qr <id>          # auto-refreshes; --no-watch for a single shot
omni instances connect <id>     # counterpart: omni instances disconnect <id>
```

Restart, logout, pairing codes, sync state: omni-ops skill § Instances.
