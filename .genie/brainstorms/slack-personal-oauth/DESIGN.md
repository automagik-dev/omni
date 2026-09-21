# Design: Slack personal integration via native OAuth

| Field | Value |
|-------|-------|
| **Slug** | `slack-personal-oauth` |
| **Date** | 2026-09-21 |
| **Classification** | Architectural |
| **Draft** | `.genie/brainstorms/slack-personal-oauth/DRAFT.md` (evidence + decision rounds) |

## Problem

Connecting a personal Slack account to Omni means hand-creating a Slack app from a
generated manifest, installing it, and pasting three or four tokens (`xoxb`, `xapp`,
`xoxp`, optionally a signing secret) through the CLI; "Claude in Slack" is one click on
an OAuth button. Omni's user mode (#889) already acts as the human once the tokens
exist, so the gap is token *acquisition* and the plumbing that assumes one Slack app
per Omni instance. The result is that the personal integration is effectively
CLI-only, undocumented in the dashboard, and blocked for anyone who will not create a
Slack app by hand.

## Scope

### IN

- **Deployment Slack app credentials** as install-wide settings with env fallback
  (`SettingsService.getString/getSecret` precedent, PR #1225): `slack.app.client_id`,
  `slack.app.client_secret` (secret), `slack.app.signing_secret` (secret),
  `slack.app.app_token` (secret, `xapp`), plus one general `server.public_url`
  (`OMNI_PUBLIC_URL`). All five keys are registered in `DEFAULT_SETTINGS`
  (`packages/api/src/services/settings.ts`) before any write path exists, the three
  secrets with `valueType: 'secret', isSecret: true`, because sealing and masking are
  decided by that registry, not by the PUT body (`settings.ts:410-418`). A read-only
  `GET /slack/app` status endpoint reports which keys are missing, the derived redirect
  URL, and a pre-filled manifest link; it never returns secrets.
- **OAuth v2 install flow** in `packages/api` (Slack-specific routes, like
  `whatsapp-business.ts`): authenticated `POST /slack/oauth/start` and
  `GET /slack/oauth/result/:nonce` (`instances:write` / `instances:read`, tenant-scoped),
  and `GET /slack/oauth/callback`, which is mounted before `protectedApp` like the
  Telegram and Twilio webhooks (`packages/api/src/app.ts:239`, `:468`), declared
  `public-by-contract` in `packages/api/src/tenancy/route-ownership.ts` with an inline
  privacy contract (responses carry no instance id, tenant id, connection state, or
  existence oracle; the tenant comes from a server-side pending record, never from a
  request claim), and guarded by `webhookIngressRateLimitMiddleware`
  (`packages/api/src/middleware/rate-limit.ts:188`). Bot + user scopes are requested on
  every authorize; the browser never receives a token (exchange-handle precedent,
  `packages/api/src/lib/oauth-token-cache.ts`).
- **Instance auto-provisioning** at the callback: one instance per (workspace,
  authorizing user), `slack_auth_mode = 'user'`, `slack_connection_method = 'oauth'`,
  upserted by new `slack_team_id` / `slack_user_id` columns; connected immediately.
  `mode: 'bot'` on `start` produces a bot-mode instance keyed by workspace only, so the
  bot install is also one click.
- **Shared receiver refactor** in `packages/channel-slack`: one Bolt `App` per Slack
  app (registry keyed by the app-level token digest for Socket Mode; by signing
  secret + port for HTTP mode), every Slack instance attaches to its app's receiver,
  per-event `authorize`, and fan-out to every instance an event is visible to via
  `authorizations` + `apps.event.authorizations.list`. Fan-out engages only when a
  workspace has more than one attachment; a workspace with exactly one attachment
  receives every event of the app with no authorization check, which is what a
  per-instance Bolt app does today (`plugin.ts:1697-1760`), so every legacy
  pasted-token instance (each on its own app) behaves exactly as before. The #1185
  guard narrows from "same app token" to "a second bot-mode attachment on the same
  (app, workspace)", enforced at attach time and at the API create/connect routes,
  bypassable with `force` as today.
- **Revocation handling**: subscribe `tokens_revoked` and `app_uninstalled`; affected
  instances transition to `disconnected` with a reason.
- **Manifest**: `buildSlackManifest` gains `redirectUrls` (`oauth_config.redirect_urls`,
  an array of strings, max 1000, per the app-manifest reference) and the two
  revocation events; the deployment app manifest always carries user scopes and user
  events.
- **CLI**: `omni slack app setup` / `omni slack app status` (operator, once) and
  `omni slack connect [--mode user|bot]` (prints the authorize URL, polls the result).
  Existing `--slack-*` flags stay as the manual path.
- **UI** (`apps/khal-ui`, the canonical UI per the approved consolidation wish): a
  "Connect Slack" button on the instances page that starts the flow with a `returnTo`,
  and a Slack app settings card with configured/missing state and the manifest link.
- **Docs**: `docs/channels/slack.md` leads with the one-click path; the manual path
  stays below it. A migration note for `SLACK_APP_TOKEN_IN_USE` callers.
- **Schema + migration**: additive columns `slack_team_id`, `slack_user_id`,
  `slack_connection_method` on `instances`, hand-written per the 0043/0044/0052
  precedent, with a lookup index.

### OUT

- Browser-session emulation with `xoxc`/`xoxd` cookie tokens (the literal WhatsApp Web
  analog): no OAuth, against Slack's terms, breaks without notice.
- An Omni-hosted official Slack app and OAuth relay (Home Assistant style). Candidate
  follow-up wish; this design keeps the credential record shaped so a relay could
  populate it.
- HTTP Events API as the transport for OAuth installs. Socket Mode stays the default;
  HTTP mode remains available for manual instances as today.
- Token rotation (opt-in and irreversible on the Slack side), a tunnel/ngrok helper,
  enterprise (org-wide) installs (`is_enterprise_install` is rejected with a clear
  error), a generic `OAuthProvider` plugin abstraction, per-Omni-user ownership of
  instances (waits on `saas-platform-auth`), and any change to the legacy `apps/ui`.

## Approach

### Operator, once per deployment

1. `omni slack app setup` (or the settings card) prints a pre-filled
   `https://api.slack.com/apps?new_app=1&manifest_json=…` link. The manifest embeds
   `<public_url>/api/v2/slack/oauth/callback` in `redirect_urls`, bot + user scopes,
   user events, `agent_view`, Socket Mode on, and the revocation events.
2. The operator creates the app from that link, generates an app-level token with
   `connections:write` + `authorizations:read`, and pastes client id, client secret,
   signing secret and the app-level token into the prompt. The CLI writes them with
   `PUT /settings/:key` (secrets flagged `is_secret`, sealed like every other
   credential).
3. `GET /slack/app` reports `configured: true`. Nothing else is ever pasted again.

### Team member, every time

1. Click "Connect Slack" (UI) or run `omni slack connect`. The API builds
   `https://slack.com/oauth/v2/authorize` with `client_id`, `scope=<REQUIRED_BOT_SCOPES>`,
   `user_scope=<USER_SCOPES>`, the derived `redirect_uri`, and a signed `state`.
2. Slack asks the person to authorize; Slack redirects to the API callback.
3. The callback verifies `state`, consumes the server-side pending record, calls
   `oauth.v2.access`, resolves the display name, upserts the instance and connects it
   inside the tenant scope taken from that record, parks the outcome under the nonce,
   and either 302-redirects to the UI's `returnTo` with `?slack=<nonce>` only, or renders
   a fixed "done, return to your terminal" page for the CLI entry. Neither response
   carries an instance id, a name, or a connection state.
4. The CLI polls the authenticated `GET /slack/oauth/result/:nonce` (2s, 5 min cap) and
   prints the instance. The dashboard reads the nonce from the query string and calls
   the same authenticated endpoint to learn the instance id, then refreshes.

### Pending record and state parameter

`POST /slack/oauth/start` runs inside the normal authenticated chain, so its tenant is
the request's `AuthContext`. It writes a server-side pending record
`{ nonce → { tenantContext, entry: 'ui'|'cli', mode, returnTo?, createdAt } }` and
returns `state = nonce + "." + HMAC-SHA256(nonce, K)` with
`K = HKDF(slack.app.client_secret, info: 'slack-oauth-state')`. The state carries no
tenant, no user, no instance: the tenant is established from the server-side record
alone, which is the rule the multitenancy wish sets for every callback surface
("callback tokens establish tenant from a server-side source record and signed
audience; request body/header tenant claims cannot select ownership"). No new secret is
introduced; the flow already cannot run without the client secret. `returnTo` is
accepted only as a relative path or a same-origin URL of `server.public_url`.

The callback verifies the HMAC, then `take`s the pending record. A missing record
(never issued, already consumed, expired, or evicted) rejects the callback before any
Slack call, so replay and forgery both fail closed; the record's lifetime IS the state's
lifetime, so there is no window in which a consumed nonce could be replayed. The
callback's instance upsert and connect run under `runInTenantScope`
(`packages/api/src/tenancy/tenant-scope.ts:107`) with the record's context; in a
single-tenant deployment that is the legacy unscoped path, and the multitenancy
enforcement trigger changes nothing in this flow.

### Pending and outcome store

The process-local single-use map from `oauth-token-cache.ts` is generalized to a
`put/take/transition` keyed store (5-minute TTL, 100-entry LRU cap) holding the pending
record and, after the callback, the outcome `{ instanceId } | { error }` for the
authenticated `result` endpoint to `take`. LRU eviction of a pending record fails the
flow closed (the person restarts it); it never admits a stale one. Same single-replica
assumption the file already documents; same named trigger (API replicas → Redis with
the same surface).

### Receiver registry (plugin)

`BoltConnection` splits in two:

- **Receiver** (one per Slack app): the Bolt `App`, the socket (or Express receiver),
  the bot `WebClient` per workspace, socket-health watchdog (#941/#1151), and a
  `Map<instanceId, Attachment>`. Handlers are registered once, at receiver creation,
  and consult the attachment map at event time. This removes the per-instance
  "handlers before start" ordering constraint.
- **Attachment** (one per instance): acting client (`xoxp` in user mode, bot client in
  bot mode), `actingUserId`, `botUserId`, the `SlackConfig`, dedupe cache, debouncer,
  thread caches. Everything downstream (`sendMessage`, reactions, history, search,
  typing) keeps its current per-instance signature and reads the attachment.

The Bolt `App` is constructed with `authorize` and no `token` (Bolt treats the two as
exclusive: `token` is the single-workspace form). Consequently `app.client` carries no
token, and today's identity resolution via `connection.app.client.auth.test()`
(`bolt-client.ts:461`) moves to the workspace's bot `WebClient`; the user-mode
`auth.test` with the user token (`bolt-client.ts:479-481`) is unchanged and still fails
fast when no acting user id resolves.

`connect(instanceId)`: resolve tokens → get-or-create the receiver for the app-level
token → verify identity (`auth.test` with the user token, fail fast as today) → refuse
a second bot-mode attachment for the same (app, workspace) unless `force` → attach →
start the receiver if it is not running. `disconnect`: detach; stop and drop the
receiver when its last attachment leaves.

Bolt's `authorize(source)` returns the workspace's bot token, `botId` and `botUserId`
from the most recently updated attachment of `source.teamId` (so a reinstalled bot
token wins); Bolt runs listeners once per event. Bolt skips `authorize` entirely for
`app_uninstalled` and `tokens_revoked` (`dist/helpers.js:18`), so those two listeners
receive no token and no attachment context: they key on `body.team_id` and
`event.tokens.oauth` / `event.tokens.bot` (arrays of user ids) to find the attachments
to transition.

### Fan-out

Inside each listener the receiver computes the target set for the event's `team_id`:

- **Exactly one attachment for that workspace** (every legacy app, and a deployment app
  with a single member connected): that attachment receives the event with no
  authorization check. This is byte-for-byte today's behavior, where a per-instance
  Bolt app delivers every event of the app to its instance (`plugin.ts:1697-1760`),
  including channel traffic whose only `authorizations` entry is the bot.
- **More than one attachment**: the receiver always fetches the full list, which is
  `body.authorizations` (at most one entry) plus
  `apps.event.authorizations.list(event_context)`, cached per `event_context` for 60
  seconds (Slack allows 600 calls per minute per app per workspace). Targets are the
  user-mode attachments whose `actingUserId` is in that list, plus the workspace's
  bot-mode attachment (at most one, by the narrowed guard) when any entry has
  `is_bot: true`. If the app-level token lacks `authorizations:read`, the receiver logs
  once, falls back to the single entry, and `GET /slack/app` surfaces the degraded
  state.

The existing per-instance pipeline (dedupe key `channel:ts` per instance, self-filter
against that instance's acting user, ack reactions, agent dispatch) then runs once per
target attachment.

### Alternatives considered

- **HTTP Events API on Hono** for OAuth installs: no app-level token and no ten-socket
  cap, but it replaces the proven socket pipeline (agent view #914, socket health #941,
  native streaming) with a path that would need re-validation, and OAuth's HTTPS
  requirement gives it no reachability advantage the deployment does not already need.
- **Hosted relay**: zero operator setup, but personal tokens transit infrastructure
  outside this repo; the one-deployment-one-tenant doctrine makes a per-deployment app
  the honest default.
- **One instance per workspace with many users**: fewer rows, but every handler assumes
  one acting user per instance (`bolt-client.ts:411`), and instance = identity is what
  routing, agent binding, allowlists and chats are built on.
- **User-scope-only installs**: the plugin mandates `xoxb` (Bolt authenticates with it,
  it is the fallback client, and bot-only features depend on it).
- **DB-backed pending-flows table**: replica-safe from day one, but the repo's
  standard deployment is single-process and the same trade-off is already recorded
  for the WhatsApp Cloud handle.

## Simplicity Case

- **Simplest complete design:** three routes, five settings keys, three columns, one
  receiver registry replacing the per-instance Bolt app, two CLI commands, one button.
  No new secret, no new table, no new transport, no new plugin-contract abstraction.
- **Added machinery:** the shared receiver (required: Slack spreads one app's events
  across its connections, the exact failure #1185 guards against); the
  `authorizations.list` fan-out, engaged only past one attachment per workspace
  (required by "every team member clicks Connect", decision 6); the server-side
  pending record with a signed nonce (required by Slack's OAuth guidance and by the
  multitenancy rule that callbacks derive tenant from a server-side record); the
  single-use outcome map (required so the CLI and the dashboard learn the result
  through an authenticated call; precedent exists).
- **Deferred until measured:** DB-backed pending flows (trigger: API replicas); HTTP
  transport for OAuth installs (trigger: more than ten receivers per app, or operators
  refusing app-level tokens); hosted relay (trigger: OSS users refusing to create an
  app); generic `OAuthProvider` (trigger: a second OAuth channel); enterprise installs
  (trigger: first Enterprise Grid workspace).
- **Complexity removed:** the per-instance Bolt app and its "handlers before start"
  constraint; the #1185 guard shrinks from "same app token anywhere" to "second
  bot-mode attachment on one workspace"; tokens or instance identifiers in browser
  memory, URLs or logs; a separate signing secret for state; any tenant claim in the
  state.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 0 | Browser-session emulation (`xoxc`/`xoxd`) is out | Bypasses OAuth, violates Slack's terms, brittle; the user's stated target is the OAuth click, not the cookie hack |
| 1 | One Slack app per deployment, operator-created from a pre-filled manifest link | Slack has no app-less path or device flow; matches one-deployment-one-tenant; no hosted infra |
| 2 | Socket Mode with one shared receiver per Slack app | Slack load-balances an app's events across its connections; Bolt 4.7.2 runs `authorize` per event on a Socket Mode receiver; keeps the proven pipeline |
| 3 | One instance per (workspace, user), `authMode: 'user'`, auto-created at callback | Preserves instance = identity for routing, agent binding, allowlists, chats |
| 4 | API-hosted callback; UI button and `omni slack connect`; tokens never reach the browser | Redirect must be public HTTPS anyway; exchange-handle precedent already closes the XSS window |
| 5 | API + CLI are the deliverable; button lands in `apps/khal-ui` | It is the canonical UI per the approved consolidation wish and already has Slack forms; legacy `apps/ui` has no Slack entry |
| 6 | Full multi-user fan-out from day one via `apps.event.authorizations.list` | Slack sends one event per workspace naming one user; without the list a second member's instance silently misses channel traffic |
| 7 | Bot + user scopes on every authorize; `xoxb` stays mandatory | Plugin, socket auth, agent-view status and slash commands depend on the bot token; user-only installs would be a larger change for less |
| 8 | Unify: legacy instances attach to the same registry; a single-attachment workspace gets every event unchecked | Two connection code paths forever is the alternative; legacy apps are distinct, and the single-attachment fast path is today's delivery rule verbatim |
| 9 | Server-side pending record + HMAC-signed nonce, process-local store | No new schema; CSRF covered; tenant comes from the record, never from the state; same single-replica assumption the repo already documents with a named trigger |
| 13 | The callback is `public-by-contract`, rate-limited, and redirects with the nonce only | The ownership gate fails the build on an undeclared route; the public-surface contract forbids identifiers and connection state; the dashboard and CLI learn the instance through the authenticated result endpoint |
| 14 | The #1185 guard narrows to "second bot-mode attachment per (app, workspace)" instead of being retired | Two bot-mode attachments share one bot identity and would both dispatch the agent; personal attachments on one app are the whole point and must not trip it |
| 10 | App credentials in `global_settings` with env fallback; one general public URL setting | Matches the gate provider config and `META_APP_*` precedents; the redirect must match the manifest byte for byte, so one source of truth |
| 11 | Re-auth upserts by (`slack_team_id`, `slack_user_id`); bot instances keyed by team only | Prevents duplicate instances; acting clients are rebuilt on upsert so cached clients (typing.ts:64) are invalidated |
| 12 | `mode: 'bot'` on `start` is in scope | Same routes, same callback, one branch; removes the token paste for bot instances too |

## Risks & Assumptions

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | The receiver refactor touches `plugin.ts` (79 KB) where every handler is closed over one instance id; `socket-health`, `bolt-client-http`, `bolt-client-user-mode`, `connection` tests encode the per-instance model | High | Keep the per-instance pipeline signature, introduce the attachment registry underneath, port tests with equal assertions, run `make test-pg-gate` before merge |
| 2 | Fan-out misses or duplicates: self-filter and dedupe must be per attachment (user A's own message is "self" for A and a counterpart for B) | High | Explicit two-instance fan-out tests with a mocked `authorizations.list`; dedupe stays keyed by instance |
| 3 | App-level token generated without `authorizations:read` | Medium | Setup prints the exact scopes; receiver logs once and degrades to the single authorization; status endpoint reports it |
| 4 | Redirect must be public HTTPS; laptop-only development cannot complete the flow | Medium | `start` returns `SLACK_APP_NOT_CONFIGURED` naming the missing public URL; docs describe a tunnel; manual token path stays |
| 5 | `instances.name` is unique; two workspaces can share a display name | Low | Name `Slack · <display> @ <team>`; suffix on collision |
| 6 | Bot token drift across reinstalls (each authorize returns the workspace bot token) | Low | `authorize` uses the most recently updated attachment of the team; `invalid_auth` on the bot client triggers a re-read |
| 7 | Personal tokens die with the person's Slack account or on uninstall | Medium | `tokens_revoked` / `app_uninstalled` handlers; instance shows `disconnected` with a reason; reconnect is the same button |
| 8 | Callback is auth-exempt | Medium | `public-by-contract` declaration with inline contract; `webhookIngressRateLimitMiddleware`; HMAC-signed single-use nonce backed by a server-side record that also supplies the tenant; `returnTo` allowlisted to the public origin; responses carry no identifiers; no instance is created on any verification failure |
| 9 | Enterprise Grid installs route by `enterprise_id` | Low | Rejected with `SLACK_ENTERPRISE_INSTALL_UNSUPPORTED` in v1 |
| 10 | Two bot-mode attachments on one (app, workspace) would both dispatch the agent | Medium | Narrowed #1185 guard at attach time and at the API routes; the OAuth bot path upserts by workspace so it cannot trip it; `force` remains the explicit override |
| 11 | A settings key written before it is registered lands in plaintext | Low | The five keys are added to `DEFAULT_SETTINGS` in the same change that introduces any write path; a test asserts the three secrets seal and mask |

Assumptions: single-process API deployment (documented); the canonical UI is
`apps/khal-ui` until the consolidation lands; instances are tenant-owned, not
per-Omni-user; the master secret sealing applies to the new settings keys exactly as to
existing credential columns.

## Success Criteria

- [ ] `omni slack app setup` prints a manifest link whose decoded JSON contains the
      derived redirect URL, bot + user scopes, user events, `agent_view`,
      `socket_mode_enabled: true`, and `tokens_revoked` + `app_uninstalled`; after the
      three values are pasted, `GET /slack/app` returns `configured: true`.
- [ ] `POST /slack/oauth/start` → Slack authorize → callback produces an instance with
      `slack_auth_mode = 'user'`, `slack_connection_method = 'oauth'`, populated
      `slack_team_id` / `slack_user_id`, state `connected`; a test asserts no `xox`
      prefixed string appears in any response body, redirect URL, or log line.
- [ ] Repeating the flow as the same Slack user returns the same instance id; a second
      Slack user in the same workspace gets a second instance on the same receiver.
- [ ] Two user-mode instances on one app-level token: a channel message visible to
      both reaches both exactly once (mocked `authorizations.list`); a DM to one
      reaches only that one; each instance's own outbound is filtered as self.
- [ ] A workspace with exactly one user-mode attachment receives a channel event whose
      only `authorizations` entry is the bot, with no `authorizations.list` call made.
- [ ] Bad, expired, evicted or replayed `state` → 400 and no instance and no Slack
      call; `error=access_denied` → `result` reports `error` and no instance.
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
      `channel-slack` and API Slack test passes or is ported with equal assertions; the
      #1185 conflict test is rewritten to prove that two user-mode instances on one
      token are accepted and both receive their events, while a second bot-mode
      instance on the same workspace is refused without `force`.
- [ ] `omni slack connect` completes end to end against a mocked Slack and prints the
      instance id; `make check` and `make verify-migrations` are green; the migration
      is additive and idempotent with the precedent header.

## Next Step

After an independent design review returns SHIP, persist the evidence below and verify its content digest before running `wish`.

<!-- genie-design-review:start -->
## Design Review Evidence

- **Verdict:** SHIP
- **Reviewed content SHA-256:** `1f74a12e5d7e58edb128674ad442be04b29f5dc65db4a66c96c33efba861bc59`
- **Reviewer:** review-agent/claude (design-reviewer, Fable 5.1)
- **Reviewed at:** 2026-09-21T18:52:38.000Z
<!-- genie-design-review:end -->
