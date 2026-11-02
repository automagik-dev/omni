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

## Examples

```bash
omni events analytics --since 7d --json
omni events search "error" --since 24h
omni events replay --start --since 1h --dry-run   # then: omni events replay --status <sessionId>
```

For a one-shot condition, use `omni events wait --type <event-type> --timeout 30 --json`. For event causality use `omni events trace <event-id>`; for observed contracts use `omni events types --help`, `omni events sample --help` and `omni events schema --help`.

Durable delivery uses `omni events consumers --help` (create/ls/inspect/rm) and `omni events follow --help`. Follow normally pulls and acknowledges progress; `--no-ack` peeks at one page. Consumers need `events:write`; don't widen instance grants to access an unscoped consumer. There are no standalone CLI consumer pull/ack commands. Streaming, lease/cursor semantics, metrics and replay control: omni-ops skill § Events.
