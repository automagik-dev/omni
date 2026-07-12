# Omni — Channels & Access (wireframe guideline)

> Source of truth: shipped khal-ui admin app, `omni/apps/khal-ui/package/src/pages/`.
> Three routes, all under the **Channels & Access** nav group:
> `/webhook-sources` · `/access-rules` · `/routing`.
> Prototype every screen with the KhalOS Design System. App-level widgets (tables,
> schema forms, JSON inspectors, confirm dialogs) are **compositions** of the DS
> primitives below — never new components.

---

## Shared compositions (used by all three screens)

Reference these by name in each screen instead of re-describing them.

**Entry-head** (`PageShell`) — every route opens with it. `PillBadge` eyebrow
(size sm, muted, copper dot) reading `Channels & Access`, a tight display `SectionHeader`
title + one-line lede, right-aligned `Button` actions (optional).
Build with: `PillBadge` + `SectionHeader` + `Button`.

**Table** (`DataTable`) — server-driven list; never sorts/slices locally. A
`SectionCard` (padding none) wrapping a mono, uppercase, wide-tracked header row
over hairline-`Separator` rows; id/timestamp/number cells are mono + tabular-nums;
copper inset bar on row hover; row click opens the inline detail. Three states:
loading = `Spinner` "Loading…", empty = `EmptyState` (compact, title + optional
desc), error = `Note` type=error. Optional filter `Toolbar` slot above, `Button`
Prev/Next pager below.
Build with: `SectionCard` + `Separator` + `Spinner` + `EmptyState` + `Note` + `Button` (+ `Toolbar`).

**Card / Panel** (`Panel`, `CardSection`) — titled content card: `SectionCard` +
`SectionCardHeader` (mono uppercase head, optional right actions + sub-description).
Build with: `SectionCard` + `SectionCardHeader`.

**Effect badge** (`EffectBadge`) — every action declares its blast radius. A
`PillBadge` (dot, `borderColor:currentColor`) tinted by effect:
`READ-ONLY`=gray · `SYNTHETIC`=blue · `DRY-RUN`=amber · `LIVE`=red. Hover title =
the effect's description.
Build with: `PillBadge`.

**Confirm dialog** (`ConfirmDialog`) — gates every mutation. `Dialog` holding a
raised `GlassCard` body: effect `PillBadge` + its description, an inset box with
two `DataRow`s (`Target`=name, `ID`=id, mono), an optional `description` node, and
— for `destructive`/`LIVE` — a typed-phrase `Input` ("Type `<name>` to confirm",
border turns ok-green when satisfied). `Dialog` actions = Cancel + Confirm `Button`
(Confirm disabled until phrase matches).
Build with: `Dialog` + `GlassCard` + `PillBadge` + `DataRow` + `Input` + `Button`.

**Mutation result** (`MutationResult`) — post-write evidence, not a toast. Inset
`SectionCard` (border turns red on error): effect `PillBadge`, a mono request line
`METHOD /path` (method in blue), the raw response as a JSON tree, and a read-back
diff of the re-fetched entity — `DataRow`s `field: <before> → <after>` with an
"N changed" counter.
Build with: `SectionCard` + `PillBadge` + `DataRow` + JSON tree.

**Live test result** (`LiveTestResult`) — outcome of a read/dry-run check. Bordered
card with a colored left accent: `StatusDot` PASS/FAIL/RUNNING (pulse while
pending) + check name + optional `NumberFlow` `ms` latency + effect `PillBadge`,
then a message line and a JSON evidence tree.
Build with: `StatusDot` + `NumberFlow` + `PillBadge` + JSON tree.

**JSON inspector** (`JsonInspector`) — redacted-by-default collapsible tree.
`GlassCard`/`SectionCard` with a `Toolbar` header (mono `JSON (redacted)` label +
`Show raw` / `Copy redacted` `Button`s) over the mono tree; credential-like keys
render masked; copy always emits the redacted form.
Build with: `SectionCard` + `Toolbar` + `Button`.

**Field grid** (`FieldGrid`) — an entity's scalar fields as a two-column
definition list (`label` → value, booleans as yes/no, ids/timestamps mono).
Build with: `PropertyPanel`.

**Resource detail** (`ResourceDetail`) — inline, opened by a table row-click. A
`SectionCard` whose header carries the title, a status `Badge`, the mono id, and
right-aligned action `Button`s, over titled `PropertyPanel` field sections plus
(after an action) a **mutation result**.
Build with: `SectionCard` + `Badge` + `Button` + `PropertyPanel`.

**Freshness** (`FreshnessBadge`) — live values show a pill: `StatusDot`
(live/away/error/idle, pulse when live) + source label + mono ticking age; degrades
to amber "away"/red "degraded" instead of going silent.
Build with: `PillBadge` + `StatusDot`.

**Schema form** (`SchemaForm`) — Zod-driven create/edit. `SectionCard` fieldsets
with label/control rows: `Input` (string/number), `Toggle` (boolean),
`DropdownMenu` (enum), required-`*` markers + hint text, inline error `Note`,
submit `Button`. `preview` mode = every control read-only, no submit.
Build with: `SectionCard` + `Input` + `Toggle` + `DropdownMenu` + `Note` + `Button`.

**Guarded action** (`ActionButton`) — one button that runs a guarded mutation.
Read-only effects run on click; mutating effects open the **confirm dialog** first;
the outcome renders as a **live test result**. `disabledReason` disables the
`Button` and shows it as a `Tooltip` (production guard).
Build with: `Button` + `Tooltip` + confirm dialog + live test result.

---

## Screen 1 — Webhook Sources `/webhook-sources`

**Purpose:** register inbound webhook sources; create defaults to *disabled*, and
the create-disabled → delete round-trip is the sanctioned validation path.

**Layout** (single column, stacked):
```
[entry-head]  eyebrow "Channels & Access" · title "Webhook Sources" · lede "Inbound webhook registrations."
[table]       webhook-source rows
[card "NEW SOURCE"]   inline create row
[resource detail]     (only when a row is selected)
[confirm dialog]      (only when Delete pressed)
```

**Table columns** (`WebhookSourceRow`):
| col | field | render |
|---|---|---|
| Name | `name` | semibold |
| Enabled (110) | `enabled` | `Badge` green `enabled` / gray `disabled` |
| Description | `description` | text or `—` |
| Created (180) | `createdAt` | mono, formatted time |

**New source card** — `name` `Input`, `description` `Input`, `enabled` `Toggle`
(defaults **false/disabled**), `Create` `Button` (disabled until `name`).
Effect: **LIVE** `POST /webhook-sources` → mutation result below the row.

**Detail** (row-click) — title=`name`, status `Badge` enabled/disabled, mono id.
`PropertyPanel` fields: `Description`, `Enabled`, `Created` (mono). Actions:
- `Enable`/`Disable` `Button` (secondary) → **LIVE** `PATCH /webhook-sources/{id}` `{enabled}` → mutation result with read-back diff.
- `Delete` `Button` (error) → confirm dialog.

**Delete** — confirm dialog, title "Delete webhook source", `Target`=`name`,
`ID`=id, effect **LIVE**, `destructive` (must type the name), confirm label `Delete`.

**Build with:** `PillBadge`, `SectionHeader`, `SectionCard`, `SectionCardHeader`,
`Separator`, `Spinner`, `EmptyState`, `Note`, `Badge`, `Input`, `Toggle`, `Button`,
`PropertyPanel`, `DataRow`, `Dialog`, `GlassCard`.

---

## Screen 2 — Access Rules `/access-rules`

**Purpose:** allow/deny routing policy plus a **read-only** live access checker that
explains the decision for a simulated identity.

**Layout** (single column, stacked):
```
[entry-head]  "Access Rules" · lede "Allow/deny routing policy and a live access checker."
[table]       access-rule rows
[card "NEW RULE"]        inline create row
[card "ACCESS CHECKER"]  read-only tester → live test result
[resource detail]        (when a row is selected)
[Note]                   empty-state hint "No access rules configured — all traffic is allowed by default." (when 0 rows)
[confirm dialog]         (on Delete)
```

**Table columns** (`AccessRuleRow`):
| col | field | render |
|---|---|---|
| Type (90) | `ruleType` | `Badge` red `deny` / green `allow` |
| Action (120) | `action` | text or `—` |
| Match | `phonePattern` ?? `platformUserId` ?? `personId` ?? `—` | mono |
| Enabled (100) | `enabled` | `Badge` green `on` / gray `off` |
| Prio (70, right) | `priority` (default 0) | tabular |

**New rule card** — `ruleType` `DropdownMenu` (`deny`\|`allow`), `action`
`DropdownMenu` (`block`\|`allow`\|`silent_block`), `phonePattern` `Input`
(e.g. `5511*`), `enabled` `Toggle` (defaults **true**), `Create` `Button`
(disabled until `phonePattern`). Effect: **LIVE** `POST /access/rules` → mutation result.

**Access checker card** — instance `DropdownMenu`, `platformUserId` `Input`
(e.g. `5511999999999`), `channel` `Input` (defaults `whatsapp-baileys`), `Check`
`Button` (disabled until instance + user). Effect: **READ-ONLY**
`access.check(...)`. Result = live test result named `access.check(<user>)`, status
PASS/FAIL from `allowed`, message = `reason`, evidence = the decision payload.

**Detail** — title=`{ruleType} rule`, status `Badge` on/off, mono id.
`PropertyPanel` fields: `Instance` (`instanceId` or `all`, mono), `Action`,
`Phone pattern` (mono), `Platform user` (mono), `Priority`, `Reason`, `Expires`
(`expiresAt`, mono). Actions: `Enable`/`Disable` `Button` → **LIVE**
`PATCH /access/rules/{id}` (read-back diff); `Delete` `Button` (error) → confirm.

**Delete** — confirm dialog, `Target`=`phonePattern` ?? `ruleType` ?? `rule`,
`ID`=id, effect **LIVE**, `destructive` (type the phrase), label `Delete`.

**Build with:** `PillBadge`, `SectionHeader`, `SectionCard`, `SectionCardHeader`,
`Separator`, `Spinner`, `EmptyState`, `Note`, `Badge`, `Input`, `Toggle`,
`DropdownMenu`, `Button`, `PropertyPanel`, `StatusDot`, `NumberFlow`, `DataRow`,
`Dialog`, `GlassCard`, `Tooltip`.

---

## Screen 3 — Routing `/routing`

**Purpose:** cross-instance view of how messages map to agents — fanned in from
every instance (backend has no global route list), with resolver cache metrics, a
**SYNTHETIC** route-test explainer, and guarded create/toggle/delete blocked on the
two production instances.

**Layout** (single column, stacked):
```
[entry-head]  "Routing" · lede "How messages map to agents, across every instance."   [Refresh Button ▸]
[card "RESOLVER CACHE"]   metric tiles (live, 15s poll)
[card "ALL ROUTES"]       fanned-in table   (right head: "{n} routes")
[card "ROUTE TEST"]       synthetic decision explainer   (head badge: SYNTHETIC)
[card "CREATE ROUTE"]     instance pick → schema form → confirm
```

### Resolver cache (`MetricsPanel`, live, `refetchInterval` 15s)
Six `MetricDisplay` tiles from `data.cache`: `hits` (Hits), `misses` (Misses),
`hitRate` (`Hit rate`, `%`), `cacheSize` (Cache size), `invalidations`
(Invalidations), `lastQueryMs` (`Last query`, `ms`). Attach a **freshness** pill.
Build with: `SectionCard` + `SectionCardHeader` + `MetricDisplay` + `NumberFlow` + freshness.

### All routes (`fanInRoutes` → table)
Columns (`FannedRoute` = `{instanceId, instanceName, route}`, `route` is `AgentRouteRow`):
| col | field | render |
|---|---|---|
| Instance | `instanceName` | semibold + amber `Badge` `prod` when production |
| Scope (80) | `route.scope` | `chat`/`user` |
| Agent (220) | `route.agentId` | mono or `—` |
| Label | `route.label` | text or `—` |
| Prio (60) | `route.priority` (default 0) | tabular |
| Active (70) | `route.isActive` | `yes` / `no` (false→no) |
| (240) | — | two guarded actions ↓ |

Row actions (`ActionButton`, per route):
- `Activate`/`Deactivate` — **LIVE** `patchRoute {isActive}`; on a production instance the `Button` is disabled with `Tooltip` "Production instance — routes are read-only."
- `Delete` — **LIVE** `destructive` `deleteRoute`; confirm dialog description "Delete route `<label|id>`"; same production guard.

### Route test (`RouteTestPanel`) — **SYNTHETIC**, header effect `PillBadge`
No server route-test endpoint exists; this assembles the dispatcher's decision from
real **reads only** (`listRoutes` + `agents.get` + `providers.health` +
`access.check`) and never sends a message.
Inputs (row): instance `DropdownMenu`, `Simulated identity` `Input` (phone/user id,
e.g. `5511999999999`), `Message type` `DropdownMenu`
(`text`\|`image`\|`audio`\|`document`\|`reaction`), `Explain decision` `Button`
(disabled until instance + identity; label → "Explaining…" while running).
Output = verdict `Note` (tone success/warning/error from the worst step) over a
**vertical `StatusDot` step timeline** with a connecting spine (`Separator`-style
line), each step = `StatusDot` (pass=active · warn=away · fail=error+pulse ·
info=idle) + bold label + muted detail:
1. `Access check` — allowed (mode) / denied (reason)
2. `Route match` — winning route `label` (scope, priority) / fallback to default
3. `Agent active` / `Agent binding` — agent name active-or-dropped / no agent
4. `Provider health` — healthy (`latency`ms) / unhealthy (error)
5. `Message type` — relevance note (reactions often dropped; media needs accept)

Footer: mono disclaimer "Synthetic — assembled from real reads … No message was
sent." Errors → `Note` type=error.
Build with: `SectionCard` + `SectionCardHeader` + `PillBadge` + `DropdownMenu` +
`Input` + `Button` + `Note` + `StatusDot` + `Separator`.

### Create route (`CreateRoutePanel`)
Instance `DropdownMenu` first. If a **production** instance is picked → `Note`
"Production instance — attaching routes is prohibited." and the schema form renders
in `preview` (read-only) mode. Otherwise a **schema form** of `createRouteSchema`:
`scope` (enum `chat`\|`user`), `agentId` (Agent UUID, required), `chatId` (opt,
scope=chat), `personId` (opt, scope=user), `label` (opt), `priority` (opt int),
`isActive` (opt bool); submit label `Review route`. After review (non-prod) an
`ActionButton` `Confirm create route` — **LIVE**, target=instance name+id, confirm
description "Attaches this route to the instance." → `createRoute`.

**Build with:** `PillBadge`, `SectionHeader`, `SectionCard`, `SectionCardHeader`,
`MetricDisplay`, `NumberFlow`, `Badge`, `Button`, `DropdownMenu`, `Input`, `Toggle`,
`Note`, `StatusDot`, `Separator`, `Spinner`, `EmptyState`, `Dialog`, `GlassCard`,
`DataRow`, `Tooltip`.

---

## Interaction conventions (carry into all three)

- **Effect labels everywhere.** Every action carries an effect `PillBadge`:
  `READ-ONLY` (checker) · `SYNTHETIC` (route test) · `DRY-RUN` (reserved) · `LIVE`
  (all writes). LIVE writes always route through the confirm dialog; destructive
  LIVE writes (deletes) additionally require typing the target phrase.
- **Proof, not toasts.** After a write, show the mutation result (request line +
  response + read-back diff), not a "saved" toast.
- **Freshness.** Live values (resolver cache) show a `StatusDot` + mono ticking age
  and degrade visibly to amber/red instead of going silent.
- **Honest empty & error.** Empty lists → `EmptyState`; access-rules empty adds the
  "all traffic allowed by default" `Note`. Errors render in place as `Note`
  type=error, never a blank surface.
- **Production guard.** The two production instances show an amber `prod` `Badge`;
  their route create/toggle/delete controls are disabled with a `Tooltip` reason —
  read-only, never mutated from the UI.
- **Redaction.** Any JSON payload renders redacted-by-default; `Show raw` reveals
  for the operator, `Copy redacted` never leaks secrets to the clipboard.
