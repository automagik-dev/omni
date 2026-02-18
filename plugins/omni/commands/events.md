---
description: Event timeline with replay, analytics, and metrics
arguments:
  - name: args
    description: Event subcommand (e.g., analytics --since 7d, replay --start --since 1h)
    required: false
---

# /omni:events — Event Management

Query event history, run analytics, replay past events, and view metrics.

## Usage

$ARGUMENTS

## Examples

```bash
omni events analytics --since 7d --json
omni events replay --start --since 1h --dry-run
omni events replay --status <session-id>
omni events search "error" --since 24h
```
