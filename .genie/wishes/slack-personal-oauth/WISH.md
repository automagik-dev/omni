# Wish: Slack personal integration via native OAuth

| Field | Value |
|-------|-------|
| **Status** | IN_PROGRESS |
| **Slug** | `slack-personal-oauth` |
| **Date** | 2026-09-21 |
| **Author** | Felipe Rosa |
| **Appetite** | large |
| **Branch** | `wish/slack-personal-oauth` |
| **Repos touched** | omni (`packages/core`, `packages/channel-sdk`, `packages/db`, `packages/api`, `packages/channel-slack`, `packages/sdk`, `packages/cli`, `apps/khal-ui`, `docs`) |
| **Design** | [DESIGN.md](../../brainstorms/slack-personal-oauth/DESIGN.md) |

## Summary

Replace the manual Slack setup (hand-create an app from a generated manifest, paste
`xoxb` + `xapp` + `xoxp`) with a native Slack OAuth v2 install flow: the operator
registers one Slack app per deployment once, and every team member connects a personal
(user-mode) instance with one click, the way "Claude in Slack" does. The plugin moves
from one Bolt app per instance to one shared receiver per Slack app with per-event
authorization and multi-user fan-out, which is what makes several personal instances
on one app possible at all. Design reviewed SHIP on 2026-09-21 (digest `1f74a12e`).

## Scope

### IN

- Additive schema: `instances.slack_team_id`, `slack_user_id`, `slack_connection_method`
  with a lookup index; hand-written migration `0078` + journal entry.
- `instance.connected` carries optional `teamId` / `actingUserId` end to end: core
  payload, channel-SDK metadata type, base-plugin emit, API event listener write.
- Deployment Slack app credentials as registered settings with env fallback
  (`slack.app.client_id`, `slack.app.client_secret`, `slack.app.signing_secret`,
  `slack.app.app_token`, `server.public_url`), sealed by the settings registry.
- Manifest generator: `oauth_config.redirect_urls`, revocation events, exported
  authorize scope lists.
- Shared receiver registry in `@omni/channel-slack`: one Bolt `App` per Slack app
  (built with `authorize`, no `token`), instance attachments, single-attachment fast
  path, full fan-out via `authorizations` + `apps.event.authorizations.list`,
  `tokens_revoked` / `app_uninstalled` handling, narrowed #1185 guard (second
  bot-mode attachment per workspace).
- API: `GET /slack/app`, `POST /slack/oauth/start`, auth-exempt `public-by-contract`
  `GET /slack/oauth/callback` (rate-limited, tenant from a server-side pending record,
  nonce-only redirect), `GET /slack/oauth/result/:nonce`; instance upsert by
  (workspace, user); OpenAPI registration; route-ownership and scope declarations;
  SDK client methods and regenerated types.
- CLI: `omni slack app setup`, `omni slack app status`, `omni slack connect`.
- UI (`apps/khal-ui`): "Connect Slack" button on the instances page, Slack app settings
  card with configured/missing state and the manifest link.
- Docs: `docs/channels/slack.md` leads with the one-click path; endpoint reference;
  migration note for `SLACK_APP_TOKEN_IN_USE` callers.
- End-to-end API test against a stubbed Slack, and the full repository gate green.

### OUT

- Browser-session emulation with `xoxc`/`xoxd` cookie tokens.
- An Omni-hosted official Slack app or OAuth relay.
- HTTP Events API as the transport for OAuth installs (manual HTTP-mode instances keep
  working as today).
- Token rotation, a tunnel/ngrok helper, Enterprise Grid (org-wide) installs (rejected
  with `SLACK_ENTERPRISE_INSTALL_UNSUPPORTED`), a generic `OAuthProvider` plugin
  abstraction, per-Omni-user ownership of instances, any change to the legacy
  `apps/ui`, and a DB-backed pending-flows table (trigger: API replicas).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | One Slack app per deployment, operator-created from a pre-filled manifest link; credentials in `global_settings` with env fallback | Slack has no app-less path or device flow; matches one-deployment-one-tenant; same shape as the gate provider config and `META_APP_*` (design D1, D10) |
| 2 | Socket Mode with one shared receiver per Slack app, Bolt `App` built with `authorize` and no `token` | Slack spreads one app's events across its connections (#1185); Bolt runs `authorize` per event; `token` and `authorize` are exclusive on `App` (design D2, review finding 5) |
| 3 | One instance per (workspace, user) with `slack_auth_mode='user'`, upserted at the callback; bot-mode instances keyed by workspace only | Preserves instance = identity for routing, agent binding, allowlists, chats (design D3, D11, D12) |
| 4 | Single-attachment workspaces receive every event unchecked; fan-out engages only past one attachment per workspace, and logs once when it narrows delivery | Byte-for-byte today's delivery for every legacy app; fan-out cost only where it buys correctness (design D8, review round 2 note) |
| 5 | The #1185 guard narrows to "second bot-mode attachment per (app, workspace)": same token digest, both bot-mode, team ids equal or unknown; the receiver's attach-time check is authoritative; `slack_team_id` is persisted on first connect of manual instances through the `instance.connected` listener | Two bot-mode attachments share one bot identity and would both dispatch the agent; personal attachments on one app must never trip it (design D14, review note) |
| 6 | Server-side pending record + HMAC-signed nonce; tenant comes from the record, never from the state; outcome TTL re-armed on transition | Multitenancy rule for callback surfaces; no new secret (HKDF from the client secret); CLI and dashboard learn the result through an authenticated call (design D9, D13) |
| 7 | Callback tenant branch: tenant-class context wraps writes in `runInTenantScope`; no context (legacy single-tenant) runs on the ambient pool; platform-class credential is rejected at `start` | `withTenantTransaction` throws on missing or non-tenant context; legacy requests carry no `authContext` (review note) |
| 8 | API + CLI are the deliverable; the button lands in `apps/khal-ui` | Canonical UI per the approved consolidation wish; it already has Slack forms (design D5) |
| 9 | Wide refactor sequenced expand → migrate → contract: Group 2 adds the receiver module beside the existing code, Group 3 switches the plugin onto it behavior-preserving, Group 5 adds fan-out and narrows the guard. Every group's own push must pass the pre-push gate (`make typecheck` + the full turbo test suite); the promise deferred to the final group is `make check-all`, which adds the real-PostgreSQL gate | Keeps every group inside the admission band and isolates the highest-risk change |
| 10 | `connect` on an already-attached instance detaches first and rebuilds its acting clients | Design D11: re-authorization must invalidate cached clients (typing.ts:64); the same-user callback path re-runs connect |

## Simplicity Case

- **Simplest complete design:** three routes, five settings keys, three columns, one
  receiver registry replacing the per-instance Bolt app, two CLI commands, one button.
  No new secret, no new table, no new transport, no new plugin-contract abstraction.
- **Added machinery:** the shared receiver (Slack load-balances one app's events across
  its connections, the exact failure #1185 guards against); the `authorizations.list`
  fan-out engaged only past one attachment per workspace ("every team member clicks
  Connect"); the server-side pending record with a signed nonce (Slack's OAuth guidance
  and the multitenancy rule for callbacks); the single-use outcome map (so CLI and
  dashboard learn the result through an authenticated call; precedent
  `packages/api/src/lib/oauth-token-cache.ts`); two optional fields on
  `instance.connected` (the only path from the plugin to the instance row).
- **Deferred until measured:** DB-backed pending flows (trigger: API replicas); HTTP
  transport for OAuth installs (trigger: more than ten receivers per app, or operators
  refusing app-level tokens); hosted relay (trigger: OSS users refusing to create an
  app); generic `OAuthProvider` (trigger: a second OAuth channel); Enterprise Grid
  (trigger: first Enterprise Grid workspace).
- **Complexity removed:** the per-instance Bolt app and its "handlers before start"
  constraint; the broad "same app token anywhere" guard; tokens or instance identifiers
  in browser memory, URLs or logs; a separate signing secret for state; any tenant claim
  in the state.

## Dependencies

**depends-on:** none
**blocks:** none

## Success Criteria

- [ ] `omni slack app setup` prints a manifest link whose decoded JSON contains the
      derived redirect URL, bot + user scopes, user events, `agent_view`,
      `socket_mode_enabled: true`, `tokens_revoked` and `app_uninstalled`; after the
      values are written, `GET /slack/app` returns `configured: true`.
- [ ] `POST /slack/oauth/start` → callback produces an instance with
      `slack_auth_mode='user'`, `slack_connection_method='oauth'`, populated
      `slack_team_id` / `slack_user_id`, state `connected`; a test asserts no
      `xox`-prefixed string appears in any response body, redirect URL, or log line.
- [ ] Repeating the flow as the same Slack user returns the same instance id and runs
      `connect` again; a second Slack user in the same workspace gets a second instance
      on the same receiver.
- [ ] Two user-mode instances on one app-level token: a channel message visible to
      both reaches both exactly once (mocked `authorizations.list`); a DM to one
      reaches only that one; each instance's own outbound is filtered as self.
- [ ] A workspace with exactly one user-mode attachment receives a channel event whose
      only `authorizations` entry is the bot, with no `authorizations.list` call made.
- [ ] Bad, expired, evicted or replayed `state` → 400, no instance, no Slack call;
      `error=access_denied` → `result` reports `error` and no instance.
- [ ] The callback's redirect URL and CLI page contain no instance id, name, tenant id
      or connection state; the route-ownership gate and the public-surface privacy
      test pass with the new declaration; the callback is rate-limited by IP.
- [ ] The three secret settings keys seal at rest and read back masked through
      `GET /settings`; the two string keys read back in clear.
- [ ] `tokens_revoked` for one user → only that instance becomes `disconnected` with
      reason `token_revoked`; `app_uninstalled` → every instance of that workspace.
- [ ] Missing `server.public_url` or `slack.app.client_id` → `start` returns
      `SLACK_APP_NOT_CONFIGURED` listing the missing keys.
- [ ] Every existing manual Slack instance connects unchanged; every existing
      `channel-slack` and API Slack test passes or is ported with equal assertions;
      the #1185 conflict test proves two user-mode instances on one token are accepted
      and a second bot-mode instance on the same workspace is refused without `force`.
- [ ] `omni slack connect` completes end to end against a stubbed Slack and prints the
      instance id; `make check-all` and `make verify-migrations` are green; the
      migration is additive and idempotent with the precedent header.

## Execution Strategy

### Wave 1 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | Low coupling, low risk: additive schema, registry keys, manifest fields, two optional event fields; no behavior change | inherit | Foundation: migration 0078, settings keys, manifest `redirect_urls` + revocation events + exported scopes, `instance.connected` team/acting-user fields |

### Wave 2 (parallel — disjoint files)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | Medium risk, low coupling: a new module beside the existing connection code; nothing else imports it yet | inherit | Receiver module (expand): `SlackAppReceiver`, `SlackAttachment`, `receiverKeyFor`, `buildActingClients` exported, unit tests |
| 4 | engineer | Medium risk: new public route under the ownership gate, HMAC state, stubbed Slack exchange; OpenAPI + SDK | inherit | OAuth flow API: `/slack/app`, `/slack/oauth/start`, `/callback`, `/result`; pending/outcome store; instance upsert service; declarations; SDK |

### Wave 3 (parallel — disjoint files)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 3 | engineer | High risk, high coupling: `plugin.ts` (2168 lines, 18 `getConnection` call sites) switched onto attachments, behavior-preserving; six connection tests ported | inherit | Plugin switch (migrate): attachments replace `connections`, handlers registered per receiver, reconnect detaches first, exports kept |
| 6 | engineer | Low risk: commander subcommands over existing SDK methods; interactive prompt + polling | inherit | CLI: `omni slack app setup`, `omni slack app status`, `omni slack connect` |
| 7 | engineer | Medium risk: `apps/khal-ui` is a private-registry workspace outside root workspaces and `make test`; validated by its own scripts after its own install | inherit | UI: Connect Slack button, return-nonce handling, Slack app settings card |

### Wave 4 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 5 | engineer | High risk: fan-out correctness across attachments, revocation listeners without `authorize`, narrowed guard on the API, listener-side persistence | inherit | Fan-out + revocation + guard (contract): `authorizations.list` cache, per-attachment pipeline, `tokens_revoked`/`app_uninstalled`, narrowed #1185 guard, team id persisted by the `instance.connected` listener |

### Wave 5 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 8 | engineer | Medium risk: end-to-end test with stubbed Slack and mocked Bolt; full gate | inherit | Docs + integrate-and-verify: `docs/channels/slack.md`, endpoint reference, e2e test, `make check-all` green |

**Global constraints:**
- "This project uses **Bun exclusively**": `bun install`, `bun run`, `bunx`, `bun test`; never npm/yarn/pnpm/node/npx.
- Conventional commits `type(scope): description`; commitlint enforces `body-max-line-length` 100; husky pre-commit runs biome; `.husky/pre-push` runs `make typecheck` and then `bunx turbo test --concurrency=4 --continue --output-logs=new-only` (the full per-package suite), so every group's push must be typecheck-and-test green; `--no-verify` and bare `--force` are forbidden by `.claude/hooks/git-safety.sh`.
- Migrations are hand-written: "Header comment first", "Additive + idempotent", "No destructive statements", "No explicit `BEGIN`/`COMMIT`", "`when` timestamps must strictly increase", "schema.ts and the migration ship in the same PR"; next free number is `0078`, journal `idx: 78`, `when: 1787800000000` (previous `1787700000000` + 100000000); never `drizzle-kit push` or `generate`.
- "Validate every external boundary with Zod." "Represent state changes with events." "Don't use `any` types." "Don't create REST endpoints without OpenAPI docs." "No warnings — biome strict mode, `--error-on-warnings`." "No skips."
- Every registered route carries an explicit ownership class in `packages/api/src/tenancy/route-ownership.ts`; `public-by-contract` requires an inline privacy contract; "Webhook/source secrets and callback tokens establish tenant from a server-side source record and signed audience; request body/header tenant claims cannot select ownership."
- "Do not start services, access databases or production systems, or send external messages without explicit approval." "Use a disposable database for database-backed or full integration tests." No real Slack calls in tests: stub `fetch` / Bolt.
- Slack platform: redirect URLs must be HTTPS; the app-level token needs `connections:write` + `authorizations:read`; `apps.event.authorizations.list` is limited to 600/min per app per workspace.
- Bolt 4.7.2: `token` and `authorize` are exclusive on `App`; `authorize` is skipped for `app_uninstalled` and `tokens_revoked`.
- Parallel groups own disjoint files (listed under **Files to Create/Modify**); a group edits nothing outside its set.

Describe each group's coupling and risk in **Complexity**. In **Model**, inherit the active model unless user instructions or an evidenced capacity need justify another supported runtime configuration. Use portable role names; keep actual model/effort settings in the runtime. Order groups by dependencies and give parallel writers disjoint files or isolated worktrees.

## Execution Groups

### Group 1: Foundation — schema, settings keys, manifest, connected-event fields

**Goal:** Land every additive contract the later groups build on, with no runtime behavior change.

**Deliverables:**
1. `packages/db/src/schema.ts`: `slackTeamId: varchar('slack_team_id', { length: 32 })`, `slackUserId: varchar('slack_user_id', { length: 32 })`, `slackConnectionMethod: varchar('slack_connection_method', { length: 16 })` on `instances`, plus index `instances_slack_identity_idx (slack_team_id, slack_user_id)`.
2. `packages/db/drizzle/0078_instances_slack_oauth_identity.sql` (header per the 0043/0044/0052 precedent; `ADD COLUMN IF NOT EXISTS` ×3; `CREATE INDEX IF NOT EXISTS`) and the `_journal.json` entry `{ idx: 78, version: '7', when: 1787800000000, tag: '0078_instances_slack_oauth_identity', breakpoints: true }`.
3. `packages/api/src/constants/slack-app.ts`: `SLACK_APP_SETTINGS` (five keys with env fallbacks) and `SLACK_OAUTH_CALLBACK_PATH = '/api/v2/slack/oauth/callback'`.
4. `packages/api/src/services/settings.ts`: the five keys in `DEFAULT_SETTINGS`: `slack.app.client_secret`, `slack.app.signing_secret`, `slack.app.app_token` as `{ category: 'slack', valueType: 'secret', isSecret: true }`; `slack.app.client_id` as `{ category: 'slack', valueType: 'string' }`; `server.public_url` as `{ category: 'server', valueType: 'string' }` (a general setting, not a Slack one).
5. `packages/core/src/events/types.ts`: `InstanceConnectedPayload` gains `teamId?: string` and `actingUserId?: string` (flat, beside `profileName` / `ownerIdentifier`); `packages/channel-sdk/src/helpers/events.ts`: `InstanceConnectedMetadata` gains the same two optional fields; `packages/channel-sdk/src/base/BaseChannelPlugin.ts`: `emitInstanceConnected` spreads them (today it spreads only the three existing fields, so anything else is dropped).
6. `packages/channel-slack/src/manifest.ts` + `src/types.ts` + `src/index.ts`: `buildSlackManifest` accepts `redirectUrls?: string[]` → `oauth_config.redirect_urls`; `BOT_EVENTS` gains `tokens_revoked`, `app_uninstalled`; `USER_SCOPES`, `USER_EVENTS` exported; new `slackAuthorizeScopes()`; `SlackManifest.oauth_config.redirect_urls?: string[]`.
7. Tests: manifest assertions in `auth-mode.test.ts`; a settings test asserting the three secrets seal and mask and the two strings do not; a `BaseChannelPlugin` test asserting `teamId` / `actingUserId` survive the emit.

**Interfaces:**
- Consumes: none
- Produces:
  - `export const SLACK_APP_SETTINGS = { clientId: { key: 'slack.app.client_id', env: 'SLACK_CLIENT_ID' }, clientSecret: { key: 'slack.app.client_secret', env: 'SLACK_CLIENT_SECRET' }, signingSecret: { key: 'slack.app.signing_secret', env: 'SLACK_SIGNING_SECRET' }, appToken: { key: 'slack.app.app_token', env: 'SLACK_APP_TOKEN' }, publicUrl: { key: 'server.public_url', env: 'OMNI_PUBLIC_URL' } } as const` (`packages/api/src/constants/slack-app.ts`)
  - `export const SLACK_OAUTH_CALLBACK_PATH: '/api/v2/slack/oauth/callback'`
  - `buildSlackManifest(options?: { …existing; redirectUrls?: string[] }): SlackManifest`
  - `export const USER_SCOPES: readonly string[]`, `export const USER_EVENTS: readonly string[]`, `export const REVOCATION_EVENTS: readonly ['tokens_revoked', 'app_uninstalled']`
  - `export function slackAuthorizeScopes(): { scope: string; user_scope: string }` (comma-joined `REQUIRED_BOT_SCOPES` and `USER_SCOPES`)
  - `InstanceConnectedPayload { …existing; teamId?: string; actingUserId?: string }` (`@omni/core`); `InstanceConnectedMetadata { …existing; teamId?: string; actingUserId?: string }` (`@omni/channel-sdk`); `emitInstanceConnected(instanceId, metadata)` forwards both.
  - Drizzle columns `instances.slackTeamId`, `instances.slackUserId`, `instances.slackConnectionMethod` (`'manual' | 'oauth'`, nullable; null reads as `'manual'`).

**Acceptance Criteria:**
- [ ] `make verify-migrations` passes; the migration applies twice without error on a disposable database.
- [ ] `buildSlackManifest({ redirectUrls: ['https://x/api/v2/slack/oauth/callback'], includeUserScopes: true })` emits `oauth_config.redirect_urls`, `oauth_config.scopes.user`, `bot_events` containing `tokens_revoked` and `app_uninstalled`.
- [ ] `SettingsService.setValue('slack.app.client_secret', 'x')` stores a sealed value when a master key is set and `GET /settings` returns `********`; `slack.app.client_id` and `server.public_url` read back in clear.
- [ ] `emitInstanceConnected(id, { profileName, teamId: 'T1', actingUserId: 'U1' })` publishes a payload carrying `teamId` and `actingUserId`.
- [ ] No existing channel-slack, channel-sdk, core or API test changes behavior.

**Validation:**
```bash
make verify-migrations && make test-file F=packages/channel-slack/src/__tests__/auth-mode.test.ts && make test-file F=packages/api/src/services/__tests__/settings-slack-app.test.ts && make test-file F=packages/channel-sdk/src/base && make typecheck
```

**depends-on:** none

---

### Group 2: Receiver module (expand)

**Goal:** Add the shared-receiver module beside the existing connection code, fully unit-tested, without changing what the plugin runs.

**Deliverables:**
1. `packages/channel-slack/src/connection/app-receiver.ts` (new): `SlackAppReceiver` owning one Bolt `App` (constructed with `authorize`, `socketMode`/`appToken` or the Express receiver, never `token`), the per-workspace bot `WebClient`s, the socket-health watchdog logic (#941/#1151) lifted from `bolt-client.ts` behind the same behavior, and the attachment map; handlers are registered once at creation through a `registerHandlers(app, receiver)` hook the plugin will supply in Group 3.
2. `receiverKeyFor(opts)` and `SlackAttachment`; `targetsFor(body)` returns every attachment of the event's `team_id` with no authorization check (fan-out arrives in Group 5).
3. `packages/channel-slack/src/connection/bolt-client.ts`: export `buildActingClients` (unchanged behavior) so the receiver and the plugin share it; identity resolution helper `resolveWorkspaceIdentity(botClient)` replacing the `connection.app.client.auth.test()` path for callers that hold a workspace bot client (existing callers untouched in this group).
4. `packages/channel-slack/src/__tests__/app-receiver.test.ts` (new): two attachments on one key share one `App`; distinct keys → distinct receivers; `authorize` returns the most recently attached bot token for the team; detaching the last attachment stops the receiver; `targetsFor` returns all attachments of the team.

**Interfaces:**
- Consumes: `REVOCATION_EVENTS` (Group 1, registered as no-op listeners here).
- Produces:
  - `export interface SlackAttachment { instanceId: string; teamId: string; authMode: SlackAuthMode; actingClient: WebClient; userClient?: WebClient; actingUserId?: string; botUserId: string; botId: string; botToken: string; config: SlackConfig; dedupeCache: DedupeCache; debouncer: DebounceManager; attachedAt: number }`
  - `export class SlackAppReceiver { constructor(opts: SlackConnectionOptions, registerHandlers: (app: App, receiver: SlackAppReceiver) => void, logger: Logger); readonly key: string; attach(a: SlackAttachment): void; detach(instanceId: string): boolean; start(): Promise<void>; stop(): Promise<void>; readonly attachments: ReadonlyMap<string, SlackAttachment>; targetsFor(body: SlackEventBody): Promise<SlackAttachment[]>; readonly isRunning: boolean; botClientFor(teamId: string): WebClient | undefined }`
  - `export function receiverKeyFor(opts: SlackConnectionOptions): string` (`socket:<sha256(appToken)>` or `http:<sha256(signingSecret)>:<httpPort>`)
  - `export function buildActingClients(...)` (existing signature, now exported) and `export async function resolveWorkspaceIdentity(botClient: WebClient): Promise<{ teamId: string; botId: string; botUserId: string; botName: string }>`

**Acceptance Criteria:**
- [ ] `app-receiver.test.ts` passes with a fake Bolt `App` (no network).
- [ ] `plugin.ts` is unchanged in this group; every existing channel-slack test passes untouched.

**Validation:**
```bash
cd packages/channel-slack && bun run typecheck && cd ../.. && make test-file F=packages/channel-slack
```

**depends-on:** 1

---

### Group 3: Plugin switch (migrate, behavior-preserving)

**Goal:** Run every Slack instance through the receiver registry while delivering exactly what each instance receives today.

**Deliverables:**
1. `packages/channel-slack/src/plugin.ts`: `connections: Map<instanceId, BoltConnection>` → `attachments: Map<instanceId, SlackAttachment>` + `receivers: Map<receiverKey, SlackAppReceiver>`; `connect` = resolve tokens → get-or-create receiver → verify identity (user-mode `auth.test` with the user token, fail fast as today) → if already attached, detach first and rebuild acting clients (Decision 10) → attach → start if idle; `disconnect` = detach → stop and drop receiver when empty; every outbound path and every `getConnection` call site reads the attachment; `setupHandlers` becomes the receiver's `registerHandlers` and resolves the attachment(s) per event through `targetsFor`.
2. `packages/channel-slack/src/handlers/messages.ts`, `handlers/typing.ts`: take a `SlackAttachment` instead of `(app, instanceId, …)`; typing's client cache keyed by attachment and dropped on detach.
3. `packages/channel-slack/src/connection/bolt-client.ts`: identity resolution for the plugin now uses `resolveWorkspaceIdentity(receiver.botClientFor(teamId))`; `createBoltConnection`, `destroyBoltConnection`, `checkBoltHealth` and `BoltConnection` stay exported from `packages/channel-slack/src/index.ts` (re-pointed at the receiver implementation, same signatures) so nothing outside the package breaks.
4. `emitInstanceConnected` passes `teamId` and `actingUserId`.
5. Ported tests with equal assertions: `connection.test.ts`, `socket-health.test.ts`, `bolt-client-user-mode.test.ts`, `bolt-client-http.test.ts`, `auth-mode-connect.test.ts`, `inbound-dedup.test.ts`; plus: two instances on one token share one receiver and both receive a team event; disconnecting one of two leaves the socket open; reconnecting an attached instance detaches first.

**Interfaces:**
- Consumes: `SlackAppReceiver`, `SlackAttachment`, `receiverKeyFor`, `buildActingClients`, `resolveWorkspaceIdentity` (Group 2); `InstanceConnectedMetadata.teamId/actingUserId` (Group 1).
- Produces:
  - `instance.connected` payloads from Slack carry `teamId` and, in user mode, `actingUserId`.
  - `@omni/channel-slack` public exports unchanged in name and signature.

**Acceptance Criteria:**
- [ ] Every ported test passes with its original assertions; the fail-fast for an unresolved acting user id still refuses to start.
- [ ] Two manual instances on distinct app tokens connect to two receivers; two on one token share one receiver and both receive an event delivered to that team.
- [ ] Disconnecting the last attachment stops the socket; disconnecting one of two leaves it open; `connect` on an attached instance detaches and re-attaches with fresh acting clients.
- [ ] `sendMessage`, reactions, history, search, typing status all work through the attachment (existing sender/handler tests unchanged).

**Validation:**
```bash
cd packages/channel-slack && bun run typecheck && cd ../.. && make test-file F=packages/channel-slack
```

**depends-on:** 2

---

### Group 4: OAuth flow API, store, upsert, declarations, SDK

**Goal:** Give the API a complete Slack OAuth install flow whose callback is a declared public surface, with tokens never leaving the server and the tenant taken from a server-side record.

**Deliverables:**
1. `packages/api/src/lib/single-use-store.ts` (new): generic `createSingleUseStore<T>({ ttlMs, maxEntries, prefix })` with `put(value, ttlMs?)`, `take`, `transition`; `oauth-token-cache.ts` re-implemented on it with its surface unchanged (`put(accessToken, ttlMs?)`, `take(handle)`), plus a new unit test for the cache (none exists today).
2. `packages/api/src/lib/slack-oauth.ts` (new): authorize URL builder, HKDF-derived state key, `signState`/`verifyState`, Zod-validated `oauth.v2.access` and `users.info` calls over `fetch` (no new dependency), `SlackOAuthAccessSchema`.
3. `packages/api/src/services/slack-oauth.ts` (new): `resolveSlackAppConfig(settings)` (settings + env fallback → `{ configured, missing[], redirectUrl, manifestUrl }`), `upsertSlackOAuthInstance(...)` (by `(slack_team_id, slack_user_id)`, name `Slack · <display> @ <team>` with numeric suffix on collision, `slack_connection_method='oauth'`, `slack_auth_mode` per mode, tokens sealed by the existing instance service), `connectInstance` via the channel registry exactly as `POST /instances/:id/connect` does, including on an existing row (the plugin then detaches and re-attaches, Decision 10).
4. `packages/api/src/routes/v2/slack.ts`: `GET /slack/app`, `POST /slack/oauth/start`, `GET /slack/oauth/result/:nonce`; `packages/api/src/app.ts`: `GET /api/v2/slack/oauth/callback` mounted before `protectedApp` behind `webhookIngressRateLimitMiddleware`, with the tenant branch of Decision 7; `returnTo` allowlisted to a relative path or the `server.public_url` origin; Enterprise installs rejected.
5. `packages/api/src/tenancy/route-ownership.ts` (three `tenant-scoped` + one `public-by-contract` with inline contract), `packages/api/src/constants/scopes.ts` (`GET /slack/app` → `instances:read`, `POST /slack/oauth/start` → `instances:write`, `GET /slack/oauth/result/:nonce` → `instances:read`), `packages/api/src/schemas/openapi/slack.ts` (new) registered from `routes/openapi.ts`.
6. `packages/sdk/src/client.ts`: `slack.appStatus()`, `slack.oauthStart(body)`, `slack.oauthResult(nonce)`; `bun run generate:sdk` regenerates `types.generated.ts`.
7. Tests: `routes/v2/__tests__/slack-oauth.test.ts` (start requires config; state sign/verify; callback with stubbed `fetch` creates and connects an instance through a fake channel registry; replay → 400; `access_denied` → error outcome; redirect carries only the nonce; second callback for the same user updates the same row AND calls `connect` again; bot mode keyed by team), `lib/__tests__/single-use-store.test.ts`, `lib/__tests__/oauth-token-cache.test.ts`, plus `tenancy/__tests__/route-ownership-gate.test.ts` and `public-surface-privacy.test.ts` passing.

**Interfaces:**
- Consumes: `SLACK_APP_SETTINGS`, `SLACK_OAUTH_CALLBACK_PATH`, `slackAuthorizeScopes`, `buildSlackManifest({ redirectUrls })`, Drizzle columns (Group 1).
- Produces:
  - `POST /api/v2/slack/oauth/start` body `{ mode?: 'user' | 'bot'; entry: 'ui' | 'cli'; returnTo?: string }` → `200 { authorizeUrl: string; nonce: string; expiresAt: string }` | `409 { error: { code: 'SLACK_APP_NOT_CONFIGURED', details: { missing: string[] } } }`
  - `GET /api/v2/slack/oauth/callback?code&state[&error]` → `302 Location: <returnTo>?slack=<nonce>` (ui) | `200 text/html` fixed page (cli) | `400 text/html` fixed page
  - `GET /api/v2/slack/oauth/result/:nonce` → `{ status: 'pending' } | { status: 'done'; instanceId: string } | { status: 'error'; code: string; message: string }`
  - `GET /api/v2/slack/app` → `{ configured: boolean; missing: string[]; redirectUrl: string | null; manifestUrl: string | null }`
  - SDK: `client.slack.appStatus(): Promise<SlackAppStatus>`, `client.slack.oauthStart(body: SlackOAuthStartBody): Promise<SlackOAuthStart>`, `client.slack.oauthResult(nonce: string): Promise<SlackOAuthResult>`
  - `createSingleUseStore<T>(opts: { ttlMs: number; maxEntries: number; prefix: string }): { put(value: T, ttlMs?: number): string; take(handle: string): T | undefined; transition(handle: string, value: T): boolean }` (`transition` re-arms the store TTL)

**Acceptance Criteria:**
- [ ] With no settings, `start` returns `SLACK_APP_NOT_CONFIGURED` naming every missing key; with settings from env fallback it returns an authorize URL containing `scope`, `user_scope`, `redirect_uri` and a signed state.
- [ ] Callback with a stubbed Slack creates an instance with the four columns populated and calls the registry's `connect`; the redirect contains only `slack=<nonce>`; the result endpoint returns `done` once and `pending`/unknown afterwards.
- [ ] Replayed, tampered, expired, or unknown state → 400 with no Slack call and no row; `error=access_denied` → outcome `error`.
- [ ] `route-ownership-gate.test.ts` and `public-surface-privacy.test.ts` pass; `GET /api/v2/docs` lists the three authenticated routes.
- [ ] No `xox` string in any response, redirect or log in the tests.

**Validation:**
```bash
make test-file F=packages/api/src/routes/v2/__tests__/slack-oauth.test.ts && make test-file F=packages/api/src/lib/__tests__ && make test-file F=packages/api/src/tenancy/__tests__/route-ownership-gate.test.ts && make test-file F=packages/api/src/tenancy/__tests__/public-surface-privacy.test.ts && bun run generate:sdk && git diff --exit-code packages/sdk/src/types.generated.ts && make typecheck
```

**depends-on:** 1

---

### Group 5: Fan-out, revocation, narrowed guard (contract)

**Goal:** Make several instances on one Slack app correct: deliver each event to exactly the instances it is visible to, handle revocation, and keep the duplicate-dispatch guard where it still matters.

**Deliverables:**
1. `SlackAppReceiver.targetsFor`: exactly one attachment for the team → that attachment, no check; more than one → `body.authorizations` + `apps.event.authorizations.list(event_context)` (app-level token, cached 60 s per `event_context`), user-mode attachments whose `actingUserId` is listed plus the single bot-mode attachment when any entry has `is_bot: true`; missing `authorizations:read` → log once, fall back to the single entry; log once per workspace when a second attachment first narrows delivery.
2. Per-attachment pipeline: dedupe key `channel:ts` per instance, self-filter against that attachment's acting user, ack reactions and agent dispatch once per target.
3. Revocation listeners registered without `authorize`: `tokens_revoked` keys on `body.team_id` + `event.tokens.oauth`/`tokens.bot`; `app_uninstalled` on `body.team_id`; affected attachments are detached and their instances transition to `disconnected` with reason `token_revoked` / `app_uninstalled` (events published as today's status transitions).
4. Attach-time guard: a second bot-mode attachment for the same receiver + team is refused with `SlackError(SlackErrorCode.BOT_INSTANCE_EXISTS)` unless `force`; `packages/channel-slack/src/types.ts` adds `BOT_INSTANCE_EXISTS: 'SLACK_BOT_INSTANCE_EXISTS'` to the `SlackErrorCode` const object and its `SLACK_CORE_CODE_MAP` entry.
5. `packages/api/src/routes/v2/instances.ts`: `findSlackAppTokenConflict` → `findSlackBotModeConflict(services, { appToken, teamId, authMode }, selfId)`: same digest, both bot-mode, team ids equal or unknown; keeps the `SLACK_APP_TOKEN_IN_USE` code and `force`.
6. `packages/api/src/plugins/event-listeners.ts`: the `instance.connected` subscriber also writes `slack_team_id` (and `slack_user_id` when `actingUserId` is present and the row has none) from the payload, so manual instances get their workspace persisted on first connect.
7. Tests: `receiver-fanout.test.ts` (single attachment gets bot-only event unchecked; two users + channel event → both once; DM → one; own outbound filtered per attachment; missing scope fallback), `revocation.test.ts`, rewritten `instances-slack-app-token-conflict.test.ts` (two user-mode on one token accepted; second bot-mode on same team refused; distinct teams accepted), an `event-listeners` test for the team-id write.

**Interfaces:**
- Consumes: `SlackAppReceiver`, `SlackAttachment` (Groups 2, 3); `InstanceConnectedPayload.teamId/actingUserId` (Group 1); `REVOCATION_EVENTS` (Group 1); columns (Group 1).
- Produces:
  - `SlackErrorCode.BOT_INSTANCE_EXISTS = 'SLACK_BOT_INSTANCE_EXISTS'` (+ `SLACK_CORE_CODE_MAP` entry)
  - `findSlackBotModeConflict(services: Services, input: { appToken: string | null | undefined; teamId: string | null | undefined; authMode: 'bot' | 'user' }, selfId?: string): Promise<{ id: string; name: string } | null>`
  - Instance status reasons `'token_revoked' | 'app_uninstalled'` on the disconnected transition.

**Acceptance Criteria:**
- [ ] Success criteria 4, 5, 9 and 11 of this wish pass as tests.
- [ ] `apps.event.authorizations.list` is called at most once per `event_context` per minute per receiver.
- [ ] A manual instance connected once has `slack_team_id` populated afterwards.

**Validation:**
```bash
make test-file F=packages/channel-slack && make test-file F=packages/api/src/routes/v2/__tests__/instances-slack-app-token-conflict.test.ts && make test-file F=packages/api/src/plugins && make typecheck
```

**depends-on:** 3, 4

---

### Group 6: CLI

**Goal:** Let an operator register the deployment app and let any member connect from the terminal.

**Deliverables:**
1. `packages/cli/src/commands/slack.ts`: `omni slack app setup [--public-url <url>] [--client-id] [--client-secret-stdin] [--signing-secret-stdin] [--app-token-stdin] [--non-interactive]` (prints the manifest link, prompts for the values not passed, writes them with `client.settings.set`, then prints `omni slack app status`), `omni slack app status`, `omni slack connect [--mode user|bot] [--no-open] [--timeout <seconds>]` (start with `entry: 'cli'`, print the URL, try to open the browser, poll `oauthResult` every 2 s up to 5 min, print the instance id and status).
2. Secrets accepted only via `-stdin`/prompt, masked in output (same discipline as `--slack-user-token-stdin`).
3. `packages/cli/src/commands/__tests__/slack.test.ts` (new): setup writes the five keys via a mocked client; connect polls until `done` and prints the id; `error` outcome exits non-zero; timeout exits non-zero with the nonce for retry.

**Interfaces:**
- Consumes: `client.slack.appStatus`, `client.slack.oauthStart`, `client.slack.oauthResult` (Group 4); `client.settings.set(key, value)` (already in `packages/sdk/src/client.ts`).
- Produces: the three commands above; exit codes `0` success, `2` usage, `3` API failure (matching the existing `slack` command group).

**Acceptance Criteria:**
- [ ] `omni slack app setup --non-interactive` with all values passed exits 0 and `omni slack app status` prints `configured: true` against the mocked client.
- [ ] `omni slack connect` prints an `https://slack.com/oauth/v2/authorize?…` URL and exits 0 with the instance id when the mocked result becomes `done`.
- [ ] No secret value appears in stdout/stderr in the tests.

**Validation:**
```bash
make test-file F=packages/cli/src/commands/__tests__/slack.test.ts && cd packages/cli && bun run typecheck
```

**depends-on:** 4

---

### Group 7: UI (khal-ui)

**Goal:** Give the canonical dashboard the one-click button and the operator status card.

**Deliverables:**
1. `apps/khal-ui/package/src/api/ext.ts`: a `slack` namespace on the object returned by the `omniExt(base)` factory with `appStatus()`, `oauthStart(body)`, `oauthResult(nonce)` through the BFF mount.
2. `apps/khal-ui/package/src/pages/instances/SlackConnectButton.tsx` (new): calls `slack.oauthStart({ entry: 'ui', returnTo: <current path> })` and navigates to `authorizeUrl`; disabled with a tooltip naming the missing keys when `configured` is false.
3. `apps/khal-ui/package/src/pages/instances/InstancesListPage.tsx`: renders the button; on mount reads `?slack=<nonce>`, calls `slack.oauthResult`, shows a toast, refreshes the list, and strips the query.
4. `apps/khal-ui/package/src/pages/resources/SlackAppCard.tsx` (new) rendered from `SettingsPage.tsx`: configured/missing state, redirect URL, manifest link, and the five settings keys through the existing settings editor.
5. Tests alongside the existing `instance-helpers.test.ts` / `settings-helpers.test.ts` for the pure helpers (nonce extraction, missing-keys tooltip text).

**Interfaces:**
- Consumes: the three endpoints and their response shapes (Group 4).
- Produces: `SlackConnectButton` (props `{ onConnected(instanceId: string): void }`), `SlackAppCard` (no props), helpers `readSlackReturnNonce(search: string): string | null`.

**Acceptance Criteria:**
- [ ] Button hidden/disabled state follows `GET /slack/app`; click navigates to the authorize URL returned by the API.
- [ ] Returning with `?slack=<nonce>` resolves the instance through the authenticated result endpoint and the list shows it connected; no instance id is read from the URL.
- [ ] `bun run typecheck` and the package tests pass in `apps/khal-ui/package` after the app's own install.

**Validation:**
```bash
cd apps/khal-ui && bun install && cd package && bun run typecheck && bun test
```
`apps/khal-ui` sits outside the root workspaces (`package.json:7`) and outside `make test` (`Makefile:230`); its `@khal-os/*` dependencies resolve through the `~/.npmrc` mapping to `git.namastex.io`, which the worker's environment must already carry. If the install cannot complete, this group is reported **blocked**, never skipped.

**depends-on:** 4

---

### Group 8: Docs + integrate-and-verify

**Goal:** Document the one-click path and prove the whole flow green under the repository's full gate.

**Deliverables:**
1. `docs/channels/slack.md`: "One-click setup (OAuth)" first (operator once; member every time; what the manifest link contains; HTTPS/tunnel note), manual path retained below; revocation behavior; the narrowed `SLACK_APP_TOKEN_IN_USE` semantics.
2. `docs/api/endpoints.md`: the four routes.
3. `packages/api/src/routes/v2/__tests__/slack-oauth-e2e.test.ts` (new): start → callback (stubbed `fetch`) → result → instance connected through a mocked Bolt receiver with two members; a `tokens_revoked` event disconnects one.
4. `make check-all` green on the merged tree; `make verify-migrations` green.

**Interfaces:**
- Consumes: everything above.
- Produces: none.

**Acceptance Criteria:**
- [ ] `make check-all` exits 0 (typecheck + lint + tests + real-PostgreSQL gate).
- [ ] The e2e test passes and asserts success criteria 2, 3, 9 end to end.
- [ ] `docs/channels/slack.md` "Verify" section reproduces on a deployment with `server.public_url` set (QA).

**Validation:**
```bash
make verify-migrations && make check-all
```

**depends-on:** 5, 6, 7

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] Functional: on a deployment with HTTPS and the five settings set, a member clicks Connect Slack (or runs `omni slack connect`), authorizes, and lands back with a connected `user`-mode instance; sending a DM from another Slack account to that member reaches the agent and the reply is posted as the member.
- [ ] Integration: a second member connects on the same workspace; a channel message both can see reaches both instances exactly once; each member's own messages are not answered by their own instance.
- [ ] Integration: revoking the app for one member (Slack → Apps → Remove) disconnects only that instance with reason `token_revoked`; reconnecting is the same button.
- [ ] Regression: a pre-existing manual Slack instance (own app, pasted tokens) reconnects after upgrade with no config change and receives every event as before; `omni instances create --channel slack --slack-app-token …` on an already-used token succeeds when the modes differ and is refused for a second bot-mode instance on the same workspace.
- [ ] Regression: `GET /api/v2/slack/oauth/callback` without valid state returns a fixed 400 page with no identifiers and is rate-limited.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `plugin.ts` (2168 lines) switch: every handler is closed over one instance id; six connection tests encode the per-instance model | High | Group 2 lands the module with its own tests first; Group 3 is behavior-preserving (single-attachment parity) with the ported tests as the spec; fan-out is Group 5; `make check-all` in Group 8 |
| Fan-out misses or duplicates across attachments (self vs counterpart) | High | Explicit two-instance tests with mocked `authorizations.list`; dedupe and self-filter per attachment |
| App-level token generated without `authorizations:read` | Medium | Setup prints the exact scopes; receiver degrades to the single entry and logs once; `GET /slack/app` surfaces it |
| Redirect must be public HTTPS; laptop-only development cannot complete the flow | Medium | `start` returns `SLACK_APP_NOT_CONFIGURED`; docs describe a tunnel; the manual token path stays |
| Callback is auth-exempt | Medium | `public-by-contract` declaration + IP rate limiter + HMAC nonce backed by a server-side record that supplies the tenant; nonce-only redirect; no row on any failure |
| Two bot-mode attachments on one workspace would both dispatch | Medium | Narrowed guard at attach time and in the API; OAuth bot path upserts by workspace |
| `apps/khal-ui` depends on a private registry (`@khal-os/*` via `~/.npmrc` → `git.namastex.io`) and sits outside root workspaces and `make test` | Medium | Group 7 installs and validates with the app's own scripts; if the install cannot complete in the worker's environment, Group 7 is reported blocked, never skipped silently |
| Settings key written before registration lands in plaintext | Low | Group 1 registers the keys before any write path exists; test asserts sealing |
| `instances.name` is unique | Low | `Slack · <display> @ <team>` with numeric suffix |
| Bot token drift across reinstalls | Low | `authorize` uses the most recently attached bot token for the team; `invalid_auth` triggers a re-read |
| Personal tokens die with the person's Slack account | Medium | Revocation listeners; reconnect is the same button |
| Workspace typecheck fails in `@omni/voice-client` ("Cannot find type definition file for 'bun'") on a checkout whose `node_modules` predate the `@types/bun@1.3.14` unification (observed on dev, 2026-09-21) | Low | Executors run `bun install` in the worktree before the first commit |
| Core's NATS-backed test needs a local `nats-server` (`bin/nats-server`, `NATS_SERVER_BIN`, or `~/.omni/nats-server`); `NATS_SERVER_BIN` is not on turbo's `test.env` allowlist | Low | Executors run `scripts/ensure-nats.sh` once per checkout |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review — round 1 (2026-09-21T19:14:17Z)

- **Verdict:** FIX-FIRST
- **Reviewer:** review-agent/claude (plan-reviewer, Fable 5.1)
- **Reviewed head:** `6d714b0f`; WISH.md sha256 `7b571c463837cf24bdb8b39a3b9debe53bb5ed85ff1d4e450fa82a9551b1b893`
- **Findings:** 0 blocking / 2 major / 4 minor / 5 low. All applied in this revision: the receiver work split into Group 2 (module) and Group 3 (plugin switch); `teamId`/`actingUserId` carried through the core payload, the SDK metadata type and the base-plugin emit (Group 1) and persisted by the `instance.connected` listener (Group 5); `index.ts` exports owned by Group 3; khal-ui install step and credential source named; `put(value, ttlMs?)` and a cache unit test; reconnect detaches first (Decision 10); pre-push constraint states typecheck + full turbo suite; frozen-lockfile claim replaced by the observed typecheck fact; tenancy validation names the two gate tests; `SlackErrorCode.BOT_INSTANCE_EXISTS` + core map entry, `client.settings.set` exists, `omniExt` slack namespace; `server.public_url` under category `server`.
- Full report: session scratchpad `plan-review-1.md`.

### Plan review — round 2 (2026-09-21T19:22:58Z)

- **Verdict:** APPROVED
- **Reviewer:** review-agent/claude (plan-reviewer, Fable 5.1)
- **Reviewed head:** `6d714b0f`; WISH.md sha256 `de940e582bc41f381e4286e12068c92a847369dcbc5b1a7d3bf2e032e10746ab`
- **Findings:** round-1 items 1–11 all resolved; restructure verified (waves W1:1, W2:2∥4, W3:3∥6∥7, W4:5, W5:8; zero file overlap inside a wave; every depends-on points to an earlier wave; file counts 14/3/12/15/10/2/7/3). 0 blocking / 0 major / 0 minor / 3 low, carried as worker notes without changing the reviewed text:
  - Groups 3 and 4 sit near the top of the insertion band: workers report `git diff --shortstat` at hand-off; if Group 3 exceeds 2,000 insertions, move `handlers/messages.ts` + `handlers/typing.ts` to a sequential Group 3b.
  - Group 3 deliverable 3: nothing outside `packages/channel-slack` imports `createBoltConnection`, `destroyBoltConnection`, `checkBoltHealth` or `BoltConnection`; drop those four exports rather than re-implementing `BoltConnection` over the receiver.
  - Group 5 validation: run the named listener test (`packages/api/src/plugins/__tests__/event-listeners-slack-identity.test.ts`) directly rather than the whole `plugins` directory.
- Full report: session scratchpad `plan-review-2.md`. `work` may execute.

---

## Files to Create/Modify

```
# Group 1 (foundation)
packages/db/src/schema.ts
packages/db/drizzle/0078_instances_slack_oauth_identity.sql            (new)
packages/db/drizzle/meta/_journal.json
packages/api/src/constants/slack-app.ts                                 (new)
packages/api/src/services/settings.ts
packages/api/src/services/__tests__/settings-slack-app.test.ts          (new)
packages/core/src/events/types.ts
packages/channel-sdk/src/helpers/events.ts
packages/channel-sdk/src/base/BaseChannelPlugin.ts
packages/channel-sdk/src/base/__tests__/instance-connected-metadata.test.ts (new)
packages/channel-slack/src/manifest.ts
packages/channel-slack/src/types.ts
packages/channel-slack/src/index.ts
packages/channel-slack/src/__tests__/auth-mode.test.ts

# Group 2 (receiver module) — channel-slack only, no plugin.ts
packages/channel-slack/src/connection/app-receiver.ts                   (new)
packages/channel-slack/src/connection/bolt-client.ts
packages/channel-slack/src/__tests__/app-receiver.test.ts               (new)

# Group 3 (plugin switch) — channel-slack only
packages/channel-slack/src/plugin.ts
packages/channel-slack/src/connection/bolt-client.ts
packages/channel-slack/src/connection/app-receiver.ts
packages/channel-slack/src/handlers/messages.ts
packages/channel-slack/src/handlers/typing.ts
packages/channel-slack/src/index.ts
packages/channel-slack/src/__tests__/connection.test.ts
packages/channel-slack/src/__tests__/socket-health.test.ts
packages/channel-slack/src/__tests__/bolt-client-user-mode.test.ts
packages/channel-slack/src/__tests__/bolt-client-http.test.ts
packages/channel-slack/src/__tests__/auth-mode-connect.test.ts
packages/channel-slack/src/__tests__/inbound-dedup.test.ts

# Group 4 (OAuth API) — api + sdk only; no channel-slack, no routes/v2/instances.ts, no plugins/event-listeners.ts
packages/api/src/lib/single-use-store.ts                                (new)
packages/api/src/lib/oauth-token-cache.ts
packages/api/src/lib/slack-oauth.ts                                     (new)
packages/api/src/lib/__tests__/single-use-store.test.ts                 (new)
packages/api/src/lib/__tests__/oauth-token-cache.test.ts                (new)
packages/api/src/services/slack-oauth.ts                                (new)
packages/api/src/routes/v2/slack.ts
packages/api/src/app.ts
packages/api/src/tenancy/route-ownership.ts
packages/api/src/constants/scopes.ts
packages/api/src/schemas/openapi/slack.ts                               (new)
packages/api/src/routes/openapi.ts
packages/api/src/routes/v2/__tests__/slack-oauth.test.ts                (new)
packages/sdk/src/client.ts
packages/sdk/src/types.generated.ts                                     (regenerated)

# Group 5 (fan-out, revocation, guard)
packages/channel-slack/src/connection/app-receiver.ts
packages/channel-slack/src/plugin.ts
packages/channel-slack/src/handlers/messages.ts
packages/channel-slack/src/types.ts
packages/channel-slack/src/__tests__/receiver-fanout.test.ts            (new)
packages/channel-slack/src/__tests__/revocation.test.ts                 (new)
packages/api/src/routes/v2/instances.ts
packages/api/src/plugins/event-listeners.ts
packages/api/src/plugins/__tests__/event-listeners-slack-identity.test.ts (new)
packages/api/src/routes/v2/__tests__/instances-slack-app-token-conflict.test.ts

# Group 6 (CLI)
packages/cli/src/commands/slack.ts
packages/cli/src/commands/__tests__/slack.test.ts                       (new)

# Group 7 (khal-ui)
apps/khal-ui/package/src/api/ext.ts
apps/khal-ui/package/src/pages/instances/SlackConnectButton.tsx         (new)
apps/khal-ui/package/src/pages/instances/InstancesListPage.tsx
apps/khal-ui/package/src/pages/instances/instance-helpers.ts
apps/khal-ui/package/src/pages/instances/instance-helpers.test.ts
apps/khal-ui/package/src/pages/resources/SlackAppCard.tsx               (new)
apps/khal-ui/package/src/pages/resources/SettingsPage.tsx

# Group 8 (docs + integrate-and-verify)
docs/channels/slack.md
docs/api/endpoints.md
packages/api/src/routes/v2/__tests__/slack-oauth-e2e.test.ts            (new)
```

### Group 4 execution review — commit `c274c3e4` (2026-09-21T21:24:48Z)

- **Verdict:** SHIP
- **Reviewer:** review-agent/claude (reviewer-g4, Fable 5.1); blind criteria written 21:12:59Z before any changed file was opened
- **Target:** `c274c3e4` on `wish/slack-personal-oauth-g4` (parent `e28e2379`); commands run on HEAD `61fdb0c7`
- **Criteria:** all 15 frozen contract criteria traced to code and to a test; 14 met outright. AC15 (file set) was graded MEDIUM because the reviewer diffed against `e3bb2c2e` instead of the true parent `e28e2379`, which showed dev's gitignore fix `7184b155` reversed; the effective diff against the integration tip carries no `.gitignore` change, so the coordinator records AC15 as met.
- **Validation (reviewer's own runs, all exit 0):** slack-oauth 38 pass; lib/__tests__ 145 pass; ownership gate 22; privacy 10; generate:sdk no diff; typecheck (turbo replay + fresh tsc in api and sdk); lint clean; knip exit 0 at HEAD; routes/v2 466 pass / 7 pre-existing MinIO skips; sdk 52 pass.
- **Findings:** 0 CRITICAL / 0 HIGH / 2 MEDIUM / 3 LOW. F2 (MEDIUM): the (team, user) lookup lists up to 1000 Slack rows and filters in JS; trigger for `findBySlackIdentity` on InstanceService when Group 5 lands. F3 (LOW): service-level connect-failure log not passed through `redactSlackTokens`, regex misses `xapp-`. F4 (LOW): the 100-entry issued-handle cap can evict an in-flight callback under a burst (design-accepted fail-closed). F5 (LOW): contract wording about SDK path literals (server-relative paths by convention).
- **Ruling recorded:** `@omni/api` declares `@omni/channel-slack` as a workspace dependency (plan file set omitted `packages/api/package.json`; precedent channel-whatsapp-business / channel-harness).
- Full report: session scratchpad `g4-review.md`; author report `g4-report.md`. Group executed by hand after wish workflow run `wf_b8e249a2-415` refused at admission (route `plan`, auth/secret/permission surfaces).

### Group 2 execution review — branch head `980929b6` (2026-09-21T21:35:12Z)

- **Verdict:** SHIP
- **Reviewer:** review-agent/claude (reviewer-g2, Opus); blind plan written before opening the diff (`g2-review-plan.md`)
- **Target:** `980929b6` on `wish/slack-personal-oauth-g2` vs base `96e8b1ce`; diff exactly the three declared files, 928 insertions
- **Criteria:** all 11 frozen contract criteria met (every Bolt App built with `authorize`, no `token`; SHA-256 receiver key without the plaintext secret; handlers registered once; revocation events as no-ops; `targetsFor` team fallback adds no authorization check)
- **Validation (reviewer's own runs):** typecheck exit 0; app-receiver test 10 pass; channel-slack 317 pass across 24 files, no existing test file touched; biome clean; knip exit 0; no `any`, no suppression, no skip. Coordinator gate `bun run check` on `980929b6`: 26/26 tasks, 0 failures.
- **Findings:** 0 CRITICAL / 0 HIGH / 3 MEDIUM / 4 LOW. MEDIUM carried to Group 3: (1) `attach` overwrites the per-team bot client unconditionally while `authorize` picks by `attachedAt`, so out-of-order attaches disagree; (2) the HTTP path lacks the 1 MB body-limit guard and `httpHandler` the existing connection code has; (3) the last detach stops the App but notifies no registry.
- Full report: session scratchpad `g2-review.md`. Group built by wish workflow run `wf_d17f6910-2c7` (reviews SHIP twice); its gate failed on the knip and `.env` host traps fixed in `7184b155` and `9cbf1402`; runs `wf_b3e1bf30-7e5` (stopped) and `wf_7680df4c-b2d` (refused: existing unreviewed branch) did not change the code beyond commit `975afcef`.

### Group 6 execution review — commit `ecb1533a` (workflow run `wf_1ac9b711-675`, 2026-09-21)

- **Verdict:** SHIP (workflow reviewer, Opus run; 0 blocking findings) on the executor commit `59c06913`, whose tree is identical to the squashed `ecb1533a`
- **Gate:** `bun run check` — pass (CLI package 804 tests, 0 failures); read-back measured 2 files, 1,062 insertions
- **Contract:** `omni slack app setup|status` and `omni slack connect` in `packages/cli/src/commands/slack.ts` against the Group 4 SDK surface; handlers take the client and every side effect as injectable parameters and are re-exported through `__testables`; secrets only via `-stdin` flags or a stderr prompt and never echoed; exit codes 0 / 2 / 3; `packages/cli/src/commands/__tests__/slack.test.ts` covers the five frozen cases with a fake client and no real wait or launch
- **Read-back:** the run ended `blocked` only because the GitGuardian check flagged a high-entropy test sentinel (`xapp-1-…`) on the first commit; the coordinator squashed the branch into one sentinel-free commit (`ecb1533a`, same tree as `cc09fc0a` after the sentinel change) and pushed with `--force-with-lease`; GitGuardian passes on that head. PR #1229 against `wish/slack-personal-oauth`.
- Full result: session task output `wsrqqcfgh`; per-agent journal `wf_1ac9b711-675`.

### Group 3 execution review — commit `ba08978c` (workflow run `wf_026cb518-d0f`, 2026-09-21)

- **Verdict:** SHIP (workflow reviewer, Opus run; 0 blocking findings, nothing outside the declared set)
- **Gate:** `bun run check` — pass (26/26 turbo tasks; 3,209 tests across 322 files, 0 failures)
- **Contract:** `plugin.ts` runs every instance through `attachments` + `receivers` (one `SlackAppReceiver` per receiver key), connect gets-or-creates the receiver, resolves identity through `resolveWorkspaceIdentity(receiver.botClientFor(teamId))`, keeps the user-mode fail-fast, detaches first on reconnect (Decision 10) and attaches with a monotonic `attachedAt`; disconnect stops and drops the receiver on its last attachment; `setupHandlers` is the receiver's `registerHandlers` hook resolving targets via `targetsFor`; handlers take a `SlackAttachment`; the four dead `BoltConnection` exports are dropped from `index.ts`; `channel-name.test.ts` added to the owned set by coordinator ruling (its setup seeded the private map).
- **Read-back:** the run ended `blocked` only because three declared test files (`bolt-client-user-mode`, `auth-mode-connect`, `inbound-dedup`) needed no change: they pass unchanged against the new plugin under the full gate, which satisfies "ported with equal assertions". Coordinator ruling: accepted as delivered. PR #1230 against `wish/slack-personal-oauth`, 10 files, 1,227 insertions; GitGuardian pass.
- **Carried forward:** Group 2 MEDIUM #2 (HTTP body-limit guard and `httpHandler` on the receiver's HTTP branch) was cuttable in this contract; Group 5 or Group 8 verifies whether the HTTP transport path still enforces the 1 MB limit.
- Full result: session task output `wwqiz53qp`; per-agent journal `wf_026cb518-d0f`.
