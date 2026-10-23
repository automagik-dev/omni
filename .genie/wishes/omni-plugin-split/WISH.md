# Wish: Omni's plugins split, a marketplace of Omni's own, one version, and a release to @next

| Field | Value |
|-------|-------|
| **Status** | EXECUTED |
| **Slug** | `omni-plugin-split` |
| **Date** | 2026-10-21 |
| **Author** | Felipe Rosa (owner), planned and executed by Claude |
| **Appetite** | large |
| **Branch** | `labs-distribution` → PR #1310, retargeted from `labs` to `dev` |
| **Repos touched** | automagik-dev/omni |
| **Design** | _No brainstorm — direct wish (owner's goal: "pr > dev so that it can get published on @next, break the plugins down, build our own market place, and finish the leftovers one after the other; the plugin version should match the omni version")_ |

## Summary

The one 30k-line Omni DSH plugin becomes three: the team (core), channels and canvases. Every Omni release carries its plugins at its own version and serves them as the Automagik marketplace at `/api/market`. Each dev cut publishes the desktop app that `omni desktop` downloads. The leftovers from `omni-ai-marketplace` are closed: installs inside the app, updates of existing desktop profiles, and the onboarding rail.

## Scope

### IN
- Version sync covers `apps/*-dsh` and `apps/omni-desktop`, with their package-lock.json.
- Plugin split: `@automagik/omni-dsh` (core, `omniTeam`), `@automagik/omni-channels-dsh`, `@automagik/omni-canvas-dsh`, sharing core's client module through `dsh.client.external`.
- The Automagik marketplace in the API: index, npm registry, catalog page; the plugins packed into the CLI tarball and the image.
- The desktop release workflow, called from each dev cut; macOS signing and notarization when secrets exist.
- Desktop: pnpm and node shims on Electron as Node; vendored plugin tarballs (`file:` dependencies); profile updates that keep the user's settings and plugins; the linked Omni's market added to DSH's plugin market.

### OUT
- An LLM gateway of Omni's own (owner: not now).
- CI signing secrets (owner's account); Intel macOS builds; auto-update.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Three plugins, not five | The Bot team is one dense cluster (turns ↔ groups ↔ tools ↔ store); automations live on Omni events, so they go with channels. |
| 2 | Plugins carry Omni's calver | Owner's rule; one version answers "which plugins does this Omni serve". |
| 3 | Each Omni is a marketplace (npm source with its own registry) | DSH's index supports `{type:'npm', registry}`; nothing is published to npm, and a plugin's version always matches the server's. |
| 4 | Packed with `bun pm pack` | Same files as `npm pack`; the Docker image needs nothing beyond Bun. |
| 5 | Vendored tarballs in the desktop profile | pnpm resolves Omni's own plugins offline whatever registry a market install asks. |
| 6 | The linked Omni's market is offered once per link, https or loopback only | No extra step for the user who paired; a removed index stays removed; no plugin source over plain http. |

## Simplicity Case

No new service: the marketplace is four routes on the existing API, reading files the release already carries. The split reuses DSH's own `provide`/`inject` and client externals. The release workflow is one reusable workflow called like the dev image.

## Dependencies

**depends-on:** omni-ai-marketplace
**blocks:** none

## Success Criteria

- [x] `verify-versions` holds 37 fields, plugins and lockfiles included.
- [x] Core 658, channels 66, canvases 12, welcome 21, desktop 15 tests pass; client build checks pass.
- [x] The Main Bot prompt is byte-identical with all three plugins (fixture).
- [x] `/api/market/index.json` validates with DSH's `parseMarketIndex`; pnpm installs from an Omni's registry.
- [x] The desktop app boots with all four plugins; Connect Omni pairs against a live Omni.
- [x] An existing paired install upgrades in place with its settings and link kept.
- [x] Independent review: SHIP after fixes.

## Execution Strategy

### Wave 1
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Version sync |
| 2 | engineer (worktree) | Marketplace in the API |
| 3 | engineer (worktree) | Plugin split, groups 1–6 |
| 4 | engineer | Desktop release, pnpm, profile updates, rail |

### Wave 2
| Group | Agent | Description |
|-------|-------|-------------|
| 5 | engineer | Integrate: desktop ships the split, market wiring, static index |
| review | reviewer | Independent read-only review, fixes, re-review |

## Execution Groups

### Group 1: Version sync
**Goal:** The plugins and the desktop app carry Omni's version.
**Deliverables:** `scripts/lib/version-fields.ts` covers them and their lockfiles.
**Interfaces:** `getAllVersionFields()` unchanged.
**Acceptance Criteria:** `bun scripts/verify-versions.ts` passes.
**Validation:** `bun test scripts/verify-versions.test.ts`
**depends-on:** none

### Group 2: Marketplace
**Goal:** Every Omni serves its release's plugins.
**Deliverables:** `scripts/pack-market.ts`, `packages/api/src/market/*`, route ownership, Dockerfile.
**Interfaces:** `GET /api/market`, `/api/market/index.json`, `/api/market/npm/*`.
**Acceptance Criteria:** index validates; packument and tarball integrity; 302 for other names; no traversal.
**Validation:** `bun test packages/api/src/market scripts/pack-market.test.ts`
**depends-on:** Group 1

### Group 3: Plugin split
**Goal:** Core, channels and canvases.
**Deliverables:** `apps/omni-channels-dsh`, `apps/omni-canvas-dsh`, core hooks and client registries, CI jobs.
**Interfaces:** `ctx.provide('omniTeam')`, `rt.hooks.{endpoint,view,live,mainRules}`, client `omni` export.
**Acceptance Criteria:** suites pass; prompt byte-identical.
**Validation:** `npm test && npm run lint && node scripts/build-client.mjs --check` in each plugin
**depends-on:** Group 1

### Group 4: Desktop and release
**Goal:** `npx @automagik/omni@next desktop` finds a build; installs work in the app.
**Deliverables:** `desktop-release.yml`, `version.yml` job, shims, profile merge.
**Interfaces:** release `omni-desktop-v<version>` with `SHA256SUMS`.
**Acceptance Criteria:** actionlint clean; release contract passes; desktop tests pass.
**Validation:** `node --test test/*.test.js` in apps/omni-desktop; `bash scripts/release/release-workflow-contract.test.sh`
**depends-on:** Group 1

### Group 5: Integrate and verify
**Goal:** Everything together, live.
**Deliverables:** desktop profile with four plugins and the plugin market; static index entries; deploys.
**Interfaces:** —
**Acceptance Criteria:** the repo gate is green; second machine and Mac upgraded.
**Validation:** `bun run typecheck && bunx biome check . && bunx knip && make verify-migrations && make verify-versions && make marketplace-check && LOG_LEVEL=silent bun run test`
**depends-on:** Groups 2, 3, 4

## QA Criteria

- [x] Linux app on a virtual display: onboarding with three steps, Connect Omni code and QR from the live Omni.
- [x] The second Linux machine upgraded in place: plugins, plugin-market row, the linked Omni's market added once.
- [x] Mac: built and signed with the Developer ID, dsh running on Electron as Node with four plugins.
- [x] A market add-on installs with the app's own pnpm into the shipped profile.

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No signing secrets in CI | Medium | CI's dmg is unsigned until the owner adds them; local Mac builds are signed. |
| Notarization | Low | Waits for a notarytool profile on the owner's Mac. |
| Merging with a squash | High | `marketplace/automagik.json` pins branch commits: merge with a merge commit. |

## Review Results

### Execution review — 2026-10-21 — FIX-FIRST, then SHIP (independent reviewer, read-only)
- **First pass, FIX-FIRST.**
  - Blockers:
    - The market test asserted the old title; turbo replayed a cached pass.
    - The Docker builder could not resolve the static index or the packer.
  - Should-fix:
    - Host-derived URLs were cached publicly.
    - The market was offered over http and at the server-reported address.
    - Link writes raced.
    - Updates dropped user-installed plugins.
    - A quit during startup left dsh running.
    - The app's node came first on PATH.
    - The release workflow inherited every secret, and its key file was never removed.
    - The CLI picked the newest release over its own version's.
  - All of these were fixed.
- **Re-review: SHIP.** One nit, removing the index where it was added, was fixed after.
- **Found while closing the reviewer's lockfile nit:** pnpm could not resolve Omni's plugins from npm in an installed profile. They are now vendored as `file:` tarballs.
- **CI on the PR:**
  - One commit header was over 100 characters. It was reworded; trees are unchanged, and the marketplace was re-pinned to the new hash.
  - The release contract's window was widened for the optional signing secrets.

## Files to Create/Modify

```
scripts/lib/version-fields.ts, scripts/verify-versions.test.ts
scripts/pack-market.ts (+ test), packages/api/src/market/*, packages/api/src/app.ts, packages/api/src/tenancy/route-ownership.ts
deploy/Dockerfile, turbo.json, knip.json, Makefile, marketplace/*
apps/omni-ui-dsh/** (core), apps/omni-channels-dsh/** (new), apps/omni-canvas-dsh/** (new), apps/omni-ai-dsh/src/client/*
apps/omni-desktop/{src,scripts,profile,runtime,test,assets}/*
.github/workflows/{desktop-release.yml,version.yml,ci.yml}, scripts/release/release-workflow-contract.test.sh
packages/cli/src/commands/desktop.ts (+ test)
```
