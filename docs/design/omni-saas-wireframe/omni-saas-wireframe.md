# Omni SaaS — wireframe base (from the shipped khal-ui admin app)

> Source of truth: the working KhalOS app at `omni/apps/khal-ui` (live against Omni v2). Use this as the structural base when prototyping the Omni SaaS; build every screen with the KhalOS Design System components named below.

## App shell (every screen)
Left `SidebarNav` rail 268px (KhalLogo + product name, search `Input`, 6 nav groups below) · content column (header row: global instance/channel scope selector as `DropdownMenu`, backend origin + version + freshness as mono text + `StatusDot`, `ThemeSwitcher`) · bottom `StatusBar` (mono: backend origin · version · route path · "71/268 capabilities live" · ⌘K hint) · `CommandDialog` palette on ⌘K with all routes + "jump to instance/chat" actions · `khal-wallpaper` on the root.

## Navigation (6 groups, 35 routes)
1. **Home**: Overview `/` · Health & Incidents `/health` · Activity `/activity`
2. **Messaging**: Chat `/chat` · Conversations · Persons · Contacts · Groups · Journeys · Voice
3. **Agents & Automation**: Agents · Providers · Automations · Batch Jobs
4. **Channels & Access**: Instances · Webhook Sources · Access Rules · Routing
5. **Operations**: Events · Event Ops · Dead Letters · Logs · Metrics
6. **Configuration**: Settings · Payload Config · TTS Voices · API Keys · Trust Hosts · Media Console · Turns · Context · Handoffs · A2A · API Info · Capabilities (dev)

## Flagship screens

### Overview (dashboard)
Stat tile row: 4 `SectionCard`s with `NumberFlow` values + `MetricDisplay`-style labels (instances active · backend health · events total · inbound/outbound with "N% replied"). Two-column: "INSTANCES" `SectionCard` (rows: pulsing `StatusDot` + name + channel mono, 120ms stagger) and "HEALTH CHECKS" (`DataRow`s: database/nats/plugins → ok). Full-width "RECENT EVENTS" as `LiveFeed` (mono timestamps, type-colored dots). `PillBadge` eyebrow above the h1 on every page (entry-head pattern).

### Live Chat (WhatsApp-web-style, THE flagship)
`SplitPane`: LEFT chat list (instance `DropdownMenu` + search `Input` + archived `Toggle`; `ListView` rows: `Avatar` initials, name + mono time, preview line, unread `PillBadge`, canary/production tags; copper active bar on selection). CENTER thread (day chips mono uppercase; inbound bubbles on surface-raised, outbound copper-tinted; mono timestamps + delivery ticks; media cards; reactions as floating pills; composer: growing `Input` + "+" `DropdownMenu` for media/poll/location/etc + Send `Button`; "poll 2.5s · Xs ago" freshness chip in header). RIGHT collapsible **Agent Lens** panel: "AGENT LENS" `PillBadge` eyebrow, Now/Trace tabs; Now = `StatusDot` state hero + SSE badge + `DataRow` bindings (Agent/Provider/Conversation/Agent id, mono, click-to-copy) + follow-up + access chips (`StatusBadge`); Trace = vertical `StatusDot` step timeline with expandable JSON.

### Instances
List: one `SectionCard` row per instance (pulsing `StatusDot`, `Avatar`, name + phone mono, channel, PROD·READ-ONLY `PillBadge`, copper "Open →"). Detail: hero header (name, state dot, id mono) over tabs: Overview (`MetricDisplay` send/receive proof tiles + `DataRow` status), Config (grouped `SectionCard` sections, form rows, secrets masked), Lifecycle (`Button` rows; destructive = error variant; QR wizard = `GlassCard` stepper with big QR + `StatusDot` state line), Contacts/Groups/Sync/Profile/Routing tabs.

### Agents registry
Hover-lift `SectionCard` grid: `Avatar` glyph, name h3, provider `PillBadge` + model mono, type `Badge`, capability `PillBadge`s (muted), linked-provider health `StatusDot`. Detail: hero + tabs (Overview `DataRow` grid, Identities, Tasks, Follow-up, A2A card JSON, Routes). Route-test panel: verdict `Note` + vertical `StatusDot` step timeline (access → route match → agent active → provider health → verdict), labeled SYNTHETIC.

### Ops screens
Events: analytics `MetricDisplay` tiles + filterable table (mono ids/timestamps). Logs: `LiveFeed` console with level/module filters + follow toggle. Dead Letters: stats tiles + status `Badge` rows + retry/resolve/abandon actions. Settings: prefix-grouped `SectionCard`s of `DataRow`s, secret values masked with lock glyph, per-key history timeline.

## Interaction conventions (carry into the prototype)
- Every mutation confirms via dialog repeating target name + ID + an effect label (`PillBadge`: read-only / synthetic / dry-run / LIVE); destructive requires typing the name.
- Every live value shows freshness (observed-at age, mono) and degrades visibly ("Last known…", stream degraded notice) instead of silently.
- Empty states always `EmptyState` with icon + action; errors render honestly in place (`Note` type=error), never blank.
- Production-scoped entities show a PROD tag and disabled-with-reason controls.
