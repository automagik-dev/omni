# Omni — Agents & Automation (rest) wireframes

> Source of truth: the shipped KhalOS admin app at `omni/apps/khal-ui/package/src/pages/{providers,automations,batch-jobs}`. Covers Providers, Automations, and Batch Jobs (the Agents registry itself lives in the base wireframe). Build every screen from the DS list only; app compositions below map 1:1 to DS primitives.
> Nav group: **Agents & Automation**. All screens carry the `Agents & Automation` `PillBadge` eyebrow (entry-head).

## Shared compositions (referenced per-screen — build once, reuse)

- **Entry-head** (`PageShell`): `PillBadge` eyebrow (dot) → h1 title → lede paragraph; right-aligned `Button` cluster (Refresh + primary "New …"). Wrap in `Toolbar` for the action cluster.
- **Table** (`DataTable`): `SectionCard` (padding none, clip) → mono UPPERCASE tracked header row (`SectionHeader` styling, tertiary, tabular-nums) → data rows (mono cells for ids/timestamps, copper inset bar on hover, row-click nav). States: `Spinner` "Loading…" · empty `EmptyState` (compact, icon) · error `Note` type=error in place · pagination `Button` Prev/Next.
- **Detail frame** (`ResourceDetail`): header = h2 title + status chips + mono id (break-all) + `Button` actions, over a `Separator`, over stacked sections. Each section = `SectionCard` + mono `SectionHeader` + optional description + right actions.
- **Tabs**: `Toolbar` row of ghost `Button` tabs, copper active underline (`aria-selected`).
- **Field grid** (`FieldGrid`): `PropertyPanel` of `DataRow` label→value pairs; `mono` for ids/timestamps; booleans render `yes/no`, arrays comma-joined, objects `{ N keys }`, null `—`.
- **Effect label** (`EffectBadge`): dot-colored `PillBadge` — `READ-ONLY` (gray) · `SYNTHETIC` (blue) · `DRY-RUN` (amber) · `LIVE` (red). Only `LIVE`/`destructive` gates a typed phrase.
- **Confirm gate** (`ConfirmDialog`): `Dialog` → raised `GlassCard` body: effect `PillBadge` + one-line effect description, an inset block of `DataRow` `Target`=name and `DataRow` `ID`=id (mono, tertiary), the action description, and — for destructive/live — an `Input` "type `<name>` to confirm" (border goes green on match). `Button` Cancel / Confirm (disabled until phrase matches).
- **Guarded action** (`ActionButton`): a `Button` that runs immediately for read-only effects, or opens the confirm gate for mutating effects; `disabledReason` → disabled `Button` + `Tooltip`. Renders its outcome as an evidence card below.
- **Evidence card** (`LiveTestResult`): left color-bar `SectionCard` — `StatusDot` (PASS online / FAIL error / RUNNING working, pulse while running) + name + latency `NumberFlow`+`ms` + effect `PillBadge` + message + evidence JSON block.
- **Mutation result** (`MutationResult`): inset `SectionCard` + effect `PillBadge` + Request (mono `METHOD path` + JSON) + Response JSON + Read-back diff (`DataRow` per changed field: `before → after`, "N changed" counter).
- **JSON block** (`JsonInspector`): mono, collapsible, **secrets redacted server-side by default**, in a `SectionCard`. Editor variant (`JsonEditor`): multiline `Input` + valid/invalid `PillBadge` + inline `Note` on parse error.
- **Schema form** (`SchemaForm`): renders a Zod schema — string/number → `Input`, boolean → `Toggle`, enum → `DropdownMenu`, arrays/nested inline; inline `Note` errors; `Button` submit. Read-only preview mode disables all controls.

## Interaction conventions (carry into every screen)
- Every mutation routes through the confirm gate repeating target **name + ID** + effect `PillBadge`; destructive/LIVE requires typing the name.
- Live values show **freshness** (mono observed-at, `StatusDot` pulse while polling) and degrade honestly — discovery that isn't supported returns an explanatory `Note`, never a fake error.
- Empty → `EmptyState`; error → `Note` type=error in place, never blank.
- Production / paid / irreversible actions carry a standing `Note` warning and disabled-with-reason controls (`Tooltip`).

---

## Providers list — `/providers`
Purpose: the agent backends Omni dispatches to — a live table with a gated create; rows open the detail.

Layout: entry-head ("Providers" / "Agent provider configuration, health, and discovery.") over a full-width Table.

Columns (real fields): `name` (bold) · `schema` (`PillBadge`: `agno`/`webhook`/`openclaw`/`ag-ui`/`claude-code`/`a2a`/`nats-genie`) · `baseUrl` (mono) · Capabilities (`PillBadge` chips derived from `supportsStreaming`→stream, `supportsImages`→images, `supportsAudio`→audio, `supportsDocuments`→docs; `—` if none) · Status (`StatusBadge` green `active` / gray `inactive`, from `isActive`) · `id` (mono, 220w).

Actions: `Refresh` (read-only) · `New provider` → create dialog · row-click → `/providers/:id`.

Build with: `PillBadge` `Button` `Toolbar` `SectionCard` `SectionHeader` `StatusBadge` `Spinner` `EmptyState` `Note` `Icons`.

### New provider dialog
`Dialog` "New provider" → `SchemaForm` (`providerCreateSchema`): `name` · `schema` (enum, default `agno`) · `baseUrl` (url) · `apiKey` (optional, "stored encrypted") · `defaultStream` (bool, true) · `defaultTimeout` (int seconds, 600) · `supportsStreaming`/`supportsImages`/`supportsAudio`/`supportsDocuments` (bools) · `tags` (array) · `description`. Plus a JSON editor `schemaConfig` ("agno: `{ agentId }`, claude-code: `{ projectPath }`, …"). Submit "Review & create" → confirm gate **LIVE** ("Creates a new agent provider record."). `MutationResult` on success, then navigates to detail.

Build with: `Dialog` `Input` `DropdownMenu` `Toggle` `Button` `Note` `PillBadge` `GlassCard` `DataRow` `SectionCard`.

## Provider detail — `/providers/:id`
Purpose: identity + schema + active state + gated delete over config/health, live discovery, and linked agents.

Layout: detail frame — title `provider.name`, status = `schema` `PillBadge` + active `StatusBadge`, subtitle `baseUrl`, mono `id`. Header actions: `Back` · `Refresh` · **Delete provider** (`LIVE`, destructive, typed-phrase; "Permanently deletes this provider. Agents linked to it will lose their backend."). Tabs: Overview / Discovery / Linked agents. Loading → `Spinner`; not-found/error → `Note` type=error + Back.

**Overview tab**
- Health section: "Check health" guarded action, effect **READ-ONLY** ("reports reachability and latency, changes nothing", `POST /providers/:id/health`) → evidence card with latency + status.
- Configuration section (`FieldGrid`): `name` · `schema` (`PillBadge`) · `baseUrl` (mono) · `apiKey` (mono, **masked from API**) · `defaultTimeout` (`Ns`) · `defaultStream` · Capabilities (`PillBadge` chips) · `tags` · Active (`StatusBadge`) · `description` · `createdAt` (mono). `schemaConfig` JSON block ("sensitive keys redacted server-side"). "Edit" toggles an inline `SchemaForm` (`providerEditSchema`, partial; "Only changed fields are sent. Leave API key blank to keep it.") + `schemaConfig` editor → confirm gate **LIVE** "Update provider" → `MutationResult` with read-back diff.

**Discovery tab** (read-only): only `agno` supports live discovery; other schemas return `{ items: [], message }` rendered as an explanatory `Note` (surface stays honest). A banner `Note` names the schema when discovery is off. Three sections — **Agents / Teams / Workflows** — each: count, `Spinner` while loading, error `Note`, message `Note`, items JSON block, or "None discovered."

**Linked agents tab** (read-only): Table of registry agents where `agentProviderId === provider.id`. Columns: `name` (bold) · Type (`agentType`) · `model` · Status (`StatusBadge` from `isActive`) · `id` (mono). Row-click → `/agents/:id`. Empty: "No agents link to this provider".

Build with: `SectionCard` `SectionHeader` `Toolbar` `Button` `PillBadge` `StatusBadge` `DataRow` `PropertyPanel` `GlassCard` `Dialog` `Input` `DropdownMenu` `Toggle` `Note` `StatusDot` `NumberFlow` `Spinner` `EmptyState` `Separator` `Tooltip`.

---

## Automations list — `/automations`
Purpose: event-driven workflows read as IF/THEN cards with a gated enable toggle, over engine metrics + the global execution log — config and live behaviour on one screen.

Layout: entry-head ("Automations" / "Event-driven workflows — triggers, conditions, and actions.") → stacked automation cards (50ms fade-up stagger) → Engine metrics section → Recent executions section. Empty → `SectionCard` + `EmptyState` ("No automations", "New automation" action). Loading → `Spinner`. List error → `Note`.

**Automation card** (`SectionCard`, hover-lift, click → `/automations/:id`): row = `name` (650) · `prio N` `PillBadge` (`priority`, muted) · on/off mono label + `Toggle` (`enabled`; the toggle stops propagation so flipping never navigates). Body = `DataRow` tag `IF` → `triggerEventType`; `DataRow` tag `THEN` (blue) → "N action(s)" (`actions.length`). Toggle → confirm gate **LIVE** (enable: "This automation will fire on matching events." / disable: "Stops this automation from firing.").

**Engine metrics** (`ext.automations.metrics`, poll 15s): running `StatusBadge` (green `running` / gray `stopped`) + `MetricDisplay` tiles — `totalExecutions` Executions · `totalActions` Actions · `successRate`% Success rate · `avgExecutionTimeMs`ms Avg time · `recentFailures` Recent failures (warn accent when >0) · `instanceQueues.length` Instance queues.

**Recent executions (all automations)** (limit 25): Table — `createdAt` When (mono) · `automationId` Automation (mono) · `status` Status (`StatusBadge`: `success` green / `failed` amber / `skipped` gray) · `executionTimeMs` Time (`ms`) · `error` Error. `Refresh`.

Header actions: `Refresh` · `New automation`.

Build with: `PillBadge` `Button` `Toolbar` `SectionCard` `SectionHeader` `DataRow` `Toggle` `StatusBadge` `MetricDisplay` `NumberFlow` `Dialog` `GlassCard` `Input` `Spinner` `EmptyState` `Note` `Icons`.

### New automation dialog
`Dialog` "New automation" → automation builder (below) → confirm gate **LIVE** (enabled draft: "Creates the automation ENABLED — it will fire on matching events." / else "Creates the automation disabled."). `MutationResult` on success.

## Automation detail — `/automations/:id`
Purpose: identity + enabled state + gated delete over config, a validated builder, a test/execute run panel, and this automation's logs.

Layout: detail frame — title `name`, status `StatusBadge` (green `enabled` / gray `disabled`), subtitle `triggerEventType`, mono `id`. Header actions: `Back` · **Enable/Disable** (`LIVE`) · **Delete** (`LIVE`, destructive, "Permanently deletes this automation."). Tabs: Overview / Edit / Test / Execute / Logs.

**Overview tab**: Definition `FieldGrid` — `name` · `triggerEventType` Trigger (mono) · `conditionLogic` (`and`) · `triggerConditions.length` Conditions · `actions.length` Actions · `enabled` · `priority` · `description` · `createdAt` (mono). Actions section = `actions` JSON block. Conditions & debounce section (when present) = `triggerConditions` + `debounce` JSON blocks.

**Edit tab (builder)** (`AutomationEditor`): scalar `SchemaForm` (`name`, `description`, `triggerEventType`, `conditionLogic` enum `and`/`or`, `enabled` toggle, `priority` int) + three JSON editors — `actions` (array of `log`/`call_agent`/`send_message`/`emit_event`/`webhook`, required; template = a no-op `log`) · `triggerConditions` (array of `{ field, operator, value }`; operators `eq`/`neq`/`gt`/`lt`/`gte`/`lte`/`contains`/`not_contains`/`exists`/`not_exists`/`regex`) · `debounce` (`{ mode: none|fixed|range|presence, … }`). **"Validate (client)"** → evidence card effect **READ-ONLY** (real client-side Zod parse of the assembled body; PASS "Body is valid." or FAIL with per-issue list `path: message`). "Review changes" → confirm gate **LIVE** "Update automation" ("Only sends the parts you touch") → `MutationResult` `PATCH /automations/:id` before/after diff.

**Run tab (Test / Execute)** — two paths separated by blast radius:
- Sample event section: `JsonEditor` `event` seeded from the trigger type (`{ type, payload: { content, chatId, instanceId } }`).
- **Test (dry-run)** section: "Run test" guarded action, effect **SYNTHETIC** → `POST /automations/:id/test` — evaluates conditions and reports which actions **would** run, executes nothing → evidence card. `disabledReason` "Fix the event JSON first" when invalid.
- **Execute (live)** section: standing `Note` type=error warning ("Execute is a LIVE action with real side effects. There is no dry-run safety net — only run it when you intend the actions to happen. Confirm by typing the automation name."). "Execute now" guarded action, effect **LIVE**, destructive → `POST /automations/:id/execute` (runs every action for real — may send messages, call agents, hit webhooks). Caption: "always warn; this backend exposes no disposable flag, so execution is treated as production-affecting."

**Logs tab** (read-only, limit 50): Table — `createdAt` When (mono) · `status` Status (`StatusBadge`) · `conditionsMatched` Matched (`yes`/`no`) · `executionTimeMs` Time (`ms`) · `error` Error. `Refresh`. Empty: "No executions logged".

Build with: `SectionCard` `SectionHeader` `Toolbar` `Button` `StatusBadge` `PillBadge` `DataRow` `PropertyPanel` `Input` `DropdownMenu` `Toggle` `Note` `Dialog` `GlassCard` `StatusDot` `NumberFlow` `Spinner` `EmptyState` `Separator` `Tooltip`.

---

## Batch Jobs list — `/batch-jobs`
Purpose: historical media processing (transcription / extraction / re-download) — a live table that polls while any job is active, with an estimate→create wizard.

Layout: entry-head ("Batch Jobs" / "Transcription and extraction batches over historical media.") over a full-width Table (poll 5s). When any row is `pending`/`running`: header shows `StatusDot` state=live pulse + mono "polling". Header actions: `Refresh` · `New job`.

Columns (real fields): `jobType` Type (`targeted_chat_sync`/`time_based_batch`/`media_redownload`) · `status` Status (`StatusBadge`: `completed` green / `running` blue / `pending` gray / `failed` amber / `cancelled` gray) · Progress (`ProgressBar` value=`progressPercent`, warn color when `failedItems`; mono caption `processedItems/totalItems · N failed · pct%`) · Cost (`CostCounter` from `totalCostUsd`, `$0.0000` under $1 else `$0.00`) · `instanceId` Instance (mono) · `createdAt` Created (mono). Row-click → `/batch-jobs/:id`. Empty: "No batch jobs".

Build with: `PillBadge` `Button` `Toolbar` `SectionCard` `SectionHeader` `StatusBadge` `ProgressBar` `CostCounter` `StatusDot` `Spinner` `EmptyState` `Note` `Icons`.

### New batch job wizard
`Dialog` "New batch job" → `SchemaForm` (`batchJobSchema`): `jobType` (enum) · `instanceId` (uuid) · `chatId` (required for `targeted_chat_sync`) · `daysBack` (int, required for `time_based_batch`/`media_redownload`) · `limit` (int) · `contentTypes` (multi: `audio`/`image`/`video`/`document`, default all) · `force` (bool, "re-process items that already have content"). Type-specific requirements validated inline → `Note`.

Flow (blast radius stepped): **"Estimate cost"** → read-only estimate → evidence card effect **READ-ONLY** ("~N items · $cost", `estimatedCostUsd`/`totalItems` evidence). Then a **LIVE** `Note` warning ("Creating the job starts background media processing that consumes tokens and costs money. This is not a dry run.") + job-body JSON block + a danger `Button` "Create job (live, costs money)" → confirm gate **LIVE**, destructive, typed-phrase (target = `jobType`, id = `instanceId`; "Starts a live, paid batch-processing job."). Create is disabled until an estimate has been fetched — nobody kicks off a paid job blind.

Build with: `Dialog` `Input` `DropdownMenu` `Toggle` `Button` `Note` `CostCounter` `StatusDot` `NumberFlow` `PillBadge` `GlassCard` `DataRow` `SectionCard`.

## Batch Job detail — `/batch-jobs/:id`
Purpose: the full record + per-item errors + a gated cancel; polls the lightweight status endpoint while active.

Layout: detail frame — title `jobType`, status `StatusBadge`, subtitle `instance {instanceId}`, mono `id`. Live status (`ext.batchJobs.status`) polls every 3s while active and merges over the record. Header actions: `Back` · `Refresh` · **Cancel job** (`LIVE`, destructive, "Gracefully stops this job after the current item."; `disabledReason` "Only running/pending jobs can be cancelled" + `Tooltip` when not active).

- Progress section (`SectionCard`, description "Live · polling every 3s." / "Final."): `ProgressBar` value=`progressPercent` (warn color when `failedItems`>0) + `MetricDisplay` tiles — `processedItems` Processed · `totalItems` Total · `failedItems` Failed (warn) · `skippedItems` Skipped · `progressPercent`% Progress · `totalCostUsd` Cost (`CostCounter`) · `totalTokens` Tokens.
- Record section (`FieldGrid`): `jobType` Type · `instanceId` Instance (mono) · `status` · `currentItem` Current item (mono) · `createdAt` (mono) · `startedAt` Started (mono) · `completedAt` Completed (mono) · `errorMessage` Error.
- Request params section (when present): `requestParams` JSON block.
- Item errors section (when present, count in header): `errors` JSON block.

Loading → `Spinner`; not-found/error → `Note` + Back.

Build with: `SectionCard` `SectionHeader` `Toolbar` `Button` `StatusBadge` `ProgressBar` `MetricDisplay` `CostCounter` `NumberFlow` `DataRow` `PropertyPanel` `StatusDot` `Note` `Spinner` `Tooltip` `GlassCard` `Dialog` `Input` `Separator`.
