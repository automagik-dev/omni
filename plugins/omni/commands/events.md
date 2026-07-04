---
description: Query the Omni event stream — analytics, content search, timelines, replay. Use when investigating what happened on the platform or re-processing missed events.
arguments:
  - name: args
    description: Event subcommand (e.g., analytics --since 7d, replay --start --since 1h)
    required: false
---

# /omni:events — Event Timeline

Use to inspect platform activity: analytics summaries, search event content, follow a person's timeline, or replay missed events.

## Usage

$ARGUMENTS

## Examples (verified)

```bash
omni events analytics --since 7d --json
omni events search "error" --since 24h
omni events replay --start --since 1h --dry-run   # then: omni events replay --status <sessionId>
```

Streaming, metrics, per-person timelines, replay control: omni-ops skill § Events.
