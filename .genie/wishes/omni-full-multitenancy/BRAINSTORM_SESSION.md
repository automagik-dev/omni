---
slug: omni-full-multitenancy
session_id: ps_74e1504c7ef87f09
status: synthesized-reviewed-awaiting-human-approval
created_at: 2026-07-16T21:28:26Z
updated_at: 2026-07-16T22:30:10Z
brain_runtime_status: unavailable-during-final-review
---

# Brainstorm Session — Omni Full Multitenancy

## Trigger

Felipe requested: use `/brainstorm` and wish workflows to make an Omni patch that turns the platform into full multitenancy, after the tenant-key security audit found cross-instance/cross-tenant escape paths.

## Council method

1. Generated the KHAW 3-lens council prompt with `khaw_genie_brainstorm_prompt(topic=..., purpose_slug=omni-full-multitenancy)`.
2. Dispatched independent Architect and Critic/reviewer lenses against the real Omni worktree and `origin/dev`.
3. Inspected source evidence directly: schema, API-key model, scope enforcer, key mint ceiling, UUID routes, person identity model, DB client/pooling, role cutover, Git history, and related PRs.
4. Ran a read-only external Codex adversarial pass over the staged wish and source. It completed its source inspection and synthesized the highest-risk gap—the missing old/new fleet, event-envelope, backlog, and RLS activation state machine—but hung in its own collaboration wait before emitting the requested final verdict; the actionable finding was independently verified and incorporated before the process was stopped.
5. Synthesized the chosen architecture into Purpose and Genie WISH artifacts.
6. Attempted a final local Brain review. The previously healthy Brain API became unavailable (`127.0.0.1:1934` connection refused); the two-tier fallback also failed because its local script was absent. Per workflow, the council/template and failure evidence are preserved, and no Brain output is fabricated.
7. Received the completed Architect and Critic lenses. Both selected application authorization plus PostgreSQL RLS over app-only or schema/database-per-tenant as the default; the Critic's P0/P1 stop conditions were folded into the execution and QA contract.
8. Received a focused independent artifact review: **FAIL, 0 critical / 6 high**. It verified byte equality and current no-execution gates, then identified prose-only production approvals, insufficient cutover fencing/compensation, tenant-controlled outbound SSRF, stale long-lived/async authority, subjective release evidence, and broken root-relative traceability. All six required amendments were incorporated.
9. Fresh re-review closed egress, objective SLO, and artifact-link findings but returned **FAIL, 0 critical / 3 high**: receipts were self-asserted/replay-raceable, G8C contradicted secure-floor ordering, and revocation could miss already-dequeued work. The design now requires an isolated append-only Ed25519 approval authority with atomic compare-and-consume, persists the secure-floor marker before/atomically with the incompatible writer fence, and revalidates current epoch before every external/durable side effect and between steps with a 30-second in-flight ceiling.
10. Final bounded re-review on WISH SHA `67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938` returned **PASS — 0 critical / 0 high**. It independently confirmed all three blockers closed, byte-identical mirrors, execution authorization false, an empty Genie board/task list, and clean staged diff. No blocking amendment remains.

## Problem statement sent to the council

Design a security-first, production-grade full multitenancy patch for Omni so each tenant fully owns its own instances, chats, messages, persons, media, events, jobs, agents, providers, settings, and credentials. Tenant admins must fully operate and delegate inside their tenant but never escape to another tenant or platform authority. The design must cover database ownership/RLS, API/auth/CLI, NATS/jobs/storage/cache, key delegation, legacy migration/backfill, production cutover/rollback, and adversarial QA.

## Lens 1 — Architect

The independent architecture lens proposed:

- a first-class tenant/organization aggregate;
- explicit `tenant_id` ownership on direct and derived resources;
- tenant membership/role model and immutable tenant-bound API credentials;
- tenant context propagated through HTTP, service, repository, event, worker, storage, and audit layers;
- shared-schema PostgreSQL with application predicates plus RLS;
- tenant-aware NATS subjects/envelopes, object prefixes, caches, and audit records;
- staged additive migration, shadow/dual-read validation, canary, and reconciliation;
- role/scope/constraint delegation ceilings;
- two-tenant positive/negative tests and release gates.

The lens correctly treated instance allowlists as insufficient and recommended a platform-root vs tenant-role separation.

## Lens 2 — Critic

The critic lens was performed against direct source evidence and the first wish draft. Prioritized risks/amendments:

### Critical 1 — Authentication bootstrap contradiction

A tenant credential cannot live only behind tenant RLS because the service does not know `tenant_id` until it validates the credential. The design now requires an isolated platform-owned auth index/service that maps a key hash/session subject to immutable credential class, tenant, principal, status, role/ceiling, and membership. Tenant routes cannot enumerate it. Child-key creation crosses this boundary only through a transactionally enforced service/procedure.

### Critical 2 — RLS role/DDL bypass

`NOBYPASSRLS` is necessary but insufficient if the runtime owns tables/schemas, can create objects, alter policies, use unsafe `SECURITY DEFINER` functions/search paths, or silently falls back to `postgres:postgres`. The wish now requires separate migration and runtime roles, revoked DDL/unsafe privileges, `FORCE RLS`, privilege-path tests, and fail-closed startup.

### Critical 3 — Shared runtime compromise is a residual risk

A shared application process legitimately opens tenant transactions for every tenant, so RLS protects against query/IDOR mistakes but does not provide hard containment from full application RCE. The wish now requires explicit threat-model acceptance in G0 or escalation to per-tenant service/database credentials/physical isolation.

### High 1 — Mixed ownership tables

Global/tenant concepts must not be hidden behind nullable ownership. Keys, settings, provider catalog/config, storage config, plugin state, and audit paths require explicit split tables/services.

### High 2 — Identity privacy

Global `persons` and identity merging would leak/correlate users across tenants. Persons and platform identities are tenant-local; ambiguous legacy persons are cloned per tenant.

### High 3 — Async/storage confused deputy

Events, jobs, retries, DLQs, callbacks, media paths, presigned URLs, caches, idempotency, and search can bypass HTTP guards. Tenant context must be trusted/derived, propagated, verified, namespaced, and quarantined when absent.

### High 4 — Mixed-version and unsafe rollback

An older global-query pod cannot run once multiple tenants coexist. A generic feature flag is not sufficient: the release requires a machine-checkable schema/binary/event compatibility state machine, old producer/worker drain, legacy backlog mapping/quarantine, startup refusal of incompatible epochs, a secure rollback floor, and maintenance mode instead of disabling tenant protections.

### High 5 — Migration ambiguity

Legacy keys spanning mapped tenants, null-instance access rules, unowned rows, and persons connected across tenants cannot be silently inferred. They require a decision ledger, quarantine, explicit owner mapping, and reconciliation.

### High 6 — Delegation races

Scope subset checks alone do not prove tenant or policy containment. Tenant ID, parent/root lineage, role ceiling, resource constraints, expiry, budget/rate, delegation depth, suspension, and ancestor revocation must be enforced atomically and tested under concurrency.

### High 7 — Public/bootstrap and freshness gaps

Current unauthenticated health/info/A2A-style surfaces and startup primary-key initialization can bypass or leak a future tenant boundary. Public endpoints, webhook/callback tenant derivation, startup seeding/migrations/schedulers, primary credential bootstrap, and plaintext startup banners require explicit control-plane contracts. Cached auth decisions need bounded revocation freshness and fail-closed behavior when the auth plane is unavailable.

### High 8 — Production approvals must be executable dependencies

Prose gates do not stop launchers, and unsigned files are self-asserted/replayable. G8/G9 are split into staging work, non-executable H8.1–H9.2 hold nodes, and narrowly scoped production tasks. Each hold requires a canonical Ed25519-signed receipt emitted by an authenticated append-only approval authority whose write/signing credentials are inaccessible to executors. The launcher verifies signer/event/audience/action/digests and atomically compare-and-consumes the exact tuple; one concurrent consumer wins, and task-materialization approval cannot satisfy a production hold.

### High 9 — Tenant egress is a control-plane boundary

Automations, webhook providers, callback URLs, and provider base URLs can become SSRF paths into metadata, auth, cluster, or internal networks. The selected design adds a central default-deny egress broker, destination/redirect/DNS validation, no ambient credentials, network bypass prevention, and adversarial rebinding tests.

### High 10 — Revocation, data compensation, and evidence must be objective

Suspension terminates or revalidates cached auth, long-lived sessions, queued/retried work, callbacks, provider sessions, and presigned URLs within numeric bounds. Already-dequeued work revalidates immediately before every external/durable side effect and between multi-effect steps; revocation after dequeue must stop the next side effect within 30 seconds. Ownership rewrites require a durable pre-image/inverse ledger, an irreversible secure-floor marker persisted before or atomically with the incompatible writer fence, WAL/LSN high-water mark, post-snapshot compensation, and final atomic reconciliation. `RELEASE_SLOS.yaml` freezes soak, performance, security, revocation, receipt, and custody thresholds; missing evidence fails.

## Lens 3 — Synthesizer

### Chosen architecture

1. **Logical tenant root:** `tenants`, global principals, tenant memberships/fixed roles, and tenant lifecycle (`active`, `suspended`, `archived`; no hard delete initially).
2. **Ownership:** every tenant business/operational row has non-null `tenant_id`, tenant-aware unique indexes, and composite tenant FKs. Tenant/platform/mixed resources are classified before migrations.
3. **Auth plane:** separate minimal platform-owned credential/session index establishes immutable tenant context; platform credentials are a distinct class; tenant admins cannot mint the platform `*` capability.
4. **Data plane:** repository/service methods require tenant context; tenant queries run in a transaction with `SET LOCAL`/`set_config(..., true)`; PostgreSQL `ENABLE` + `FORCE RLS` provides defense in depth.
5. **Privilege plane:** migration and runtime DB roles are split; runtime is not owner/DDL-capable and startup refuses superuser/bypass fallback.
6. **Async/storage plane:** tenant context in NATS, jobs, DLQ, idempotency, callbacks, object keys, presigned URLs, caches, search, and audit.
7. **Migration:** additive columns + dual write + explicit mapping ledger + clone/split/quarantine + snapshot rehearsal + reconciliation before constraints/RLS.
8. **Release:** staged PR train, explicit schema/binary/event compatibility states, legacy backlog drain/quarantine, shadow observations, synthetic tenant A/B attacks, canary, explicit human gates, and secure rollback floor.
9. **Onboarding:** developer tenant/key creation is the final separately approved group, after deployment and negative isolation proofs.

### Why this option

It provides a practical logical multitenancy boundary using Omni's existing PostgreSQL architecture while adding database defense in depth and complete non-HTTP boundary coverage. It avoids treating route guards or instance allowlists as ownership. It also exposes the shared-runtime RCE limitation honestly rather than claiming RLS is a complete physical-isolation boundary.

## Alternatives rejected or deferred

### A. Keep `instanceIds`/allowlists and patch every route

Rejected. It is fragile, does not cover global collections/indirect relations/workers/storage, and continuously reopens IDOR risk as routes are added.

### B. Nullable `tenant_id` everywhere with platform rows mixed in

Rejected. Null semantics become a bypass surface. Mixed concepts are split into platform and tenant tables/services.

### C. One global `*` tenant-admin key plus RLS

Rejected. It conflates platform authority with tenant authority and creates delegation/minting ambiguity. Tenant admins use tenant-bounded roles/scopes only.

### D. Database-per-tenant immediately

Deferred, not rejected forever. It offers stronger physical isolation and compromise containment but creates large migration, connection, deployment, observability, backup, and cross-version complexity. G0 can escalate to it if the accepted threat model requires protection from a compromised shared runtime.

### E. Disable RLS during rollback

Rejected. Once multiple tenants coexist, rollback cannot reopen global-query access. Use a previous tenant-safe build or maintenance mode.

## Source evidence and prior art

- 38 current Drizzle tables, zero `tenant_id` columns (`packages/db/src/schema.ts`).
- API key instance/profile restrictions (`packages/db/src/schema.ts:529-600`, migration `0026_agent_key_profiles.sql`).
- Request-extracted lock targets and deny-by-default scope map (`packages/api/src/middleware/scope-enforcer.ts`).
- Scope-only mint ceiling and HTTP-mintable console profiles (`packages/api/src/routes/v2/keys.ts`, PR #831).
- Dedicated DB role uses `NOBYPASSRLS` but supports best-effort legacy fallback (`packages/cli/src/lib/role-cutover.ts`, PR #646).
- Global persons/platform identity relation (`packages/db/src/schema.ts:955-993`).
- No directly relevant existing multitenancy issue/PR found by repository issue/PR search; related work is authorization/profile and dedicated-role hardening, not ownership.

## Output artifacts

- `PURPOSE_SPEC.yaml` — KHAW canonical session metadata.
- `PURPOSE_SPEC.md` — human-readable purpose and locked decisions.
- `OWNERSHIP_MATRIX.md` — provisional classification of 38 tables and non-DB boundaries.
- `WISH.md` — Purpose mirror of the Genie wish.
- `.genie/wishes/omni-full-multitenancy/WISH.md` — implementation contract with staged groups, non-executable production holds, Success Criteria, and QA Criteria.
- `RELEASE_SLOS.yaml` — normative numeric release, revocation, custody, and approval-receipt evidence contract.
- `validate-artifacts.mjs` — repository-root-relative link, execution-flag, and WISH mirror validator.
- `STATUS.md` — current gate and blocker.

## Handoff gate

The session is **SPECIFIED**, not execution-authorized. Human approval may authorize creation of Genie tasks. It does not authorize production migration, deployment, key rotation/minting, tenant creation, or destructive cleanup; those remain separate gates.
