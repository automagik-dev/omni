# slack-personal-oauth — DRAFT

WRS: ██████████ 100/100
 Problem ✅ | Scope ✅ | Decisions ✅ | Risks ✅ | Criteria ✅ | Review ✅ SHIP

Classification: **Architectural** (new OAuth subsystem + change to Slack inbound routing).
Started 2026-09-21. Rounds 1 and 2 resolved by the user on 2026-09-21 (all
recommended options accepted). Frontier empty. Crystallized to DESIGN.md. Review round 1 (2026-09-21T18:43Z,
digest e88a63ae…): FIX-FIRST, 0 blocking / 3 major / 4 minor, all addressed as
text changes (single-attachment fast path, narrowed #1185 guard, public-by-contract
callback with server-side tenant record and nonce-only redirect, DEFAULT_SETTINGS
registration, Bolt authorize/token exclusivity, state lifetime = store TTL,
redirect_urls verified). Round 2 (2026-09-21T18:52Z, digest 1f74a12e…): SHIP, 0 blocking / 0 major /
4 minor / 1 low. Evidence stamped in DESIGN.md. Wish written 2026-09-21 and plan-reviewed APPROVED
(round 2): .genie/wishes/slack-personal-oauth/WISH.md. Non-blocking notes carried into
wish planning (reviewer's proposed resolutions, accepted as written):
- API-level bot-guard rule: same token digest, both bot-mode, team ids equal or
  unknown; persist `slack_team_id` on first connect of manual instances; the
  attach-time guard in the receiver is authoritative.
- Callback tenant branch: tenant-class context → `runInTenantScope`; no context
  (legacy single-tenant) → ambient pool; platform-class credential rejected at
  `start`. A revocation inside the 5-minute window is not re-checked (state
  lifetime is the bound).
- `transition` re-arms the store's 5-minute TTL so a late outcome survives
  until the dashboard/CLI `take`s it.
- The single-attachment fast path is a compatibility mode: log once per
  workspace when a second attachment narrows delivery to authorized traffic.
- Renumber decisions 13/14 after 12 when the wish copies the table.

## Problem

Connecting a PERSONAL Slack account to Omni today means: generate a manifest,
hand-create a Slack app at api.slack.com, install it, copy `xoxb` + `xapp`,
optionally copy `xoxp`, and paste three or four tokens into the CLI (the main
dashboard has no Slack form at all; `apps/khal-ui` has bot/app/signing fields
and no user-mode toggle). "Claude in Slack" is one click on an OAuth button.
The user wants Omni's personal Slack mode to feel like that, the way WhatsApp
Web pairing already does for WhatsApp.

## Evidence (verified 2026-09-21)

Repo:
- User mode (#889) already exists: `authMode: 'user'` + `userToken` (xoxp),
  acting client routes every outbound call as the human; only token
  *acquisition* is manual. `packages/channel-slack/src/plugin.ts:85-135`,
  `src/connection/bolt-client.ts:56-64`.
- Transport is identical in both modes: Socket Mode (xapp) or Bolt's own
  ExpressReceiver on port 3001. No RTM, no xoxc/xoxd, no OAuth code anywhere
  in the package.
- One Bolt app per omni instance. The API already guards against two active
  instances sharing one xapp (#1185, `packages/api/src/routes/v2/instances.ts:994-1024`)
  because Slack load-balances events across a single app's connections.
- Only OAuth precedent in the repo: WhatsApp Cloud Embedded Signup —
  `POST /:id/whatsapp-business/oauth/exchange` returns a single-use
  `exchangeHandle` (`packages/api/src/lib/oauth-token-cache.ts`), and one
  connect route serves `manual | embedded_signup`. No redirect/callback route
  exists for any channel.
- Secrets: one sealed `text` column per credential (`instances.slack_user_token`
  etc., `packages/db/src/schema.ts:767-777`); install-wide config via
  `SettingsService.getString(key, envFallback)` over `global_settings`.
- Public URL: no single `PUBLIC_URL`; precedents are `WEBHOOK_BASE_URL` and
  `META_FLOWS_BASE_URL` (returns `NOT_CONFIGURED` when unset). No tunnel helper.
- WhatsApp pairing UX = event → in-process store → polled `GET /:id/qr`
  (WhatsApp-only guard at `instances.ts:1342`) + 5s status poll.
- Topology doctrine (canonical-ui-consolidation wish, APPROVED, not landed):
  one deployment = one tenant. `apps/khal-ui` still exists alongside `apps/ui`.

Slack platform (docs.slack.dev, fetched 2026-09-21):
- OAuth v2: `scope` (bot) and `user_scope` (user) on the authorize URL;
  `oauth.v2.access` returns `access_token` (xoxb) and `authed_user.access_token`
  (xoxp) + `team.id`. User-only installs are allowed ("instead of, or in
  addition to").
- Redirect URLs MUST be HTTPS. No localhost exception.
- No device-authorization flow exists.
- App-level token (xapp) is per-app across all workspaces; up to 10 Socket Mode
  connections; "each payload may be sent to any of the connections".
- Workspace (user-scoped) events are perspectival; if several users in one
  workspace installed, Slack sends ONE event with one `authorizations[]`
  entry; `apps.event.authorizations.list` (xapp with `authorizations:read`)
  lists the rest.
- Manifest can be pre-filled: `https://api.slack.com/apps?new_app=1&manifest_json=<urlencoded>`.
- App-manifest reference (https://docs.slack.dev/reference/app-manifest):
  `oauth_config.redirect_urls` is an array of strings (max 1000);
  `oauth_config.scopes.bot` / `.user` max 255 each; `settings.socket_mode_enabled`
  and `settings.token_rotation_enabled` are booleans.
- `apps.event.authorizations.list` rate limit: 600/min per app per workspace.
- Bolt skips `authorize` for `app_uninstalled` and `tokens_revoked`
  (`@slack/bolt/dist/helpers.js:18`); `token` and `authorize` are exclusive on `App`.
- Bolt 4.7.2 (installed): `SocketModeReceiver` accepts `clientId/clientSecret/installationStore`
  and `App.authorize(source)` runs per event → one socket can serve many
  installs. `@slack/oauth@3.0.5` `InstallProvider` is present transitively.

## Decisions (Round 1 — RESOLVED 2026-09-21, user accepted every ★)

0. Browser-session emulation (xoxc/xoxd, like WhatsApp Web) — ★ OUT of scope.
1. Who owns the Slack app — ★ one app per deployment, operator creates it once
   from a pre-filled manifest link and pastes client id/secret (+ xapp).
   Alternative: Omni-hosted official app + relay (later wish).
2. Inbound transport for personal instances — ★ Socket Mode, ONE shared Bolt
   app per Slack app with per-event `authorize` → omni instance. Alternative:
   HTTP Events API mounted on Hono.
3. Instance model — ★ one omni instance per (workspace, authorizing user),
   auto-created at callback, `authMode: 'user'`.
4. Flow shape — ★ API `start` returns authorize URL with signed state; API
   hosts `GET /slack/oauth/callback`; UI button + `omni slack connect` (CLI
   prints URL, polls status). Browser never sees tokens.
5. UI target — ★ API + CLI are the deliverable; button lands in the canonical
   UI (khal-ui today, carried by the consolidation wish).

## Round 2 — RESOLVED 2026-09-21 (user accepted every ★)

6. Multi-user fan-out in one workspace — ★ full fan-out from day one via
   `apps.event.authorizations.list` (xapp needs `authorizations:read`), cached
   per `event_context`, dispatch to every matching instance.
7. Scopes at authorize — ★ bot + user scopes; bot token per workspace (shared
   by that workspace's personal instances), user token per instance; xoxb
   stays mandatory.
8. Connection model — ★ unify: one Bolt receiver per Slack app (keyed by xapp
   digest); every Slack instance attaches to its app's receiver; #1185 guard
   retired.
9. OAuth state — ★ stateless HMAC `state` + process-local single-use result
   map (precedent: `oauth-token-cache.ts`); CLI polls the result.

Assumptions accepted without objection:
- App credentials in `global_settings` with env fallback (`slack.app.*` /
  `SLACK_*`), written via `PUT /settings/:key` or `omni slack app setup`.
- One general public base URL setting; Slack redirect derived from it;
  `NOT_CONFIGURED` when missing; dev = tunnel (documented, not built).
- Re-auth upserts the same (team, user) instance via new `slack_team_id` /
  `slack_user_id` columns.
- `tokens_revoked` / `app_uninstalled` → instance disconnected with reason.

## Risks (draft)

- Refactor from one-Bolt-app-per-instance to shared receiver touches every
  handler that assumes one acting user per connection (`bolt-client.ts:411`).
- HTTPS redirect requirement blocks laptop-only setups.
- Personal tokens die with the user's Slack account; instance must degrade cleanly.

## Criteria (to fill)
