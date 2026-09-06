# Connector Lifecycle Contract

> Issue #961 — liveness supervision, heartbeat ingress, and declared
> window/mutation semantics for sources that push events into omni.

Omni supervises the connector **contract** — are events arriving as declared —
never the connector process itself. Connectors live outside omni (cron,
launchd, whatever); this contract makes their environment failures **visible**,
not impossible. It was promoted from dogfood evidence (RFC #925): three silent
environment failures in one week (cron PATH, missing keyring, broken shebang),
each invisible until manually audited, each catchable on the first tick by the
heartbeat + liveness model below.

## Declaring the contract

All fields live on `webhook_sources` and are set at create/update time
(API `POST/PATCH /webhook-sources`, CLI `omni webhooks create|update`):

| Field | Meaning |
|---|---|
| `expectedIntervalSeconds` | Declared cadence: "≥1 event **or heartbeat** per N seconds" (1s–30d). Declaring it arms liveness supervision; `null` disarms. |
| `windowSemantics` | For time-window sources: `future_only` (only not-yet-started items) or `includes_in_progress`. `null` = undeclared. |
| `mutationPolicy` | When an upstream item changes (e.g. a reschedule): `same_id` (re-emits under the same source id — consumers must key on id+content) or `new_id`. Feeds the ingress-idempotency key template choice (#958). `null` = undeclared. |

```bash
omni webhooks create --name gcal-meetings \
  --expected-interval 900 \
  --window-semantics future_only \
  --mutation-policy same_id
```

`windowSemantics` and `mutationPolicy` are *informational* contract fields:
persisted, exposed in list/get (API and CLI), and read by humans and by the
idempotency work — omni does not enforce them at ingest time.

## Liveness supervision

A source with a declared cadence is scanned by the **connector-liveness
sweeper** (in-process scheduler, every 30s; pure logic in
`packages/core/src/connectors/liveness.ts`, data access via `WebhookService` —
the one sanctioned `webhook_sources` accessor). The liveness window is
anchored at the most recent of:

- `lastReceivedAt` — a real event arrived,
- `lastHeartbeatAt` — the connector heartbeated,
- `livenessArmedAt` — the cadence was (re)declared (a fresh source gets one
  full window before it can stall).

Silence strictly beyond the window (compared in milliseconds) transitions the
source `healthy → stalled`; any newer signal transitions it back. Transitions
are persisted with guarded updates (`WHERE liveness_status = <previous>`), so:

- `system.connector.stalled` / `system.connector.recovered` are emitted
  **once per transition**, never per tick — route them to alerts with a normal
  automation (`triggerEventType: 'system.connector.stalled'` + a `webhook` or
  `send_message` action).
- The unhealthy state is visible as `livenessStatus` in
  `GET /webhook-sources` / `omni webhooks list` (health column) and get/detail.
- A stalled transition also files a **dead-letter entry** (manual-resolution
  only, no auto-retry — retrying would republish the emitted-once event);
  recovery auto-resolves it. This is the "zero-emission dead-letter": a dead
  connector surfaces on the ops surface, not only in a log.

Payloads are Zod-registered in `SystemEventSchemas`
(`packages/core/src/events/nats/registry.ts`). `recoveredBy` on the recovered
event tells you which signal ended the stall: `event`, `heartbeat`, or
`rearmed` (cadence re-declared).

## Heartbeat: quiet vs. dead

```bash
# in the connector's cron script, after a run that found nothing:
omni webhooks heartbeat gcal-meetings
# or: POST /api/v2/webhooks/gcal-meetings/heartbeat   (authenticated, no body)
```

A heartbeat says "I ran, zero events found" and resets the liveness window.
Deliberately **no journal event per heartbeat**: at cadence, heartbeats are
control-plane noise; the compacted representation is `lastHeartbeatAt` +
`heartbeatCount` on the source row, and only the *transitions* are journaled.

A heartbeat does not itself flip a stalled source back to healthy — the
sweeper does, on its next tick (≤30s later). Keeping every transition
single-writer is what makes the stalled/recovered events emitted-once.

## Scope boundary

- Omni never runs or restarts connectors; supervision covers only the arrival
  contract.
- Fixing the connector's environment (PATH, keyring, shebang) remains the
  connector author's job — this contract just guarantees the failure is
  visible within one liveness window.
