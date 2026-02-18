---
name: omni-events
description: |
  Query, search, replay, and analyze Omni platform events — view timelines, run analytics, replay past events for testing, and monitor event metrics.
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Events

Query and analyze platform events using `omni events`.

## List Events

```bash
omni events list --limit 100
omni events list --since 24h --json
```

## Search Events

```bash
omni events search "error" --since 7d
omni events search "message.received" --type <event-type>
```

## Person Timeline

```bash
omni events timeline <person-id>
```

## Event Replay

Replay past events for testing, debugging, or reprocessing.

```bash
# Start replay
omni events replay --start --since 7d
omni events replay --start --since 7d --until 1d
omni events replay --start --since 24h --speed 2.0

# Dry run (preview without executing)
omni events replay --start --since 7d --dry-run

# Filter by event types
omni events replay --start --since 7d --types message.received

# Check status
omni events replay --status <session-id>

# Cancel replay
omni events replay --cancel <session-id>
```

## Analytics

```bash
omni events analytics --since 7d
omni events analytics --instance <id> --since 30d
omni events analytics --instance <id> --all-time
```

Analytics returns: total messages, success rate, average processing time, error stages breakdown, message types distribution.

## Metrics

```bash
omni events metrics --since 7d
omni events metrics --instance <id>
```

## Message Journey

Trace a single message through the system:

```bash
omni journey show <correlationId>
```

Shows event timeline, latency breakdown, processing stages, and error details.
