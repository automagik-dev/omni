# Wish: Canonical UI Consolidation (khal-ui → apps/ui) + Topology Doctrine

| Field | Value |
|-------|-------|
| **Status** | IN_PROGRESS |
| **Slug** | `canonical-ui-consolidation` |
| **Date** | 2026-08-12 |
| **Author** | Felipe Rosa |
| **Appetite** | medium-large |
| **Branch** | `wish/canonical-ui-consolidation` |
| **Repos touched** | omni (`apps/*`, root workspace, `packages/api`, `packages/cli`, `.github/workflows`, `deploy/`, `docs/`) |
| **Design** | _No brainstorm — direct wish_ (grounded in 2026-08-12 council deliberation, 4 lenses, consensus verdicts persisted below) |

## Summary

Make the Admin Harness (`apps/khal-ui`) the single canonical UI: delete the legacy `apps/ui`, move khal-ui into its place with sane `@omni/ui-*` names, dissolve its nested-workspace island into the root workspace, and give OSS one-box installs a working UI serving path. Alongside, write the deployment topology doctrine the council converged on — **one deployment = one tenant, at every scale** — into the repo, and propose the consequent re-scoping of the `omni-full-multitenancy` and `saas-platform-auth` wishes.

## Scope

### IN

- Resolve the `@khal-os/*` private-registry dependency question (currently khal-ui cannot be built without a `git.namastex.io` token) with an explicit OSS distribution decision.
- One atomic consolidation PR: delete `apps/ui`; `git mv apps/khal-ui apps/ui`; delete nested `bun.lock` + `tsconfig.base.json`; rename `package/`→`app/`, `service/`→`server/`; fold members into root workspaces **per Decision 5b** (shape depends on Group 1's distribution model); rename packages to `@omni/ui`, `@omni/ui-app`, `@omni/ui-server`, `@omni/ui-dev`; sweep every referencing path (Group 2 D2 is the authoritative list).
- Repoint the API's source-checkout SPA serving (`packages/api/src/app.ts:414-450`) and the tenancy route-ownership entries (`route-enumeration.ts:32`, `route-ownership.ts:142-159`) at the new UI dist so `make dev` keeps a UI and the ownership gate stays green.
- OSS one-box UI path: ship the prebuilt SPA + BFF in the npm package (`@automagik/omni`), and teach the CLI runtime (`omni start`/PM2 ecosystem) to run the BFF with the key it already manages — one-command install yields the canonical UI.
- CI gates for the canonical UI: wire its typecheck, tests, and `capabilities:check` drift gate into `ci.yml` (today nothing runs them despite `oci:omni-admin-ui` being a first-class release component).
- Topology doctrine document in-repo (one-line invariant + realm matrix rationale), and drafted amendment proposals for `omni-full-multitenancy` (defer RLS train behind a named trigger) and `saas-platform-auth` (narrow to single-deployment identity) — owner signs off before those wishes change.

### OUT

- Porting the ServerSwitcher/multi-server UI into the BFF — council P0: the BFF stays single-upstream, single-key, permanently. The ServerSwitcher component dies with `apps/ui`; the CLI named-server registry (shipped in `2155d857`) is the durable operator artifact. Any future web fleet view is a new wish with its own key-custody design.
- Executing the re-scope of `omni-full-multitenancy` / `saas-platform-auth` — this wish only drafts and proposes; those wishes change under their own governance after owner sign-off.
- Renaming external ops contracts: the `ghcr.io/automagik-dev/omni-admin-ui` image, `Dockerfile.admin-ui`, helm `adminUi:` block, and the `omni-admin-bff` systemd unit keep their names permanently (declared in the doctrine doc) — renaming them breaks deployed values files and runbooks for zero functional gain.
- Collapsing the four workspace members to two and evicting the 17M `evidence/` directory — council P2 follow-ups, separate wish, after the atomic PR proves stable.
- Porting `apps/ui`-only extras (`useFacebookSDK.ts` embedded signup, sparkline polish) — re-created in the canonical UI only when a page needs them.
- Any change to the KHAL OS host-auth model or the unmerged `wish/omni-appkit-gap` branch (role gating, per-user console keys) — that branch lands under its own wish; this wish must not conflict with it (Group 2 rebases if it merges first).

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `apps/khal-ui` → `apps/ui`, packages → `@omni/ui-*`; the repo never has zero or two things called "ui" | Council consensus (all 4 lenses). The vacated name is the honest one; `khal-ui` names a host platform, not the product. |
| 2 | BFF stays inside the app at `apps/ui/server/` (renamed from `service/`), not `packages/` | Exactly one consumer, deployment-coupled to the SPA (one image, one origin); promoting to `packages/` would assert shareability that does not exist. |
| 3 | One atomic PR for delete + mv + nested-workspace dissolution + renames + path sweep | Bun does not compose nested workspace roots: any sequencing where the mv lands before dissolution leaves root glob `apps/ui` matching a directory that is itself a workspace root — `bun install` undefined between PRs. Three lenses independently flagged the multi-PR failure mode. |
| 4 | No ServerSwitcher port; BFF single-upstream/single-key forever | A BFF holding N customer keys is a cross-customer credential aggregator (blast radius = every key at once) — incoherent with per-customer deployment isolation. Perf withdrew its port recommendation in round 2. The CLI registry survives untouched as the fleet-operator plane. |
| 5 | `@khal-os/*` resolution is a hard gate (Group 1) before the lockfile dissolution | The nested `bun.lock` pins private packages the root workspace has never resolved; without resolution the only remaining UI is Namastex-only-buildable, contradicting the OSS one-command constraint. Distribution fallback: OSS consumes prebuilt SPA dist (npm package/GHCR image) even if source builds stay token-gated — but that choice must be explicit and documented, not accidental. |
| 5b | Group 2 has two shapes, keyed to Group 1's outcome | Bun has no per-member install pruning: a root-workspace member's deps must resolve for `bun install` to pass. **Models (a) publish / (b) vendor:** full fold — `apps/ui/app`, `apps/ui/server`, `apps/ui/dev` all join root workspaces. **Model (c) prebuilt-artifact:** `apps/ui/server` and `apps/ui/dev`-sans-@khal-os join root; `apps/ui/app` (the `@khal-os`-consuming pack) stays OUT of root workspaces as a token-gated build island with its own minimal lock, and CI builds it only when `KHAL_NPM_TOKEN` is present. Either way the umbrella `apps/ui/package.json` **must drop its `workspaces` field** — a member-with-workspaces is the exact undefined state Decision 3 forbids. (Review finding 1/5.) |
| 5c | Versioning: extend `scripts/lib/version-fields.ts` walker to descend into `apps/ui` members | The walker only visits top-level `packages/*`/`apps/*` dirs (`version-fields.ts:163-172`); removing the `khal-ui` exclusion alone would version only the umbrella and leave the members at unmanaged `0.1.0`. (Review finding 5.) |
| 6 | OSS one-box serving: prebuilt `ui/` dist + BFF ship in the npm package; CLI runtime runs the BFF | The API's `app.ts` static serving of `apps/ui/dist` was the legacy path and only worked from source checkouts. The BFF is the canonical server (single-origin, key injection); the CLI already owns the API key and process supervision, so it supervises the BFF too. |
| 7 | Topology doctrine as repo invariant: "One deployment = one tenant; the database is single-tenant. OSS = single box, single tenant; enterprise = one deployment per customer (hml + prod realms); isolation between customers is infrastructure, never application code." | Council P1: the doctrine exists only in the owner's head and an LXC; undocumented simplifications get re-complicated by the next contributor. This one line makes the no-port decision, the RLS deferral, and one-command install consequences of a single rule. |
| 8 | External ops names (`omni-admin-ui` image, `omni-admin-bff` unit, `Dockerfile.admin-ui`, helm `adminUi:`) are permanent | Council P2 demanded an explicit settlement; renaming deployed contracts breaks every values file, runbook, and running box for cosmetic parity. Recorded in the doctrine doc so the seam is intentional, not drift. |
| 9 | Doctrine consequences are *proposed*, not executed, for the two affected wishes | `omni-full-multitenancy` is work-approved at risk:critical with in-flight groups; silently re-scoping an active critical wish from a sibling wish would bypass its governance. Simplifier's dissent (park entirely) vs perf's remnant (keep ownership columns) is preserved verbatim in the proposal for the owner to adjudicate. |

## Simplicity Case

- **Simplest complete design:** one `git mv` + one delete + name sweep in a single commit; UI serving moves to the component that already exists for it (the BFF); doctrine is one markdown file. No new services, no new build systems, no feature work.
- **Added machinery:** a CLI-supervised BFF process for one-box installs — required because deleting `apps/ui` removes the API's only SPA serving path and the BFF is the canonical, already-shipped alternative; CI gates for the UI — required because the release pipeline already treats `omni-admin-ui` as a first-class component that nothing currently tests.
- **Deferred until measured:** package collapse 4→2 (trigger: post-PR stability + a real friction measurement); `evidence/` eviction (trigger: same follow-up wish); web fleet view (trigger: a real demand, with key-custody design); RLS multitenancy (trigger: a named actor needing sub-tenancy inside one customer's deployment, or a decision to launch a shared hosted tier — with an EXPLAIN ANALYZE benchmark on the messages hot path before enforcement).
- **Complexity removed:** an entire duplicate UI (React 18 app, ~25 hooks, login flow, its knip/CI/Makefile surface); the nested-workspace island with its own lockfile and tsconfig; the false canonical encoded in root `workspaces: ["packages/*", "apps/ui"]`.

## Dependencies

**depends-on:** none
**blocks:** none

_Coordination edge (not a DAG dependency): `origin/wish/omni-appkit-gap` (53 files, +3275/−147) adds a **runtime** `@khal-os/sdk` dependency to the BFF (`service/package.json`) plus `auth.ts`/`console-keys.ts`/`roles.ts` and a `bff.ts` rewrite — it breaks the "zero-dep BFF" premise, not just the path. **Merge-order preference: this wish's Group 2 lands first**, appkit-gap rebases onto the new layout. If appkit-gap merges first anyway, Group 1's audit must cover the BFF's new runtime dep and Group 3's npm packaging switches to shipping the BFF **bundled** (`bun build` single-file) instead of as source, so consumer installs never resolve `@khal-os/*`. The doctrine proposals touch `omni-full-multitenancy` and `saas-platform-auth` governance but do not block or get blocked by them._

## Success Criteria

- [ ] `bun install && make check` green from a fresh clone **without** a `git.namastex.io` token, with the documented OSS build-or-consume path for the UI (Group 1 decision executed).
- [ ] `apps/ui` is the Harness: `git log --follow apps/ui/app/src` shows khal-ui history; no `apps/khal-ui` directory; no nested `bun.lock`/`tsconfig.base.json`; root workspaces list the folded members; all packages named `@omni/ui*`.
- [ ] Repo-wide sweep clean (the canonical command, identical to Group 2's AC): `rg "khal-ui|@omni/khal" -g '!*.lock' -g '!CHANGELOG*' -g '!docs/_internal/**' -g '!docs/design/omni-saas-wireframe/**' -g '!.genie/**'` → zero hits, wireframe-doc retentions listed in the PR description.
- [ ] `make dev` serves the canonical UI in a source checkout; the tenancy route-ownership gate passes.
- [ ] Fresh one-box install (`omni install`-equivalent on a clean disposable env) yields the canonical UI on the configured port with BFF key injection working — no browser-held key.
- [ ] CI runs the UI's typecheck + tests + `capabilities:check`; a seeded drift in capabilities.json fails CI.
- [ ] `docs/TOPOLOGY.md` (or agreed location) states the doctrine invariant verbatim (Decision 7) including the permanent-ops-names declaration (Decision 8).
- [ ] Amendment proposals appended under `## Review Results`-adjacent sections of `omni-full-multitenancy` and `saas-platform-auth` WISH.md files, each marked `PROPOSED — awaiting owner adjudication`, preserving the council's dissent verbatim.
- [ ] `make check` passes repo-wide with zero warnings; `bun install` wall-time and `make check` wall-time recorded before/after (hyperfine + time) in the PR description.

## Execution Strategy

### Wave 1 (sequential — hard gate)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | 4 — dependency archaeology + distribution decision with OSS-posture stakes (+2 subjective acceptance, +2 external-registry coupling) | engineer-complex / high | `@khal-os/*` audit and OSS build/consume path |

### Wave 2 (sequential — the atomic PR)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | 5 — workspace-graph surgery with undefined intermediate states (+2 stateful, +1 multi-package, +1 CI/release surface, +1 no deterministic test for "atomicity") | engineer-complex / high | Atomic consolidation PR |

### Wave 3 (parallel, after Wave 2)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 3 | engineer | 4 — npm packaging + process supervision across CLI runtime (+2 stateful, +1 multi-package, +1 release surface) | engineer-complex / high | OSS one-box serving path + CI gates |
| 4 | engineer | 2 — docs + governance proposals, review-heavy but mechanical (+2 subjective acceptance) | engineer-standard / medium | Doctrine doc + wish amendment proposals |

## Execution Groups

### Group 1: `@khal-os/*` dependency resolution and OSS distribution decision

**Goal:** The canonical UI has an explicit, documented, tested answer to "can someone without Namastex credentials build or obtain it?" before any structural change lands.

**Deliverables:**
1. Audit: exact list of `@khal-os/*` packages pinned by `apps/khal-ui/bun.lock` (`sdk`, `ui`, `types`, +transitives), their licenses, sizes, and what surface khal-ui actually imports from each — **including the `wish/omni-appkit-gap` branch's BFF runtime dep (`@khal-os/sdk` in `service/package.json`)**, so the decision covers the BFF's future shape, not just the pack's present one.
2. Decision memo (in the wish dir) choosing one: (a) publish the `@khal-os` packages publicly, (b) vendor the consumed surface into the repo, (c) prebuilt-artifact distribution — OSS consumes the SPA dist from the npm package/GHCR image while source builds stay token-gated. Each option costed; owner confirms the pick.
3. Implementation of the chosen path far enough that Group 2's lockfile dissolution has a resolvable dependency story (e.g. if (c): the build path is CI-only and `bun install` from a fresh clone must not attempt to resolve `@khal-os/*` — verify workspace pruning achieves that).
4. If (c): `docs/` note in the UI README stating the build-vs-consume contract for contributors.

**Acceptance Criteria:**
- [ ] Fresh clone + `bun install` (no token) exits 0 under the chosen model.
- [ ] Decision memo exists with owner sign-off recorded.
- [ ] The chosen path is exercised by a command in CI or a documented manual gate.

**Validation** (scope: decision + audit artifacts now; the token-less-install proof is only meaningful **after** Group 2's dissolution, so it is re-run there — pre-dissolution, root `bun install` passes trivially because khal-ui is excluded):
```bash
test -f .genie/wishes/canonical-ui-consolidation/DECISION-khalos.md && grep -qE "chosen: \((a|b|c)\)" .genie/wishes/canonical-ui-consolidation/DECISION-khalos.md
```

**depends-on:** none

---

### Group 2: Atomic consolidation PR

**Goal:** One commit swaps the canonical UI into `apps/ui` with root-workspace membership, `@omni/ui-*` names, and every reference swept — repo green before and after, nothing between.

**Deliverables:**
1. Delete `apps/ui` (legacy). `git mv apps/khal-ui apps/ui`; inside it: `package/`→`app/`, `service/`→`server/`; delete nested `bun.lock` + `tsconfig.base.json`; **strip the umbrella `apps/ui/package.json` `workspaces` field**; fold members into root `workspaces` **per Decision 5b** (all three under models a/b; `server`+`dev` only under model (c), with `app/` a documented token-gated build island); renames: `@omni/khal-ui`→`@omni/ui`, `-pack`→`@omni/ui-app`, `-service`→`@omni/ui-server`, `-dev`→`@omni/ui-dev`.
2. Reference sweep: root `package.json` workspaces; `.github/workflows/ci.yml:149` test scope; **`.husky/pre-push:69`** (same `apps/ui` test-scope decision as ci.yml); `knip.json` (drop legacy block at `:75`, add new members); **`biome.json`** (`:65-68,115` khal-ui entries + `:99` legacy apps/ui block); `Makefile` targets `dev-ui`/`lint-ui`/`typecheck-ui`/`build-ui`; **`deploy/Dockerfile.admin-ui` — structural redesign, not a path sweep**: the image currently installs from the nested workspace root (`WORKDIR /app/apps/khal-ui:32`, nested-lock toolchain pin `:25`, `--filter '@omni/khal-ui-dev'` against the nested graph `:51`); it must be rebuilt to install from the root workspace (COPY root manifests + lock) or keep a standalone install story under model (c); its dockerignore drops the legacy-`apps/ui` exclusion and **re-paths the `evidence/`/`.qa` exclusions** (evidence stays, per OUT); `deploy/Makefile` `build-ui`; `image-publish.yml` comment/step updates (`:12-13,225,251` — its `apps/**` path filter survives the mv unchanged); **`release.yml` npm-candidate jobs (`:707-716`) per Group 3's dist-provenance design** (no KHAL token exists in that workflow); `scripts/lib/version-fields.ts` — remove `:23` exclusion **and extend the walker (`:163-172`) to descend into `apps/ui` members** (Decision 5c); comment-only hits (`commitlint.config.ts:42`, `packages/api/src/routes/v2/keys.ts:29`, helm `values.yaml:195-197`, `_helpers.tpl:62`, `externalsecret-omni-ui.yaml:2`); `docs/design/omni-saas-wireframe/*.md` (7 files) updated or explicitly allowlisted.
3. API serving repoint: `packages/api/src/app.ts:414-450` serves the new SPA dist location (`apps/ui/dev/dist` or the agreed build output) for source checkouts; `packages/api/src/tenancy/route-enumeration.ts:32` + `route-ownership.ts:142-159` updated so the ownership gate enumerates the new static routes.
4. Baselines bracketing the PR: `hyperfine 'bun install'` and `time make check` before/after, recorded in the PR description.
5. If `wish/omni-appkit-gap` merged meanwhile: rebase the `server/` move over it (coordination note, not silent conflict).

**Acceptance Criteria:**
- [ ] Single commit (or single PR with one logical change); repo `make check` green at the merge commit; no intermediate commit exists where `bun install` double-resolves or fails.
- [ ] `git log --follow` preserves khal-ui file history through the mv.
- [ ] Sweep criterion (the single canonical command, also used by Success Criterion 3): `rg "khal-ui|@omni/khal" -g '!*.lock' -g '!CHANGELOG*' -g '!docs/_internal/**' -g '!docs/design/omni-saas-wireframe/**' -g '!.genie/**'` → zero hits, with any wireframe-doc retentions listed in the PR description.
- [ ] Route-ownership gate green; `make dev` serves the canonical UI.
- [ ] Token-less install proof (Group 1's criterion, now meaningful): fresh `git clone` + `bun install` with no `.npmrc` token exits 0.

**Validation** (scope: workspace/dependency/CI surface → repository full gate; every command must gate):
```bash
make check && bunx knip && rm -rf /tmp/ui-consol-clone && git clone --depth 1 file://$PWD /tmp/ui-consol-clone && (cd /tmp/ui-consol-clone && bun install)
```

**depends-on:** group-1

---

### Group 3: OSS one-box serving + CI gates

**Goal:** A one-command install serves the canonical UI via the BFF, and CI actually tests the UI it releases.

**Deliverables:**
1. npm packaging: `@automagik/omni` (packages/cli `prepack`) gains the prebuilt SPA dist + the BFF **bundled via `bun build` into a single dependency-free file** (source-shipping is only safe while the BFF is zero-dep; appkit-gap adds `@khal-os/sdk` to it — bundling is robust to both worlds). **Dist provenance at pack time (explicit, because `release.yml`'s npm-candidate jobs at `:707-716` have no `KHAL_NPM_TOKEN`):** the SPA dist is built in the token-holding `image-publish`/UI-build job, uploaded as a workflow artifact, and the npm-candidate job downloads it before `bun pm pack`; `prepack` itself never builds the SPA. Local `prepack` without the artifact produces a UI-less package loudly (guard message), never a silent one.
2. CLI runtime: PM2/systemd ecosystem the CLI manages (`omni start`, `buildRuntimeEnv`) supervises the BFF process with `OMNI_API_KEY`/`OMNI_BASE_URL`/`PUBLIC_DIR` wired from the local runtime config (Decision 9 of `multi-server-management` — local entry, never the active remote).
3. `omni doctor` knows the BFF unit (status, port check).
4. CI: `ci.yml` job (or step) running the UI's typecheck, `bun test`, and `bun run capabilities:check`, token-gated the same way `image-publish.yml` gates (skip-with-notice when `KHAL_NPM_TOKEN` absent, if Group 1 chose model (c)).

**Acceptance Criteria:**
- [ ] Disposable-env install test: fresh box → install → `curl localhost:<port>/` returns the SPA; `/omni/api/v2/health` proxies with injected key; browser flow needs no pasted key.
- [ ] Killing the BFF and running `omni doctor` reports it; `omni start` restores it.
- [ ] Seeded capabilities.json drift fails CI; UI tests run (or skip loudly with the documented token notice).

**Validation** (scope: runtime + packaging → CLI suite, packaging smoke, full typecheck):
```bash
make test-file F=packages/cli/src/__tests__/cli.test.ts && cd packages/cli && bun run prepack >/dev/null && tar -tzf $(bun pm pack --quiet) | grep -c "ui/index.html" && cd - && make typecheck && make lint
```

**depends-on:** group-2

---

### Group 4: Topology doctrine + wish amendment proposals

**Goal:** The doctrine is a repo artifact, and the two affected wishes carry formal, owner-adjudicable proposals rather than silent drift.

**Deliverables:**
1. `docs/TOPOLOGY.md`: the invariant (Decision 7 verbatim), the three-shape table (one-box / per-customer k8s / what omni is not), the realm matrix pointer to `deploy/README.md`, the permanent-ops-names declaration (Decision 8), and the multi-server CLI registry as the fleet-operator plane.
2. Amendment proposal appended to `omni-full-multitenancy/WISH.md`: defer the RLS/fail-closed train behind the named trigger; require the EXPLAIN ANALYZE messages-hot-path benchmark before any enforcement lands; preserve simplifier's park-it dissent and perf's ownership-columns remnant verbatim; status `PROPOSED — awaiting owner adjudication`.
3. Amendment proposal appended to `saas-platform-auth/WISH.md`: decouple from the RLS train; narrow to single-deployment identity (users, roles, sessions, federation into one deployment); same PROPOSED marker.
4. `multi-server-management/WISH.md` post-script, **also marked `PROPOSED — awaiting owner adjudication`** (it changes another wish's QA scope): UI half (Groups 3–4) shipped but the surface is retiring with `apps/ui`; CLI half is the durable artifact; QA scope proposed to reduce to CLI-only.
5. CLAUDE.md/AGENTS.md one-line pointer to the doctrine doc.

**Acceptance Criteria:**
- [ ] Doctrine doc exists with the invariant verbatim; AGENTS.md/CLAUDE.md links it.
- [ ] Both amendment proposals present, marked PROPOSED, dissent preserved verbatim (quoted, attributed to lens).
- [ ] No status field of either affected wish is changed by this wish.

**Validation** (scope: docs-only → content-contract checks):
```bash
grep -q "One deployment = one tenant" docs/TOPOLOGY.md && grep -q "PROPOSED — awaiting owner adjudication" .genie/wishes/omni-full-multitenancy/WISH.md && grep -q "PROPOSED — awaiting owner adjudication" .genie/wishes/saas-platform-auth/WISH.md && grep -q "TOPOLOGY" AGENTS.md
```

**depends-on:** group-2

---

## QA Criteria

- [ ] Functional: fresh disposable one-box install serves the canonical UI end-to-end (SPA loads, instances page live against the local API, no key in browser storage).
- [ ] Integration: dev LXC (`omni-dev`) updated to a build of the consolidated repo; Harness works at its existing URL; `omni doctor` supervises API + BFF.
- [ ] Regression: enterprise image path — `deploy/Dockerfile.admin-ui` builds from the new layout with the token; helm `adminUi:` values need zero changes (Decision 8).
- [ ] Regression: `omni server`/`--server` CLI multi-server flows unaffected (they are the surviving multi-server artifact).

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `@khal-os/*` cannot be published or vendored (license/ownership), forcing model (c) permanently | Medium | Model (c) is acceptable per council — but Group 1 must make it explicit and CI-visible, not accidental; OSS still gets the UI as artifact. |
| Atomic PR conflicts with in-flight `wish/omni-appkit-gap` branch | Medium | Coordination note in Group 2; rebase the `server/` move; the BFF's public contract (endpoints, env) is unchanged by the rename. |
| Uniform-versioning join (version-fields exclusion removal) ripples release tooling | Medium | Decision 5c extends the walker deliberately (not just exclusion removal); `verify-release-workflows.ts` needs no change (Decision 8 keeps `oci:omni-admin-ui`); `make check` in Group 2 validation gates the result. |
| Nested-workspace dissolution surfaces dependency conflicts (React 19 pack vs root React 18 legacy deps) | Medium | Legacy `apps/ui` (the React 18 consumer) is deleted in the same commit; remaining conflicts resolved in-PR; `bun install` clean is the acceptance test. |
| Tenancy route-ownership gate breaks on the serving repoint | Low | Explicit deliverable with the two file anchors; gate run in Group 2 validation. |
| Doctrine proposals stall unadjudicated, leaving `omni-full-multitenancy` critical-and-ambiguous | Low | PROPOSED markers make the pending decision visible in the wish itself; owner is the single adjudicator. |

---

## Council Verdicts (persisted evidence — 2026-08-12 deliberation, lenses: questioner, architecture, simplifier, perf)

**Consensus (unanimous):** delete `apps/ui`; `khal-ui` takes the name with `@omni/ui-*` packages; BFF stays in-app; **no ServerSwitcher port** (BFF single-key contract is the security boundary; CLI registry is the fleet plane); atomic single-commit migration (Bun cannot compose nested workspace roots); doctrine invariant "one deployment = one tenant, at every scale"; demote the RLS train behind a named trigger; narrow saas-platform-auth to single-deployment identity.

**P0s:** (1) `@khal-os/*` resolution gates everything — otherwise the only UI silently becomes Namastex-only-buildable; (2) atomicity of the migration; (3) no-port of ServerSwitcher.

**Recorded tensions (unresolved, preserved for owner):** simplifier would park `omni-full-multitenancy` entirely ("half-implemented tenancy is worse than none"); architecture/questioner keep within-deployment hardening live; perf would keep tenant/ownership columns as "data hygiene" — simplifier objects that unenforced tenant columns are an illusion of a boundary. Perf's dissent on framing: the multi-server *feature* does not die — only the ServerSwitcher component does; the CLI half is "the first brick of the fleet-operator plane."

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review — 2026-08-12 — Verdict: FIX-FIRST (amended same day)

**Reviewer:** plan-review agent (independent, evidence-first). All file:line anchors spot-checked and verified current (`app.ts:414-450`, tenancy anchors, workspaces line, ci.yml:149, knip:75, Makefile targets, version-fields:23, khal-ui structure/names, image-publish token gating, release.yml oci refs, appkit-gap branch existence). Core mechanics endorsed: one-atomic-PR reasoning justified; Group 1 gate correctly sequenced; React-conflict risk row confirmed complete; Group 3 npm approach fits `files`/`prepack` pattern.

**Findings and dispositions:**

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| 1 | HIGH | Group 2's unconditional workspace fold contradicts token-less install under model (c) — Bun has no per-member install pruning; `@khal-os/*` (pack deps `sdk`/`ui`/`types`, `.npmrc`→git.namastex.io, no root `.npmrc`) would have to resolve on every fresh clone | Fixed: Decision 5b — Group 2 has two explicit shapes keyed to Group 1's outcome; under (c) `app/` stays out of root workspaces as a token-gated build island; umbrella `workspaces` field stripped either way |
| 2 | MED | `wish/omni-appkit-gap` adds runtime `@khal-os/sdk` to the BFF (breaks "zero-dep BFF" premise); coordination note covered only the rename | Fixed: Dependencies note rewritten — merge-order preference (this wish first), Group 1 audit extended to the branch's BFF dep, Group 3 ships the BFF bundled (single-file `bun build`) robust to both worlds |
| 3 | MED | `release.yml` npm-candidate jobs (`:707-716`) run `prepack` with no KHAL token — SPA dist provenance unspecified | Fixed: Group 3 D1 — dist built in the token-holding job, passed as workflow artifact, downloaded before `bun pm pack`; local prepack fails loud, not silent; release.yml npm jobs added to Group 2 sweep |
| 4 | MED | `Dockerfile.admin-ui` change is structural (nested-workspace install root at `:25,:32,:38,:51`), not "paths only"; dockerignore evidence/.qa exclusions need re-pathing | Fixed: Group 2 D2 reframed as structural redesign with the two options named; dockerignore re-path added |
| 5 | MED-LOW | Umbrella `workspaces` field un-stripped = the exact undefined state Decision 3 forbids; version-fields walker (`:163-172`) only walks top-level dirs so nested members stay unversioned | Fixed: Decision 5b (strip) + Decision 5c (extend walker) |
| 6 | LOW | Sweep omissions (biome.json, .husky/pre-push:69, commitlint comment, keys.ts comment, helm comments, docs/design wireframes ×7); two divergent sweep commands | Fixed: all named in Group 2 D2; single canonical sweep command shared by AC and Success Criteria |
| 7 | LOW | Validation defects: `;` discarding exit codes; `scripts/__tests__/` is another wish's untracked WIP; Group 1 fresh-clone proof vacuous pre-dissolution; `npm pack` violates Bun-only | Fixed: Group 2 validation all-`&&` with the clone-install proof moved there; Group 1 validates the decision memo; `bun pm pack` |
| 8 | LOW | Group 4 D4 executed (not proposed) a QA-scope change to `multi-server-management` | Fixed: marked PROPOSED like the other two |

**Factual corrections adopted:** `image-publish.yml`/`release.yml` have no khal-ui path filters (`apps/**` survives the mv) — effort redirected to release.yml's npm jobs and image-publish comments; `verify-release-workflows.ts:15` needs no change (Decision 8 keeps `oci:omni-admin-ui`).

### Plan re-review — 2026-08-12 — Verdict: SHIP

**Reviewer:** same plan-review agent, full re-read. All 8 prior findings verified closed **in the text, not just claimed** (per-finding closure table in reviewer transcript: Decision 5b/5c anchors, appkit-gap coordination note with branch stats and bundled-BFF contingency, artifact-based dist provenance for release.yml:707-716, Dockerfile structural reframe with install-root anchors, canonical sweep command, all-`&&` validations, `bun pm pack`, PROPOSED marker on the multi-server post-script).

**Residual advisories (all LOW, stale summary text — fixed same day by the orchestrator):** SC3 carried the old sweep command → replaced with the canonical one; Scope IN bullet 2 stated the unconditional fold → now defers to Decision 5b; Files list annotations out of sync → synced and marked "indicative — Group deliverables authoritative"; uniform-versioning risk row cited a removed validation test → now cites Decision 5c + `make check`.

**Bottom line (verbatim):** "Every material gap from the FIX-FIRST round is closed with real, anchored text — the model-(c) workspace shape, the appkit-gap dependency story, the npm dist provenance, and the Dockerfile reframing are all now execution-ready. SHIP."

---

## Files to Create/Modify

_Indicative — Group deliverables are authoritative where they differ._

```
apps/ui/                                   # was apps/khal-ui (git mv); app/, server/, dev/, scripts/
apps/khal-ui/                              # REMOVED (moved)
apps/ui (legacy contents)                  # DELETED
package.json                               # workspaces per Decision 5b (shape depends on Group 1 model)
.github/workflows/ci.yml                   # test scope, UI gates job
.github/workflows/image-publish.yml        # comments/steps (:12-13,225,251); apps/** filter unchanged; UI-dist artifact upload (Group 3)
.github/workflows/release.yml              # npm-candidate jobs :707-716 consume UI-dist artifact (component name unchanged)
.husky/pre-push                            # :69 test-scope decision (same as ci.yml:149)
biome.json                                 # khal-ui entries :65-68,115 + legacy apps/ui block :99
knip.json                                  # legacy block out, new members in
Makefile                                   # dev-ui/lint-ui/typecheck-ui/build-ui
deploy/Dockerfile.admin-ui                 # STRUCTURAL: install-root redesign (file name permanent)
deploy/Dockerfile.admin-ui.dockerignore    # drop legacy exclusion; re-path evidence/.qa
deploy/Makefile                            # build-ui context paths
packages/api/src/app.ts                    # SPA serving repoint (:414-450)
packages/api/src/tenancy/route-enumeration.ts  # static route entries
packages/api/src/tenancy/route-ownership.ts    # ownership entries
packages/api/src/routes/v2/keys.ts         # comment :29
packages/cli/package.json                  # files+prepack: ships SPA dist (artifact-provided) + bundled BFF
packages/cli/src/runtime-env.ts            # BFF process env
packages/cli/src/commands/{start,doctor}.ts # BFF supervision
scripts/lib/version-fields.ts              # remove :23 exclusion + extend walker :163-172 (Decision 5c)
commitlint.config.ts                       # comment :42
deploy/helm/omni/values.yaml + templates/_helpers.tpl + deploy/k8s/omni-hml/externalsecret-omni-ui.yaml  # comments
docs/design/omni-saas-wireframe/*.md       # update or allowlist (7 files)
docs/TOPOLOGY.md                           # NEW: doctrine
AGENTS.md                                  # doctrine pointer
.genie/wishes/canonical-ui-consolidation/DECISION-khalos.md  # NEW: Group 1 memo
.genie/wishes/omni-full-multitenancy/WISH.md   # amendment PROPOSAL appended
.genie/wishes/saas-platform-auth/WISH.md       # amendment PROPOSAL appended
.genie/wishes/multi-server-management/WISH.md  # UI-half retirement post-script (PROPOSED)
```
