# Wish: Omni Labs distribution — desktop app, npx entry, isolated DSH plugin, code pairing

| Field | Value |
|-------|-------|
| **Status** | EXECUTED |
| **Slug** | `omni-labs-distribution` |
| **Date** | 2026-10-20 |
| **Author** | Felipe Rosa (with Claude) |
| **Appetite** | large |
| **Branch** | `labs-distribution` → PR into `labs` |
| **Repos touched** | automagik-dev/omni |
| **Design** | _No brainstorm — direct wish_ |

> **As shipped (2026-10-23).** Pairing did not ship as the `OMNI_PAIRING_*` env vars and `/api/v2/pair/*` routes
> planned below. It shipped as human login on Better Auth: the RFC 8628 device flow at `/api/auth/device/*`, keys
> from `/api/v2/login/device-key` and `/api/v2/login/connect`, and `OMNI_LOGIN_*` / `OMNI_DEVICE_KEY_*` settings
> (see `.env.example`). Login is on by default for a single-tenant Omni; the operator claims it and approves devices
> with `omni claim` / `omni approve` / `omni connect`, and WhatsApp is optional. Guide:
> `docs/guides/pair-dsh-with-omni.md`. The pairing criteria below are kept as the record of the plan.

## Summary

Publish Omni three ways from one new `labs` branch: a desktop app (Linux AppImage/deb now, macOS dmg as an unsigned labs build), the same app launched through `npx @automagik/omni desktop`, and the Omni UI as an independent DSH plugin that keeps all of its own data under `~/.omni`. Connecting the app to a remote Omni needs no keys: the app shows a code, the user sends it to themselves on WhatsApp on the remote's pairing channel, and the app receives a scoped key.

## Scope

### IN

- `labs` branch policy: CI and commitlint run on `labs`; nothing auto-merges `labs` into `dev`; no publishing from `labs`.
- Device pairing API (inbound code over WhatsApp) behind `OMNI_PAIRING_ENABLED`, with its table, migration, events, OpenAPI docs and tests.
- Omni UI plugin isolation: own package identity, own home under `~/.omni` (overridable), own credential file, DSH self-updater off, and a "Connect to Omni" pairing flow in the UI.
- `apps/omni-desktop`: thin Electron app that runs a bundled DSH with the Omni plugin on an isolated home; AppImage + deb (linux-x64) and an unsigned dmg target.
- `omni desktop` subcommand in the CLI that fetches and launches the desktop build; the CLI's default behaviour is unchanged.
- Redeploy the owner's Omni with pairing on; build the Linux app; pair it from a second machine against this host.

### OUT

- Running a full local Omni (Postgres + NATS + API) inside the Electron process. "Run locally" in the app hands off to the existing `omni install` service path, measured later.
- Outbound verification codes sent to arbitrary numbers (abuse and ban risk on a personal WhatsApp account).
- Apple Developer ID signing and notarization (no credentials yet); the dmg is labelled unsigned/labs.
- Native Windows (WSL is in scope through the Linux build).
- Auto-update; npm publishing from `labs`; merging `labs` into `dev`.
- Production specifics (hostnames, numbers, instance names) in the public repo.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Pairing is inbound: the app shows a code, the user sends it from WhatsApp to the pairing channel; only the channel owner's own messages in the self chat (or numbers on a server allowlist) approve. | Proves ownership of the number without Omni ever messaging strangers; no public "send a message" endpoint; the security lens's preferred design. |
| 2 | One thin Electron app of our own, built with electron-builder; it spawns a bundled DSH server with an isolated `DSH_HOME` on 127.0.0.1, a random port and a per-launch token. | Upstream DSH desktop rejects Linux targets; Agent Studio is a remote client. A thin shell is the smallest thing that runs on all three targets. |
| 3 | `npx @automagik/omni` stays the CLI; the desktop opens with `omni desktop`. | `@automagik/omni` is already the published CLI; changing its default breaks scripted and agent users. |
| 4 | The plugin's home is `$OMNI_HOME/ui` (default `~/.omni/ui`), never `~/.dsh/bot`; its credential lives in that home, not in DSH's credential store. | Item (3) of the request: the plugin must not touch the user's DSH state. A dedicated subdirectory keeps it clear of the CLI's own `~/.omni` files. |
| 5 | Pairing mints a normal API key through `ApiKeyService.create` with scopes, TTL and rate limit from server config; `*`, `keys:*` and `platform:*` are refused at config parse. The key is minted at the consuming poll, never stored. | Reuses the existing key model (listing, revocation, expiry) instead of a second credential type; the operator chooses breadth (the owner's Main Bot operates Omni on their behalf). |
| 6 | `labs` gets CI triggers before the PR; the PR head is `labs-distribution` (not `feat/*`). | CI only ran on `main`/`dev`; `feat/*` auto-merges to `dev`. |
| 7 | Migration 0086's journal `when` is 0085 + 1, not + 100000000. | Labs deploys before dev takes its next migration; dev's conventional `when` stays above it, so it still applies on a database that ran labs (plan review, finding 1). Renumbered after dev's on merge; the SQL is idempotent. |
| 8 | Owner approval leaves a notice in the self chat ("paired <device> from <ip>; revoke …") instead of a second confirm message. | A confirm reply proves nothing more against an API caller (it could send the confirm too) and doubles the steps; Omni's own sends never reach `message.received`, and the notice makes a talked-into pairing visible. |
| 9 | Code and poll token are SHA-256, not HMAC. | The code is a rendezvous: knowing one grants nothing without an approver sending it. The poll token (32 random bytes) is what releases the key. |
| 10 | The plugin rename covers every key it shares with DS Bot: package, plugin id, route, i18n/@-menu namespaces, storage prefix; its patch no longer overrides `web`. | Same-origin coexistence with DS Bot; reading or removing `ds-bot:` keys would touch DS Bot's state. |
| 11 | The desktop app keeps everything in `~/.omni/desktop` (its own `dsh/` and `ui/`). | Sharing `~/.omni/ui` with a plugin installed into another dsh would put one team on two dsh homes whose Sessions differ. |
| 12 | Linux launches run the AppImage unpacked (`omni desktop` unpacks once). | The second machine had `/dev/fuse` but no libfuse2 (Ubuntu 26.04); WSL usually has neither. |

## Simplicity Case

- **Simplest complete design:** one table (`device_pairings`), three routes (start, poll, cancel), one `message.received` subscriber; the plugin reads one JSON credential file; the desktop app is a main process that spawns DSH and opens one window.
- **Added machinery:** a server allowlist of approver numbers (needed: the owner may pair from a second phone); a per-instance cap on pending pairings in Postgres (survives restarts and replicas) beside the existing in-memory per-IP limiter; a shell launcher in front of Electron on Linux, because Chromium's sandbox must be decided before Chromium starts.
- **Deferred until measured:** local Omni inside the app (measured: the app alone is ~1.0 GB RSS idle and 251 MB to download, before Postgres/NATS), keychain storage (the link file is 0600 in the user's home), auto-update (trigger: signing exists), signed dmg (trigger: Apple credentials), slimming dsh's 145 MB LibreOffice WASM.
- **Complexity removed:** no outbound OTP sending, no new credential type, no fork of upstream DSH desktop, no change to the CLI's default command.

## Dependencies

**depends-on:** none
**blocks:** none

## Success Criteria

- [ ] CI runs on pushes and PRs to `labs`; no workflow merges or publishes from `labs`.
- [ ] `POST /api/v2/pair/start` returns a code, a send-to number and a wa.me link only when `OMNI_PAIRING_ENABLED=true`; otherwise 404.
- [ ] Sending the code from the pairing channel's owner self chat approves the pairing; `GET /api/v2/pair/:id` then returns a key exactly once; unknown senders, expired, reused or wrong codes never approve.
- [ ] The minted key has only the configured scopes, an expiry and a rate limit, and is listed under keys.
- [ ] With the plugin installed into a DSH whose `DSH_HOME` is a temp dir, nothing is written under that `DSH_HOME` by the plugin beyond DSH's own profile files; its state lives under `$OMNI_HOME/ui`.
- [ ] The Omni UI can connect to a remote Omni by pairing code, with no key typed.
- [ ] `apps/omni-desktop` builds an AppImage and a deb on Linux, starts DSH with the Omni plugin on an isolated home, and shows the Omni UI.
- [ ] `omni desktop` downloads (or reuses) the Linux build and launches it; `omni --help` and every existing command behave as before.
- [ ] The owner's Omni runs the labs build with pairing on, and a second machine pairs against it end to end.

## Execution Strategy

### Wave 1 (sequential)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | low — two workflow files | inherit | `labs` branch policy in CI |
| 2 | engineer | high — new public auth surface, migration, events | inherit | Device pairing API |
| 3 | engineer | medium — plugin home/credential move, rename, UI flow | inherit | Plugin isolation + Connect by code |
| 4 | engineer | high — new app, packaging, process supervision | inherit | `apps/omni-desktop` (Linux first) |
| 5 | engineer | low — one CLI subcommand | inherit | `omni desktop` |
| 6 | engineer | medium — production deploy + second-machine test | inherit | Deploy, build, pair end to end |

**Global constraints:**
- Bun + TypeScript for packages/*; Zod at every external boundary; state changes publish events.
- Hand-written, additive, idempotent migration with a header comment and a journal entry (`make verify-migrations`).
- No production hostnames, phone numbers, instance names or ops paths in the repo.
- Conventional commits; author Felipe Rosa <felipe@namastex.ai>; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- DSH pinned at 0.2.1-rc.3. Builds run with `DO_NOT_TRACK=1`.
- Electron renderer: contextIsolation on, sandbox on, nodeIntegration off, narrow preload, navigation allowlist.

## Execution Groups

### Group 1: labs branch policy

**Goal:** CI and commit checks run for `labs`, and nothing merges or publishes from it automatically.

**Deliverables:**
1. `labs` added to the push / pull_request / merge_group branch lists of `.github/workflows/ci.yml` and `commitlint.yml`.
2. Confirmation (and a guard if needed) that the auto-merge and version/release workflows never act on `labs`.

**Interfaces:**
- Consumes: none
- Produces: CI on PRs whose base is `labs`.

**Acceptance Criteria:**
- [ ] `grep` shows `labs` in the trigger lists of ci.yml and commitlint.yml.
- [ ] No workflow with `publish`, `npm`, `release` or auto-merge logic triggers on `labs`.

**Validation:**
```bash
grep -n "labs" .github/workflows/ci.yml .github/workflows/commitlint.yml && ! grep -ln "labs" .github/workflows/version.yml .github/workflows/release.yml
```

**depends-on:** none

---

### Group 2: Device pairing API

**Goal:** A device can obtain a scoped API key by sending a short code to the server's pairing channel from WhatsApp.

**Deliverables:**
1. `device_pairings` table in `packages/db/src/schema.ts` with migration `0086_device_pairings.sql` and journal entry.
2. Events `device.pairing.started` and `device.pairing.completed` in `@omni/core`.
3. `services/device-pairing.ts`: start, poll, approve-from-message, expire; codes and poll tokens hashed (SHA-256); codes from a CSPRNG; single use; ≤10 min expiry; Postgres-backed per-IP start limit.
4. `routes/v2/pairing.ts` mounted before auth: `POST /pair/start`, `GET /pair/:id` (poll token in a header), `DELETE /pair/:id`; 404 when `OMNI_PAIRING_ENABLED` is not `true`.
5. `plugins/device-pairing.ts`: durable `message.received` subscriber that approves a pending pairing when its code arrives on the configured instance from the owner's self chat or an allowlisted number.
6. OpenAPI registration and tests (service unit tests, route tests, subscriber tests).

**Interfaces:**
- Consumes: `ApiKeyService.create(options: CreateApiKeyOptions)`, `eventBus.subscribe('message.received', handler, { durable, queue, startFrom: 'new' })`.
- Produces:
  - `POST /api/v2/pair/start` body `{ deviceName: string(1..80) }` → `{ data: { pairingId: uuid, code: string, sendTo: string, waLink: string, expiresAt: iso, pollToken: string } }`
  - `GET /api/v2/pair/:id` header `x-pairing-token` → `{ data: { status: 'pending'|'approved'|'expired'|'consumed', apiKey?: string, apiUrl?: string, scopes?: string[], expiresAt?: iso } }` (apiKey only on the first approved read)
  - Server config env: `OMNI_PAIRING_ENABLED`, `OMNI_PAIRING_INSTANCE_ID`, `OMNI_PAIRING_ALLOWED_NUMBERS` (comma list), `OMNI_PAIRING_KEY_SCOPES` (comma list), `OMNI_PAIRING_KEY_TTL_DAYS`, `OMNI_PAIRING_PUBLIC_URL`.

**Acceptance Criteria:**
- [ ] Disabled flag → 404 on all three routes.
- [ ] Code sent from the owner's self chat approves; from another chat or an unknown number it does not; a second send of the same code does nothing.
- [ ] Poll with a wrong token → 404; the key is returned once, later polls report `consumed` without it.
- [ ] Expired pairings never approve; starts beyond the per-IP limit → 429.
- [ ] `make verify-migrations` passes; minted scopes never include `*` or `keys:*`.

**Validation:**
```bash
make verify-migrations && cd packages/api && LOG_LEVEL=silent bun test src/services/__tests__/device-pairing.test.ts src/__tests__/consumer-config.test.ts src/tenancy/__tests__/route-ownership.test.ts && cd ../.. && make test-pg-gate
```

**depends-on:** Group 1

---

### Group 3: Plugin isolation and Connect by code

**Goal:** The Omni UI plugin keeps everything of its own under `$OMNI_HOME/ui` and connects to a remote Omni by pairing code.

**Deliverables:**
1. Package identity `@automagik/omni-dsh` (npm name), plugin config home defaulting to `$OMNI_HOME/ui` (`OMNI_HOME` default `~/.omni`); opt-in copy from an existing `~/.dsh/bot`.
2. Omni URL and key read from `$OMNI_HOME/ui/omni.json` (0600) instead of DSH's credential store and profile patch; the old sources are not read.
3. DSH self-updater off.
4. "Connect to Omni" flow in the Channels page: server URL → `POST /pair/start` → code, wa.me link and its QR → poll → credential saved → live.
5. Test proving a run with a temp `DSH_HOME` writes no plugin state under it.

**Interfaces:**
- Consumes: the pairing routes of Group 2.
- Produces: `rt.omniLink(): { url, key, keyId, scopes, pairedAt, keyExpiresAt } | null`, `rt.omniNamed(): boolean`, host endpoints `omni-link`, `omni-pair-start`, `omni-pair-poll`, `omni-pair-cancel`, `omni-disconnect`.

**Acceptance Criteria:**
- [ ] Plugin tests pass; the isolation test proves no writes under `DSH_HOME/bot`.
- [ ] The Connect flow pairs against a server with pairing on (covered by a host test with a fake server).

**Validation:**
```bash
cd apps/omni-ui-dsh && npm test && node scripts/build-client.mjs --check
```

**depends-on:** Group 2

---

### Group 4: Desktop app (Linux first)

**Goal:** A native app that starts DSH with the Omni plugin on an isolated home and opens the Omni UI.

**Deliverables:**
1. `apps/omni-desktop`: Electron main (spawn DSH with `DSH_HOME=<userData>/dsh`, `OMNI_HOME=<userData>/omni`, 127.0.0.1, random port, per-launch token, health wait, clean shutdown), narrow preload, hardened window.
2. electron-builder config: AppImage + deb (linux-x64), dmg (darwin, unsigned, labelled labs).
3. Prototype measurements (artifact size, idle RAM) recorded in the app README.

**Interfaces:**
- Consumes: the plugin of Group 3 (bundled into the app's DSH profile).
- Produces: `apps/omni-desktop/dist/Omni-<version>-linux-x86_64.AppImage`, `Omni-<version>-linux-amd64.deb`, `Omni-<version>-labs-unsigned-mac-<arch>.dmg`.

**Acceptance Criteria:**
- [ ] `npm run dist:linux` produces an AppImage and a deb.
- [ ] The AppImage starts headless under xvfb, DSH answers on loopback, and the Omni UI loads (screenshot).

**Validation:**
```bash
cd apps/omni-desktop && npm test && npm run dist:linux && ls dist/*.AppImage dist/*.deb
```

**depends-on:** Group 3

---

### Group 5: `omni desktop`

**Goal:** `npx @automagik/omni desktop` launches the desktop app on Linux, WSL and macOS.

**Deliverables:**
1. `packages/cli/src/commands/desktop.ts`: resolves the platform build from the labs GitHub release (or a local path), downloads to `~/.omni/desktop/`, verifies SHA-256, launches it.
2. Registration in the CLI; `omni --help` lists it; nothing else changes.

**Interfaces:**
- Consumes: Group 4 artifacts.
- Produces: `omni desktop [--path <file>] [--tag <tag>] [--dry-run]`.

**Acceptance Criteria:**
- [ ] CLI tests pass; the default command and existing commands are unchanged.

**Validation:**
```bash
cd packages/cli && LOG_LEVEL=silent bun test src/commands/__tests__/desktop.test.ts && LOG_LEVEL=silent bun test
```

**depends-on:** Group 4

---

### Group 6: Deploy and pair end to end

**Goal:** The owner's Omni runs the labs build with pairing on, and a second machine pairs against it.

**Deliverables:**
1. Labs build deployed to the owner's Omni (private ops runbook), pairing env set (outside the repo).
2. AppImage installed on the second machine; pairing completed from WhatsApp; Omni UI live there.

**Interfaces:**
- Consumes: Groups 2–5.
- Produces: evidence (screenshots, key listed, events) in the PR body.

**Acceptance Criteria:**
- [ ] `POST /pair/start` on the owner's Omni answers; a pairing completes from the owner's self chat.
- [ ] The second machine's app shows the owner's channels.

**Validation:**
```bash
curl -fsS -X POST "$OMNI_URL/api/v2/pair/start" -H 'content-type: application/json' -d '{"deviceName":"probe"}' | grep -q pairingId
```

**depends-on:** Group 5

---

## QA Criteria

- [ ] A fresh machine pairs with no key typed and sees its channels.
- [ ] Pairing off by default: a server without the flag answers 404 on pairing routes.
- [ ] Existing CLI commands and the existing DSH plugin users are unaffected.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Abuse of the unauthenticated start route | Medium | No outbound sends; per-IP limits in Postgres; codes approve only from owner self chat / allowlist. |
| Bundled DSH size and RAM | Medium | Measure in the prototype; remote-only first. |
| Unsigned dmg blocked by Gatekeeper | Medium | Labelled labs/unsigned; no bypass instructions in the default flow. |
| Self-chat messages not delivered as `message.received` with `fromMe` | Medium | Verify on the owner's instance before relying on it; allowlist covers a second phone. |
| Plugin rename breaks existing installs | Low | Old home only copied on explicit opt-in. |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review — 2026-10-20, independent read-only reviewer: FIX-FIRST

Findings and how each was closed before or during execution:

1. Labs migration vs dev's next `when` → Decision 7 (`when` = 0085 + 1; idempotent SQL).
2. "Flag off → 404" needs the routes mounted before auth and declared → routes always mounted before `protectedApp`, 404 inside the handler; three `public-by-contract` declarations with inline privacy contracts.
3. `device.*` events have no NATS stream → events named `access.device_pairing_started` / `access.device_paired` on the existing ACCESS stream; distinction from `access.pairing_*` stated in the commit.
4. No top-level `fromMe` → owner approval reads `rawPayload.key.fromMe`, `rawPayload.isFromMe`, `key.remoteJid === selfJid` (from the WhatsApp plugin's self identity), not quoted/forwarded/protocol/history-sync, and the message must not predate the pairing; allowlist reads `resolvedSenderPhone` for LID senders. Omni's own sends are dropped as echoes before `message.received`.
5. Security → per-IP limiter via the shared trusted-proxy rule (`requestClientIp`), per-instance pending cap, key minted at the consuming poll, multitenancy refused, envelopes classified; confirm-reply and HMAC answered in Decisions 8 and 9.
6. Interfaces → consumer added to `consumer-config.test.ts`.
7. CI policy → no workflow merges or publishes on `labs` (release/publish workflows are tag- or dispatch-only); plugin and desktop jobs added to `ci.yml`. Not added: `if:` guards on dispatch-only release workflows (a maintainer dispatch is a deliberate act).
8. Release contradiction → no release is published from labs; `omni desktop` reads releases tagged `omni-desktop-v*` with `SHA256SUMS` and works with `--path` until one exists.
9. Isolation criterion narrowed to the plugin's own files (Sessions are dsh's); proven by `test/isolation.test.js` and on the second machine (0 files changed under its `~/.dsh`).
10. Sizing → kept as one PR into `labs` per the request, in reviewable commits per slice.

### Execution evidence — 2026-10-20

- API: `device-pairing.test.ts` 19/19, `device-pairing-postgres.test.ts` 12/12 on a disposable PostgreSQL 18 cluster; route-ownership, OpenAPI and consumer-config suites green; `make verify-migrations` OK. The pg-gate's one failure (`upgrade-2.260902.5-to-2.260908.20` catalog fingerprint) reproduces on a checkout without this change under PostgreSQL 18.
- Plugin: 688/688 (`npm test`), lint, generated files current.
- Desktop: 7/7 main-process tests; AppImage 251 MB, deb 208 MB; ~1.0 GB RSS idle.
- CLI: 913/913.
- Owner's Omni: labs build `2.261019.10-labs.1` deployed with backup and health check; migration 0086 applied (87/87); pairing enabled on the owner's WhatsApp instance.
- End to end on a second machine (Ubuntu 26.04, sandboxed window): the app showed a code; the code sent over WhatsApp from an allowlisted number approved it; the app went live with the owner's four channels; the key minted had 28 scopes (none of `*`, `keys`, `settings`, `trust`) and a 90-day expiry; the link file was 0600; nothing changed under that machine's own `~/.dsh`. The test key was revoked afterwards. The owner self-chat path awaits a person typing the code on the phone.

---

### Code review of the branch — 2026-10-20, independent read-only reviewer: FIX-FIRST → fixed

1. Desktop update erased the user's dsh settings (profile folder replaced) → `788e52ec1`: an update replaces node_modules and package.json only.
2. A send-only key could approve as owner if the echo set missed Omni's own send → `6f47d563d`: owner approval requires Baileys `notify` (Omni's own sends are `append`). Verified live: the code sent by Omni from the pairing instance to its own number did not approve.
3. LID-addressed self chats never matched → `6f47d563d`: `remoteJidAlt` accepted, tested.
4. Two IPs could hold the pending cap → `6f47d563d`: 3 pending per client IP in Postgres, tested.
5. A minted key could be dropped by a racing poll → `96b7b8bf6`: one poll in flight per host; a reply carrying a key is always saved; 30 s poll timeout.
6. `omni desktop` reused a stale unpack by name → `472ca01ce`: keyed by SHA-256.
7. A failed start left dsh running → `788e52ec1`.
8. Off routes leaked rate-limit headers → `6f47d563d`: off answers before the limiter.
9. SHA256SUMS proves integrity, not origin → open: sign the sums with the existing cosign identity when desktop releases are cut.

Second end-to-end on the second machine with the fixed build (`2.261019.10-labs.2` on the server): the allowlisted number approved; Omni's own send to itself did not; both test keys revoked.

### Login redesign and its review — 2026-10-20

The owner asked for frictionless login with a human ID and one library instead of two harnesses: the hand-rolled pairing (Group 2) was replaced by Better Auth 1.7.7 — claim by a WhatsApp-verified number, owner codes in the self chat, passkeys, RFC 8628 device flow, device keys (`d34c04561`, `c03c96175`). Pocket ID was considered and set aside: passkeys only, no phone verification.

Independent read-only review: FIX-FIRST → fixed in `c12a34712` and the plugin commit after it:
1. Device token was a full owner session → Authorization stripped before Better Auth; device-flow sessions marked (`device_client_id`, migration 0087); device-key accepts only those, consumes them atomically before minting.
2. Mint-then-revoke, endless client polling → consume first; client treats 400/401 as terminal and stops at expiry.
3. Better Auth limiter trusted client X-Forwarded-For; code flooding → Better Auth limiter off, Omni limiters on /api/auth; one code a minute, ten a day per number.
4. Status leaked the owner's number → number only via /api/login/whatsapp for a live device request.
5. No consent context on WhatsApp approval → confirmation names client, address and time, with revoke hint.
6. Two-owner race; non-constant-time token compare → single-row unique index; timingSafeEqual.

Deployed as `2.261019.10-labs.6` (labs.3 had rolled back automatically on a bundle-only startup crash, fixed by loading reflect-metadata first in the server entry).

## Files to Create/Modify

```
.github/workflows/ci.yml
.github/workflows/commitlint.yml
packages/db/src/schema.ts
packages/db/drizzle/0086_device_pairings.sql
packages/db/drizzle/meta/_journal.json
packages/core/src/events/types.ts
packages/api/src/services/device-pairing.ts
packages/api/src/services/__tests__/device-pairing.test.ts
packages/api/src/routes/v2/pairing.ts
packages/api/src/routes/v2/__tests__/pairing.test.ts
packages/api/src/plugins/device-pairing.ts
packages/api/src/schemas/openapi/pairing.ts
packages/api/src/routes/openapi.ts
packages/api/src/app.ts
packages/api/src/index.ts
apps/omni-ui-dsh/** (home, credential, updater, pairing UI, tests)
apps/omni-desktop/** (new)
packages/cli/src/commands/desktop.ts
packages/cli/src/index.ts
```
