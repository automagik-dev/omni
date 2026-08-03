# Wish: SaaS Platform Auth (KHAL sessions, code + URL login)

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `saas-platform-auth` |
| **Date** | 2026-07-31 |
| **Author** | Felipe Rosa |
| **Appetite** | large |
| **Branch** | `wish/saas-platform-auth` |
| **Repos touched** | omni (`packages/api`, `packages/cli`, `apps/ui`) |
| **Design** | _No brainstorm — direct wish_ |

## Summary

In multitenant (SaaS) deployments, omni delegates human identity to the KHAL app-kit platform: the CLI logs in via the RFC 8628 "code + URL" device flow, the dashboard signs in via the same flow with an httpOnly session cookie, and platform admins see everything. Single-tenant deployments (OSS/self-hosted) are untouched — master API key, BAU. Split out of `multi-server-management` after plan review found the first version was designed against the khal reference without reconciling omni's own in-progress tenancy subsystem; this wish carries that re-plan.

## Scope

### IN

- Group 0 reconciliation: bind this design to omni's real auth architecture — the existing `OMNI_MULTITENANCY_ENABLED` flag and enforcement posture, a chosen middleware-chain position with context projection, KHAL-role naming that cannot be confused with omni's `credentialClass = platform`, a Bearer-token discriminator, and written sequencing with `omni-full-multitenancy`.
- API: validate KHAL platform sessions (`khal-session` HS256 JWT, cookie or Bearer — ported from app-kit's dependency-free verifier) alongside API-key auth, projecting a principal the existing protected chain accepts; fail closed to admin-grade sessions until tenant enforcement is live.
- API: unauthenticated discovery of `{ multitenant, platformUrl }` so CLI/UI adapt per server (recorded as an explicit disclosure decision).
- CLI: `omni auth login` against a multitenant server runs the device flow (print user code + `verification_uri_complete`, poll at the server-given interval, session-exchange via the platform-served `exchange_url`), storing a short-lived session token on the server entry; one silent re-exchange on 401, then re-login prompt.
- UI: mode-aware login (code + URL instead of the API-key form for multitenant servers), httpOnly cookie same-origin / short-lived Bearer token cross-origin, role-aware display, unified logout.

### OUT

- Implementing the device-grant **issuer** inside omni — grants tables, activation page, SSO hop, and token minting stay in the KHAL platform (`platform/src/routes/auth-device.ts`); omni is a validator only. The SaaS composition (which platform, which secrets) is the closed-source part and never lands in this repo.
- Tenant data enforcement (row ownership, RLS, scoped queries) — owned by `omni-full-multitenancy`; this wish must not fake or fork it.
- Org-member (non-admin) access — deferred behind the fail-closed gate until `omni-full-multitenancy` enforcement is live.
- First-party identity (email OTP) or embedding WorkOS in omni.
- Any change to single-tenant auth behavior — existing auth tests must pass unmodified.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Omni is a session validator, never an issuer | The platform already implements the security-critical device-grant machinery: grants table (`platform/src/db/schema.ts:1839-1878`), activation page with device-context card, token-hash-only storage, `pending → linked → completed` lifecycle (`auth-device.ts:64-645`). Verified exact by plan review 2026-07-31. |
| 2 | Session verification ports app-kit's dependency-free verifier | `os-sdk/src/server/index.ts:23-186` (sole import `node:crypto`): HS256 pinned, cookie `khal-session` or Bearer, timing-safe compare, `exp`/`nbf`, required claims `userId/orgId/role/permissions[]`. Claims get Zod per repo contract. Verified exact by plan review. |
| 3 | No new mode flag — reuse `OMNI_MULTITENANCY_ENABLED` + enforcement posture | Omni already gates multitenancy with this flag (`packages/api/src/tenancy/feature-flag.ts`) and a three-state posture (`tenancy/enforcement-posture.ts:58-67`); a second flag admits contradictory states (review blocker 1). Exact composition settled in Group 0. |
| 4 | Chain position and principal projection are a Group 0 deliverable, chosen from the two existing precedents | The protected chain (`app.ts:390-404`) 401s any request without an `apiKey` context (`scope-enforcer.ts:372-386`). Precedent A: project into `apiKey`/`authContext` like the tenancy edge (`middleware/auth.ts:20-27`). Precedent B: separately guarded subtree like the platform control plane (`app.ts:375-377`). Review blocker 2 requires choosing explicitly, with the scope-enforcer interplay specified. |
| 5 | KHAL roles are named and routed so they can never be mistaken for omni's `credentialClass = platform` | `platform-auth.ts:2-14` defines platform authority via the isolated auth-bootstrap service with fail-closed properties; a shared-secret JWT must not become a weaker second door to that authority (review blocker 3). Group 0 defines the mapping (e.g. khal admin session → provisioned platform-class credential binding, or a distinct `khalSession` context with its own explicitly-scoped authority). |
| 6 | Bearer discriminator: three-segment JWT shape routes to session validation; otherwise API-key path | `Authorization: Bearer` currently feeds `apiKeys.validate` (`middleware/auth.ts:29-30`) and `platform-auth.ts:24`; without a discriminator a khal JWT 401s (review major 5). Precedence and error behavior specified in Group 0. |
| 7 | Fail closed to admin-grade sessions until `omni-full-multitenancy` enforcement is live | KHAL hierarchy `member < platform-dev < platform-admin < platform-owner` (`access-resolver.ts:7-14`, verified). Below the admin threshold is rejected with an error naming the gate; the gate is one function guarded by tests on both sides. |
| 8 | CLI device flow mirrors app-kit's client, consuming server-supplied values | `deviceCodeLogin` (`app-kit/src/commands/auth.ts:540-706`): poll at `(grant.interval ?? 5)s`, `authorization_pending` continues, `expired_token` aborts; use the platform-served `exchange_url` (`auth-device.ts:621,637`) rather than hardcoding (review minor 9); 401 recovery = one silent session-exchange then prompt (`platform-auth-client.ts:314-345`). |
| 9 | UI sessions: httpOnly cookie same-origin, short-lived Bearer token in the registry cross-origin | Cookies don't travel cross-origin without `SameSite=None` + CORS-with-credentials; the SaaS dashboard is served same-origin by the API. Either way no long-lived key in localStorage for multitenant entries. |
| 10 | Discovery exposes `{ multitenant, platformUrl }` unauthenticated | CLI/UI need it pre-credential on the deliberately auth-free health payload (`app.ts:155-158`); recorded per review minor 10 — low-sensitivity disclosure, accepted. |

## Simplicity Case

- **Simplest complete design:** one ported ~160-line verifier wired into the *existing* multitenancy flag and chain, one discovery field, one device-flow client in the CLI, one mode-aware login screen. No issuer, no IdP, no refresh tokens, no new mode flag, no parallel authority model.
- **Added machinery:** a Group 0 reconciliation gate before any code — required because the target surface (`packages/api` auth chain) is actively being rebuilt by a `risk: critical` wish and the first plan died on exactly that coupling.
- **Deferred until measured:** org-member access (trigger: `omni-full-multitenancy` enforcement live); asymmetric session verification (trigger: secret-distribution pain or platform key rotation); EdDSA kernel-session validation for WebSocket/NATS surfaces (trigger: a surface actually gated on platform identity).
- **Complexity removed:** no second mode flag, no shadow tenancy model, no refresh-token storage, no per-tenant session state in omni.

## Dependencies

**depends-on:** multi-server-management, omni-full-multitenancy
**blocks:** none

_`multi-server-management` supplies the server registry and mode-aware entry points (hard dependency). `omni-full-multitenancy` owns the auth chain this wish integrates with: Group 0 produces a written sequencing agreement (which of its waves must merge first), and no `packages/api` middleware work starts before that agreement exists._

## Success Criteria

- [ ] Group 0 reconciliation document exists, is reviewed SHIP, and pins: flag composition, chain position + projection, role naming/mapping, Bearer discriminator, and the sequencing agreement with `omni-full-multitenancy`.
- [ ] Single-tenant: the entire pre-existing API auth test suite passes with zero modifications (`make test-api`).
- [ ] Multitenant: a valid admin-grade `khal-session` (cookie or Bearer) traverses the full protected chain and reaches handlers with correct principal context; member-grade sessions are rejected naming the gate; tampered/expired/alg-confused tokens are rejected.
- [ ] `omni auth login` against a multitenant server completes the code + URL flow end-to-end with no API key, storing a session token on that entry; 401 triggers exactly one silent re-exchange before prompting.
- [ ] Dashboard sign-in via code + URL leaves no credential in localStorage for same-origin multitenant entries; admin sees the full dashboard; expired sessions prompt re-login.
- [ ] `make check` passes with zero warnings.

## Execution Strategy

### Wave 0 (sequential, gates everything)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 0 | engineer | 4 — security architecture reconciliation (+2 subjective acceptance, +2 coupling to in-progress critical wish) | engineer-complex / high | Reconciliation: read `packages/api/src/tenancy/` + `omni-full-multitenancy` WISH, produce the binding design doc (flag, chain, naming, discriminator, sequencing), reviewed before code |

### Wave 1 (after Group 0 SHIP + sequencing agreement)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 1 | engineer | 5 — security-critical middleware in an actively changing chain | engineer-complex / high | API: ported verifier, projection per Group 0, discovery field, fail-closed gate, `make test-api` green unmodified |

### Wave 2 (parallel, after Wave 1)

| Group | Agent | Complexity | Model | Description |
|-------|-------|------------|-------|-------------|
| 2 | engineer | 3 — device-flow client, deterministic via mock platform | engineer-standard / high | CLI: device flow, session storage on registry entries, 401 re-exchange |
| 3 | engineer | 4 — dual-mode auth UX, subjective acceptance | engineer-complex / high | UI: mode-aware login, cookie/Bearer sessions, role-aware display |

## Execution Groups

### Group 0: Architecture reconciliation and sequencing

**Goal:** Every open question the plan review blocked on is answered in a short design doc, agreed against `omni-full-multitenancy`, and reviewed SHIP before any code.

**Deliverables:**
1. `DESIGN-RECONCILIATION.md` in this wish directory pinning: (a) flag composition with `OMNI_MULTITENANCY_ENABLED`/`OMNI_DB_ENFORCEMENT` (no new flag); (b) chain position — Precedent A (project into `apiKey`/`authContext`) vs B (guarded subtree), with the scope-enforcer and output-redactor interplay traced; (c) KHAL-role → omni-authority mapping that routes through, not around, the credential-class model; (d) Bearer discriminator + precedence; (e) sequencing agreement naming which `omni-full-multitenancy` waves must merge first.
2. Updated Groups 1–3 in this wish (deliverables/ACs/files) rewritten against the chosen design.

**Acceptance Criteria:**
- [ ] Doc cites current code at line level for every claim (no stale references).
- [ ] Plan review returns SHIP on the updated wish.
- [ ] Sequencing agreement is recorded in both this wish and noted to `omni-full-multitenancy`.

**Validation:**
```bash
test -f .genie/wishes/saas-platform-auth/DESIGN-RECONCILIATION.md
```

**depends-on:** none

---

### Group 1: API session validation (design-bound)

**Goal:** A valid admin-grade platform session traverses the real protected chain; everything else fails closed; single-tenant is byte-for-byte unchanged.

**Deliverables:**
1. Ported verifier as middleware with Zod-validated claims, positioned per Group 0; principal projection per Group 0; fail-closed admin gate (one function, tests both sides).
2. Discovery field on the health payload; boot-time config validation (refuse multitenant session auth without the session secret).
3. Auth events for session accept/reject without token material in logs.
4. Tests: valid/expired/tampered/alg-confused, cookie vs Bearer, discriminator routing, gate both sides — plus the full existing API suite unmodified.

**Acceptance Criteria:**
- [ ] Multitenant admin session reaches a real handler through `tenancyMiddleware → … → scopeEnforcerMiddleware` (integration test), per the Group 0 design.
- [ ] `make test-api` passes with zero modifications to pre-existing tests.
- [ ] Boot fails closed on missing secret; no token/secret material in logs or error bodies.

**Validation:**
```bash
make test-api && make typecheck && make lint
```

**depends-on:** group-0

---

### Group 2: CLI device-flow login

**Goal:** `omni auth login` against a multitenant server completes the code + URL flow and the entry operates on a short-lived session token.

**Deliverables:**
1. Mode detection via discovery; registry entries gain `authMode`/`sessionToken` (extends `multi-server-management` Group 1 schema).
2. Device-flow client per Decision 8 (server-supplied interval and `exchange_url`; fail-closed Zod validation of exchange responses).
3. 401 → one silent session-exchange → re-login prompt naming the entry; session state shown masked in `omni server list`/`auth status`.
4. Tests against a mock platform (device endpoints added to `__tests__/mock-api.ts`): happy path, `authorization_pending`, `expired_token`, retry-then-prompt.

**Acceptance Criteria:**
- [ ] End-to-end login against the mock with no API key; token persisted on the targeted entry.
- [ ] Polling honors the server interval; grant expiry aborts cleanly.
- [ ] Single-tenant `auth login --api-key` byte-for-byte unchanged.

**Validation:**
```bash
make test-file F=packages/cli/src/__tests__/cli.test.ts && make typecheck && make lint
```

**depends-on:** group-0, group-1

---

### Group 3: UI mode-aware login and role display

**Goal:** Multitenant servers sign in via code + URL with cookie sessions; single-tenant keeps the API-key form; roles render correctly.

**Deliverables:**
1. Mode-aware `Login.tsx`/`AddServerDialog` (code + URL flow for multitenant; API-key form untouched for single-tenant).
2. Session handling per Decision 9; expiry-aware re-login prompts; unified logout through `useAuth`.
3. Role-aware display (identity, role, org in the sidebar user area); member-grade rejection renders the gate message, not an empty dashboard.
4. Registry unit tests extended for `authMode`/session fields.

**Acceptance Criteria:**
- [ ] Multitenant entries never render an API-key input; single-tenant flow byte-for-byte unchanged.
- [ ] Same-origin multitenant entries hold no localStorage credential (unit-tested for the registry).
- [ ] Switching between single-tenant and multitenant entries swaps auth transport with no cache bleed.

**Validation:**
```bash
make test-file F=apps/ui/src/lib/__tests__/servers.test.ts && make typecheck && make lint
```

**depends-on:** group-0, group-1

---

## QA Criteria

- [ ] Staging with a real platform: CLI code + URL login end-to-end; dashboard sign-in with httpOnly cookie; admin sees all data; member account refused with the gate message.
- [ ] Regression: a deployment without multitenant session config behaves identically to a build without this wish.

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| The fail-closed gate is widened before `omni-full-multitenancy` enforcement lands, exposing cross-tenant data | High | Gate is one function with tests on both sides; lifting it edits a test that names the dependency; sequencing agreement from Group 0. |
| Concurrent edits with `omni-full-multitenancy` (its G3/G4 rebuild the same chain) | High | Group 0 sequencing agreement is a hard precondition; no `packages/api` middleware work before it. |
| KHAL platform outage locks out multitenant operators | Medium | API keys keep working in both modes — break-glass and automation never depend on the platform; session verification is local (shared secret). |
| Shared-secret distribution/rotation between platform and omni | Medium | Owned by the closed-source SaaS composition; omni fails closed at boot when unset; asymmetric verification is a validator-only future change (Decision 1 separation). |

---

## Review Results

_The read-only reviewer returns evidence; the invoking orchestrator appends a timestamped block here after plan, execution, and PR reviews._

**Provenance:** carries Groups 5–7 split from `multi-server-management` per its 2026-07-31 BLOCKED plan review (blockers 1–4 and findings 5–6, 8–11 recorded there; khal citations in Decisions 1–2, 7–8 were reviewer-verified exact). Group 0 exists to resolve those blockers; plan review of this wish follows Group 0's reconciliation, not precedes it.

---

## Files to Create/Modify

```
.genie/wishes/saas-platform-auth/DESIGN-RECONCILIATION.md   # Group 0 output (binding design)
packages/api/src/middleware/khal-session.ts                 # NEW: ported verifier + projection + gate (per Group 0)
packages/api/src/middleware/__tests__/khal-session.test.ts  # NEW: validation/discriminator/gate tests
packages/api/src/app.ts                                     # discovery field; chain wiring per Group 0
packages/cli/src/commands/auth.ts                           # device-flow login
packages/cli/src/client.ts                                  # 401 re-exchange
packages/cli/src/config.ts                                  # authMode/sessionToken on registry entries
packages/cli/src/__tests__/mock-api.ts                      # mock platform device endpoints
apps/ui/src/pages/Login.tsx                                 # mode-aware login
apps/ui/src/hooks/useAuth.ts                                # session establishment/logout
apps/ui/src/lib/servers.ts                                  # authMode/session fields
```
