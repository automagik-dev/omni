# Omni — Messaging (rest) screens

> Source of truth: shipped khal-ui admin at `omni/apps/khal-ui/package/src/pages/resources/`. Six routes in the **Messaging** nav group (after `/chat`, which is documented separately). Build every screen with the KhalOS DS components named in each "Build with:" line. Field/mono names in backticks are the real API/schema names — do not rename.

Routes covered: `/conversations` · `/persons` · `/contacts` · `/groups` · `/journeys` · `/voice`. They sit in the **Messaging** `SidebarNav` group (below `/chat`), inside the standard app shell (`SidebarNav` rail + content column + `StatusBar`); this doc specs the content column only.

---

## Shared compositions (used on every screen)

These are APP compositions, not single DS components. Build them from the DS list.

- **entry-head** (page frame): `PillBadge` eyebrow (`Messaging`, muted, copper dot) → tight display `SectionHeader` (h1 + one-line lede) → right-aligned `Toolbar` for header actions (Refresh `Button`, pickers). All content stacks under it.
- **data table**: `SectionCard` (padding none, overflow hidden) wrapping a real `<table>`.
  - header: mono UPPERCASE tracked row (`SectionCardHeader` treatment on `<th>`, 10.5px, tertiary); sortable columns emit sort intent (`↑`/`↓`/`↕`), never sort locally.
  - body: rows with hairline rules, mono tabular-nums for id/timestamp cells, copper inset bar on hover, click-to-select (keyboard Enter too).
  - states: loading = inline `Spinner` + "Loading…"; empty = `EmptyState` (`Icons` glyph + title + description, compact); error = `Note` type=error above the card.
  - optional `Toolbar` slot above (search/filter `Input` + `Button`); optional pagination footer = mono count (`NumberFlow`) + Prev/Next `Button`s.
  - (Non-columnar card-style row lists use `ListView` instead.)
- **resource detail** (inline, opens below the table on row-click): `SectionCard` frame; header = h2 title + mono `id` handle + status chip (`StatusBadge`/`Badge`) + action `Button`s, `Separator` under it; body = stack of titled sections, each a `SectionCard` with a mono `SectionCardHeader` eyebrow + optional description.
- **field grid** (scalar fields): `PropertyPanel` / `DataRow` definition list — label muted left, value fg right, mono for ids/timestamps, booleans as yes/no, `—` for null.
- **JSON inspector**: collapsible mono key/value tree in a `SectionCard` — `DataRow` rows, credential-looking keys **redacted by default**, `Toggle` to reveal raw, copy `Button` (+`Tooltip`) that always emits the redacted form.
- **schema form** (create/edit): `Input` (string/number), `Toggle` (bool), enum via `DropdownMenu`; inline validation `Note`s; submit `Button`. Read-back proves the write (see below).
- **confirm gate**: `Dialog` → raised `GlassCard` body.
  - effect `PillBadge` + its plain-language description at top.
  - inset `DataRow` block: **Target** (name) + **ID** (read-only — no ambiguity about what is hit).
  - optional description line; for destructive/LIVE, a typed-phrase `Input` whose `borderColor` goes ok-green when the phrase matches.
  - `Dialog` Cancel/Confirm `Button`s; Confirm disabled until the phrase matches (and while pending shows "Working…").
- **mutation evidence** (in place after a write, never a toast): inset `SectionCard`.
  - effect `PillBadge` + Result/Failed heading.
  - **Request** panel: mono `<method> <path>` (blue verb) + optional body JSON inspector.
  - **Response** panel: JSON inspector (redacted).
  - **Read-back diff** panel: `DataRow` per changed field `before → after` + an "N changed" mono count; error border turns danger-red and shows the message honestly.
- **freshness**: `StatusDot` (live/away/degraded) + mono source label + live-ticking age ("Xs ago", `NumberFlow`), `Tooltip` = exact observed-at. Degrades visibly ("degraded") instead of going silent.
- **stat tiles**: responsive grid of `SectionCard` + `MetricDisplay` (mono tabular value via `NumberFlow`, muted label); status-token accent used sparingly (never copper decoratively).
- **effect labels** (`PillBadge`, on every action): `READ-ONLY` gray · `SYNTHETIC` blue · `DRY-RUN` amber · `LIVE` red. `LIVE` is the only mutating one → always confirmed, destructive ones type-gated.
- **instance picker**: `DropdownMenu` of instances as `name (channel)`; production instances carry a ` · prod` tag. Prod-scoped entities are read-only with the reason shown.

---

## `/conversations` — Conversations

**Purpose:** cross-channel conversation records and the chats stitched under each.

**Layout:** entry-head (`Messaging` / "Conversations" / "Cross-channel conversation records and the chats linked to them.", Refresh `Button`) → data table → "New conversation" `SectionCard` (schema form) → on row-click, resource detail opens below → confirm gate for delete.

**Data — table columns:** `title` (bold, `(untitled)` fallback) · `summary` (`—` fallback) · `createdAt` (mono, 180w) · `id` (mono, 260w). Source: `conversations.list({ limit: 200 })`.
**Detail — Fields:** `title` · `summary` · `createdAt` (mono) · `updatedAt` (mono). **Edit form:** `title`, `summary`. **Linked chats** (`/conversations/:id/chats`): each `id` · `name` · `channel` · `lastMessageAt` (JSON inspector; `Note` "No chats linked…" when empty). **State:** `selected.state` JSON inspector (only when present).

**Actions + effects:**
- Refresh — READ-ONLY, refetch.
- Create — **LIVE** `POST /conversations`; mutation evidence Response after submit.
- Save (detail edit) — **LIVE** `PATCH /conversations/:id`; mutation evidence with read-back diff (`after` re-fetched).
- Delete — **LIVE · destructive**; confirm gate, typed phrase = the conversation `title`; description: "Permanently deletes this conversation record. Linked chats are not deleted."

**Build with:** PillBadge, SectionHeader, Toolbar, Button, SectionCard, SectionCardHeader, Spinner, EmptyState, Note, Input, Toggle, DropdownMenu, PropertyPanel, DataRow, Dialog, GlassCard.

---

## `/persons` — Persons

**Purpose:** cross-channel identity graph — search, presence, timeline, and the destructive identity ops. Every person here is **production data**; identity ops are operator-driven only, never auto-run.

**Layout:** entry-head (no header action) → data table with a search `Toolbar` (`Input` "Search by name, email, or phone…" + Search `Button`) → resource detail on row-click → "Identity operations" `SectionCard` (a warning `Note` + three side-by-side op forms) → confirm gate.

**Data — table columns:** `displayName` (bold, `(unnamed)`) · `primaryPhone` (mono) · `primaryEmail` · `id` (mono, 260w). Source: `persons.list({ limit: 100, search })`.
**Detail — Profile form:** `displayName` · `primaryPhone` (E.164) · `primaryEmail` · `avatarUrl`. **Presence** (`/persons/:id/presence`): `identities` count · `byChannel` keys joined · full JSON. **Timeline** (`limit: 25`): each `eventType` · `direction` · `textContent` · `receivedAt` (JSON inspector; `Note` when empty).

**Actions + effects:**
- Search — READ-ONLY, re-queries list.
- Save profile — **LIVE** `PATCH /persons/:id`; mutation evidence with `before → after` read-back diff.
- Link (`identityA`, `identityB`) — **LIVE · destructive**, warning `Button`.
- Unlink (`identityId`, `reason`) — **LIVE · destructive**, warning `Button`.
- Merge (`sourcePersonId` deleted, `targetPersonId` kept) — **LIVE · destructive**, error `Button`.
- Standing `Note` type=warning label `LIVE · destructive`: "Link, unlink, and merge permanently rewrite the identity graph… each op requires a typed-phrase confirm and is never run by automated validation." Confirm gate description: "This permanently rewrites the identity graph on production data." Typed phrase = the op target (merge→`targetPersonId`, unlink→`identityId`, link→`identityA + identityB`).

**Build with:** PillBadge, SectionHeader, SectionCard, SectionCardHeader, Input, Button, Note, Spinner, EmptyState, PropertyPanel, DataRow, Toggle, Dialog, GlassCard.

---

## `/contacts` — Contacts

**Purpose:** per-instance address book, fanned in from one channel. Fully **read-only** here; block/unblock lives on the instance detail's Contacts tab.

**Layout:** entry-head with an **instance picker** as the header action → if no instance picked, a `Note` "Pick an instance" placeholder → else stat tiles + data table → resource detail on row-click.

**Data — stat tiles** (computed from rows): `Total` · `Contacts` · `Groups` · `Business`. **Table columns:** `displayName` (bold, `(unnamed)`) · `phone` (mono) · `kind` (chips: `isGroup`→"group" purple `Badge`, `isBusiness`→"business" teal, else "contact" gray) · `platformUserId` (mono, 260w). Source: `instances.contacts(instanceId, { limit: 500 })`.
**Detail — Fields:** Name · Phone (mono) · Platform ID (mono) · Group (bool) · Business (bool) · **Raw** JSON inspector. Status chip mirrors `kind`.

**Actions + effects:** all READ-ONLY. Pick instance (`DropdownMenu`), select row → detail. Empty description: "This instance returned no contacts, or the channel does not support contact listing."

**Build with:** PillBadge, SectionHeader, Toolbar, DropdownMenu, Note, SectionCard, SectionCardHeader, MetricDisplay, NumberFlow, Badge, StatusBadge, Spinner, EmptyState, PropertyPanel, DataRow.

---

## `/groups` — Groups

**Purpose:** cross-instance directory of group chats (fans `/instances/:id/groups` across every instance, `Promise.allSettled`, tagging each row with its source instance). **Read-only**; deep management lives per-instance.

**Layout:** entry-head (Refresh `Button`) → while instances load, a `Note` "Loading instances…" → else stat tiles + data table with a filter `Toolbar` (`Input` "Filter groups…").

**Data — stat tiles:** `Groups` (total across instances) · `Instances scanned`. **Table columns:** `name` (bold, `(unnamed)`) · `instance` (source `__instanceName` as blue `Badge`) · `memberCount` (right-aligned, 100w, `—` fallback) · `createdAt` (mono, 180w) · manage cell (a "Manage →" `Button`). Filter matches `name` or `externalId` (case-insensitive). Row key = `__instanceId:externalId`.

**Actions + effects:** all READ-ONLY. Refresh (refetch). Filter (client-side). **Manage →** navigates to `/instances/:__instanceId` (deep group management — subject/participants/invites). Empty: "No instance returned any groups."

**Build with:** PillBadge, SectionHeader, Toolbar, Button, Note, SectionCard, SectionCardHeader, MetricDisplay, NumberFlow, Badge, Input, Icons, Spinner, EmptyState.

---

## `/journeys` — Journeys

**Purpose:** end-to-end latency tracing across the message pipeline — stage percentiles plus a single-journey checkpoint trace. **Read-only.**

**Layout:** entry-head with a header `Toolbar`: "Since" window `DropdownMenu` (`30m` / `1h` / `6h` / `24h` / `7d`) + Refresh `Button` → stat tiles (or a `Note` type=error if summary fails) → per-stage percentile table → "Look up a journey" `SectionCard`: `correlationId` `Input` + Trace `Button`; result renders a `DataRow` summary + a vertical trace timeline + JSON inspector.

**Data — stat tiles:** `Tracked` (`totalTracked`) · `Completed` (`completedJourneys`) · `Active` (`activeJourneys`, blue accent). **Stage table** (from `summary.stages`): `stage` (bold) · `count` (right, 90w) · `avg` "Avg ms" (mono) · `p50` · `p95` · `p99` (mono, right) · `max` "Max ms" (mono). **Journey lookup** (`journeys.get(id)`): `DataRow` summary — Correlation ID · Started · Completed · Checkpoints count. **Trace timeline** = vertical `StatusDot` spine (one node per checkpoint, sorted by `timestamp`; last node pulses `active`, others `online`): each shows `name`/`stage`, `+<delta>` from prior checkpoint (mono), and absolute offset from start (mono). Then full JSON inspector.

**Actions + effects:** all READ-ONLY. Change window (re-query summary). Refresh. Trace (`correlationId` → single-journey fetch); not-found renders `Note` type=error label "Not found" in place. Empty stage table: "No journeys tracked in this window."

**Build with:** PillBadge, SectionHeader, Toolbar, DropdownMenu, Button, SectionCard, SectionCardHeader, MetricDisplay, NumberFlow, Note, Input, DataRow, StatusDot, Separator, Spinner, EmptyState.

---

## `/voice` — Voice

**Purpose:** active voice sessions (read-only list/detail) plus join/leave controls. Join/leave touch a live instance → both are **LIVE**, typed-phrase-gated, never exercised by validation.

**Layout:** entry-head (Refresh `Button`) → data table (auto-refetches every 10s → surface as a **freshness** chip) → resource detail on row-click (Leave action) → "Join a voice channel" `SectionCard` (warning `Note` + join form) → two confirm gates (join, leave).

**Data — table columns:** `sessionId` (mono, bold) · `channelId` (mono, `—`) · `state` (`StatusBadge`: green when `connected`, else gray, `unknown` fallback) · `createdAt` (mono, 180w). Source: `voice.sessions()`, `refetchInterval: 10_000`.
**Detail — Fields:** `instanceId` (mono) · `channelId` (mono) · `state` · `createdAt` (mono) · **Raw** JSON inspector. **Join form:** instance picker + `channelId` `Input` + `guildId` `Input` (Discord, optional).

**Actions + effects:**
- Refresh — READ-ONLY.
- Join — **LIVE · destructive** `POST /voice/join`; warning `Button` (disabled until `instanceId` + `channelId`); confirm gate target = `channelId`, ID = `instanceId`, description "Connects the selected instance to this voice channel." Standing `Note` type=warning label `LIVE`: "Joining connects a live instance to a voice channel. Confirm required."
- Leave — **LIVE · destructive** `POST /voice/leave`; error `Button` in detail header; confirm gate target/ID = `sessionId`.
- Both writes render mutation evidence (Request + Response) in the join card.

**Build with:** PillBadge, SectionHeader, Toolbar, Button, SectionCard, SectionCardHeader, StatusBadge, StatusDot, NumberFlow, Note, Input, DropdownMenu, PropertyPanel, DataRow, Dialog, GlassCard, Spinner, EmptyState, Tooltip.

---

## Conventions to carry everywhere

- Every LIVE mutation confirms via `Dialog` repeating **target name + ID + effect `PillBadge`**; destructive requires typing the target phrase.
- Every write shows **read-back evidence** (Request/Response/diff), never a bare toast.
- Every live value shows **freshness** (mono age, degrades visibly); polling surfaces (Voice 10s) show the poll chip.
- Empty = `EmptyState` (icon + reason); errors render honestly in place via `Note` type=error, never blank.
- Per-instance fan-in pages (Contacts, Voice-join) gate on a picked instance first, with a `Note` prompt until one is chosen.
- **PROD** entities (persons, prod-tagged instances) carry the tag and are read-only with the reason stated.
