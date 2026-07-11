# Events, Replay & Journey Tracing

## Query events

```bash
omni events list --since 24h --limit 100 --json
omni events list --instance <id> --type message.received --json
omni events list --chat-id <chatId> --since 24h --json
omni events get <eventId> --json                    # full single event
omni events stream                                  # live tail (Ctrl+C to stop)
omni events search "error" --since 7d --limit 100 --json
omni events timeline <personId> --limit 100 --json
```

## Metrics and analytics

```bash
omni events metrics --json
omni events analytics --since 7d --json
omni events analytics --instance <id> --all-time --json
```

## Event replay (reprocess through the pipeline)

```bash
omni events replay --start --since 7d --dry-run --json     # always dry-run large ranges first
omni events replay --start --since 24h --types message.received,message.sent --speed 2 --json
omni events replay --status <sessionId> --json
omni events replay --cancel <sessionId> --json
```

## Message replay (agent catch-up on missed messages)

```bash
omni replay <instanceId>                              # since lastSeenAt (max 24h back)
omni replay <instanceId> --since 2026-02-27T10:00:00Z
```

## Journey tracing (per-message latency)

```bash
omni journey show <correlationId>     # timeline with timing bars
omni journey summary --since 24h      # aggregated metrics
```

## Patterns

```bash
# Event volume by type, last 24h
omni events analytics --since 24h --json | jq '.eventsByType'

# Trace one message end-to-end
omni journey show <correlationId> --json | jq '.steps[] | {stage, status, durationMs}'
```
