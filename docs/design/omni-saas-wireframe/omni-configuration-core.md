# Omni — Configuration core screens

> Source of truth: shipped khal-ui admin app, `omni/apps/khal-ui/package/src/pages/resources/`. Four routes under the **Configuration** nav group: `/settings`, `/payload-config`, `/tts-voices`, `/api-keys`. Build every screen from the KhalOS DS components named in each `Build with:` line — nothing else.

## App compositions (defined once, reused below)

These are APP patterns, not DS primitives. Each is a composition of DS components; screens reference them by name.

- **Entry-head** (every page top): `PillBadge` eyebrow (`variant=muted`, dot, = the section name "Configuration") over a tight display `h1`, a ≤60ch lede, and a right-aligned actions row. → `PillBadge` + `Button`.
- **Table** (server-driven list; never sorts/slices locally): `SectionCard` (`padding=none`) wrapping a `<table>` with a quiet **mono uppercase** header row (`SectionCardHeader` treatment: 10.5px, `0.1em` tracking, tertiary) and hairline-ruled rows with a copper inset bar on hover. Three states baked in: loading → `Spinner` + "Loading…"; error → `Note type=error` in place (never blank); empty → `EmptyState` (compact, icon + title). Optional `Toolbar` above for filters; `Button` Prev/Next when paginated. → `SectionCard` + `SectionCardHeader` + `Spinner` + `Note` + `EmptyState` + `Toolbar` + `Button`.
- **Detail** (single resource, opens below the table on row-click): header = `h2` title + status `Badge`/`StatusBadge` + mono `id` handle + actions `Button`s, ruled off by `Separator`, over a stack of `SectionCard` sections each fronted by a mono uppercase `SectionHeader`. → `SectionCard` + `SectionHeader` + `Separator` + `Badge` + `Button`.
- **Field list** (read-only key/value block inside a detail section): mono, tabular, hairline-ruled rows. → `PropertyPanel` composed of `DataRow`s.
- **Confirm gate** (before any mutation): `Dialog` → raised `GlassCard` body showing, read-only, **what** (`DataRow` Target name + `DataRow` ID) and **how hard** it hits (effect `PillBadge` + its one-line description via `Tooltip`). Destructive/LIVE actions additionally require typing the target's phrase into an `Input` (border turns ok-green when satisfied) before Confirm enables. → `Dialog` + `GlassCard` + `DataRow` + `PillBadge` + `Input` + `Tooltip` + `Button`.
- **Mutation result / read-back proof** (shown after every write — proof, not a toast): inset `SectionCard` (border turns danger on error) with effect `PillBadge`, a mono `METHOD path` request line, the raw response and a field-level **read-back diff** rendered as mono `DataRow`s (`before → after`, "N changed"). Payloads render through the **JSON inspector** so secrets stay masked. → `SectionCard` + `PillBadge` + `DataRow`.
- **JSON inspector** (redacted-by-default collapsible mono tree): `GlassCard`/`SectionCard` surface with a `Toolbar` chrome header ("JSON (redacted)" label + `Button` Show-raw / `Button` Copy-redacted). Credential-looking keys masked; copy always emits the redacted form. → `GlassCard` + `Toolbar` + `Button`.
- **Schema form** (Zod-driven create/edit): `.k-fieldset` surfaces of label/control rows — `Input` for string/number, `Toggle` for boolean, `DropdownMenu` for enum — with declared defaults, inline errors, required `*`, and a submit `Button`. → `Input` + `Toggle` + `DropdownMenu` + `Button`.
- **Stat tiles**: responsive grid of `SectionCard`s each holding a `MetricDisplay` (mono tabular value via `NumberFlow` + quiet label). → `SectionCard` + `MetricDisplay` + `NumberFlow`.
- **Freshness chip** (any live value): `StatusDot` (pulses when live, amber when stale/degraded) + mono source + live-ticking age; observed-at timestamp in a `Tooltip`. → `StatusDot` + `Tooltip`.

### Effect vocabulary (every action declares its blast radius)

Effect `PillBadge` with a colored dot: `READ-ONLY` (gray) · `SYNTHETIC` (blue) · `DRY-RUN` (amber) · `LIVE` (red). Only `LIVE` mutates real state and gates a typed-phrase confirm. **All four screens here are LIVE surfaces** — every write is against production. Reads (refresh, list, filter, preview) are READ-ONLY.

### Interaction conventions (carry into all four)

Honest errors render in place (`Note type=error`), never a blank panel. Empty → `EmptyState` with icon. Live values show freshness and degrade visibly. PROD-scoped entities carry a PROD tag and disabled-with-reason controls. Destructive = typed-phrase confirm; the phrase is the target's own name/key.

---

## `/settings` — Settings

**Purpose:** grouped key/value platform config; per-key edit (PUT + read-back), change-history timeline, restore, and typed-phrase delete. Secrets arrive masked and are never echoed.

**Layout:** Entry-head (eyebrow `Configuration`, title `Settings`, lede "…Secrets are masked; history values are redacted by the API.", `Refresh` `Button`). Below: one **titled group card per key-prefix** (`groupOf(key)` = leading `prefix.`/`prefix_` segment, else `general`), each a `SectionHeader` title over a **Table**. Row-click opens the **Detail** card at the bottom.

```
┌ [Configuration] ─────────────────────────────── [Refresh] ┐
│ Settings                                                   │
│ Platform settings, grouped by prefix…                      │
├────────────────────────────────────────────────────────────┤
│ ELEVENLABS                                                 │  ← group card (SectionHeader + Table)
│  KEY               VALUE        TYPE    DEFAULT             │  ← mono header row
│  elevenlabs.api_key 🔒 ••••••••  secret  —                  │  ← secret = lock glyph
│  elevenlabs.default_voice  Rachel  string  —               │
│ ─────────────────────────────────────────────────────────  │
│ WHATSAPP  · SYSTEM · GENERAL …                             │  ← more group cards
├──────── selected key detail (on row-click) ───────────────┤
│ elevenlabs.api_key            [secret]        [Delete key] │  ← Detail header
│ Fields:  Type · Category · Description · Default · Current │
│ Edit value  [ input………… ] [Save]  →  read-back diff       │
│ History (n)   [Restore a value…]                          │
│   ● 12:04  genie  · edit    "new-value"                   │  ← StatusDot timeline, head pulses
│   ○ 11:50  system · restore "(redacted)"                  │
└────────────────────────────────────────────────────────────┘
```

**Data — group table columns:** `key` (mono, semibold) · `value` (mono; secrets → lock `Icons` glyph + `••••••••`) · `valueType` (`PillBadge sm`) · `defaultValue` (mono, `—` when undefined).
**Detail header:** `title=key`, mono `id=key`, `Badge variant=amber` "secret" when `isSecret`.
**Detail — Fields** (`PropertyPanel`): `valueType` · `category` · `description` · `defaultValue` · Current (secrets masked in-cell: lock `Icons` glyph + `••••••••`; else raw value) · `updatedAt`.
**Detail — History** (`SettingHistoryRow[]`, newest-first vertical `StatusDot` timeline, head node pulses): mono `changedAt` · `changedBy` · `· changeReason` · `newValue` (API-redacted → `(redacted)`). Separated by hairline rules (`Separator`).

**Actions:**
- `Refresh` — re-list. **READ-ONLY**.
- Row click — select key into detail.
- **Edit value** section → `Input` + `Save` `Button`. PUT `/settings/:key` then re-reads to prove the write; JSON auto-detected (`coerceValue`). Result via **Mutation result**. **LIVE**. Guard: a secret with an empty edit field is blocked ("a secret can't be overwritten with an empty string").
- **Restore a value…** — Confirm gate with an inline `Input` for the value to re-apply (history values are redacted, so restore PUTs a value the operator supplies). PUT `/settings/:key`. **LIVE**. Same empty-secret guard disables Confirm.
- **Delete key** — Confirm gate, **destructive**, phrase = the key. Removes the setting entirely. **LIVE**.

**Build with:** `PillBadge`, `Button`, `SectionCard`, `SectionCardHeader`, `SectionHeader`, `Spinner`, `Note`, `EmptyState`, `Badge`, `Icons`, `PropertyPanel`, `DataRow`, `StatusDot`, `Separator`, `Input`, `Dialog`, `GlassCard`, `Tooltip`.

---

## `/payload-config` — Payload Config

**Purpose:** per-event-type control over which pipeline payload stages are stored and for how long; storage stats up top, the `*` row is the default.

**Layout:** Entry-head (eyebrow `Configuration`, title `Payload Config`). **Stat tiles** (3, `min=150`). A **Table** of configs. Row-click opens a **Detail** card with a **Schema form** editor + read-back. If zero overrides, a `Note type=default`: "No per-event overrides configured — the default (`*`) applies to everything."

```
┌ [Configuration]  Payload Config ──────────────────────────┐
│ ┌ Payloads stored ┐ ┌ Compressed size ┐ ┌ Avg compression ┐│  ← 3 stat tiles (MetricDisplay)
│ │   12,480        │ │   48.3 MB       │ │   3.14x         ││
│ └─────────────────┘ └─────────────────┘ └─────────────────┘│
├────────────────────────────────────────────────────────────┤
│ EVENT TYPE          STORED STAGES              RETENTION    │  ← Table
│ * (default)         raw · req · resp · send · err   14d     │
│ message.received    raw · resp                       7d     │
├──────── selected detail (on row-click) ───────────────────┤
│ message.received                                           │  ← Detail header
│ Storage config:                                            │
│   [x] storeWebhookRaw   [x] storeAgentRequest             │  ← Toggles (Schema form)
│   [x] storeAgentResponse [ ] storeChannelSend [x] storeError│
│   retentionDays [ 14 ]                    [Save config]     │
│   → read-back diff                                         │
└────────────────────────────────────────────────────────────┘
```

**Data — stat tiles** (`payloadConfig.stats()` → `s`): `Payloads stored` = `totalPayloads` · `Compressed size` = `fmtBytes(totalSizeCompressed)` · `Avg compression` = `avgCompressionRatio.toFixed(2)x` (`—` when null).
**Table columns:** `eventType` (mono, semibold; `*` renders `* (default)`) · `Stored stages` (joined from booleans: `storeWebhookRaw`→`raw`, `storeAgentRequest`→`req`, `storeAgentResponse`→`resp`, `storeChannelSend`→`send`, `storeError`→`err`; `·`-joined or `—`) · `Retention` = `retentionDays`+`d`, right-aligned.
**Detail — Schema form** (`cfgSchema`) `Toggle` per stage: `storeWebhookRaw`, `storeAgentRequest`, `storeAgentResponse`, `storeChannelSend`, `storeError` (defaults true) + `retentionDays` number `Input` (default 14, described "Days to retain").

**Actions:**
- Row click — select config.
- **Save config** (`Button`) — PUT `/payload-config/:eventType` with the form body, then re-lists for read-back. Result via **Mutation result**. **LIVE**. No destructive actions on this screen.

**Build with:** `PillBadge`, `SectionCard`, `MetricDisplay`, `NumberFlow`, `SectionCardHeader`, `SectionHeader`, `Spinner`, `Note`, `EmptyState`, `Toggle`, `Input`, `Button`, `DataRow`.

---

## `/tts-voices` — TTS Voices

**Purpose:** synthesis voice catalog (`GET /messages/tts/voices`) as a hover-lift card grid, plus set the platform default (`elevenlabs.default_voice`). The catalog endpoint is known to 500/400 on this backend; that error is surfaced prominently, not blanked.

**Layout:** Entry-head (eyebrow `Configuration`, title `TTS Voices`, lede "Synthesis voice catalog and platform default."). **Platform-default `SectionCard`** first: `SectionHeader` "Platform default", current-default `code` value (or `(unset)`), mono voice count, and a read-back **Mutation result** after a set. Then, on catalog error, a prominent `Note type=error` (label `GET /messages/tts/voices · error`) explaining the default can still be set by id; loading → mono "Loading catalog…". Then the **voice card grid** (`auto-fit, minmax(280px, 1fr)`). Empty catalog → `Note type=default` label "Empty catalog".

```
┌ [Configuration]  TTS Voices ──────────────────────────────┐
│ PLATFORM DEFAULT                                           │  ← SectionCard
│ Current default: `Rachel`      24 voices                   │
│ (→ read-back Mutation result after a set)                  │
├────────────────────────────────────────────────────────────┤
│ ⚠ GET /messages/tts/voices · error   (surfaced, not blank) │  ← Note type=error when endpoint 500s
├──────── voice card grid (auto-fit minmax 280px) ──────────┤
│ ┌ Rachel        ● default ┐ ┌ Adam                       ┐│  ← hover-lift SectionCards
│ │ 21m00…voiceId           │ │ pNInz…voiceId              ││  ← mono id
│ │ [narration][calm]       │ │ [narration]                ││  ← PillBadge labels
│ │ [Preview] [Current dflt]│ │ [Preview] [Set default]    ││
│ └─────────────────────────┘ └────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

**Data — per voice card** (`Voice`, keys resolved best-effort): name (`name`/`voiceName`/`label`/id) as `h3`; id (`voiceId`/`id`/`voice_id`/`name`) mono; label chips (`category` + string values under `labels`, deduped, max 4) as `PillBadge sm muted`; preview URL (`previewUrl`/`preview_url`/`sampleUrl`/`sample`). Current default → `StatusDot state=active pulse` + `Badge variant=green` "default".

**Actions:**
- **Preview / Hide preview** (`Button`, only when a preview URL exists) — toggles an inline `<audio controls>` clip. **READ-ONLY**.
- **Set default** (`Button`, disabled when already default → "Current default") — PUT `/settings/elevenlabs.default_voice` = voice id, then re-reads the key. Result via **Mutation result**. **LIVE**. Still usable by id even when the catalog itself errors.

**Build with:** `PillBadge`, `SectionCard`, `SectionHeader`, `Note`, `Spinner`, `StatusDot`, `Badge`, `Button`, `DataRow`.

---

## `/api-keys` — API Keys

**Purpose:** API-key management — status-filtered list, create (raw key shown **once**), inline detail with per-key audit log, revoke, delete. The `admin` profile is refused server-side; that refusal is surfaced honestly.

**Layout:** Entry-head (eyebrow `Configuration`, title `API Keys`, lede "Key management, scopes, and per-key audit."). A **Table** with a status-filter **Toolbar**. A **Create key** `SectionHeader` card. On row-click, a **Detail** card with Fields + audit sub-table + revoke read-back.

```
┌ [Configuration]  API Keys ────────────────────────────────┐
│ Status [ all ▾ ]                                          │  ← Toolbar (DropdownMenu)
│ NAME        PREFIX    STATUS   SCOPES          LAST USED   │  ← Table
│ scout-bot   omni_ak…  [active] metrics:read…   2m ago      │  ← StatusBadge
│ old-key     omni_ak…  [revoked] …              14d ago     │
├──────── CREATE KEY ───────────────────────────────────────┤
│ ⚠ LIVE  raw key shown once, never again; admin refused     │  ← Note type=warning
│ [name][scopes,…][profile ▾][instanceIds,…]      [Create]   │
│ ✓ Copy this key now:  omni_ak_9f3…                         │  ← Note type=success, copy-once
├──────── selected key detail (on row-click) ───────────────┤
│ scout-bot                 [active]    [Revoke] [Delete]    │  ← Detail header
│ Fields: Prefix·Profile·Scopes·Instances·Usage·Expires·Created│
│ Audit (n):  WHEN   METHOD  PATH            CODE            │  ← sub-Table
└────────────────────────────────────────────────────────────┘
```

**Data — table columns:** `name` (semibold) · `keyPrefix` (mono, `—`) · `status` (`StatusBadge`: green when `active`, gray otherwise) · `scopes` (first 3, `…` overflow) · `lastUsedAt` (mono).
**Filter toolbar:** Status `DropdownMenu` — `all` / `active` / `revoked` / `expired`.
**Create form** (row of `Input`s + `DropdownMenu`): `name` · `scopes` (comma-sep, ignored when a profile is chosen) · `profile` `DropdownMenu` (`(scopes)` / `cs` / `personal` / `scout` / `coworker` / `admin`) · `instanceIds` (comma-sep) · `Create` `Button` (disabled until `name`). Above it a `Note type=warning` label `LIVE`: "The raw key is shown once here and never again. The `admin` profile is refused server-side."
**Create response:** `plainTextKey` in a `Note type=success` label "Copy this key now" (mono, break-all) — never re-fetchable — plus **Mutation result** for `POST /keys`.
**Detail — Fields** (`PropertyPanel`): `keyPrefix` · `profile` · `scopes` (joined) · `instanceIds` (joined, or `all`) · `usageCount` · `expiresAt` · `createdAt`. Header status via `StatusBadge`.
**Detail — Audit** (`ApiKeyAuditRow[]`, sub-**Table**): `timestamp` (mono) · `method` (mono) · `path` (mono) · `statusCode` (right-aligned).

**Actions:**
- Status filter — re-lists. **READ-ONLY**.
- **Create** — POST `/keys` (scopes[] OR profile, + instanceIds[]). **LIVE**. `admin` profile → honest server refusal in the result.
- **Revoke** — Confirm gate, **destructive**, phrase = key name; disabled unless `status==='active'`. "Disables this key immediately. Existing sessions using it will start failing." Read-back proves the status flip. **LIVE**.
- **Delete** — Confirm gate, **destructive**, phrase = key name. "Permanently removes this key and its audit trail." **LIVE**.

**Build with:** `PillBadge`, `Button`, `SectionCard`, `SectionCardHeader`, `SectionHeader`, `Spinner`, `Note`, `EmptyState`, `Toolbar`, `DropdownMenu`, `Input`, `StatusBadge`, `Badge`, `PropertyPanel`, `DataRow`, `Dialog`, `GlassCard`, `Tooltip`.
