# Omni SaaS — Operations screens (wireframe guideline)

> Source of truth: the shipped khal-ui admin app at `omni/apps/khal-ui/package/src/pages/resources/`
> (`EventsPage`, `EventOpsPage`, `DeadLettersPage`, `LogsPage`, `MetricsPage`). Prototype these five with the
> KhalOS Design System only. Field names below are the real API fields — keep them mono, keep them exact.

## Nav group 5 — Operations (5 routes)
`Events /events` · `Event Ops /event-ops` · `Dead Letters /dead-letters` · `Logs /logs` · `Metrics /metrics`.
All render inside the app shell (`SidebarNav` rail + content column + `StatusBar`); these screens own only the content column.

---

## App-composition legend (map these to the DS list, don't invent)

The app wraps a few repeated compositions. Build each from DS primitives — never as a bespoke widget:

- **Entry-head** (every page top) = `PillBadge` eyebrow (`"Operations"`, muted, accent dot) + display `SectionHeader` (title + lede) + right-aligned `Toolbar` of header actions.
- **Stat-tile row** (`StatGrid`) = responsive grid of `SectionCard`s, each one `MetricDisplay` (value in `NumberFlow`, mono tabular, label under). Accent color only for status (ok/warn/danger), never decorative.
- **Data table** (`DataTable`) = `SectionCard` (padding none, `overflow-x:auto`) + a quiet **mono uppercase header row** (10.5px, wide-tracked) + tabular rows; ids/timestamps mono. States: `Spinner` "Loading…", `EmptyState` (compact, icon + title), error `Note type=error`. Optional `Toolbar` above for search/filter, pagination = two `Button`s + mono "Page N" count.
- **Detail panel** (`ResourceDetail`) = `SectionCard` holding a header (h2 title + mono id + status `Badge`/`StatusBadge` + action `Button`s over a hairline rule) then titled sections, each fronted by a mono-uppercase `SectionCardHeader`.
- **Field grid** (`FieldGrid`) = `PropertyPanel` of label→value rows (or a `DataRow` stack); scalar values mono tabular, ids mono.
- **Card section** (`CardSection`) = `SectionCard` + mono-uppercase `SectionCardHeader` (+ optional lede + right `Toolbar`).
- **JSON inspector** (`JsonInspector`) = `SectionCard` (inset, mono) collapsible key/value tree; **secrets render redacted** (never raw). Cite it as SectionCard + mono tree.
- **JSON editor** (`JsonEditor`) = mono multi-line `Input` + inline parse-error `Note`; exposes an `ok` flag that gates submit.
- **Confirm gate** (`ConfirmDialog`) = `Dialog` + raised `GlassCard` body: an **effect `PillBadge`** + its description, a `DataRow` `Target` + `DataRow` `ID` (read-only), optional description, and — for destructive/live — a typed-phrase `Input` (must match the target name/type) that unlocks the confirm `Button`.
- **Mutation evidence** (`MutationResult`) = inset `SectionCard`: effect `PillBadge` + mono `METHOD path` request line + `JsonInspector` response + optional read-back `DataRow` diff (`before → after`). Shows proof the write landed instead of a toast; error state tints the card border danger.
- **Freshness** (`FreshnessBadge`) = `PillBadge`/pill with a pulsing `StatusDot` + source + mono live-ticking age; goes amber/"degraded" when stale or the stream drops.

### Effect vocabulary (the safety label on every action — an effect `PillBadge` with a colored dot)
`READ-ONLY` gray · `SYNTHETIC` blue · `DRY-RUN` amber · `LIVE` red (mutating). Only `LIVE`/destructive require the typed-phrase confirm.

---

## Events — `/events`
Purpose: pipeline event explorer — analytics, full-text search, per-stage payloads, and a manual custom-event trigger.

Layout (top → bottom):
```
entry-head  ["Operations" eyebrow · title Events · lede]
StatGrid    [ Total(24h) | Success rate | Failed | Avg processing ]
DataTable   [ search Toolbar over columns ]
detail      [ inline SectionCard — only when a row is selected ]
CardSection [ "Trigger a custom event" — LIVE Note + type Input + JSON editor + Trigger btn + MutationResult ]
+ 2 confirm gates (purge, trigger)
```

Stat tiles (`GET /events/analytics`):
- `totalMessages` → "Total (24h)"
- `successRate` → "Success rate" `%` (ok accent)
- `failedMessages` → "Failed" (danger accent)
- `avgProcessingTimeMs` → "Avg processing" `ms`

Table columns (`GET /events`, `POST /events/search`):
- `eventType` — Type (semibold)
- `direction` — Dir (`Badge` purple `outbound` / blue inbound)
- `status` — Status (`Badge` red `failed` / green `completed` / gray other)
- `textContent` — Text (first 60 chars)
- `receivedAt` — Received (mono)

Detail (`GET /events/:id`) — `FieldGrid`: `eventType`, `direction`, `status`, `errorMessage`, `chatId` (mono), `totalLatencyMs` `ms`, `receivedAt` (mono); subtitle = `channel`.
- **Payload stages** (`GET /events/:id/payloads`): one `Button` per `stage` (disabled when `hasData===false`, `(deleted)` tag when `deletedAt`); click loads `GET /events/:id/payloads/:stage` into a `JsonInspector`.
- **Inline payloads**: `rawPayload` / `agentRequest` / `agentResponse` in a `JsonInspector`.

Actions:
- Search — **READ-ONLY**.
- Row click / stage load — **READ-ONLY**.
- **Purge payloads** — **LIVE**, destructive, typed-phrase = `eventType`; soft-deletes every stored payload stage (reason `khalui operator purge`).
- **Trigger…** — **LIVE**, destructive, typed-phrase; disabled unless type starts with `custom.` and payload JSON is valid; publishes a real event into the pipeline (`POST /events/trigger`) — **never auto-run**, `MutationResult effect=live`.

Build with: PillBadge, SectionHeader, Toolbar, SectionCard, MetricDisplay, NumberFlow, Input, Button, Badge, Spinner, EmptyState, Note, PropertyPanel, DataRow, Dialog, GlassCard.

---

## Event Ops — `/event-ops`
Purpose: replay/reprocessing and scheduled maintenance — the LIVE side of the pipeline.

Layout (top → bottom):
```
entry-head  [ title Event Ops · header action: "Run scheduled maintenance…" btn ]
metrics     [ 4 SectionCard/MetricDisplay tiles — poll 15s ]
DataTable   [ replay sessions — poll 10s ]
SectionCard [ "New replay session" — LIVE Note + since Input + Dry-run Toggle + Start replay btn + MutationResult ]
SectionCard [ "Scheduled maintenance result" — only after a run (JsonInspector) ]
+ 3 confirm gates (replay, cancel, scheduled)
```

Metric tiles (`GET /event-ops/metrics`):
- `totalEvents` → "Total events"
- `pending` → "Pending" (warn accent)
- `failed` → "Failed" (danger accent)
- `deadLettersPending` → "Dead-letters"

Replay table (`GET /event-ops/replay`) columns:
- `id` — Session (mono semibold)
- `status`
- `dryRun` — Dry-run (`yes`/`no`)
- `startedAt` — Started (mono)
- trailing `Cancel` `Button` shown only when `status==='running'`

New-replay form: `since` `Input` (ISO or relative e.g. `1h`) + **Dry-run** `Toggle` (default on) + **Start replay…** `Button`. A LIVE `Note` warns non-dry-run reprocesses real events; start disabled until `since` is set.

Actions:
- **Start replay** — **DRY-RUN** while the toggle is on (`Button` default variant, simulates only); toggle off → **LIVE**, destructive, typed-phrase = `since <ts>`; reprocesses real events (`POST /event-ops/replay`), `MutationResult effect=dry-run|live`.
- **Cancel** a running session — **LIVE**, destructive.
- **Run scheduled maintenance** — **LIVE**, destructive, target `auto-retry + cleanup`; runs dead-letter auto-retry + payload/dead-letter cleanup immediately; result as `JsonInspector`.
- Metrics + list reads — **READ-ONLY**.

Build with: PillBadge, SectionHeader, Toolbar, SectionCard, MetricDisplay, NumberFlow, Input, Toggle, Button, Note, Spinner, EmptyState, Dialog, GlassCard, DataRow.

---

## Dead Letters — `/dead-letters`
Purpose: failed events and their resolution — retry, resolve, or abandon.

Layout (top → bottom):
```
entry-head  [ title Dead Letters ]
StatGrid    [ Total | Pending | Resolved | Abandoned — stats poll 15s ]
DataTable   [ status DropdownMenu in Toolbar ]
detail      [ inline SectionCard — when selected: status Badge, Retry/Resolve/Abandon btns, fields, Error, Payload ]
+ 1 confirm gate (retry/resolve/abandon)
```

Stat tiles (`GET /dead-letters/stats`):
- `total` → "Total"
- `pending` → "Pending" (warn accent)
- `resolved` → "Resolved" (ok accent)
- `abandoned` → "Abandoned" (danger accent)

Table (`GET /dead-letters`) columns:
- `eventType` — Event type (semibold)
- `status` — `Badge`/`StatusBadge`: `pending`=amber, `retrying`=gray, `resolved`=green, `abandoned`=red
- `error` — first 60 chars
- retries — `autoRetryCount + manualRetryCount` (right-align)
- `createdAt` — Created (mono)
- Toolbar filter = `DropdownMenu` on `status` (`all` / pending / retrying / resolved / abandoned)

Detail (`GET /dead-letters/:id`) — status `Badge` beside title; `FieldGrid`: `eventId` (mono), `subject` (mono), `autoRetryCount`, `manualRetryCount`, `createdAt` (mono), `resolvedBy`.
- **Error** section: `Note type=error` with `error`, then `stack` in a mono scrolling `pre`.
- **Payload** section: `JsonInspector` over `payload`.

Actions (all confirm-gated, `MutationResult effect=live`):
- **Retry** — **LIVE**, re-enqueues the event; disabled when `status==='resolved'`.
- **Resolve** — **LIVE**; confirm description carries a resolution-note `Input` (default `resolved via khal-ui`).
- **Abandon** — **LIVE**, destructive, typed-phrase; permanent, no further retries.
- Filter/select — **READ-ONLY**.

Build with: PillBadge, SectionHeader, SectionCard, MetricDisplay, NumberFlow, Badge, StatusBadge, DropdownMenu, Button, Note, Spinner, EmptyState, PropertyPanel, DataRow, Dialog, GlassCard.

---

## Logs — `/logs`
Purpose: a live SSE log tail plus the recent-buffer snapshot, both streamed through the KhalOS console.

Layout (top → bottom):
```
entry-head  [ title Logs · header action: "Follow tail" Toggle ]
SectionCard [ filters — Min-level DropdownMenu + modules Input + "Refresh snapshot" btn ]
CardSection [ "Live tail" — only when following: connection Badge + N frames + LiveFeed ]
CardSection [ "Recent buffer · N" — LiveFeed snapshot ]
```

Filters:
- `level` — `debug` / `info` / `warn` / `error` (min-level `DropdownMenu`)
- `modules` — comma-separated glob `Input`, e.g. `whatsapp:*`

Log entry fields: `time`, `level`, `module`, `msg`. Level → `LiveFeed` row type (dot color + glyph): `debug`→system, `info`→info, `warn`→warning, `error`→error; each row = `` `${module}  ${msg}` `` mono with a mono timestamp.
- **Live tail** = `LiveFeed` (height 320, `showTimestamps`) over `GET /logs/stream` (SSE); header = connection `Badge`/`StatusBadge` (green `streaming` / red `degraded` / gray `connecting`) + mono `N frames` count (pulsing `StatusDot`).
- **Recent buffer** = `LiveFeed` (height 480) over `GET /logs/recent`; empty → muted "No recent logs.", error → `Note type=error`.

Actions: Follow-tail toggle, level/module filters, Refresh snapshot — all **READ-ONLY** (pure observation, no mutations). Freshness *is* the connection state: degrade visibly, never silently.

Build with: PillBadge, SectionHeader, Toolbar, SectionCard, SectionCardHeader, Toggle, DropdownMenu, Input, Button, LiveFeed, Badge, StatusBadge, StatusDot, Note.

---

## Metrics — `/metrics`
Purpose: the Prometheus exposition text (`GET /metrics`) parsed into grouped metric families, with a consumer-lag panel.

Layout (top → bottom):
```
entry-head  [ title Metrics · header action: "Refresh" btn — auto-refetch 30s ]
Note        [ type=error — only on fetch failure; else ↓ ]
SectionCard [ filter Input + mono "N families · M consumer/lag" ]
CardSection [ "Consumer lag" — when any lag family ]
SectionCard [ one family card per family ]
```

Data — filter `Input` narrows families by `name`/`help`; mono count reads `N families · M consumer/lag`. Each family: `name`, `help`, `type`, `samples[]` where a sample is `{ labels, value }`.
- **Consumer lag** = every sample of families whose `name` matches `/lag|consumer/`: mono `name` + tertiary `labels` left, mono tabular `value` right (amber when hot), and a **relative** `ProgressBar` scaled to the max observed lag (hot = ≥66% of max → warn color). Lag is unbounded, so the bar is relative and the mono value carries the real number.
- **Family card** = mono `name` h3 + `type` `PillBadge` + `help` lede + a two-column `DataTable` (`labels` mono / `value` mono right-align, `(none)` when unlabeled).

Actions: Refresh, Filter — **READ-ONLY**. Pure observation — no mutations, no confirm gates.

Build with: PillBadge, SectionHeader, SectionCard, SectionCardHeader, Input, Button, ProgressBar, DataRow, Note, EmptyState, Spinner, Tooltip.

---

## Interaction conventions (carry into every Operations screen)
- **Effect labels are mandatory.** Every action declares its blast radius as an effect `PillBadge` — READ-ONLY / SYNTHETIC / DRY-RUN / LIVE — shown in the button context, the confirm `Dialog`, and the `MutationResult`.
- **LIVE/destructive = typed-phrase confirm.** The `ConfirmDialog` repeats the `Target` name + `ID` as read-only `DataRow`s and requires typing the target's phrase; the confirm `Button` stays disabled until it matches. Purge/abandon/cancel/live-replay/trigger/scheduled all gate this way — no live delete is one mis-click away.
- **Prove the write.** After a mutation show `MutationResult` (request line + response `JsonInspector` + read-back diff), not a toast.
- **Freshness is visible.** Polled panels (metrics 15s/30s, replay 10s, DL stats 15s) and the SSE tail surface an observed-at age or a connection `Badge`; when stale or dropped they read `degraded`/"connecting", never a silent stale value.
- **Honest empty & error states.** Lists use `EmptyState` (icon + title); every error renders in place as `Note type=error`; loading uses `Spinner`. Never a blank surface.
- **Secrets stay redacted** in every `JsonInspector` (payloads, responses, evidence).
- **Production is read-only.** The two production instance ids are reads-only from the UI; any prod-scoped entity shows a `PROD` `PillBadge`/`StatusBadge` and disabled-with-reason controls.
- **Mono everywhere it counts:** ids, timestamps, metric values, event types, and table headers are mono tabular — the KhalOS operator surface reads like a console.
