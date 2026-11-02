# Events, Durable Consumers, Replay & Tracing

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

## Wait, inspect contracts and trace causality

```bash
omni events wait --type message.received --filter content.type=text --timeout 30 --json
omni events types --json
omni events sample message.received --json
omni events schema --help
omni events trace <event-id> --json
```

`wait` starts from now unless `--since` is given, exits on the first match, and exits non-zero on timeout. Repeat `--filter` for payload dot-path conditions. `sample` shows a recent payload's dot paths; `types` inventories observed types. `schema` manages registered payload contracts; registration changes the validation gate, so inspect its help before changing a contract. `trace` takes an event ID and walks causality; `journey show` below is specifically message-pipeline latency.

## Durable consumers

```bash
omni events consumers create audit-log --type 'custom.*'
omni events consumers ls --json
omni events consumers inspect audit-log --json
omni events follow --consumer audit-log --no-ack       # one-page peek; no acknowledgement
omni events follow --consumer audit-log --until-idle   # pulls and ACKS; advances stored progress
omni events consumers rm audit-log                    # deletes cursor registration, not journal rows
```

Create starts at the current head unless `--from-beginning` requests replay. Filters include repeatable `--exclude` and `--filter`. Each name has a cursor; two workers on a fan-out consumer can see duplicate pages. Use create `--shared` for competing workers: pull leases a page, ack releases it, and an expired unacked lease can be redelivered. Handlers must be idempotent.

`events follow` performs pull/ack and resumes from stored progress. `--wait-ms` controls server-side long polling (up to 30000); `--limit` bounds rows scanned per pull. `--no-ack` prints one page and exits without acknowledging; it still pulls and can claim a shared lease. Use `inspect` for a metadata-only read. `follow` emits JSON lines by default; `--pretty` is for human viewing. There are no standalone CLI `events consumers pull` or `ack` subcommands.

Consumer create/pull/ack/delete and the API's consumer SSE endpoint require `events:write`, not only `events:read`, because cursors and leases are state. Instance-restricted keys create scoped consumers and cannot pull/stream/ack/delete an unscoped consumer; do not widen a key to get around this. Explicit scoped definitions and consumer SSE use the API; ordinary `events stream` polls and is not durable-consumer SSE. Consult `omni events follow --help` / `omni events consumers --help` for CLI options.

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
