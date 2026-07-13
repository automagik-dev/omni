# Handoff — Omni ↔ app-kit integration (users, permissions, auth)

> **Why this exists:** the Omni Admin UI (`apps/khal-ui`) is built, deployable, and shipping to
> production **gated OFF**. It cannot be turned on for anyone — hml or prod — because Omni has no
> real KHAL app-kit integration: **no users, no roles, no permissions, no login**. This document
> captures the full state and scopes the surgical wish that closes that gap.
>
> Status date: 2026-07-13. Author: prior session (admin-ui deploy arc).

---

## 1. Where the admin-UI work stands

| Thing | State |
|---|---|
| UI (pack + BFF + standalone shell) | **Built, live-verified** against the local k8s omni backend |
| k8s deploy (image, helm `adminUi.*`, CI publish, ExternalSecret, Makefile) | **Shipping to main** (PRs #821 → #822 → #824 → #823) |
| Local dogfood | **Proven** — `omni-admin-ui` pod Running, `/diag` auth ok, live reads, key never client-side |
| `adminUi.enabled` in **dev** | `true` |
| `adminUi.enabled` in **homolog / prod** | **`false` — deliberately gated (this doc's subject)** |
| Image `ghcr.io/…/omni-admin-ui` | **Not published yet** — `build-push-ui` is gated on a missing `KHAL_NPM_TOKEN` repo secret |

**Architecture as deployed (single container):**
`ingress → Service:8899 → BFF` — one Bun process serves the built SPA **and** proxies `/omni/*` to
omni-api, injecting `x-api-key` server-side (the browser never sees the key).

---

## 2. The gap — why the UI cannot be exposed to anyone

Three findings, each verified in code. Together they mean **any person who can reach the UI's host
gets unauthenticated, unrestricted admin control of the Omni backend.**

### 2.1 The "logged-in user" is a hardcoded mock
The standalone shell is the Vite harness (`dev/`), which *is* the KHAL-OS substitute. It fabricates
the identity the pack would otherwise get from a real host:

`apps/khal-ui/dev/src/sdk-shim.tsx`
```ts
export const DEV_USER: KhalAuth = {
  userId: 'harness-dev',
  role: 'platform-dev' satisfies Role,
  permissions: ['*'],          // ← wildcard: everything
  email: 'dev@omni.local',
  name: 'Omni Dev',
};
// …provided via <KhalAuthContext.Provider value={DEV_USER}>
```
There is **no login**. Every visitor is `platform-dev` with `permissions: ['*']`.

### 2.2 The pack enforces nothing
`package/src` **never calls `useKhalAuth()`** and **never checks a permission**. Grep for
`useKhalAuth|hasPermission|minRole` across `package/src` returns *zero* functional hits.

The only permission references are **declarations** in `package/src/manifest.ts` (→ `khal-app.json`):
```json
"permissions": ["nats:publish", "nats:subscribe"],
"defaultScope": "shared",
"allowedScopes": ["shared", "user"],
"views": [{ "permission": "omni-admin", "minRole": "member", … }]
```
These are a **contract for a KHAL OS host to enforce** — and no such host exists in the standalone
deployment. Nothing reads or honours them. Every page and every mutating action is reachable.

### 2.3 The BFF is a single god-key, shared by all visitors
The BFF holds one `omni_sk_…` key and injects it as `x-api-key` on **every** request, regardless of
who the caller is (`service/src/bff.ts`). It is a *secret boundary*, not an *authorization
boundary*. Even if the UI hid buttons, a visitor could call `/omni/api/v2/*` directly through the
same origin and get the full key's authority.

### 2.4 …and Omni has no user model to authorize against
This is the root constraint. **Omni's schema has no users, roles, accounts, or memberships.**
`packages/db/src/schema.ts` defines only:
- `apiKeys` (with a `scopes` column)
- `apiKeyAuditLogs`

`/api/v2/auth/validate` returns `{ keyPrefix, keyName, scopes }` — the **key** is the identity.
There is no principal to map a KHAL user onto, and no general RBAC middleware in `packages/api/src`.

> **Net:** KHAL app-kit speaks *users → roles → permissions*. Omni speaks *API keys → scopes*.
> Nothing bridges the two, and the UI enforces neither.

---

## 3. What the wish must address (surgical scope)

Four pieces. (1) and (4) are the hard ones; (2) and (3) fall out of them.

### (1) Identity: a real host supplying `KhalAuthContext`
Replace the `sdk-shim` mock with a real logged-in user. Decide the host model:
- **A — Real KHAL OS host:** omni-admin is `khal install`-ed into KHAL OS, which provides identity,
  the vault, and enforces `permission: omni-admin` / `minRole: member` from `khal-app.json`.
  *(Note: `khal install` packaging was never wired — flagged as a stretch item in `HANDOFF.md`.)*
- **B — Standalone + auth layer:** keep the self-hosted pod, front it with SSO/OIDC (ALB OIDC, or a
  KHAL auth service), and have the BFF resolve the authenticated user into `KhalAuth`.

### (2) Enforcement in the pack
The UI must actually consume `useKhalAuth()` and gate routes + destructive actions on permissions.
Today this is **greenfield** — there is no gating code to fix, it has to be written.

### (3) Enforcement at the BFF (non-negotiable)
Client-side gating is cosmetic. The BFF must become the **policy enforcement point**: authorize each
`/omni/api/v2/*` request against the caller's identity before injecting a key. Otherwise the
same-origin API remains a full-admin backdoor.

### (4) The bridge: KHAL identity → Omni authorization
**This is the core architectural decision the wish must make.** Three candidate shapes:

| Option | Shape | Trade-off |
|---|---|---|
| **A. Per-user scoped keys** | BFF mints/looks up an omni API key **per KHAL user**, mapping role → `scopes`. | Reuses omni's existing `apiKeys` + `apiKeyAuditLogs` (audit trail per user, for free). No omni schema change. Key lifecycle to manage. |
| **B. Omni grows a user model** | Add `users`/`roles`/`memberships` + RBAC middleware to omni; KHAL identity maps to omni principals. | Most "correct" long-term; biggest change; duplicates identity that app-kit already owns. |
| **C. BFF-only policy** | Keep the single key; BFF authorizes each route against the KHAL user's permissions. | Smallest change, fastest. But omni's audit log attributes everything to one key — no per-user attribution. |

**Recommendation to evaluate first: A** — it's the only option that gives per-user *attribution* in
omni's existing audit log without inventing a second identity system, and it needs no omni schema
change. Worth pressure-testing against B.

### Also in scope (small)
- `khal install` / packaging path for the pack (never wired).
- Enforce `allowedScopes` (`shared` vs `user`) — currently declared, unused.
- Then, and only then: flip `adminUi.enabled: true` for hml (proving ground) → prod, with the
  ExternalSecret (`deploy/k8s/omni-hml/externalsecret-omni-ui.yaml`, already shipped inert) and the
  commented ALB stanzas in `values-hml-alb.yaml` / `values-prod-alb.yaml`.

---

## 4. Explicitly OUT of scope for this wish

- Re-designing the UI itself (it's feature-complete; 268 capabilities inventoried).
- The k8s deploy plumbing (done and shipping).
- Publishing the image (unblocked by adding the `KHAL_NPM_TOKEN` secret — independent chore).

---

## 5. Key files / evidence

| Path | Why it matters |
|---|---|
| `apps/khal-ui/dev/src/sdk-shim.tsx` | The mocked `KhalAuth` (`permissions: ['*']`) — what must be replaced |
| `apps/khal-ui/package/src/manifest.ts` | Declares `permission: omni-admin`, `minRole: member` — unenforced |
| `apps/khal-ui/service/src/bff.ts` | Single-key injection; must become the policy enforcement point |
| `packages/db/src/schema.ts` | `apiKeys` + `apiKeyAuditLogs` — **no users/roles**; the root constraint |
| `packages/api/src/routes/v2/auth.ts` | `/auth/validate` → `{keyPrefix, keyName, scopes}` — key-as-identity |
| `deploy/helm/omni/values-prod.yaml` | `adminUi.enabled: false` — the gate this wish lifts |
| `apps/khal-ui/HANDOFF.md` | Original UI build handoff (architecture, capability matrix) |

## 6. Prerequisites unrelated to auth
- **`KHAL_NPM_TOKEN`** repo secret → activates `build-push-ui`, publishes `ghcr.io/automagik-dev/omni-admin-ui`. Without it no image exists and *no* realm can run the pod.

---

**Bottom line for the wish:** Omni has no users. The admin UI assumes it does (via a mock). Closing
that — deciding how a KHAL identity becomes an Omni authorization, and enforcing it at the BFF — is
the whole job. Everything else is already built and waiting behind a feature flag.
