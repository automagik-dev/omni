# omni-appkit-gap — Group 1: KHAL identity-token contract & role taxonomy

Status: **discovery complete — no app-kit change required; gate ruling = CLEARED WITH HARD CONDITIONS (see §4)**
Date: 2026-07-13
Evidence repos:
- app-kit (read-only): `/Users/feliperosa/workspace/app-kit`, branch `feat/claude-design-native` @ `cb6dd65`.
  `git diff origin/main` over `packages/os-sdk/src/app/{auth,auth-context,roles}.ts`,
  `packages/os-sdk/src/server/`, `packages/types/src/{auth,roles}.ts` is **empty** → every claim below
  is branch-independent (identical on `main`).
- omni: `/Users/feliperosa/workspace/omni` (this repo).

All `file:line` paths in sections 1–3 are relative to the **app-kit** repo root unless prefixed with `omni:`.

---

## 1. Identity token contract

### 1.1 What the host makes available to an installed pack

`KhalAuth` — `packages/types/src/auth.ts:2-17` (re-exported by the SDK at
`packages/os-sdk/src/app/auth.ts:3,6` and `packages/os-sdk/src/app/index.ts:39-40`):

```ts
export interface KhalAuth {
	userId: string;
	orgId: string;
	role: string;
	permissions: string[];
	loading: boolean;
	email?: string;    // types/src/auth.ts:10  — "propagated via the platform JWT"
	name?: string;     // :11
	picture?: string;  // :12
	/** Raw encoded platform JWT, exposed for pack BFFs that need to forward
	 *  `Authorization: Bearer <jwt>` to upstream services. Optional — callers
	 *  without a token (legacy / standalone) MUST handle absence gracefully. */
	token?: string;    // types/src/auth.ts:13-16
}
```

The host supplies it by mounting a provider over `KhalAuthContext`
(`packages/os-sdk/src/app/auth-context.ts:10`). The provider implementation is **host-side, not in
app-kit**: `packages/os-sdk/src/app/auth.ts:10` states it is "the nearest KhalAuthProvider (WorkOS on
web, Tauri on desktop)". `rg KhalAuthProvider` across app-kit returns only doc comments — the concrete
provider lives in the KHAL OS core/kernel repo, which is not checked out here. That is a *sourcing*
gap, not a *contract* gap: the contract (the `token` field and its verifier) is fixed in the published
SDK, and the intent is recorded in the commit that added it —
`git show -s 170f2ce`: "Adds optional `token?: string` to KhalAuth so pack frontends can forward
`Authorization: Bearer <jwt>` from their BFFs to upstream services … Paired with the
eugenia-metrics-pack auth-bridge PR that consumes the field."

### 1.2 Token verification (server side) — **YES, a server-verifiable token exists**

**Mechanism: HS256 (HMAC-SHA256) JWT with a pre-shared secret. NOT JWKS, not asymmetric, no
introspection endpoint.** `rg -i "jwks|jwtVerify|createRemoteJWKSet|jose"` over app-kit returns **zero
hits** — there is no asymmetric/JWKS path anywhere.

Verifier: `@khal-os/sdk/server` → `validateKhalSession()` —
`packages/os-sdk/src/server/index.ts:170-186`.

| Property | Value | Evidence (`packages/os-sdk/src/server/index.ts`) |
|---|---|---|
| Entry point | `await validateKhalSession(req, opts): Promise<KhalSession \| null>` | `:170-186` |
| Export path | `@khal-os/sdk/server` (Node-only condition) | `packages/os-sdk/package.json:70-82` |
| Algorithm | HS256, `createHmac('sha256', secret)` + `timingSafeEqual` | `:21`, `:110-118` (rejects any `alg !== 'HS256'` at `:135`) |
| Key material | `options.secret ?? process.env.KHAL_SESSION_SECRET` | `:44-45`, `:174-175` (returns `null` if unset) |
| Credential 1 | `Authorization: Bearer <jwt>` — **takes precedence** | `:82-90` (`extractToken`), `:17` |
| Credential 2 | Cookie `khal-session` (name overridable) | `:46-47`, `:52`, `:91-92` |
| Expiry checks | `exp` / `nbf` against injectable clock | `:139-140`, `:181` |
| Required claims | `userId` (or `sub` fallback), `orgId`, `role`, `permissions[]` — missing any ⇒ `null` | `:146-154` (`coerceSession`) |
| Optional claims | `email`, `name`, `picture` passed through | `:157-159` |
| Failure mode | returns `null` for *every* failure → caller maps to **401**: no secret `:175`, no creds `:179`, bad signature / bad `alg` / expired `:183` (via `verifyHs256`), missing claims `:185` (via `coerceSession`). Docstring: `:163-168` | `:175`, `:179`, `:183`, `:185` |
| **Not** validated | **no `iss`, no `aud`, no `kid`, no org check.** `verifyHs256` (`:110-143`) checks only `alg`/`typ`/`exp`/`nbf`; `coerceSession` (`:145-161`) only requires `orgId` to *exist* (`:148`, `:154`) — it never checks its value | `:110-143`, `:145-161` |
| Returned shape | `KhalSession { userId, orgId, role, permissions[], email?, name?, picture? }` | `:23-31` |

Provenance of the mechanism — `git show -s 6fd628d` ("feat(sdk): add @khal-os/sdk/server
validateKhalSession"): "Node-only helper that verifies a Khal-issued HS256 JWT presented as either a
`Bearer` token or `khal-session` cookie … Used by pack backends (eugenia, pack-hello, …) to
authenticate Khal users without reimplementing the WorkOS handshake." The module header
(`packages/os-sdk/src/server/index.ts:5-8`) states the host side of the handshake: "**Khal core mints
the JWT after WorkOS sign-in and forwards it to the pack on every request.**" 21 unit tests cover both
paths (`packages/os-sdk/src/server/index.test.ts:41-...`).

**Availability to Omni today (verified against the live registry, not assumed):**

```
npm view @khal-os/sdk@2.0.111 → dist.tarball git.namastex.io/api/packages/khal/npm/…/sdk-2.0.111.tgz
tar -tzf …  → package/dist/server/index.js | index.cjs | index.d.ts   (server entry IS published)
tar -xzOf … package/dist/server/index.d.ts → declare function validateKhalSession(...)  (:52)
tar -xzOf khal-os-types-2.2.63.tgz package/dist/index.d.ts → interface KhalAuth { … token?: string }  (:4-19)
```

`omni:apps/khal-ui/package/package.json` already pins `@khal-os/sdk ^2.0.111` /
`@khal-os/types ^2.2.63` (devDeps) — i.e. **the exact versions that carry both `KhalAuth.token` and
`validateKhalSession`**. `omni:apps/khal-ui/service/package.json` (the BFF workspace) currently has
**no `@khal-os/sdk` dependency at all** — Group 4 must add it (`"@khal-os/sdk": "^2.0.111"`) to use the
`/server` subpath.

### 1.3 How the pack frontend obtains the token

- Hook: `useKhalAuth(): KhalAuth | null` — `packages/os-sdk/src/app/auth.ts:13-15`, reading
  `KhalAuthContext` (`packages/os-sdk/src/app/auth-context.ts:10,16-18`). Returns `null` while
  resolving / unauthenticated (`auth.ts:11`).
- The raw JWT is `useKhalAuth()?.token` (`packages/types/src/auth.ts:16`). The frontend **will have to**
  attach it as `Authorization: Bearer <token>` on its same-origin `/omni/*` fetches — that is the field's
  documented purpose (`types/src/auth.ts:13-15`, commit `170f2ce`). **This is required future behavior,
  not current behavior:** `rg "useKhalAuth|KhalAuth|@khal-os/sdk" omni:apps/khal-ui/package/src` returns
  **zero hits** — the pack reads no auth today and attaches no Authorization header (see §4.0).
- Cookie path: the browser would send `khal-session` automatically **only if** the host sets that
  cookie on an origin/path that covers the pack's `/omni/*` calls. Nothing in app-kit sets that cookie
  (`rg "khal-session"` hits only `packages/os-sdk/src/server/index.ts:46,52` and its test) — it is
  host-issued. `validateKhalSession` accepts it with Bearer winning ties (`server/index.ts:17,82-92`),
  so **Bearer-primary / cookie-fallback (the library default) is the correct BFF posture** and works
  whether or not the cookie materializes.
- For comparison, the browser NATS transport shows the same "host hands the browser a JWT" pattern:
  `BrowserEnterpriseConfig { wsUrl, token }` read from the host adapter and sent as the
  `bearer.<jwt>` WebSocket subprotocol (`packages/os-sdk/src/app/nats-client-browser.ts:24-31,42-51,
  187-193`).

### 1.4 What the BFF must NOT trust

`KhalAuth.permissions[]` / `KhalSession.permissions[]` are **KHAL app-visibility permissions**, not an
authorization vocabulary: they are computed from the app manifest as "every app whose `minRole` is at
or below your level, plus `desktop`" (`packages/os-sdk/src/app/roles.ts:61-73`,
`computeRolePermissions`). They must never be mapped onto Omni scopes. The authorization input for
Omni is **`role` only**, normalized (§2), then mapped to a key profile.

---

## 2. KHAL role taxonomy

### 2.1 Canonical roles (the complete set)

`packages/types/src/roles.ts:2-3` (re-exported by `packages/os-sdk/src/app/roles.ts:9-13`):

```ts
export const ROLE_HIERARCHY = ['member', 'platform-dev', 'platform-admin', 'platform-owner'] as const;
export type Role = (typeof ROLE_HIERARCHY)[number];
```

Exactly **four** roles, ordered least → most privileged. There is no `operator`, no `viewer`, no
`admin` as a canonical slug — the wish's directional guess used non-existent names.

### 2.2 Aliases and normalization

`packages/os-sdk/src/app/roles.ts:22-31` — legacy/shorthand slugs WorkOS may still return:

| Incoming | Canonical | Evidence |
|---|---|---|
| `admin` | `platform-admin` | `roles.ts:24` |
| `developer` | `platform-dev` | `roles.ts:25` |
| `owner` | `platform-owner` | `roles.ts:26` |
| `viewer` | `member` | `roles.ts:27` |
| `user` | `member` | `roles.ts:28` |
| `dev` | `platform-dev` | `roles.ts:30` |
| anything else / empty | **`member`** (least privilege *on the ladder* — but see the fail-open warning below) | `roles.ts:41-45` |

> **⚠️ `member` is fail-closed on the role ladder but FAIL-OPEN as a security property.**
> `normalizeRole` maps **any** unrecognized string — a typo, a future `org-guest`, an unseen WorkOS role —
> to `member` (`roles.ts:41-45`), and §2.3 maps `member` → `console-viewer` = **read access to every
> conversation in the tenant**. An unknown principal therefore does not fail closed to *no access*; it
> fails **open to read-everything**. **Required decision (Group 4):** the recommended posture is to
> normalize for *comparison* only and gate key-minting on **exact membership in `ROLE_HIERARCHY`** —
> mint **no key (401)** for any role slug that is not an exact canonical role or a listed alias above.
> If we instead accept "any authenticated KHAL org member may read all Omni conversations," that must be
> recorded here as an explicitly owned decision with a human owner — not inherited by default.

`normalizeRole(role)` (`roles.ts:41-45`) is the only correct way to read `session.role` — it is a free
`string` in both `KhalAuth` (`types/src/auth.ts:5`) and `KhalSession`
(`os-sdk/src/server/index.ts:26`), so the BFF **must** normalize before mapping.

`hasMinRole(userRole, minRole)` (`roles.ts:48-50`) is a pure `ROLE_HIERARCHY.indexOf` comparison —
role checks are ordinal, never string equality.

### 2.3 FINAL role → Omni key-profile map

Omni's existing profile vocabulary is `ProfileName = 'cs' | 'personal' | 'scout' | 'coworker' |
'admin'` (`omni:packages/api/src/constants/profiles.ts:21`, templates at `:81-148`), over verb buckets
`'outgoing' | 'read' | 'context' | 'turn' | 'multimodal_in' | 'multimodal_out'`
(`omni:packages/api/src/constants/verbs.ts:32`). **The `console-*` profiles the wish names do not exist
yet** — they are net-new templates for Groups 2/3 to add to `PROFILES` (and to `ProfileName`).

| KHAL role (canonical) | Hierarchy idx | Omni key profile | Rationale |
|---|---|---|---|
| `member` | 0 | `console-viewer` | Read-only console. Buckets: `read`, `context` minus `use`. **Only for an *exact* `member`/alias match** — do NOT let `normalizeRole`'s catch-all land unknown slugs here (that is fail-open read-everything; see the warning in §2.2). |
| *unrecognized / absent role slug* | — | **no key minted → 401** (recommended) | `normalizeRole` would silently coerce it to `member` (`roles.ts:41-45`). Gate key-minting on exact `ROLE_HIERARCHY`/alias membership instead. |
| `platform-dev` | 1 | `console-operator` | Day-to-day operator: read + send + turn (`read`, `context`, `outgoing`, `turn`, `multimodal_in`, `multimodal_out`). No key/tenant administration. |
| `platform-admin` | 2 | `console-admin` | Full console incl. key management / admin routes (`omni:packages/api/src/routes/v2/keys.ts`). |
| `platform-owner` | 3 | `console-admin` | Highest KHAL role; ≥ `platform-admin` by `hasMinRole` (`roles.ts:48-50`). Same profile — no wider Omni surface exists above `console-admin`. If Groups 2/3 later need an owner-only capability, split then, not now. |
| *no valid session* | — | **no key minted → 401** | `validateKhalSession` returns `null` for every failure (`server/index.ts:163-186`). |

Deltas vs the wish's directional guess: `member`→`console-viewer` **holds**; the wish's
"operator-tier" is really **`platform-dev`**; the wish mapped `platform-dev`→`console-admin`, which is
**wrong / over-privileged** — `platform-dev` is only index 1 of 4 and must land on `console-operator`.
`console-admin` belongs to `platform-admin` and `platform-owner`.

Implementation note for Group 4: gate with `hasMinRole(normalizeRole(session.role), 'platform-admin')`
style ordinal checks, never `role === 'admin'`.

---

## 3. `khal install` packaging contract

Two validators run over `khal-app.json` and **they disagree** — both must be satisfied.

**A. Canonical schema validator** — `validateManifest()`,
`packages/os-sdk/src/app/validate-manifest.ts` (re-exported `packages/os-sdk/src/app/manifest.ts:16`):

| Field | Required? | Rule | Evidence |
|---|---|---|---|
| `id` | **required** | non-empty, `[a-z0-9][a-z0-9-]*` | `validate-manifest.ts:44-48` |
| `views[]` | **required** | each: `id`, `label`, `permission`, `component` (strings); optional `minRole`, `natsPrefix`, `defaultSize` | `:50-55`, `:143-176` |
| `desktop` | **required** | object with `icon`, `categories: string[]`, `comment` | `:57-62`, `:179-191` |
| `schemaVersion`, `name`, `version`, `description`, `author`, `license`, `repository`, `minHostVersion` | optional | type-checked when present | `:66-96` |
| `services[]` | optional | unique `name`; `entry` **or** `command`; `runtime ∈ {node, python}`; `restart ∈ {always,on-failure,never}`; `ports: number[]`; `health {type,target[,interval,timeout]}` | `:100-106`, `:193-258`, runtimes at `:11` |
| `env[]` | optional | unique `key`, `description`, `required: boolean`; optional `default`, `type ∈ {string,number,boolean,secret,url}`, `visibility ∈ {config,vault}` | `:110-116`, `:280-329` |
| `deploy`, `tauri` | optional | see `:120-126`, `:331-395`; `:130-136`, `:397-420` | — |

**B. Install-command validator** — `validateManifestContract()`,
`packages/app-kit/src/commands/install.ts:563`, requires: `kind`, `id`, `name`, `version`, `icon`,
`description`, `author`, `permissions` (`install.ts:578`). It does **not** check `views`/`desktop`
(`install.ts:590` calls those "temporary HML compatibility" fields for the runtime-v2 transition).
Recognized top-level extension keys: `x-khal-archipelago`, `x-khal-deploy`
(`install.ts:234-235`; supported-key list at `:202-236`; archipelago plan parsing at `:472-538`).
Install reads `id`/`name`/`version` (`:454-462`), the `env[]` schema vs `.env.example`
(`:384-403`, `:600-641`), and `settings.schema.path` / `settings.secrets` (`:410-451`).
It enforces **no dist/bundle layout** — no remote-entry, module-federation, or bundle-path check exists
anywhere in `install.ts`; services point at source entries (`entry: "service/src/index.ts"`) and the
container build (via `x-khal-deploy`) is what actually ships. `packages/app-kit/src/commands/registry.ts`
is npm-token/auth plumbing for `@khal-os/*`, **not** a pack registry — it plays no part in install.

**Deltas for `omni:apps/khal-ui/khal-app.json`** (input for Group 6 — not implemented here):

| # | Delta | Severity | Evidence |
|---|---|---|---|
| D1 | **`desktop` block missing** (`icon`, `categories[]`, `comment`) | HIGH — fails validator A, passes B | `validate-manifest.ts:57-62,179-191`; omni manifest has no `desktop` key |
| D2 | `services[0].runtime: "bun"` is **not in `VALID_RUNTIMES = ['node','python']`** | MEDIUM — fails validator A. Note the official scaffold `packages/app-kit/templates/app/khal-app.json:24` ships the *same* violation, so this is a stale-schema-vs-reality conflict to raise with app-kit, not necessarily an omni fix | `validate-manifest.ts:11-12,223-227` |
| D3 | No `x-khal-deploy` / `requires` block (template has both) | NONE (optional) — but means the manifest declares no deploy topology; omni deploys via its own helm chart today | `install.ts:234-235`; template `khal-app.json` |
| D4 | Group 4 will add a `KHAL_SESSION_SECRET` env var (`type: secret`, `visibility: vault`) to `env[]`. **The host does NOT provision it.** `install.ts:201` defines `PLATFORM_MANAGED_ENV_KEYS = new Set(['KHAL_NATS_URL','KHAL_ORG_ID'])` — the explicit registry of what the platform injects — and `KHAL_SESSION_SECRET` is **not in it** (its only other use is `install.ts:614`, to *exempt* platform keys from `.env.example` declaration checks). Declaring it in `env[]` therefore only makes it a *prompted/vault* value; **a human must obtain KHAL core's HMAC signing key and place it in Omni's vault.** → **Tracked action: "Obtain/derive the pack's session-signing secret from KHAL core — owner: `<human>`"** (see §4.2) | **HIGH (unowned dependency)** | `install.ts:201,614`; `os-sdk/src/server/index.ts:44-45,174-175`; env schema `validate-manifest.ts:280-329` |
| — | All 8 install-required fields present (`kind`,`id`,`name`,`version`,`icon`,`description`,`author`,`permissions`); `views[]` present and well-formed; no unsupported top-level keys | OK | `install.ts:578`; omni manifest |

---

## 4. Gate ruling — **CLEARED WITH HARD CONDITIONS**

**No app-kit BLOCKING finding: the SDK contract is complete and needs zero app-kit changes.**
**But there IS a delivery-vehicle blocker (§4.0): enforcement must ship flag-gated, default OFF.**

Ruling for Wave 3 (Group 4, the BFF):

- ✅ Group 4 **may** write and unit-test `validateKhalSession` enforcement now, against **self-signed
  HS256 tokens** — the token/verifier/role contract is fully specified in §§1–2 and needs nothing from
  app-kit.
- ⛔ Group 4 **MUST** ship that enforcement path **behind a feature flag, default OFF**, with the legacy
  path intact when the flag is off.
- ⛔ **Pack-in-host delivery (Group 6) is a HARD PREREQUISITE for turning the flag ON.** Enabling
  enforcement before Group 6 lands is a guaranteed total console outage (§4.0).
- ⛔ The mandatory hardening in §4.1 (org pinning) and §4.2 (trust model / secret ownership) is in scope
  for Group 4, not deferrable.

### 4.0 ⛔ Current omni delivery vehicle has NO KHAL host — enforcement today = 100% outage

The doc above notes the KHAL-OS-core host isn't in the checkout. Worse, and verifiable **entirely inside
the omni repo**: in what omni actually ships today, the KHAL host **is not there at all**.

1. **The deployed console is the standalone Vite harness, not a pack installed in a KHAL OS host.**
   `omni:deploy/Dockerfile.admin-ui:51` builds `bun run --filter '@omni/khal-ui-dev' build` and
   `:63` copies `apps/khal-ui/dev/dist` into the image's `./public`. The image serves the **dev harness**.
2. **That harness fakes auth with a hardcoded user and provides NO token.**
   `omni:apps/khal-ui/dev/src/sdk-shim.tsx:51` mounts `<KhalAuthContext.Provider value={DEV_USER}>`, and
   `DEV_USER` (`:16-25`) is `{ role: 'platform-dev', permissions: ['*'], … }` with **no `token` field at
   all**. Nothing mints or forwards a JWT.
3. **The pack never reads auth anyway.**
   `rg "useKhalAuth|KhalAuth|@khal-os/sdk" omni:apps/khal-ui/package/src` → **zero hits**. Even if a token
   existed, no code would attach a Bearer header.

**Consequence:** if Group 4 lands `validateKhalSession` enforcement against today's deployment, every
request carries no credential → `validateKhalSession` returns `null` at `server/index.ts:179` → **401 for
every user → total console outage.** Hence: flag-gated, default OFF; Group 6 (real pack-in-host delivery,
with the frontend attaching `useKhalAuth()?.token`) is the hard prerequisite for flipping it on.

### 4.1 ⛔ MANDATORY (Group 4): pin `orgId` — the token alone does not scope to Omni

`verifyHs256` (`server/index.ts:110-143`) validates only `alg`/`typ`/`exp`/`nbf`. `coerceSession`
(`:145-161`) only requires `orgId` to **exist** (`:148`, `:154`) — it never checks its **value**. There is
**no `iss`, no `aud`, no `kid`** check anywhere. With a platform-wide shared secret, a session minted for a
**different org** or a **different pack** verifies successfully against Omni's BFF and lands on at least
`console-viewer` = read access to this tenant's conversations.

**Requirement:** immediately after `validateKhalSession` returns a session, the BFF **MUST** assert
`session.orgId === <Omni's expected KHAL org>` (env-pinned allowlist) and return **401** otherwise. This is
not optional hardening; without it the verifier is an authentication check with no tenant binding.

### 4.2 ⛔ Trust model: HS256 + shared secret partially DEFEATS this wish's own goal

This wish exists to remove a shared god-key. Be explicit about what replaces it: **HS256 is symmetric.**
The Omni BFF pod would hold KHAL core's **signing** key, not a verification-only key. Anyone with read
access to that pod's env can **mint** a JWT for **any** `userId` / `orgId` / `role` — including
`platform-owner` — and that forged token is valid at **every other pack sharing the secret**. That is a
strictly **larger** blast radius than the Omni-scoped god-key it is meant to replace.

**Required resolution — one of, before the flag is turned on:**
1. **Pack-scoped secret** (preferred): KHAL core signs with a per-pack secret, or adds an `aud` claim the
   BFF pins alongside `orgId` (§4.1). Then a leaked Omni secret forges only Omni-scoped tokens.
2. **Asymmetric / JWKS verification** — file an app-kit request (no such path exists today:
   `rg -i "jwks|jwtVerify|createRemoteJWKSet|jose"` over app-kit → **zero hits**), giving the BFF a
   verify-only public key.
3. If neither is available, record it here as an **explicitly accepted residual risk with a named human
   owner** — it must not be inherited silently.

**Tracked dependency (from D4):** *"Obtain/derive the pack's session-signing secret from KHAL core — owner:
`<human>`."* `install.ts:201` (`PLATFORM_MANAGED_ENV_KEYS = {'KHAL_NATS_URL','KHAL_ORG_ID'}`) proves the
platform does **not** inject `KHAL_SESSION_SECRET`; a human must copy KHAL core's HMAC signing key into
Omni's vault. Until an owner is named, this is an invisible config step, not a plan.

### 4.3 What IS settled (no app-kit change required)

A server-verifiable identity token exists and is already published in the SDK versions this pack pins:

- **Token verification** = HS256 JWT via `validateKhalSession()` from `@khal-os/sdk/server`
  (`packages/os-sdk/src/server/index.ts:170-186`), presented as `Authorization: Bearer <jwt>`
  (from `useKhalAuth().token`, `packages/types/src/auth.ts:13-16`) or the `khal-session` cookie, keyed
  by the pre-shared `KHAL_SESSION_SECRET` (`server/index.ts:174-175`). Verified present in the
  published `@khal-os/sdk@2.0.111` tarball (`dist/server/index.{js,cjs,d.ts}`).

Two **host-side prerequisites** are *not* verifiable from the app-kit checkout (the KhalAuthProvider and
the JWT minter live in the KHAL OS core/kernel repo, which is not present). They do not block *writing and
unit-testing* the verifier against self-signed tokens, but each is a **hard gate on flipping the
enforcement flag ON** (§4.0) — state them plainly rather than assume:

1. **The host must actually populate `KhalAuth.token` (or set the `khal-session` cookie) for this
   installed pack.** Evidence that it does exists only as the SDK's own contract text
   (`os-sdk/src/server/index.ts:5-8`: "Khal core mints the JWT after WorkOS sign-in and forwards it to
   the pack on every request") and commit `170f2ce`'s note that a real pack (eugenia-metrics-pack)
   consumes the field. No app-kit file *proves* the mint. Group 4 must assert it at runtime: if
   `useKhalAuth()?.token` is `undefined` in the installed pack, the Bearer path is dead and only the
   cookie path (or an app-kit/kernel change) remains.
2. **`KHAL_SESSION_SECRET` must reach the BFF's process env.** `rg KHAL_SESSION_SECRET` across the
   whole app-kit repo hits **only** `packages/os-sdk/src/server/index.ts:18,44,174` and its test —
   nothing in `install.ts`, `deploy.ts`, or the scaffold templates injects it. It is therefore an
   operator/host-provisioned secret: the omni pack must declare it in `khal-app.json` `env[]`
   (`type: "secret"`, `visibility: "vault"` — delta D4) and the same secret value must be the one KHAL
   core signs with. If the secret is absent, `validateKhalSession` returns `null` for **every** request
   (`server/index.ts:174-175`) → the console fails closed (401), which is the correct failure mode but
   would look like a total outage.

### 4.4 Fail-closed posture Group 4 must implement

- No session ⇒ **401**, **no** Omni key minted.
- `session.orgId` not in the env-pinned allowlist ⇒ **401** (§4.1).
- Role slug not an **exact** member of `ROLE_HIERARCHY` or its alias table ⇒ **401 / no key minted**.
  Do **not** rely on `normalizeRole`'s catch-all (`os-sdk/src/app/roles.ts:41-45`) as the security
  boundary: it coerces unknown slugs to `member` → `console-viewer` = read-everything (§2.2 warning).
  Use `normalizeRole` for *ordinal comparison*, gate *key-minting* on exact membership.
- Never trust `session.permissions[]` as an Omni scope source (§1.4).
- The whole enforcement path stays **flag-gated, default OFF** until Group 6 lands (§4.0).
