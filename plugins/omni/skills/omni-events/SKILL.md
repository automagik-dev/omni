---
name: omni-events
description: |
  Query and analyze Omni events: list/search/timeline, metrics, analytics, replay sessions, and message journey tracing.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Events

Use `omni events` for event streams and `omni journey` for per-message tracing.

## Query events

```bash
omni events list --since 24h --limit 100 --json
omni events list --instance <id> --type message.received --json
omni events search "error" --since 7d --limit 100 --json
omni events timeline <personId> --limit 100 --json
```

## Metrics and analytics

```bash
omni events metrics --json
omni events analytics --since 7d --json
omni events analytics --instance <id> --all-time --json
```

## Replay sessions

```bash
# Start
omni events replay --start --since 7d --json
omni events replay --start --since 24h --types message.received,message.sent --speed 2 --json
omni events replay --start --since 7d --dry-run --json

# Check / cancel
omni events replay --status <sessionId> --json
omni events replay --cancel <sessionId> --json
```

## Journey tracing

```bash
omni journey show <correlationId> --json
omni journey summary --since 24h --json
```

## Notes

- `events search` supports `--since` and `--limit` (no `--type` flag there).
- Replay management is all through `omni events replay` flags.
