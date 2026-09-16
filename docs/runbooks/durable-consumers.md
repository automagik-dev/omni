# Durable event consumers

> `omni events consumers ...` + `omni events follow` — named consumers with
> their own offsets over the event journal (#989, RFC #925 G7).

A **durable consumer** is a registered name with a filter and a stored cursor
over the event journal (`omni_events`). A client pulls events matching the
filter from the cursor, acks to commit progress, and can disconnect at any
point — the next pull resumes exactly after the last ack, even across
restarts, redeploys, or offsets older than NATS retention (the journal is the
source of truth; NATS is transport). Delivery is **at-least-once with a
cursor**: a client that crashes mid-page re-pulls the same page.

## When to use what

| Need | Use |
|------|-----|
| Block once until one matching event arrives | `omni events wait` (one-shot, ephemeral, #966) |
| Platform-side push: run an action when an event fires | Automations (`omni automations ...`) |
| A client-side process that must see **every** matching event, resumable across disconnects | **Durable consumer + `events follow`** |
| Rebuild state from history (a projection), or diff state at T1 vs T2 | Durable consumer created `--from-beginning` |

## Quick start

```bash
# Register: type glob + optional payload conditions (the events-wait matcher)
omni events consumers create deploy-tracker \
  --type 'custom.github.*' \
  --filter action=completed

# Tail from the cursor; prints JSON lines, acks as it goes; Ctrl+C anytime
omni events follow --consumer deploy-tracker

# Later, from anywhere: resumes exactly after the last acked event
omni events follow --consumer deploy-tracker --until-idle   # drain + exit 0

omni events consumers ls                      # name, filter, cursor, lag
omni events consumers inspect deploy-tracker  # + journal head
omni events consumers rm deploy-tracker
```

`--from-beginning` on create starts the cursor at 0 (full journal replay —
projections); the default starts at the current head (like `events wait`).
`--no-ack` on follow peeks one page without moving the cursor. `--pretty` on
follow prints one `time type who: text` line per event instead of JSON lines.

### Excluding noisy types

`--exclude <glob>` (repeatable, same trailing-`*` syntax as `--type`) drops
types from the consumer's stream and **wins over `--type`**, so a broad
subscription does not flood the follower with housekeeping events:

```bash
omni events consumers create app-events \
  --type 'custom.*' \
  --exclude 'custom.chat.*' --exclude 'custom.lid-mapping.*'
```

The globs are stored on the consumer (`excludeTypes`, shown by `ls` /
`inspect`), so every follower of that name sees the same sieve. The same flag
exists on `events stream` and `events wait`.

## Fan-out vs shared (competing consumers)

> **Two workers on the same consumer name do NOT split the work by default.**
> A consumer name is one cursor; separate names each see every event.

| Mode | Create | Who sees an event | Use for |
|------|--------|-------------------|---------|
| Fan-out (default) | `consumers create audit --type 'custom.*'` | every consumer **name**, once each | observers: monitors, archivers, metrics sinks |
| Shared | `consumers create my-workers --type custom.x --shared` | exactly one of the N processes following that name (redelivered if it never acks) | workers: agent runs, media downloads, anything expensive or with side effects |

Scaling a fan-out worker by starting a second copy — on the same name or a
new one — **doubles the work instead of halving it**, and corrupts anything
the handler writes. Two ways to scale:

1. **`--shared`** — start N `omni events follow --consumer my-workers`
   processes (or N API pullers). Each pull *leases* the next page to that
   puller alone; `ack` with the returned `leaseId` releases it. A page whose
   lease expires unacked (`leaseMs`, default 60s — crashed or slow worker)
   is redelivered to the next puller: **at-least-once**, so make handlers
   idempotent on `id`. For per-message ack, pull with `limit=1`. The shared
   cursor only advances past the oldest outstanding lease, so a restart
   never skips an unacked page.
2. **One consumer, parallelize inside your process** — a single follower
   that hands each page's items to a local worker pool, waits, then acks.
   Simplest when one host is enough; ordering and progress stay in one place.

API: `POST /events/consumers` with `"shared": true`; pull returns `leaseId`;
`POST .../ack` with `{"leaseId": "..."}` (a cursor ack on a shared consumer
is refused with 400). Leases live on the consumer row (`lease_state`,
compare-and-set), so pullers on different API replicas coordinate through
PostgreSQL — no extra broker.

## The model

- **Cursor** = last acked `omni_events.journal_seq`, a monotonic journal
  position assigned at insert. (`receivedAt` carries the publisher's clock
  and can land out of order, so it cannot anchor an at-least-once cursor.)
- **Pull** (`POST /api/v2/events/consumers/:name/pull`) pages rows strictly after
  the cursor in `journal_seq` order, pre-filtered by the type glob (trailing
  `*` = prefix, the #966 contract) and payload conditions (the automation
  matcher — same as `events wait --filter`). It never moves the cursor.
  `waitMs` long-polls when the journal is idle — the same poll-the-journal
  transport `events wait` uses, with the wait moved server-side.
- **Ack** (`POST .../ack`) advances the cursor **monotonically**: equal =
  idempotent no-op (safe retry), behind = 400. The pull result's `cursor` is
  the highest seq *scanned*, not merely matched — acking it skips
  filtered-out rows so a sparse filter never re-scans.
- **Lag** = journal head minus cursor. It counts *all* journal rows past the
  cursor (cheap: two indexed reads), not only rows matching the filter.
- **Tenancy**: consumer registrations are global (the `event_schemas`
  precedent); the *reads* are tenant-policed — under RLS enforcement a
  tenant-scoped pull only ever pages that tenant's journal rows.
- Consumer create/delete publish `system.consumer.created` /
  `system.consumer.deleted` on the bus.

Head-of-journal caveat: `journal_seq` is assigned at insert but rows commit
in any order, so a row can become visible with a seq below an already-acked
cursor under extreme concurrency at the head. At-least-once is guaranteed for
every row visible when a page is scanned; a tail-chasing consumer that must
not miss such stragglers should run `--until-idle` sweeps rather than acking
at the raw head.

## G6 composition (waits/continuations)

G6's "wake a suspended run when a matching event arrives" composes on this
substrate without changes: a suspended run holds a consumer (or cursor) and
its wake-up check is `pull(limit: 1)` with the same matcher — the cursor
model assumes no live socket, no NATS subscription, and the filter shape is
already the automation-condition shape G6 would persist. Nothing here
forecloses it; nothing here builds it.

## Deliberately not built

- **Fan-out coordination or per-consumer NATS durables** — the journal read
  path already serves replay and resume; NATS stays transport-only.
- **Push delivery / webhooks on match** — that is automations' job.
- **Exactly-once or server-side dedup** — at-least-once with a monotonic
  cursor; consumers idempote on `id` / `journal_seq`.
- **Per-tenant consumer ownership** — joins additively in the G6+ ownership
  pass (the RLS coverage gate freezes which tables may carry `tenant_id`).
- **Filtered lag** — lag is head-minus-cursor, not "matching events behind";
  computing the latter is a full scan.
