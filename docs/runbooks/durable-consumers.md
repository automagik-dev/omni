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
`--no-ack` on follow peeks one page without moving the cursor.

## The model

- **Cursor** = last acked `omni_events.journal_seq`, a monotonic journal
  position assigned at insert. (`receivedAt` carries the publisher's clock
  and can land out of order, so it cannot anchor an at-least-once cursor.)
- **Pull** (`POST /v2/events/consumers/:name/pull`) pages rows strictly after
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

- **Consumer groups / competing consumers** — one cursor per name; run one
  follower per consumer.
- **Fan-out coordination or per-consumer NATS durables** — the journal read
  path already serves replay and resume; NATS stays transport-only.
- **Push delivery / webhooks on match** — that is automations' job.
- **Exactly-once or server-side dedup** — at-least-once with a monotonic
  cursor; consumers idempote on `id` / `journal_seq`.
- **Per-tenant consumer ownership** — joins additively in the G6+ ownership
  pass (the RLS coverage gate freezes which tables may carry `tenant_id`).
- **Filtered lag** — lag is head-minus-cursor, not "matching events behind";
  computing the latter is a full scan.
