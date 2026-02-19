---
name: omni-analytics
description: Omni v2 event analytics specialist — use for event replay, analytics queries, debugging message flows, investigating error spikes, and tracing message journeys via the omni CLI.
version: "1.0"
---

# Omni Analytics

## Prerequisites

- `omni` CLI installed and in PATH (`omni auth login --api-key sk_xxx --api-url <url>`)
- `jq` available for JSON processing

## Event Analytics

```bash
# Last 7 days across all instances
omni events analytics --since 7d

# Specific instance
omni events analytics --instance <id> --since 30d

# All-time statistics
omni events analytics --instance <id> --all-time

# JSON output for processing
omni events analytics --since 7d --json | jq '{totalMessages, successRate, avgProcessingTime}'
```

Returns: total messages, success rate, average processing time, error stages breakdown, message types distribution.

## Event Replay

Replay past events for testing, debugging, or reprocessing:

```bash
# Start replay from 7 days ago
omni events replay --start --since 7d

# With speed multiplier
omni events replay --start --since 24h --speed 2.0

# Dry run (preview only)
omni events replay --start --since 7d --dry-run

# Filter by event types
omni events replay --start --since 7d --types message.received

# Check replay status
omni events replay --status <session-id>

# Cancel in-progress replay
omni events replay --cancel <session-id>
```

## Event Timeline

View all activity for a specific person:

```bash
omni events timeline <person-id>
```

## Message Journey

Trace a message through the entire processing pipeline:

```bash
omni journey show <correlationId>
```

Shows: event timeline, latency breakdown, processing stages, errors.

## Searching Events

```bash
omni events list --limit 100 --since 24h
omni events search "error" --since 7d
omni events search "message.received" --type <event-type>
```

## Diagnostic Patterns

### Debugging Slow Processing

```bash
# Check analytics for high processing times
omni events analytics --instance <id> --since 24h --json | jq '.avgProcessingTime'

# Trace specific slow messages
omni journey show <correlationId>
```

### Investigating Error Spikes

```bash
# Find errors in time window
omni events search "error" --since 1h --json | jq 'group_by(.type) | map({type: .[0].type, count: length})'

# Check error stages
omni events analytics --instance <id> --since 1h --json | jq '.errorStages'
```

### Monitoring Event Flow

```bash
# Real-time event list
omni events list --since 5min --json | jq '.[] | {type, timestamp, status}'
```
