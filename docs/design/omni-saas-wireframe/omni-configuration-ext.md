# Omni SaaS — Configuration extended + dev screens

> Source of truth: the shipped `omni/apps/khal-ui` admin app (live against Omni v2). Wireframe every screen with the KhalOS Design System components named in **Build with:**. These 8 routes sit in the **Configuration** nav group; the last is under **dev**. All share the app shell (`SidebarNav` rail, header scope selector, `StatusBar`, `CommandDialog`) defined in `omni-saas-wireframe.md`.

## Shared compositions (referenced by every screen below)

App-level patterns are DS compositions — build them exactly once, reuse the recipe:

- **Entry-head** (`PageShell`): `PillBadge` eyebrow (size sm, muted, copper dot) reading the group name (`Configuration`), a tight display `h1`, a ≤60ch lede, and a right-aligned `Toolbar` of header actions. Every screen opens with this.
- **Table** (`DataTable`): `SectionCard` (padding none, `overflow:hidden`) wrapping a mono UPPERCASE 10.5px wide-tracked header row over hairline-ruled rows; id/time cells mono + `tabular-nums`; copper inset bar on row hover; row click opens an inline detail. Three states: `Spinner` "Loading…", `EmptyState` (compact, `emptyTitle`/`emptyDescription`), `Note` type=error above the card. Optional `Toolbar` (search `Input` + filter chips) above.
- **Detail** (`ResourceDetail`): header = `h2` title + status `StatusBadge` + right `Button` actions, over a hairline rule; the id renders mono below the title. Body = stack of `SectionCard`s each fronted by a mono UPPERCASE `SectionHeader`; fields render as a `PropertyPanel`/`DataRow` list.
- **Field list** (`DataRowList`/`FieldGrid`): stack of `DataRow` (variant rule) — mono tabular values, hairline rules, optional `StatusDot` or IF/THEN tag. Use `PropertyPanel` for the DS equivalent.
- **Effect label** (`EffectBadge`): `PillBadge` (sm, dot) whose color encodes blast radius — `READ-ONLY` gray · `SYNTHETIC` blue · `DRY-RUN` amber · `LIVE` red. Shown before and after every action.
- **Confirm gate** (`ConfirmDialog`): `Dialog` → `GlassCard` (raised) body with the effect `PillBadge` + its description, a `DataRow` **Target** (name) + `DataRow` **ID** (mono), optional `description` slot, and — for destructive/LIVE — an `Input` requiring the operator to type the exact target phrase before `Dialog.Confirm` enables.
- **Mutation proof** (`MutationResult`): after a write, instead of a toast, an inset `SectionCard` shows the effect `PillBadge`, the mono `METHOD /path` request line, the raw response and/or a `DataRow` **read-back diff** (`before → after`, "N changed"). Errors render red in place, never hidden.
- **JSON tree** (`JsonInspector`): collapsible mono tree in a `SectionCard`/`GlassCard`, credential keys redacted by default; a raw `Toggle` reveals for the current operator and a copy `Button` (with `Tooltip`) always emits the redacted form.
- **Schema form** (`SchemaForm`): Zod-derived fieldset `SectionCard`s; string/number → `Input`, boolean → `Toggle`, enum → `DropdownMenu`, array/record → repeatable rows with add/remove `Button`; inline validation `Note`; submit `Button`.
- **Freshness** (`FreshnessBadge`): pill of `StatusDot` (pulse when live) + source label + live-ticking mono age; turns amber/"degraded" when stale or the stream drops.

Interaction conventions everywhere: every mutation confirms with target+ID+effect; every live value shows freshness and degrades visibly; empties use `EmptyState`; errors render honestly (`Note` type=error); production-scoped entities show a PROD tag with disabled-with-reason controls.

---

## `/trust-hosts` — Trust Hosts

**Purpose.** Read the genie A2A trust registry; edit a host's scopes or revoke it — both writes break request signing, so both are LIVE typed-phrase gated.

**Layout.** Entry-head (eyebrow `Configuration`, title `Trust Hosts`, lede "Genie A2A trust registry. Writes break signing — handle with care.") → full-width **Table** → on row-click an inline **Detail** `SectionCard` below.

**Table columns.** `hostname` (semibold), `scopes` (joined `, `), `lastSeenAt` (mono, w180), `id` (mono, w240). Empty → "No trust hosts".

**Detail sections.** Header: hostname title, mono id, status `StatusBadge` green `active` / red `revoked`, `Revoke` `Button` (error variant, disabled when already revoked). (1) **Fields** `DataRow`s: `Pubkey`, `Scopes`, `Last seen`, `Created`. (2) **Edit scopes** — "Wholesale replace (not merge). LIVE — confirm required." `Input` (`scope, scope, …`) + `Replace scopes…` `Button` (warning); result renders **Mutation proof** (effect LIVE, `PATCH /trust/hosts/{id}`, read-back `after`). (3) **Capabilities** (if present) → **JSON tree**.

**Actions.** Replace scopes → LIVE, destructive, confirm phrase = hostname (`PATCH`). Revoke → LIVE, destructive, confirm phrase = hostname (`DELETE`, "this host can no longer sign requests"). Both open a **Confirm gate**; neither is ever auto-run by validation.

**Build with:** PillBadge · SectionCard · DataRow · StatusBadge · Button · Input · Note · Dialog · GlassCard · EmptyState · Spinner · Toolbar · PropertyPanel · Tooltip · Toggle

---

## `/media-console` — Media Console

**Purpose.** Drive the six generative media endpoints (tts · stt · imagine · vision · film · music); every panel calls a PAID external provider behind a LIVE cost-warning confirm and is never auto-run.

**Layout.** Entry-head (title `Media Console`, lede "Generative media endpoints — every panel calls a paid provider behind a confirm.") → responsive grid `auto-fit minmax(340px,1fr)` of six panel `SectionCard`s. This route is a WIDE route (full-bleed content column).

**Panel structure** (each `SectionCard`). Mono `SectionHeader` title → `Note` type=warning label "LIVE · costs money" ("Calls a paid external provider… never auto-run by validation") → **Schema form** with submit `Generate (LIVE $)` → on error, **Mutation proof** (effect LIVE, `POST /media/{id}`) → on success, inline **MediaOutput**: `<audio>`/`<video>`/`<img>` from returned base64 + optional `text` + a **JSON tree** with `audioBase64`/`videoBase64` shown as `[omitted]`. Surface a `CostCounter` on the panel head to signal spend.

**Panel schemas (real fields).**
- `tts`: `text` (req), `voice?`, `format?` (mp3|ogg|opus|wav).
- `stt`: `audioBase64` (req), `mimeType` (req, e.g. `audio/ogg`), `language?`.
- `imagine`: `prompt` (req), `count?` (1–4), `aspectRatio?` (1:1|16:9|9:16|4:3|3:4).
- `vision`: `mediaBase64` (req), `mimeType` (req), `prompt?`.
- `film`: `prompt` (req), `durationSec?` (1–60).
- `music`: `prompt` (req), `instrumental?`, `durationSec?`.

**Actions.** Generate → **Confirm gate** titled `Generate — {title}`, effect LIVE, destructive, target = panel title, ID = `/media/{id}`, confirm label `Generate (charges apply)`, "calls a paid external provider and will incur cost."

**Build with:** PillBadge · SectionCard · SectionCardHeader · Note · Input · Toggle · DropdownMenu · Button · Dialog · GlassCard · DataRow · CostCounter · Tooltip

---

## `/turns` — Turns

**Purpose.** The agent turn ledger + admin controls; stats, a status-filtered list, inline detail, and force-close / close-all (both LIVE).

**Layout.** Entry-head (title `Turns`) with a header `Close all open…` `Button` (error). → stat-tile row (`auto-fit minmax(140px,1fr)`) → **Table** (with status filter `Toolbar`) → inline **Detail** on row-click → any close-all result as a standalone **Mutation proof** card.

**Stat tiles** (`SectionCard` + `MetricDisplay`, poll 15s → attach **Freshness**): `Open` (accent ok) · `Total` · `Avg duration` (`{ms}` or `—`) · `Timeout rate` (`{%}`, accent warn). Values animate with `NumberFlow`.

**Table columns.** `status` (`Badge`/`StatusBadge`: green `open`, red `timeout`, gray other, w100), `chatId` (mono), `agentId` (mono), `nudgeCount` (right, w80), `startedAt` (mono, w180). Toolbar: `Status` select — `all|open|done|timeout`. Empty → "No turns".

**Detail sections.** Header: `Turn {id.slice0,8}`, mono id, status `StatusBadge`, `Force close` `Button` (error, only when `status==='open'`). **Fields** `DataRow`s: `Instance`, `Chat`, `Agent`, `Action`, `Nudges`, `Messages sent`, `Started`, `Closed`. Below: **Mutation proof** on force-close (effect LIVE).

**Actions.** Force close → LIVE, destructive, target = chatId, ID = turn id; `description` carries an optional **Reason** `Input`. Close all open → LIVE, destructive, target = "all open turns", ID = `/turns/close-all` (`POST`, "closes every currently-open turn"). Validation reads list + stats only.

**Build with:** PillBadge · SectionCard · MetricDisplay · NumberFlow · StatusBadge · Badge · DataRow · Button · Input · DropdownMenu · Dialog · GlassCard · EmptyState · Spinner · Toolbar · Note · StatusDot

---

## `/context` — Context

**Purpose.** View + mutate the API key's conversation-context pointer (a KV-style record on the key row): set, use-instance, clear. Every write is LIVE + confirmed.

**Layout.** Entry-head (title `Context`, lede "The API key's conversation-context pointer.") → **Current pointer** `SectionCard` (`CardSection`) → **Set context** `SectionCard`. No table.

**Current pointer.** `DataRow`s: `Instance` (`instanceId`), `Active instance` (`activeInstanceId`), `Chat` (`chatId`), `Message` (`messageId`), `Updated` (`updatedAt`, mono time). All render `—` when absent.

**Set context.** `Note` type=warning label "LIVE": "A real `chatId` is validated against the DB. For synthetic exploration set only a `messageId` (KV-style, no chat lookup)." Three `Input`s: `instanceId (uuid)`, `chatId (uuid, real)`, `messageId (uuid)`. Three `Button`s: `Set…` (warning, disabled until any field set), `Use instance…` (secondary, disabled without instanceId), `Clear…` (error). Each write renders its own **Mutation proof** with read-back `after`.

**Actions.** Set → LIVE (`POST /context`), target = chatId|messageId|instanceId. Use instance → LIVE (`POST /context/use`), "Switch active instance". Clear → LIVE, destructive, target = "context pointer", ID = `/context` (`DELETE`). All via **Confirm gate**.

**Build with:** PillBadge · SectionCard · SectionCardHeader · DataRow · Note · Input · Button · Dialog · GlassCard · PropertyPanel

---

## `/handoffs` — Handoffs

**Purpose.** Read-only agent-to-agent handoff log with inline detail. Surfaces a known backend 500 honestly.

**Layout.** Entry-head (title `Handoffs`, lede "Agent-to-agent handoff records.") + header `Refresh` `Button` (secondary) → optional honest-error `Note` → **Table** → inline **Detail** on row-click.

**Honest error.** When the list 500s, a `Note` type=error label `GET /handoffs · 500` explains the uuid-cast bug (list route falling into the `/handoffs/:id` handler), with the raw `errMsg` in mono below — "surfaced here rather than hidden." The table then shows `EmptyState` "No handoffs" + "List unavailable — see the error above."

**Table columns.** `toPhone` (mono, → "To"), `text` (first 60 chars), `agentId` (mono), `sentAt` (mono, w180). Empty → "No handoffs".

**Detail sections.** Header: `Handoff`, mono id. (1) **Fields** `FieldGrid`/`PropertyPanel`: `Instance`, `Chat`, `Agent`, `To` (`toPhone`), `Sent` — all mono. (2) **Raw** → **JSON tree** of the full record.

**Actions.** Refresh (read-only). No mutations.

**Build with:** PillBadge · SectionCard · Button · Note · DataRow · PropertyPanel · EmptyState · Spinner · Tooltip · Toggle

---

## `/a2a` — A2A

**Purpose.** Read-only agent-to-agent discovery: list discoverable agents, load a selected agent's card. Feature-flag aware — disabled/unconfigured states shown honestly, not blanked.

**Layout.** Entry-head (title `A2A`, lede "Agent-to-agent discovery and cards.") + header `Refresh` `Button` → optional discovery-unavailable `Note` → **Table** → inline **Detail** on row-click.

**Discovery-unavailable.** When `agents` errors, `Note` type=warning label "Discovery unavailable": `{errMsg}` — "A2A discovery may be disabled or unconfigured."

**Table columns.** `name` (semibold, falls back to id), `id` (mono, from `agentId`/`id`/`name`), `description`. Empty → "No discoverable agents" / "No agents are configured for A2A discovery."

**Detail sections.** Header: `Agent card`, mono id. **Card** section: `Spinner`/"Loading…" while fetching; on error a `Note` type=warning "Not configured"; else the agent card as a **JSON tree**.

**Actions.** Refresh (read-only). No mutations.

**Build with:** PillBadge · SectionCard · Button · Note · Spinner · EmptyState · Tooltip · Toggle · DataRow

---

## `/api-info` — API Info

**Purpose.** Backend version/health + the documentation surface (OpenAPI download, Swagger docs).

**Layout.** Entry-head (title `API Info`, lede "Backend version, health, and the documentation surface.") + header `Refresh` `Button` → four stacked `SectionCard`s.

**Cards.** (1) **Backend**: mono `SectionHeader` + status `StatusBadge` green when `ok`/`healthy` else gray; `DataRow`s `Version`, `Info status` (`loaded`/error), `Health status`. `/health` polls 15s → attach **Freshness**. (2) **Documentation**: mono-blue links `↓ OpenAPI spec (openapi.json)` (download) and `→ Swagger docs (/api/v2/docs)`. (3) **/info** → **JSON tree** of the raw `info` payload. (4) **/health** → **JSON tree** of the raw `health` payload.

**Actions.** Refresh both queries (read-only). No mutations.

**Build with:** PillBadge · SectionCard · SectionCardHeader · StatusBadge · Badge · DataRow · Button · StatusDot · Tooltip · Toggle

---

## `/dev/capabilities` — Capabilities (dev)

**Purpose.** Live view of the bundled capability inventory (`capabilities.json`) + last-run validator evidence — coverage totals and a filterable table of every backend capability the UI tracks, so operators see what's still dark. Data is static/bundled → filtering is local.

**Layout.** Entry-head (title `Capabilities`, lede "Coverage of the Omni backend surface tracked by this UI.") → coverage stat-tile row → **Live evidence** panel → filterable **Table**.

**Coverage tiles** (`SectionCard` + `MetricDisplay`, `auto-fit minmax(120px,1fr)`, `NumberFlow` values): `Capabilities` (`totals.total`, desc "{n} off-spec") · `Dark` (`byUiStatus.none`, accent danger, "no UI yet") · `Exposed` ("visible, read-only") · `Operable` (accent blue, "drivable") · `Live-verified` (accent ok, "proven vs backend") · `UX-complete` (accent copper, "khalos-native"). Consider a `ProgressBar` of dark→ux-complete coverage.

**Live evidence panel** (`SectionCard`). Mono `SectionHeader` "Live evidence" + right mono "last run {time}" / "not yet run — `bun run evidence`". Grid `auto-fit minmax(180px,1fr)` of four family tiles (`instances`, `agents`, `coverage`, `chat`): each a `StatusDot`-style dot (ok/danger/muted by `fam.ok`) + family name + right "{checks} checks", mono `ranAt`, optional warn note.

**Table columns.** `resource` (w150), `method` (mono, w80), `route` (mono), `scope` (mono, w140), `flags` (`mut · destr · rt` from `mutating`/`destructive`/`realtime`, w130), `uiStatus` (`PillBadge`, muted when `none`, w110), `page` (mono-blue `{route} →` link from `RESOURCE_ROUTES`, else `—`, w130), `note` (amber warn chip with ⚠ when present, w240). Empty → "No matching capabilities".

**Toolbar.** Filter `Input` ("Filter by route, resource, or scope…") + a wrapping row of `PillBadge` family chips: `all · {n}` then each family `{fam} · {count}` (busiest first); the active chip uses `accent` variant, others `muted`. Filtering is client-side (route/resource/scope substring + family).

**Actions.** None — read-only inventory + evidence. Every row's `page` link routes an operator to where the capability is actually driven.

**Build with:** PillBadge · SectionCard · SectionCardHeader · MetricDisplay · NumberFlow · StatusDot · Input · Button · EmptyState · ProgressBar · Tooltip · DataRow

---

## Notes for the design agent

- These are horizontal-coverage / dev screens: dense, mono, evidence-first. Prefer `DataRow` + mono over decorative cards.
- Copper is brand-only — status color comes from `StatusDot`/`StatusBadge`/effect `PillBadge`, never decoration.
- Never fake success: mutations always show the **Mutation proof** (request + read-back diff), and known backend failures (Handoffs 500, A2A discovery off) render as honest `Note`s in place.
- LIVE / paid actions (Trust revoke, Media generate, Turns close, Context clear) always route through the destructive **Confirm gate** with a typed target phrase; they are never exercised by automated validation.
