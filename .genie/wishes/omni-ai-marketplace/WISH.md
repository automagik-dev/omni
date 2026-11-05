# Wish: Omni welcomes you, connects your AI, and ships as an Automagik marketplace

| Field | Value |
|-------|-------|
| **Status** | EXECUTED |
| **Slug** | `omni-ai-marketplace` |
| **Date** | 2026-10-20 |
| **Author** | Felipe Rosa (owner), planned by Claude |
| **Appetite** | medium |
| **Branch** | `labs-distribution` (same PR #1310 into `labs`, as the owner asked: "same PR") |
| **Repos touched** | automagik-dev/omni |
| **Design** | _No brainstorm — direct wish_ |

## Summary

The first minutes with Omni become one immersive, sci-fi onboarding led by the Omni octopus: claim (done, on
the server's claim page), connect your Omni, connect an AI. "Connect AI" is bring-your-own provider through what
DSH 0.2.1-rc.2 already ships — Omni writes no provider or gateway code. Omni's DSH plugins are listed in an
Automagik plugin marketplace index any raw DSH can add, so "install on top of raw DSH" is one of the install
methods; the index also lists the vetted third-party provider plugins.

## Scope

### IN

- A new plugin, `apps/omni-ai-dsh` (`@automagik/omni-ai-dsh`): octopus onboarding steps on DSH's
  `settings.onboarding` slot (welcome, connect AI) and the Connect AI tiles with a small host endpoint.
- Connect AI tiles, all through rc.2's own machinery: DeepSeek (DSH's native sign-in), Codex, Claude, Kimi
  (pi-ai's built-in OAuth), Z.ai and OpenCode and any other pi-ai provider (API key), and CLIProxyAPI (a pi-ai
  custom OpenAI-compatible route written through `ctx.settings`).
- `apps/omni-ui-dsh` registers its existing Omni connect card as an onboarding step between the two.
- An Automagik marketplace index (`marketplace/automagik.json`, DSH market index format 1) listing
  `@automagik/omni-dsh` and `@automagik/omni-ai-dsh` as git sources pinned to omni commits, and the vetted
  third-party plugins as npm sources at exact versions; a checker run in CI.
- The desktop app bundles `omni-ai-dsh` and opens on the octopus (DSH's own welcome notice and credential step
  switched off in Omni's profile).
- A labs build of the desktop app and an end-to-end first-run test on the second machine.

### OUT

- An Omni LLM gateway (owner: "i intend to have a gateway, but not now"); CLIProxyAPI's management-secret OAuth.
- Installing third-party plugins from inside Omni (no in-app `installBundle`): rc.2's pi-ai already ships the
  Codex, Claude and Kimi sign-ins, and the desktop app has no pnpm for DSH's installer. The add-ons are listed in
  the market for raw DSH, where the user's DSH installs them with its own consent dialog.
- The DSH market inside the desktop app (needs pnpm in the app; trigger: a later wish ships it).
- Migrating existing desktop installs' profiles (the seed applies to new profiles; labs has one tester).
- Splitting `apps/omni-ui-dsh` (30k lines) into omni-core / omni-team / omni-genui / omni-automations: a sibling
  wish `omni-plugin-split`, sized on its own (expand, migrate, contract).
- Publishing to npm or tagging from `labs`; Z.ai OAuth (none exists); Windows.
- Rejected plugins: `dsh-opencode-free` (impersonates the OpenCode CLI), `@opencode2dsh/dsh-plugin` (public
  proxy pools), `dsh-model` and every plugin that copies tokens out of other apps.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Connect AI drives DSH's own sign-ins; no provider code and no plugin installs from Omni. | Owner: "explore the ones you can find already existing dsh plugins, lets not waste energy developing." Vetting (2026-10-20): rc.2's `dsh-llm-pi-ai` ships Codex, Claude, Kimi OAuth and Z.ai/OpenCode key routes (`dsh-llm-pi-ai/lib/index.js:2618,2693,2729`). Plan review: in-app `installBundle` needs pnpm the app lacks and bypasses DSH's consent. |
| 2 | Vetted add-ons appear only in the Automagik market, pinned exact: `dsh-codex-subscription@3.1.3`, `dsh-oh-my-claude@1.5.4`, `dsh-kimi-subscription@1.3.10`, and `dsh-opencode-go@0.1.24` labelled untested on rc.2. | DSH's own market installs them after its trust dialog; the pin is the reviewed artifact. |
| 3 | Subscription sign-in tiles (Codex, Claude, Kimi) carry "personal use under the vendor's terms"; API-key paths come first. | Each uses a consumer plan through another CLI's OAuth client. |
| 4 | CLIProxyAPI: the key goes to `ctx.credentials.set('OMNI_AI_CLIPROXY_API_KEY', …)`; the route is written with `ctx.settings.update('llm-pi-ai', {providers: {cliproxy: {api:'openai-completions', baseURL, apiKeyEnv:'OMNI_AI_CLIPROXY_API_KEY', models:[…]}}}, revision)` (a deep merge that keeps other routes; `revision` from `describe()`), models from `GET {baseURL}/models` with that key; an empty list refuses the save. | A credential reference must be env-name shaped (`dsh-credentials/README.md:176`); pi-ai refuses a custom route without models (`dsh-llm-pi-ai/README.md:119`). |
| 5 | Onboarding steps register with `ctx.slots.inject('settings.onboarding', () => ctx.slots.register(…))`, draw their own modal and make `#root` inert, and keep a durable done flag in the plugin's own settings entry (`omni-ai`, declared by the plugin's bundle patch with volatile fields); a step whose flag is set calls `complete()` at once. A tile that opens a settings section first calls `complete()` (or renders nothing), then `openSection`, so the modal never covers the section. | The slot contract (`dsh-client-ui-settings/.../slots.d.ts:91-168`); DSH clears completed steps from React state when the session changes (`dsh-client-ui-settings-general/lib/client.js:354-371,420`). |
| 6 | Order: `omni-welcome` −300, `omni-connect` −250, `omni-connect-ai` −200, ahead of DSH's `welcome-notice` (−100) and `deepseek-official` (0). The desktop profile seeds `ui-settings-general.welcomeNoticeVersion: '2026-09-28.1'` (quoted; compared exactly) and `ui-settings-models.credentialOnboarding: false`, so DSH's own steps do not show there; on a raw DSH they follow Omni's. | The octopus opens the app; DeepSeek sign-in lives in Connect AI (`dsh-client-ui-settings-models/lib/client.js:4396-4517`). |
| 7 | Market entries for Omni's plugins are git sources (`{type:'git', url, commit, path}`); PR #1310 merges with a merge commit (not squash) so pinned commits stay reachable; the checker requires each commit to be an ancestor of the checked-out HEAD. | No npm publish from labs; a squash would orphan the pins. |
| 8 | One wish for onboarding and marketplace. | Owner: "Both in one wish". |

## Simplicity Case

- **Simplest complete design:** one small plugin (two steps, a frozen tile list, one host endpoint with three
  actions: `state`, `done`, `cliproxy`), one JSON index with a checker, and profile/runtime lines in the desktop app.
- **Added machinery:** the host endpoint (credentials and settings live on the host); the index checker (a commit
  that lacks the named package fails silently in every user's market).
- **Deferred until measured:** a gateway; in-app plugin installs and the in-app market (trigger: pnpm in the app);
  profile migration for existing installs; automatic re-vetting of add-on versions.
- **Complexity removed:** no provider adapters, no `installBundle`, no consent UI of our own, no token import, no
  npm publishing, no hosted index service.

## Dependencies

**depends-on:** omni-labs-distribution
**blocks:** none

## Success Criteria

- [ ] A fresh desktop profile opens on the octopus welcome, then Connect Omni, then Connect AI; DSH's own
      welcome notice and credential step do not appear; a finished or skipped step never returns, across reloads.
- [ ] Each Connect AI tile reaches its sign-in: DeepSeek's sign-in, the Models section for pi-ai providers, and
      the CLIProxyAPI form, whose save makes the gateway's models selectable with no secret in settings.
- [ ] `marketplace/automagik.json` passes `parseMarketIndex`, and every git entry's commit is reachable and holds
      a `package.json` at `path` whose name and version match (checked in CI).
- [ ] A raw DSH that adds the index URL lists and installs `@automagik/omni-dsh` from its market.
- [ ] The desktop isolation test (nothing written under the user's own DSH home) still passes.

## Execution Strategy

### Wave 1

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | medium: new plugin on rc.2 contracts (slots, settings, credentials), client bundle build | inherit | `omni-ai-dsh`: onboarding steps + Connect AI |

### Wave 2 (after Wave 1, parallel: disjoint files)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | low: JSON + checker + CI | inherit | Automagik marketplace index |
| 3 | engineer | low: profile seed, runtime bundling, one onboarding registration + bundle rebuild | inherit | Desktop profile + omni-ui-dsh connect step |

### Wave 3

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 4 | engineer | medium: build, second machine, screenshots | inherit | Labs build and first-run e2e |

**Global constraints:**
- Generated files (each plugin's committed `client.js`) do not count toward a group's insertion band; source does.
- DSH engine range for new entries: `>=0.2.1-rc.2 <0.3.0`.
- No secret in configuration files: keys go to `ctx.credentials`; routes reference them by an env-shaped name.
- No production specifics in the repo (hostnames, numbers, instance names).
- Plugin layout follows `apps/omni-ui-dsh`: plain ESM sources, `scripts/build-client.mjs` producing a committed
  `client.js` checked by `--check`, `npm test` with `--import ./test/harness-resolve.mjs`, `npm run lint`.
- Bun for repo tooling; commits `type(scope): description`; nothing published from `labs`.

## Execution Groups

### Group 1: `omni-ai-dsh` — the octopus welcome and Connect AI

**Goal:** a DSH with this plugin greets the user with the Omni octopus and connects an AI provider.

**Deliverables:**
1. `apps/omni-ai-dsh/` (`@automagik/omni-ai-dsh` 0.1.0, `dsh-plugin` keyword, `.` host and `./client`
   exports, peer deps on `@deepseek-ai/cordis`), build/test/lint scripts and harness copied from omni-ui-dsh,
   committed `client.js`, README, LICENSE/NOTICE, and a bundle patch (`dsh.bundle.patch` / `cordis.patch.yml`)
   inserting the plugin row `id: omni-ai` whose Config holds volatile fields `welcomeDone`, `connectAiDone`
   (and `connectOmniSkipped` for Group 3) — without it DSH's installer refuses the package as `not-bundle`.
2. Client: steps `omni-welcome` (−300: octopus, typewriter bubble, glitch, reduced motion respected) and
   `omni-connect-ai` (−200: tiles, vendor-terms notes, skip), registered per Decision 5 with durable done flags
   in the `omni-ai` settings namespace.
3. Tiles: DeepSeek → `openSection` for the account sign-in; pi-ai providers → `openSection('models')`;
   CLIProxyAPI → a form (URL, key) calling the host.
4. Host: endpoint `omni-ai` with `state` (done flags, whether a DeepSeek account or any pi-ai route is configured),
   `done {stepId}` (writes the flag through `ctx.settings.update('omni-ai', …)`), and `cliproxy {baseURL, apiKey}` per Decision 4.
5. Tests: cliproxy stores the key only in credentials, merges rather than replaces existing routes, refuses an
   empty model list and a non-http(s) URL; done flags short-circuit the steps.
6. CI job `omni-ai-dsh` copied from the omni-ui-dsh job (`.github/workflows/ci.yml:501-543`).

**Interfaces:**
- Consumes (host declares `inject: ['settings', 'credentials']`): rc.2 `ctx.slots.inject/register` (`settings.onboarding`, props `{stepId, explicit?, complete(), openSection(id)}`);
  `ctx.credentials.set/resolve`; `ctx.settings.describe()` and `ctx.settings.update(entryId, patch, expectedRevision?: number)`.
- Produces: package `@automagik/omni-ai-dsh` at `apps/omni-ai-dsh`; step ids `omni-welcome` (−300), `omni-connect-ai` (−200);
  settings entry `omni-ai` (fields `welcomeDone`, `connectAiDone`, `connectOmniSkipped`); endpoint actions `state`, `done {stepId}`, `cliproxy`; credential name `OMNI_AI_CLIPROXY_API_KEY`; route id `cliproxy`.

**Acceptance Criteria:**
- [ ] The `cliproxy` tests in deliverable 5 pass.
- [ ] `node scripts/build-client.mjs --check` passes against the committed bundle.

**Validation:**
```bash
cd apps/omni-ai-dsh && npm test && npm run lint && node scripts/build-client.mjs --check
```

**depends-on:** none

---

### Group 2: Automagik marketplace index

**Goal:** any DSH can add one URL and install Omni's plugins from its market.

**Deliverables:**
1. `marketplace/automagik.json` (format 1): `title`, `description`, `metadata.categories`, and entries for
   `@automagik/omni-dsh` (git, `apps/omni-ui-dsh`), `@automagik/omni-ai-dsh` (git, `apps/omni-ai-dsh`), and the
   Decision 2 add-ons (npm), each version with `publishTimestamp` and `engines.dsh`.
2. `scripts/marketplace.ts`: `check` (parseMarketIndex; for each git entry, fetch the commit if absent, require it
   to be an ancestor of HEAD, and `git show <commit>:<path>/package.json` name and version to match) and
   `pin <ref>` (rewrites Omni's git entries to the ref's commit and versions).
3. `make marketplace-check` in `make check`; a CI step with full history for it.
4. `marketplace/README.md`: the index URL and how to add it to a raw DSH.
5. One scratch install proving a git `path` entry installs from the monorepo (recorded in the PR).

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-plugin-market-index` `parseMarketIndex` (exact dev dependency); Group 1's package.
- Produces: `marketplace/automagik.json`, served at `https://raw.githubusercontent.com/automagik-dev/omni/labs/marketplace/automagik.json`.

**Acceptance Criteria:**
- [ ] `make marketplace-check` exits 0 on the index and non-zero on an unreachable commit or a name/version mismatch.

**Validation:**
```bash
make marketplace-check
```

**depends-on:** 1

---

### Group 3: Desktop profile and the Connect Omni step

**Goal:** the desktop app opens on the octopus and walks the three steps.

**Deliverables:**
1. `apps/omni-desktop/profile/package.json` depends on `@automagik/omni-ai-dsh` and lists it in `dsh.profile.bundles`; `profile/cordis.patch.yml`
   seeds `ui-settings-general.welcomeNoticeVersion` and `ui-settings-models.credentialOnboarding: false`.
2. `apps/omni-desktop/scripts/prepare-runtime.mjs` packs both Omni plugins, writes both packed versions into the
   profile's `dependencies`, and installs both tarballs in one `--no-save` install.
3. `apps/omni-ui-dsh`: step `omni-connect` (−250) wrapping the existing connect card, completing on pair, skip,
   or an existing link; the skip is kept through omni-ai's `done {stepId:'omni-connect'}` when omni-ai is present,
   else in omni-ui-dsh's own storage (a missing omni-ai endpoint means local storage, not an error); `client.js` rebuilt.

**Interfaces:**
- Consumes: Group 1 package and step ids.
- Produces: step `omni-connect` (−250).

**Acceptance Criteria:**
- [ ] Desktop and omni-ui-dsh suites pass, including the isolation test; the bundle check passes.

**Validation:**
```bash
cd apps/omni-desktop && npm test && cd ../omni-ui-dsh && npm test && npm run lint && node scripts/build-client.mjs --check
```

**depends-on:** 1

---

### Group 4: Labs build and first-run end to end

**Goal:** prove the onboarding on the second machine against the owner's Omni.

**Deliverables:**
1. A labs AppImage installed on the second machine through `omni desktop`, with a fresh `~/.omni/desktop`
   (the previous one moved aside, not deleted).
2. Screenshots of each step; Connect Omni pairs through the device flow; Connect AI reaches DeepSeek sign-in and
   the CLIProxyAPI form.
3. Market check from a raw DSH: add the index URL from the `labs-distribution` branch (the `labs` URL exists only
   after PR #1310 merges), see Omni's plugins listed.
4. PR #1310 body updated; Review Results appended.

**Interfaces:**
- Consumes: Groups 1–3.
- Produces: none.

**Acceptance Criteria:**
- [ ] The three steps appear once each, in order, and none returns after a restart.

**Validation:**
```bash
make check
```

**depends-on:** 2, 3

---

## QA Criteria

- [ ] Fresh desktop install: welcome → connect Omni → connect AI → done; restart does not replay finished steps.
- [ ] A raw DSH with the index URL added installs `@automagik/omni-dsh` from the market.
- [ ] Existing Omni plugin tests and the API login suites still pass.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Git-source install of a monorepo subpath fails in DSH's installer | Medium | Group 2's scratch install before listing; fallback is npm entries after a publish (owner decision). |
| `settings.onboarding` is internal to rc.2 and may change | Medium | Engine range `<0.3.0`; the steps are also reachable from the plugin's own tab. |
| Squash-merging PR #1310 orphans pinned commits | Medium | Decision 7: merge commit; the checker fails on unreachable commits. |
| Subscription OAuth breaches vendor terms for business use | Medium | Tile note; API-key paths first. |

---

## Review Results

### Plan review — 2026-10-20 — FIX-FIRST (independent reviewer, read-only)

Blocking: (1) credential references must be env-shaped and routes need models; (2) onboarding needs durable done
flags and DSH's own steps handled; (3) desktop bundles live in `profile/package.json`, the seed applies only to new
profiles, prepare-runtime packs one plugin; (4) in-app `installBundle` needs pnpm the app lacks and npm-404s the
profile's own dependency; (5) the client half needs a build and a committed bundle; (6) validation commands were
wrong (biome ignores `omni-*`, tests need the harness import, CI fetch depth). Advisory: index fields, pin
reachability under squash, add-ons redundant with pi-ai, consent on the host, pi-ai discovery.
Resolution: this revision — Decisions 1, 2, 4–7 and Groups 1–3 rewritten; in-app installs and the in-app market moved OUT.

### Plan re-review — 2026-10-20 — FIX-FIRST (same reviewer)

The six blockers resolved. New: (A) the `omni-ai` settings entry needs a bundle patch; (B) the profile must list the
bundle in `dsh.profile.bundles`; (C) a `done` action must write the flags; advisory (D) settings API is
`describe()` + `update(ns, patch, revision)`; (E) complete before `openSection`; (F) market check URL before merge;
(G) generated bundles and the insertion band. Resolution: all applied in Decisions 4–6, Groups 1, 3, 4 and Global constraints.

### Plan final check — 2026-10-20 — APPROVED (same reviewer)

A–G resolved. Advisory, applied: Simplicity Case names three actions; the host declares `inject: ['settings', 'credentials']`;
omni-ui-dsh treats a missing omni-ai endpoint as local storage.

### Execution review — 2026-10-20 — FIX-FIRST, then SHIP (independent reviewer, read-only)

Commits: b1ed5c4ee (G1), eb50dacaf 37f438f18 (G2), f8e92f659 54ddd408a (G3), 58a5dee46 df23b65e0 (bump, pin).
Blocking: the DeepSeek tile opened `account`, a section DSH registers only once an account is signed in — also
caught by the first-run test on the second machine. Advisory: uncapped `/models` body; key stored before the route
save; `pin` could re-point a listed version; unbounded fetch in a test; rail assumes both plugins; CI double run.
Fixes 715ee41dc, 324170774, ef3ea785b (omni-ai-dsh 0.1.1); the rail left as cosmetic; CI runs the gate once.
Re-review: SHIP — omni-ai-dsh 20/20, marketplace-check 6 pass + "6 plugins ok".

Live evidence (Group 4): labs.3 on a fresh `~/.omni/desktop` on the second machine opened on the octopus, walked
Welcome → Connect Omni (the owner's Omni answered "no owner yet") → Connect AI, the DeepSeek tile reached Models, and
a restart showed no onboarding. A stock DSH with only the market bundle and this index (from `labs-distribution`)
listed all six entries and installed `@automagik/omni-dsh` 0.1.8 from its git source after DSH's trust dialog, in a
profile with DSH's standard `pnpm-workspace.yaml` (`autoInstallPeers: false`).

---

## Files to Create/Modify

```
apps/omni-ai-dsh/**                                  (new; includes generated client.js)
marketplace/automagik.json, marketplace/README.md    (new)
scripts/marketplace.ts                               (new)
Makefile, .github/workflows/ci.yml                   (marketplace-check, omni-ai-dsh job)
package.json, bun.lock                               (exact dsh-plugin-market-index dev dependency)
apps/omni-desktop/profile/package.json, apps/omni-desktop/profile/cordis.patch.yml
apps/omni-desktop/scripts/prepare-runtime.mjs
apps/omni-ui-dsh/src/client/omni-connect.js, apps/omni-ui-dsh/src/client/index.js, apps/omni-ui-dsh/client.js
```
