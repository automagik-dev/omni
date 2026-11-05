---
description: Trace a message journey through the Omni platform. Use when debugging where a message went, which stage failed, or what is slow.
arguments:
  - name: args
    description: Correlation ID (from omni events list/search) to trace
    required: false
---

# /omni:trace — Message Journey

Use `journey` for channel-message delivery/latency; use `events trace` for custom-event, connector and automation causality.

## Usage

$ARGUMENTS

## Examples

```bash
omni journey show <message-correlation-id>
omni journey summary --since 24h
omni events trace <event-id>
omni events timeline <personId>
```

Choose the event ID for `events trace`; use the message journey's correlation ID for `journey show`. An arbitrary custom-event correlation string is not a channel-message journey. Inspect `omni events trace --help` / `omni journey --help`. Replay and analytics: omni-ops skill § Events.
