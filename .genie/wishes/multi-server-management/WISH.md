# Wish: Multi-Server Management (CLI + UI)

| Field | Value |
|-------|-------|
| **Status** | IN_PROGRESS |
| **Slug** | `multi-server-management` |
| **Date** | 2026-07-31 |
| **Author** | Felipe Rosa |
| **Appetite** | medium |
| **Branch** | `wish/multi-server-management` |
| **Repos touched** | omni (`packages/cli`, `apps/ui`) |
| **Design** | _No brainstorm — direct wish_ |

## Summary

Let one operator work against several Omni API servers (e.g. local dev, staging, production) from both the CLI and the dashboard. The CLI gains named server entries with add/list/switch/remove and a per-invocation override; the UI gains a server switcher dropdown with an "Add server" flow in the left sidebar. Each server entry stores its own URL and API key (single-tenant master-key auth, BAU), and switching is a single action. KHAL-platform session auth (code + URL login, multitenant SaaS mode) was split to the `saas-platform-auth` wish after plan review found it must be re-planned against omni's in-progress tenancy subsystem.

## Scope

### IN

- CLI: a `servers` section in `~/.omni/config.json` — named entries `{ name → { url, apiKey } }` plus an `active` pointer, with lazy migration of the legacy flat `apiUrl`/`apiKey` into a `default` entry.
- CLI: `omni server` command group — `add`, `list`, `use`, `remove`, `current` — plus a global `--server <name>` per-invocation override.
- CLI: `omni auth login` writes credentials into the active (or `--server`-targeted) server entry; `auth status`, `config list`, and the inline status line show the active server.
- CLI: bind the trust-handshake signing identity to the server it was performed against, so requests to other server entries go unsigned instead of hard-failing 401 (the API rejects unknown-host signatures by design).
- CLI: local-runtime paths (`start`, `restart`, `update`, `install`, `doctor`, `auth recover`) read a non-resolving local config so a remote active server never leaks its key into the local PM2 process.
- UI: client-side server registry in localStorage (`omni-servers` + `omni-active-server`), with migration of the legacy `omni-api-key`, and the SDK singleton in `apps/ui/src/lib/sdk.ts` resolving from the active entry.
- UI: server switcher dropdown in the sidebar top block (`apps/ui/src/components/layout/Sidebar.tsx`) with an "Add server" item opening a dialog (name, URL, API key, validated via `auth.validate` before save), plus remove/edit of entries.
- UI: fix the three hardcoded `localStorage.getItem('omni-api-key')` raw fetches in `apps/ui/src/hooks/usePersons.ts` so all requests route through the single config point.

### OUT

- Per-server request-signing *keypairs* — one keypair per server is deferred. In scope instead (Group 2): the handshake records which server it is bound to and signing is skipped for other entries, because the API hard-rejects unknown-host signatures with 401 (`packages/api/src/middleware/genie-signature.ts:37-38,161-163`) rather than falling through.
- Any change to the embedded local-server runtime config (`server.*` namespace consumed by `buildRuntimeEnv()`); `omni start/doctor/update` continue to read it untouched.
- CORS configuration changes — the API's production default is an **empty** CORS allow-list (`packages/api/src/app.ts:23-43`), so reaching a remote server from the dashboard requires the operator to set `OMNI_CORS_ORIGINS` on that server. This wish documents the prerequisite (Add Server dialog copy distinguishes a CORS/network block from an invalid key) but does not change the CORS defaults.
- KHAL-platform session auth (multitenant SaaS mode: device-flow login, session validation middleware, role-aware UI) — split to the `saas-platform-auth` wish, which depends on this one and must be sequenced with `omni-full-multitenancy`. Every server entry here authenticates with an API key.
- Aggregated multi-server views (querying several servers at once, health dashboards) — every screen and command talks to exactly one active server.
- Import/export or team-sharing of server lists.
- Refactoring the ~30 CLI call sites that re-derive `config.apiUrl ?? 'http://localhost:8882'` — they keep working unchanged because resolution happens inside `loadConfig()`.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | New config namespace `servers` (list + `active`), distinct from existing `server.*` | `server.*` already means the local embedded server runtime (`packages/cli/src/config.ts:15-32`, fed to PM2 by `runtime-env.ts:237-243`); reusing it would conflate a remote target with the local process and could restart the local API with a remote key. |
| 2 | `loadConfig()` resolves the active server entry into the effective top-level `apiUrl`/`apiKey` fields | ~30 call sites bypass the client factory and read `config.apiUrl` directly (`commands/messages.ts`, `chats.ts`, `voice.ts`, …); resolving at load time makes every one of them multi-server-aware without touching them. |
| 3 | Global `--server <name>` flag handled with early pre-commander stripping | Precedent already exists for `--json` (`packages/cli/src/index.ts:74-79`); the override must be set before `loadConfig()`/`getClient()` caching kicks in (`client.ts:14`). |
| 4 | Lazy migration: first load lifts legacy flat `apiUrl`/`apiKey` into a `default` server entry | `loadConfig` already merges permissively over defaults; no migration script or breaking change for existing installs. Same pattern in the UI for `omni-api-key`. |
| 5 | UI stores the registry client-side in localStorage under the existing `omni-*` convention | Matches `omni-api-key`/`omni-theme`/`omni-sidebar-collapsed`; server entries are per-browser credentials, not server-side data. |
| 6 | Add `@radix-ui/react-dropdown-menu` wrapped shadcn-style in `apps/ui/src/components/ui/` | No dropdown/select/popover primitive exists today (only dialog/tooltip/tabs/switch); native `<select>` cannot host the "Add server" action item. |
| 7 | Server switch in the UI resets the SDK singleton and calls `queryClient.clear()` | Mirrors the proven logout path (`useAuth.ts:46-50`); guarantees no cross-server cache bleed. |
| 8 | Zod schema for the new `servers` config block in the CLI | Repo contract requires Zod at external boundaries; the config file is user-editable, so entries are validated on load with graceful fallback. |
| 9 | Local-runtime paths use a non-resolving accessor (`loadLocalRuntimeConfig()`), never the active entry | `buildRuntimeEnv()` feeds `OMNI_API_KEY: cliConfig.apiKey` into the local PM2 process (`runtime-env.ts:243`) from ten call sites (`start.ts:82`, `restart.ts:45`, `update.ts:221`, `install.ts:174`, `auth.ts:104`, `doctor.ts:480,846,870,915,999`); resolving from a remote active entry would leak remote credentials into the local runtime and make `doctor`'s env-drift check report permanent drift. `doctor`/`update` health probes (`doctor.ts:357,388`, `update.ts:387`) likewise keep targeting `localhost:<apiPort>`. |
| 10 | Server entries are managed only via `omni server`; `config get/set` rejects `servers.*` keys | `ConfigKey` is a closed static union with literal-key masking (`config.ts:35-47`, `commands/config.ts:63-71`); dynamic per-name keys would print API keys unmasked. `config list` gains one read-only, masked active-server row. |
| 11 | Trust handshake appends its target server URL to `boundServers: string[]` in `host.json`; re-running against a new server registers the existing pubkey there without rotating keys; `signRequestIfHandshook()` signs only for bound servers (absent field = legacy, treated as bound to `default`) | The API returns 401 for unknown host signatures by design (`genie-signature.ts:161-163`); without binding, every command against a second server fails once any handshake exists. An array (not a single URL) because the handshake route is auth-exempt and idempotent (`trust.ts:184-186`), so one keypair can hold host records on several servers — and `--rotate` against server B must not silently unsign server A (`require-signed-instance.ts:149-159` rejects unsigned requests on opted-in instances). |
| 12 | UI logout clears only the active entry's API key (entry retained), both call sites unified through `useAuth` | `Sidebar.tsx:110-113` and `useAuth.ts:46-50` currently implement logout differently (only the latter clears the query cache); keeping the entry makes re-login to the same server one step. |
| 13 | The migrated UI `default` entry stores a same-origin sentinel (`baseUrl: null`), resolved to `VITE_API_URL \|\| window.location.origin` at call time | `sdk.ts:59,91` re-derive the origin on every call today; freezing it at migration would break dashboards later reached via a different hostname, port, or tunnel. Only explicitly added entries store absolute URLs. |
| 14 | Auth-mode work (KHAL platform sessions) split to `saas-platform-auth` | Plan review found Groups 5–7 as merged were planned against the khal reference without reconciling omni's existing tenancy subsystem (`OMNI_MULTITENANCY_ENABLED`, `packages/api/src/tenancy/`, `platform-auth.ts` credential classes) — a re-plan sequenced with `omni-full-multitenancy`, carrying its own review surface. User approved the split 2026-07-31. |

## Simplicity Case

- **Simplest complete design:** a named `{url, apiKey}` map plus an `active` pointer, persisted where each client already persists its settings (CLI JSON config, UI localStorage); resolution happens at the existing single choke points (`loadConfig()` in the CLI, the `getClient()` singleton in the UI). No new processes, no server-side state, no sync.
- **Added machinery:** one new Radix primitive (dropdown-menu) because no existing UI primitive can render a switcher with an action item; a Zod schema for the new config block because the file is a user-editable external boundary; early `--server` flag stripping because commander registers global options too late for the config cache. Each is required by a present constraint found in exploration.
- **Deferred until measured:** per-server signing *keypairs* — one keypair registered against multiple servers via `boundServers` covers current needs (trigger for per-server keys: an operator needs key isolation or independent rotation per server); an API-side CORS default change — `OMNI_CORS_ORIGINS` is a documented operator prerequisite in this wish (trigger: operators repeatedly blocked despite the dialog hint); refactoring the 30 raw-fetch call sites into one client factory (trigger: any future feature that needs per-request server targeting rather than per-process).
- **Complexity removed:** no per-command `--api-url`/`--api-key` matrix, no config file format version bump (permissive merge + lazy lift), no React context provider for servers (module singleton + full cache clear on switch, same as auth today), no simultaneous multi-server sessions.

## Dependencies

**depends-on:** none
**blocks:** saas-platform-auth

## Success Criteria

- [ ] `omni server add staging --url https://staging.example.com --api-key omni_xxx` health-checks the target (reachability + key validation, mirroring the UI Add Server dialog) and persists a named entry only on success (`--skip-verify` to bypass); `omni server list` shows it with the active one marked; `omni server use staging` switches; `omni server remove staging` deletes (refusing to remove the active entry without `--force` or auto-fallback).
- [ ] Any existing command run with `--server <name>` targets that server for that invocation only, without changing the persisted active server.
- [ ] An existing `~/.omni/config.json` with only flat `apiUrl`/`apiKey` keeps working: first load exposes it as the `default` server entry and all commands behave exactly as before.
- [ ] `omni auth login` stores the key on the targeted server entry; `omni auth status` and `omni config list` name the active server and mask its key.
- [ ] `omni start`/`omni doctor` still launch the local embedded server from `server.*` config regardless of which remote server entry is active, and `buildRuntimeEnv().OMNI_API_KEY` never contains a remote entry's key (unit-tested).
- [ ] After `omni trust handshake` against server A, commands run against server B succeed (sent unsigned) instead of failing 401; commands against A remain signed.
- [ ] `omni server list` masks API keys in both human and `--json` output; full values appear only behind an explicit `--reveal` flag.
- [ ] UI sidebar shows the active server name in a dropdown at the top block; switching servers reloads data scoped to the new server with no stale cross-server cache.
- [ ] UI "Add server" dialog validates the URL + API key against `auth.validate` before saving and surfaces failures inline.
- [ ] A browser with only the legacy `omni-api-key` in localStorage migrates transparently to a `default` server entry on first load; login/logout still work.
- [ ] `usePersons.ts` no longer reads `omni-api-key` or `(client as unknown).baseUrl` directly.
- [ ] `make check` passes (typecheck + lint + tests) with zero warnings.

## Execution Strategy

### Wave 1 (parallel)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | 3 — stateful config migration (+2), no orchestration, deterministic tests exist (+1 prior-rework-adjacent config surface) | engineer-standard / high | CLI config model: `servers` block, Zod schema, lazy migration, resolution into effective `apiUrl`/`apiKey` |
| 3 | engineer | 3 — stateful localStorage migration (+2), multi-file client refactor (+1) | engineer-standard / high | UI server registry: localStorage schema, sdk.ts resolution, migration, `usePersons` fix |

### Wave 2 (parallel, after Wave 1)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | 3 — commander wiring + global flag early-stripping (+2 stateful CLI surface), deterministic tests (+1 multi-command touchpoints) | engineer-standard / high | `omni server` command group, `--server` flag, auth/status/config surfaces |
| 4 | engineer | 3 — subjective visual acceptance (+2), new primitive (+1) | engineer-standard / high | Sidebar switcher dropdown + Add Server dialog |

Groups 3 and 4 must merge together in one PR: `make check` runs knip dead-code detection (`Makefile:256-260`), and Group 3's `switchServer` export has no consumer until Group 4 wires the dropdown.

## Execution Groups

### Group 1: CLI server registry and resolution

**Goal:** The CLI config supports named server entries with an active pointer, validated by Zod, migrating legacy flat fields, and resolving the active entry into the effective `apiUrl`/`apiKey` that all existing code paths already read.

**Deliverables:**
1. `servers` config block in `packages/cli/src/config.ts`: `{ active: string, list: Record<name, { url: string, apiKey?: string }> }`, with a Zod schema validating it on load (invalid entries dropped with a warning, never a crash).
2. Lazy migration in `loadConfig()`: when `servers` is absent and flat `apiUrl`/`apiKey` exist, lift them into a `default` entry and set it active; effective `config.apiUrl`/`config.apiKey` are derived from the active entry for client-facing paths. The `--server` override is transported via `process.env` (same mechanism and bundler-duplication rationale as `setRuntimeFormat`, `config.ts:249-255`).
3. Non-resolving accessor `loadLocalRuntimeConfig()` for local-runtime paths: `runtime-env.ts` (`buildRuntimeEnv`), `commands/start.ts`, `restart.ts`, `update.ts`, `install.ts`, `doctor.ts`, and `auth recover` read the local `default` entry regardless of the active server; `doctor`/`update` health probes (`doctor.ts:357,388`, `update.ts:387`) resolve from the local `default` entry, never the active one (reviewer-corrected wording: hardcoding `localhost:<apiPort>` would break legitimate non-default local installs).
4. `config list` shows one read-only, masked active-server row; `config get/set/delete` reject `servers.*` keys with a pointer to `omni server` (per Decision 10 — no dynamic `ConfigKey` entries).
5. Unit tests in `packages/cli/src/__tests__/config.test.ts` covering migration, resolution, override, invalid-entry fallback, and the `buildRuntimeEnv` isolation guarantee — sandboxed via `OMNI_CONFIG_DIR` with `beforeEach`/`afterEach` env save-restore. Fix the stale header comment (`config.test.ts:4-6`) claiming import-time path caching (false — `getConfigDir()` reads the env on every call), and sandbox the existing `loadServerConfig()` test that currently reads the developer's real `~/.omni`.

**Acceptance Criteria:**
- [ ] A pre-existing flat config round-trips: load → derived `default` entry → save → load yields identical effective `apiUrl`/`apiKey`.
- [ ] Resolution honors the env-transported server override without persisting it.
- [ ] A malformed `servers` block falls back to defaults with a warning instead of crashing.
- [ ] With a remote entry active, `buildRuntimeEnv().OMNI_API_KEY` equals the local `default` entry's key, not the active entry's (unit test); the `server.*` (local runtime) namespace is untouched.
- [ ] `config set servers.foo.apiKey x` is rejected with guidance; `config list` never prints an unmasked key.

**Validation:**
```bash
make test-file F=packages/cli/src/__tests__/config.test.ts && make typecheck
```

**depends-on:** none

---

### Group 2: CLI `omni server` commands and `--server` override

**Goal:** Users manage and target server entries from the command line, and every status surface names the active server.

**Deliverables:**
1. `packages/cli/src/commands/server.ts` exporting `createServerCommand()` with `add`, `list`, `use`, `remove`, `current` (commander pattern per `commands/auth.ts`), registered in the `COMMANDS` array in `src/index.ts` under helpGroup `System`; help text disambiguates the remote-server registry from the local `server.*` runtime config. `add` verifies the target before persisting — reachability (health endpoint) plus key validity (`client.auth.validate()`) — aborting with distinct unreachable vs unauthorized messages; `--skip-verify` persists anyway (e.g. adding a currently offline server). No separate health command.
2. Global `--server <name>` / `--server=<name>` flag stripped pre-commander (extending the `--json` mechanism at `index.ts:74-79` with a two-element splice); a missing or flag-like value fails fast; unknown names fail fast listing available entries. The value is handed to Group 1's env-transported override before any `loadConfig()`/`getClient()` call.
3. `omni auth login [--server <name>]` persists `apiUrl`/`apiKey` into the targeted entry; `auth logout` clears only that entry's key; `auth status`, `getInlineStatus()`/`getConfigSummary()` (`src/status.ts`) display the active server name. When a targeted entry has no key, the not-authenticated error (`client.ts:25-26`) names the entry and suggests `omni auth login --server <name>`.
4. Trust-handshake server binding: `omni trust handshake` appends the target server URL to `boundServers: string[]` in `host.json` (`src/signing.ts`, `commands/trust.ts`); re-running against a new server registers the **existing** pubkey there without rotating (handshake route is auth-exempt and idempotent, `trust.ts:184-186`). `signRequestIfHandshook()` signs only when the resolved target is bound (absent field = legacy, bound to `default`). The already-handshook early-return (`trust.ts:159-168`) names the bound servers and states that other entries are sent unsigned.
5. Key masking: `omni server list` masks `apiKey` in human and `--json` output; `--reveal` prints full values.
6. CLI tests for the command group against the mock API (`__tests__/mock-api.ts`), including an unsigned-request-succeeds test against a non-bound server.

**Acceptance Criteria:**
- [ ] `add`/`list`/`use`/`remove`/`current` behave per the Success Criteria, including active-entry removal protection.
- [ ] `omni server add` refuses to save an unreachable server or a rejected key, with distinct error messages for each; `--skip-verify` saves anyway.
- [ ] `--server` (both forms) affects exactly one invocation; `omni server current` afterwards still shows the persisted active entry; missing value exits non-zero.
- [ ] `omni server use <unknown>` and `--server <unknown>` exit non-zero listing known entries.
- [ ] Root help shows the group; `omni server list --json` emits machine-readable output with masked keys (unmasked only under `--reveal`).
- [ ] With a handshake bound to server A, a command against server B is sent unsigned and succeeds; against A it stays signed.
- [ ] Re-running `trust handshake` while server B is active binds B without rotating the keypair (server A stays signed); the already-handshook message lists bound servers.
- [ ] Targeting a keyless entry produces an error naming that entry with the `--server`-scoped login hint.

**Validation:**
```bash
make test-file F=packages/cli/src/__tests__/cli.test.ts && make test-file F=packages/cli/src/__tests__/config.test.ts && make typecheck && make lint
```

**depends-on:** group-1

---

### Group 3: UI server registry and client resolution

**Goal:** The dashboard resolves its SDK client from a localStorage-backed server registry with an active pointer, migrating the legacy single API key, with no cross-server cache bleed.

**Deliverables:**
1. Server registry module in `apps/ui/src/lib/` (e.g. `servers.ts`): Zod-validated `omni-servers` array `{ id, name, baseUrl, apiKey }` + `omni-active-server` pointer; CRUD helpers; lazy migration of legacy `omni-api-key`. `zod` must be added to `apps/ui` dependencies — it is currently absent and not transitively resolvable from `apps/ui` (verified), and knip flags unlisted deps. The migrated `default` entry stores a same-origin sentinel (`baseUrl: null`) resolved to `VITE_API_URL || globalThis.window?.location.origin` at call time (Decision 13); only explicitly added entries store absolute URLs.
2. `apps/ui/src/lib/sdk.ts` refactor: `getClient()`, `apiFetch()`, `getApiKey`/`setApiKey`/`isAuthenticated` resolve from the active entry; singleton resets on server switch; `switchServer(id)` clears the query cache mirroring `useAuth` logout.
3. `apps/ui/src/hooks/usePersons.ts` rewired through the registry/client (no direct localStorage or `baseUrl` reach-ins).
4. Login flow (`Login.tsx`/`useAuth.ts`) stores the validated key on the active server entry. Logout clears only the active entry's key (entry retained, Decision 12), and `Sidebar.tsx`'s duplicate logout path is unified through `useAuth`.
5. Unit tests at `apps/ui/src/lib/__tests__/servers.test.ts` (pure TS — picked up by root `bun test` with no new tooling; `@/`-alias resolution from root is verified working) covering legacy migration, same-origin sentinel resolution, switch reset behavior, and corrupt-localStorage fallback. Both `localStorage` **and** `globalThis.window` are undefined under `bun test` and must be stubbed; the sentinel resolver must read `globalThis.window?.location.origin` (a bare `window` reference throws `ReferenceError`).

**Acceptance Criteria:**
- [ ] Fresh browser: no registry → default entry created from legacy key/env; auth and all pages work unchanged; the migrated entry keeps resolving origin at call time (host/port change safe).
- [ ] `switchServer` swaps baseUrl + key, resets the SDK singleton, and clears the TanStack Query cache (unit-tested via injected fakes).
- [ ] No remaining direct reads of `omni-api-key` outside the registry module (`rg "omni-api-key" apps/ui/src` returns only the registry/migration code).
- [ ] All registry reads/writes validated with Zod; corrupt localStorage falls back to empty registry + login redirect (unit-tested).

**Validation:**
```bash
make test-file F=apps/ui/src/lib/__tests__/servers.test.ts && make typecheck && make lint
```

**depends-on:** none

---

### Group 4: Sidebar server switcher and Add Server dialog

**Goal:** The left sidebar exposes the active server in a dropdown switcher with add/remove, and the Add Server dialog validates a server before saving it.

**Deliverables:**
1. shadcn-style `dropdown-menu.tsx` wrapper in `apps/ui/src/components/ui/` over `@radix-ui/react-dropdown-menu` (dependency added with `bun add`).
2. `ServerSwitcher` component in the sidebar top block (`Sidebar.tsx:126-147`): shows active server name, lists entries with the active one checked, "Add server…" action item, per-entry remove; collapsed-sidebar variant with tooltip (matching existing collapse handling).
3. `AddServerDialog` following the `PollCreator.tsx` Dialog pattern: name, URL, API key inputs (`ui/input.tsx`/`ui/label.tsx`); on submit validates via `auth.validate` against the entered server and shows inline errors; saves and activates on success. A fetch-level failure (`TypeError` — network or CORS block) is reported distinctly from a 401, with a hint that the target server must set `OMNI_CORS_ORIGINS` to allow this dashboard's origin.
4. Switching from the dropdown calls Group 3's `switchServer` and lands the user on data from the new server (redirect to login if the entry has no valid key).

**Acceptance Criteria:**
- [ ] Switcher renders in expanded and collapsed sidebar states, light and dark themes.
- [ ] Adding a server with a bad URL or key shows an inline error and saves nothing; a CORS/network failure shows the `OMNI_CORS_ORIGINS` hint, not "invalid key".
- [ ] Removing the active server falls back to another entry (or login when none remain).
- [ ] Keyboard navigation works in the dropdown (Radix defaults intact).

**Validation:**
```bash
make typecheck && make lint
```

**depends-on:** group-3

---

## QA Criteria

_What must be verified on dev after merge. The QA agent tests each criterion._

- [ ] Functional: register two servers (local + a second instance) in CLI and UI; switch between them; instances/chats lists differ per server as expected.
- [ ] Integration: `omni --server <b> chats list` hits server B while the active server remains A; UI switch clears cached data (no server-A rows flash on server B).
- [ ] Integration: dashboard against a remote-origin server with `OMNI_CORS_ORIGINS` set works end-to-end; without it, the Add Server dialog shows the CORS hint (not "invalid key").
- [ ] Integration: after `omni trust handshake` on the local server, CLI commands against a second server succeed unsigned.
- [ ] Regression: existing single-server installs (flat CLI config, legacy `omni-api-key` browser) upgrade with zero user action; `omni start`/`doctor` still manage the local runtime; login/logout unchanged.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Remote servers unreachable from the browser: the API's production CORS default is an empty allow-list (`app.ts:23-43`) | High (for the UI half) | Known prerequisite, not a contingency: operator must set `OMNI_CORS_ORIGINS` on each remote server. Add Server dialog distinguishes the CORS/network `TypeError` from a 401 and surfaces the hint (Group 4). CLI is unaffected. |
| Trust-handshake signing: the API returns 401 by design for unknown-host signatures (`genie-signature.ts:161-163`), so a global handshake breaks every second server | High | In scope (Group 2): bind the handshake to its server URL in `host.json` and skip signing for other entries; absent field = legacy `default`. Per-server *keypairs* stay deferred. |
| `doctor`/`auth recover`/`start`/`update`/`install` feed `cliConfig.apiKey` into the local server env — a remote active server could leak its key into the local runtime, and `doctor`'s env-drift check would report permanent drift | High | Group 1 deliverable 3: those paths use the non-resolving `loadLocalRuntimeConfig()`; the isolation guarantee is unit-tested (Group 1 AC 4). |
| UI API keys live in localStorage in plaintext — readable by any script running on the dashboard origin (XSS) | Medium | Same exposure as today's single `omni-api-key`, now × N servers. Interim posture: no third-party scripts in the dashboard, keys masked in all rendered output. Real fix is replacing pasted long-lived keys with platform sessions — the `saas-platform-auth` wish. |
| CLI client singleton cache (`client.ts:14`) serves a stale server after override | Low | Override is set before first `getClient()` via pre-commander stripping; test asserts the flag wins. |
| `queryClient.clear()` on switch causes a visible full-refetch flash | Low | Acceptable and consistent with logout behavior; hard reload is the fallback, matching `Sidebar.tsx` logout. |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

### Plan review — 2026-07-31 — Verdict: FIX-FIRST

**Reviewer:** plan-review agent (independent, evidence-first). All code anchors cited by the wish were spot-checked and confirmed accurate ("~30 call sites" is conservative: 38 `apiUrl` hits across 17 files). Decomposition, dependencies, OUT list, and simplicity case judged sound. Verified positive: the UI's server-dependent surface is exactly `sdk.ts` (2 sites) + `usePersons.ts` (3 sites) — no other `EventSource`/`WebSocket`/`VITE_API_URL`/origin consumers.

**Findings and dispositions** (wish amended same day; re-review triggered on findings 1–7):

| # | Sev | Finding (evidence) | Disposition |
|---|-----|--------------------|-------------|
| 1 | blocker | Handshake signing hard-fails on any second server — API 401s unknown hosts by design (`genie-signature.ts:37-38,161-163`); risk row's "degrades to unsigned" was factually wrong; `host.json` records no server identity (`signing.ts:35-40`, `trust.ts:196-202`) | Fixed: Group 2 deliverable 4 binds handshake to server URL in `host.json`, gates `signRequestIfHandshook()`; OUT bullet, risk row, Success Criteria, Decision 11 updated |
| 2 | blocker | Remote key bleeds into local runtime: `runtime-env.ts:243` + 10 `buildRuntimeEnv` call sites (`start.ts:82`, `restart.ts:45`, `update.ts:221`, `install.ts:174`, `auth.ts:104`, `doctor.ts:480,846,870,915,999`) and localhost probes (`doctor.ts:357,388`, `update.ts:387`); Group 1 deliverable contradicted risk mitigation; files absent from file list | Fixed: Group 1 deliverable 3 (`loadLocalRuntimeConfig()`), AC restated testably, Decision 9, files added |
| 3 | major | CORS decidable now: production default allow-list is `[]` (`app.ts:23-43`); dialog would misreport CORS block as bad key | Fixed: `OMNI_CORS_ORIGINS` stated as operator prerequisite (OUT, risks); Group 4 distinguishes `TypeError` from 401 with hint; QA updated |
| 4 | major | Groups 3–4 had zero automated verification (`apps/ui` has no tests; typecheck/lint can't reach behavioral ACs) | Fixed: Group 3 deliverable 5 — `apps/ui/src/lib/__tests__/servers.test.ts` (root `bun test` picks it up), validation updated |
| 5 | major | Group 2 validation ran API tests with DB dependency and discarded their exit status (`2>/dev/null;`) | Fixed: replaced with cli.test + config.test + typecheck + lint |
| 6 | major | `servers.<name>.*` collides with closed `ConfigKey` union + literal masking (`config.ts:35-47`, `commands/config.ts:63-71`) → keys would print unmasked | Fixed: Decision 10 — managed only via `omni server`; `config set` rejects `servers.*`; read-only masked row in `config list` |
| 7 | major | `omni server list --json` would emit N plaintext keys | Fixed: masked by default in both formats, `--reveal` opt-in (Group 2 deliverable 5, AC, Success Criteria) |
| 8 | minor | Migrated UI default entry must not freeze `window.location.origin` (`sdk.ts:59,91` re-derive per call) | Fixed: same-origin sentinel `baseUrl: null` (Decision 13, Group 3) |
| 9 | minor | `--server <name>` needs two-element splice, `=` form, fail-fast; override transport should use `process.env` per `config.ts:249-255` rationale | Fixed: Group 1 deliverable 2 + Group 2 deliverable 2 |
| 10 | minor | `omni server` (remote) vs `server.*` (local runtime) verb collision | Accepted with mitigation: disambiguating help text (Group 2 deliverable 1); renaming rejected — `server add/use` matches user vocabulary |
| 11 | minor | `config.test.ts:4-6` header falsely claims import-time path caching; `loadServerConfig()` test reads real `~/.omni` | Fixed: Group 1 deliverable 5 (env save-restore, comment fix, sandboxing) |
| 12 | minor | knip in `make check` fails Group 3 alone (`switchServer` unconsumed until Group 4) | Fixed: note in Execution Strategy — Groups 3+4 merge in one PR |
| 13 | minor | Keyless-entry auth error names no server, suggests wrong command | Fixed: Group 2 deliverable 3 + AC |
| 14 | minor | Logout semantics undefined; two divergent logout paths (`Sidebar.tsx:110-113` vs `useAuth.ts:46-50`) | Fixed: Decision 12 — clear active entry's key only, unify via `useAuth` (Group 3 deliverable 4) |

### Plan re-review — 2026-07-31 — Verdict: SHIP

**Reviewer:** plan-review agent (independent, evidence-first). **Method:** re-read the amended wish in full; independently re-verified every newly added code citation (~15, all accurate); empirically probed the two new deliverables — confirmed `bun test` from the repo root runs files under `apps/ui/src/lib/__tests__/` with `@/`-alias resolution working, and confirmed the `process.env` override transport rationale (`config.ts:249-255`).

All seven blocking/major findings from the first pass verified genuinely closed — converted into deliverables, testable ACs, decision rows, and file-list entries, each re-checked at its cited line. The two blockers received the right shape of fix (handshake-bound signing; named non-resolving `loadLocalRuntimeConfig()` accessor with enumerated call sites and a falsifiable AC). CORS moved from QA contingency to stated operator prerequisite with a distinct dialog failure path. No speculative machinery added by the amendment. Decomposition, dependencies (2←1, 4←3), and the knip-driven Groups-3+4-single-PR constraint re-confirmed.

**Residual findings** (all minor, pre-dispatch corrections; no re-review required — applied to the wish text same day):

| # | Sev | Finding (evidence) | Disposition |
|---|-----|--------------------|-------------|
| R1 | minor | `zod` absent from `apps/ui/package.json` and not transitively resolvable (verified empirically: `Cannot find package 'zod'`); knip would flag it unlisted | Fixed: Group 3 deliverable 1 requires adding `zod` to `apps/ui` dependencies; file list updated |
| R2 | minor | `window` is undefined under `bun test` (verified empirically), so a bare `window.location.origin` in the sentinel resolver throws in Group 3's unit tests | Fixed: resolver reads `globalThis.window?.location.origin`; Group 3 deliverable 5 requires stubbing `globalThis.window` and `localStorage` |
| R3 | minor | Single bound-URL shape leaves no re-binding path: `trust.ts:159-168` early-returns when handshook, and `--rotate` (`trust.ts:173`) overwrites keys — unsigning server A, which 401s on signature-required instances (`require-signed-instance.ts:149-159`) | Fixed: Decision 11 + Group 2 deliverable 4 switched to `boundServers: string[]` append; re-handshake registers the existing pubkey without rotating (route idempotent per `trust.ts:184-186`); already-handshook message lists bound servers; new Group 2 AC |
| R4 | minor | Simplicity Case "deferred until measured" bullet was stale — cited the signing break and CORS discovery as future triggers when both are now addressed in scope | Fixed: bullet rewritten to defer only per-server *keypairs* and an API-side CORS default change, with new triggers |

### Plan review (scope-merge: auth modes) — 2026-07-31 — Verdict: BLOCKED

**Reviewer:** plan-review agent (independent, evidence-first). **Method:** full re-read; all seven khal reference citations verified exact against `/home/namastex/workspace/repos/khal/genie/repos/` (verifier properties, role hierarchy, device-flow endpoints, grants lifecycle — table in reviewer transcript); omni's actual `packages/api` auth chain and the governing `omni-full-multitenancy` wish audited.

**Core problem (one-sided):** Groups 5–7 were planned against the khal *reference* while omni's *own* auth architecture went unexamined. Omni already has: an auth-mode flag (`OMNI_MULTITENANCY_ENABLED`, `tenancy/feature-flag.ts`) with a three-state enforcement posture (`tenancy/enforcement-posture.ts:58-67`), a 23-module `packages/api/src/tenancy/` subsystem, `middleware/platform-auth.ts` defining platform authority as a `credentialClass = tenant | platform` resolved through an isolated auth-bootstrap service with fail-closed properties, and a documented protected-chain order (`app.ts:390-404`) in which `scope-enforcer.ts:372-386` 401s any request without an `apiKey` context — all produced by `omni-full-multitenancy` (`risk: critical`, `execution_authorized: true`, in progress). **Carve-out: Groups 1–4 are unaffected, touch no `packages/api` file, and remain SHIP-ready** (all prior findings + R1–R4 verified still applied; `omni server add` verify-before-persist is a clean answer to the no-health-command directive).

| # | Sev | Finding (evidence) | Requirement |
|---|-----|--------------------|-------------|
| 1 | blocker | `AUTH_MODE` duplicates `OMNI_MULTITENANCY_ENABLED` (`tenancy/feature-flag.ts`; posture `enforcement-posture.ts:58-67`; control-plane mount `app.ts:378-381`) — two flags over one behavior admit contradictory states the wish's own OUT bullet forbids | Reconcile to the existing flag/posture; no second mode flag |
| 2 | blocker | A khal-session request 401s at `scope-enforcer.ts:372-386` (requires `apiKey` context); "runs alongside" names no chain position; two precedents exist (tenancy edge projects into `apiKey` — `middleware/auth.ts:20-27`; platform control-plane bypasses with own guard — `app.ts:375-377`) and neither is chosen | Choose and specify chain position + context projection |
| 3 | blocker | "platform-admin" collides with omni's security-critical `credentialClass = platform` (`platform-auth.ts:2-14`): a shared-secret HS256 JWT would confer see-everything authority reaching neither auth-bootstrap, `credentialClass`, nor `scopeAllows` — the exact bypass `platform-auth.ts` exists to prevent | Rename the KHAL role concept; route authority through the real model |
| 4 | blocker | Gate premise false: "omni today has no tenant row-ownership" — `packages/api/src/tenancy/` (23 modules incl. `route-ownership.ts`, `tenant-transaction.ts`) + `middleware/tenancy.ts` exist and are actively changing under `omni-full-multitenancy` (its G3/G4 are this very chain); "dependency is partial" is wrong in kind | Sequencing agreement with that wish before any `packages/api` middleware work |
| 5 | major | `Authorization: Bearer` ambiguous across three consumers (`auth.ts:29-30`, `platform-auth.ts:24`, ported verifier) — no discriminator/precedence; today authMiddleware would feed a JWT to `apiKeys.validate` and 401 | Specify discriminator (e.g. three-segment JWT shape) + precedence |
| 6 | major | Group 5 validation never runs the existing auth suites its own AC 1 claims unchanged (`tenancy.test.ts`, `scope-enforcer*.test.ts`, `genie-signature*.test.ts`, …) | Add `make test-api` to Group 5 validation |
| 7 | major | The merge fuses a client-side convenience feature with a security-critical identity change on one branch/review surface; split is verified clean (no file overlap) | Reviewer recommends Groups 5–7 as separate wish; user decision pending |
| 8 | minor | Wave 3 header ("after Wave 1") contradicts Group 5 `depends-on: none` | Fix whichever is wrong |
| 9 | minor | Consume the platform-served `exchange_url` (`auth-device.ts:621,637`) rather than hardcoding; keep interval-from-server explicit in AC | Amend Group 6 |
| 10 | minor | Unauthenticated `authMode`/`platformUrl` disclosure on the health payload should be a recorded decision | Add decision row |
| 11 | minor | Simplicity Case "simplest complete design" bullet describes only the registry; auth-mode bullet claims minimality that ignores omni's existing machinery | Rewrite after 1–4 resolve |

**Path forward per reviewer:** dispatch Waves 1–2 now; re-plan Groups 5–7 against the real surface (existing flag/posture, chosen chain position, renamed role concept, Bearer discriminator, sequencing agreed with `omni-full-multitenancy`); re-review required. Findings 8–11 follow Groups 5–7 wherever they live.

### Execution reviews — 2026-07-31 — all four groups closed after fix loops

Each group: independent reviewer (≠ engineer) ran the validation personally; FIX-FIRST findings fixed by a separate fixer (one loop each); orchestrator re-validated before `genie task done`.

| Group | Verdict → outcome | Notable findings fixed |
|-------|-------------------|------------------------|
| 1 (CLI config) | FIX-FIRST → done (40 config tests, 499-sweep) | HIGH: flat `apiUrl`/`apiKey` mirror tracked the *active* (possibly remote) entry — now mirrors `default` only, and `projectEntry`'s missing-entry branch returns safe defaults instead of inheriting the mirror (closes the remote-key-into-PM2 leak plus the older-CLI-build face of it). Also: knip unused export; `config unset apiUrl` silent no-op; warning emission now asserted. Accepted judgment call: doctor/update probes resolve from the `default` entry rather than hardcoded localhost (AC wording corrected in Group 1 deliverable 3). |
| 3 (UI registry) | FIX-FIRST → done (19 UI tests) | HIGH: two literal NUL bytes in `sdk.ts` made the file binary to git (undiffable/unmergeable) — replaced with ` ` escapes; MEDIUM: `crypto.randomUUID()` undefined on non-secure origins (http://<remote-ip>) — guarded fallback with a negative-control test. Reviewer also confirmed the old `usePersons` `baseUrl` reach-in was always `undefined` (silently same-origin-only). |
| 2 (CLI commands) | FIX-FIRST → done (93 cli tests, 567-sweep) | BLOCKER (empirically proven by reviewer): re-handshake overwrote the single `hostId` with the new server's UUID, hard-401ing the previously bound server — `boundServers` is now `Array<{url, hostId}>` with per-URL id selection in `loadSigningContextForServer` and legacy coercion; tests assert per-origin ids on the wire, not just header presence. Also: knip export; duplicate `--server` rejected; `add` trims names; keyless add probes health credential-free (no `'unset'` placeholder on the wire); `syncEffectiveIntoEntry` normalizes URLs so `auth login --api-url` can't desync an entry from its signing binding. |
| 4 (UI switcher) | FIX-FIRST → done (19 UI tests, knip clean for apps/ui) | MAJOR: first-ever `apps/ui` test file missing from knip entry globs (CI gate) — `src/**/*.test.ts` added; dialog gained a staleness token so a hung validation resolving after close can't persist/activate; `removeServer` cache-discipline contract documented; last-entry removal tested. Wave-1 carried findings all closed: `switchServer(id, queryClient)` required arg, unknown-id no-op, dangling-pointer correction persisted. |

---

---

## Files to Create/Modify

```
packages/cli/src/config.ts                       # servers block, Zod schema, migration, resolution, loadLocalRuntimeConfig
packages/cli/src/client.ts                       # honor override, no stale cache, keyless-entry error names target
packages/cli/src/commands/server.ts              # NEW: omni server command group (masked list, --reveal)
packages/cli/src/commands/auth.ts                # login/logout/status target server entries; recover uses local config
packages/cli/src/index.ts                        # register command, --server/--server= pre-parse stripping
packages/cli/src/status.ts                       # inline status shows active server
packages/cli/src/runtime-env.ts                  # buildRuntimeEnv reads loadLocalRuntimeConfig
packages/cli/src/commands/start.ts               # local-runtime config accessor
packages/cli/src/commands/restart.ts             # local-runtime config accessor
packages/cli/src/commands/update.ts              # local-runtime config accessor + localhost probe
packages/cli/src/commands/install.ts             # local-runtime config accessor
packages/cli/src/commands/doctor.ts              # local-runtime config accessor + localhost probes
packages/cli/src/signing.ts                      # host.json server binding, gated signing
packages/cli/src/commands/trust.ts               # handshake records target server URL
packages/cli/src/__tests__/config.test.ts        # migration/resolution/override/runtime-isolation tests; fix stale header comment
packages/cli/src/__tests__/cli.test.ts           # server command + unsigned-second-server tests
apps/ui/package.json                             # @radix-ui/react-dropdown-menu + zod
apps/ui/src/lib/servers.ts                       # NEW: registry (localStorage, Zod, migration)
apps/ui/src/lib/sdk.ts                           # resolve from active entry, switchServer
apps/ui/src/hooks/usePersons.ts                  # route through registry/client
apps/ui/src/hooks/useAuth.ts                     # login stores key on active entry
apps/ui/src/pages/Login.tsx                      # works against active entry
apps/ui/src/components/ui/dropdown-menu.tsx      # NEW: shadcn-style wrapper
apps/ui/src/components/layout/ServerSwitcher.tsx # NEW: sidebar dropdown
apps/ui/src/components/layout/AddServerDialog.tsx# NEW: add-server dialog
apps/ui/src/lib/__tests__/servers.test.ts        # NEW: registry unit tests (localStorage stub)
apps/ui/src/components/layout/Sidebar.tsx        # mount switcher in top block; logout unified via useAuth
```
