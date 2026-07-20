---
slug: omni-full-multitenancy
title: "Omni full multitenancy: first-class tenant ownership, bounded tenant administration, and RLS"
status: draft-awaiting-human-approval
risk: critical
created_at: 2026-07-16T21:28:26Z
updated_at: 2026-07-16T22:22:33Z
base_branch: dev
base_commit: 739fd49f1cd31de759664c0dcd266f71c868e338
purpose_session: brain/wishes/2026/07/16/omni-full-multitenancy/PURPOSE_SPEC.md
brainstorm_session: brain/wishes/2026/07/16/omni-full-multitenancy/BRAINSTORM_SESSION.md
ownership_matrix: brain/wishes/2026/07/16/omni-full-multitenancy/OWNERSHIP_MATRIX.md
release_slos: brain/wishes/2026/07/16/omni-full-multitenancy/RELEASE_SLOS.yaml
artifact_validator: brain/wishes/2026/07/16/omni-full-multitenancy/validate-artifacts.mjs
execution_authorized: false
---

# WISH — Omni Full Multitenancy

## Intent

Build a fail-closed tenant ownership model across Omni's database, API, workers, event bus, media/storage, credentials, CLI, and operational lifecycle. A tenant administrator must be able to fully operate and delegate within one tenant while being cryptographically and structurally unable to access another tenant or mint platform authority.

This is a **staged PR and release train**, not a single monolithic code patch. The current instance allowlist guard is a useful temporary containment fix, but it is not accepted as multitenancy.

## Current-state evidence

At `origin/dev` commit `739fd49f1cd31de759664c0dcd266f71c868e338`:

1. `packages/db/src/schema.ts` declares 38 Drizzle/PostgreSQL tables and none has `tenant_id`.
2. `api_keys` has `instance_ids`, profile allowlists, and global scopes (`packages/db/src/schema.ts:529-600`).
3. `scope-enforcer.ts` authorizes by route scope plus request-extracted instance/chat/recipient targets (`packages/api/src/middleware/scope-enforcer.ts:82-107, 193-319, 357-501`). It cannot establish ownership for every indirect UUID route, global collection, worker, or storage path.
4. `persons` is global while `platform_identities` references instances (`packages/db/src/schema.ts:955-993`), allowing identity relations to cross future tenant boundaries unless explicitly split.
5. Tenant-like key creation only enforces a scope subset ceiling (`packages/api/src/routes/v2/keys.ts:170-284`); it has no immutable tenant lineage ceiling.
6. The dedicated runtime DB role is correctly provisioned as `NOBYPASSRLS`, but current install behavior can skip/fall back to legacy `postgres:postgres` credentials (`packages/cli/src/lib/role-cutover.ts:15-27, 181-255`). That fallback must not exist once RLS is a security boundary.
7. Existing direct UUID surfaces include persons, handoffs, dead letters, messages, access rules, jobs, turns, media, and others. Route-by-route guards alone are not sufficient defense in depth.

## Security model

### Ownership classes

- **Tenant-owned:** every row has non-null `tenant_id`, application predicates, tenant-aware unique/index/FK constraints, and RLS.
- **Platform-owned:** stored in separate control-plane tables/schemas and unavailable to tenant runtime roles/routes.
- **Split:** current mixed concepts (keys, settings, provider catalog/config, storage config, plugin storage) are separated rather than using ambiguous nullable ownership.
- **Quarantined:** legacy rows/credentials with ambiguous or missing ownership cannot be served until manually resolved.

### Auth context

Every authenticated operation receives an immutable context:

```text
request_id
principal_id
credential_id
credential_class = tenant | platform
actor_role
scopes
tenant_id          # required for tenant operations
membership_id      # required for human/service principals
platform_action    # explicit audited reason for platform operations
```

Rules:

- A tenant API key belongs to exactly one tenant and cannot select another tenant by header/path/body.
- A multi-membership human principal may select a tenant only through a validated active membership; the selected tenant becomes immutable for that request/transaction.
- Unknown/cross-tenant resource IDs return a non-enumerating result (`404`/empty as contractually appropriate) and never leak existence or metadata.
- Platform-admin operations use separate credentials/routes and explicit target tenant context. They are audited with actor, target tenant, reason, request ID, and before/after metadata.
- Platform administrators do not obtain a normal-data-plane `BYPASSRLS` connection. They act against one explicit target tenant through the same forced-RLS transaction boundary; cross-tenant control metadata/aggregates use narrow audited control-plane views/services.

Authentication itself runs before tenant context exists. Introduce an isolated platform-owned credential/session index or auth service that performs only the minimal hash/subject lookup needed to establish credential class, tenant, principal, status, role/ceiling, and membership. Tenant routes cannot enumerate that index. Tenant business-data queries start only after auth returns immutable context and opens a tenant transaction; child-key creation crosses into the auth plane through a transactionally enforced service/procedure rather than direct global-table access.

Authentication and authorization freshness are part of the boundary: tenant suspension, membership disablement, key/ancestor revocation, and policy version changes invalidate cached decisions within the numeric ceilings in `RELEASE_SLOS.yaml`. The data plane fails closed when the auth plane cannot validate freshness; it never falls back to stale/global authority.

### Tenant roles and key delegation

Initial fixed roles:

- `tenant-owner`: membership/lifecycle authority inside the tenant; cannot create platform authority.
- `tenant-admin`: full tenant resource administration and bounded delegation.
- `tenant-operator`: operational write access without membership/key-policy administration unless explicitly granted.
- `tenant-viewer`: read-only tenant access.

Delegation invariants:

1. Child `tenant_id` equals parent `tenant_id` and is immutable.
2. Child scopes are a subset of the parent effective scopes and tenant role ceiling.
3. Child resource constraints are a subset of parent constraints.
4. Child expiry is no later than parent expiry or tenant policy maximum.
5. Child rate/budget limits are no broader than parent/tenant policy.
6. Child delegation depth and `keys:delegate` are explicit; the initial release may cap depth at one if transitive revocation is not proven.
7. Parent/root/creator lineage is stored and auditable.
8. Tenant suspension, key revocation, principal disablement, or ancestor revocation denies descendants immediately or through an atomic propagated status.
9. Tenant admins never receive or mint the platform `*` capability.

### Database enforcement

- Shared PostgreSQL schema initially.
- Normal runtime role: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`.
- Tenant tables: `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- RLS policy uses a transaction-local tenant setting and fails closed when unset/invalid.
- `INSERT`/`UPDATE` policies use `WITH CHECK`; `SELECT`/`DELETE` use tenant equality.
- Every tenant request/job runs through a single `withTenantTransaction(authContext, fn)` boundary that calls `set_config('app.tenant_id', ..., true)` and keeps all repository/service queries in the same transaction.
- No session-level `SET` on a pooled postgres.js connection.
- Composite keys/FKs prevent cross-tenant joins, e.g. `(tenant_id, chat_id)` references `(tenant_id, id)`.
- Migration/DDL credentials are separate from runtime credentials and unavailable to the application process after boot.
- Production runtime does not own tenant tables/schemas, hold `CREATE`, alter policies, use `SET ROLE`, set `row_security=off`, or execute an unhardened `SECURITY DEFINER` function. Revoke unsafe `PUBLIC` schema/function privileges and pin `search_path` for any approved security-definer routine.
- Normal runtime startup fails closed if the NOBYPASSRLS role is absent. No silent superuser fallback.

RLS is defense in depth against missed predicates/IDOR and limits the blast radius of query bugs. A single shared application process that can legitimately open transactions for every tenant cannot claim hard containment from a full runtime RCE. G0 must make this trust assumption explicit and obtain human/security acceptance; otherwise the architecture must escalate to per-tenant service/database credentials or stronger physical isolation before implementation.

### Async and storage enforcement

- All NATS/JetStream event envelopes carry trusted `tenantId`; subject strategy is tenant-aware or consumers validate envelope tenant before processing.
- Publishers derive tenant from authenticated/loaded resources, never caller payload claims.
- Jobs, retries, dead letters, idempotency keys, consumer state, and callbacks preserve tenant context.
- Missing/ambiguous tenant context sends work to quarantine/DLQ and triggers an alert; no global processing fallback.
- Object keys use a tenant prefix (for example `tenants/<tenantId>/instances/<instanceId>/...`). Presigned URLs bind tenant, object, expiry, and authorization decision.
- Cache keys, rate-limit buckets, debounce buffers, search indexes, exports, and pagination cursors include tenant identity.
- WebSocket/SSE subscriptions, in-memory channel/plugin registries, callback tokens, and long-lived connection state are keyed and authorized by tenant, not only by resource UUID.
- Channel/provider/webhook credentials and session secrets are non-exportable by default and encrypted with tenant-bound context (for example per-tenant DEKs or tenant ID as authenticated encryption context); plaintext never appears in API responses, logs, caches, migration receipts, or object metadata.
- Audit logs/traces include tenant ID and actor credential ID; metrics avoid unbounded tenant labels unless explicitly controlled.

### Tenant-controlled outbound egress

Tenant-owned automations, webhook providers, callbacks, provider `baseUrl` values, and any future URL-capable integration cross a control-plane trust boundary. Database isolation does not make arbitrary outbound fetches safe.

- All tenant-controlled egress goes through one audited egress broker; direct `fetch`/socket use from tenant routes, providers, plugins, automations, and workers is blocked by code architecture checks and runtime network policy.
- Destination policy is default-deny. A tenant may use only explicitly approved HTTPS destinations or approved platform connector classes; policies are tenant-bound and cannot grant access to platform/control-plane networks.
- The broker rejects loopback, RFC1918, carrier-grade NAT, link-local, multicast, Unix sockets, cloud metadata addresses, cluster/service networks, auth/control-plane endpoints, and all non-approved schemes/ports.
- DNS is resolved and validated immediately before connection. Every redirect hop is re-resolved and revalidated; DNS rebinding, alternate IP representations, IPv4-mapped IPv6, credential-bearing URLs, and userinfo confusion are rejected.
- Requests use bounded connect/read timeouts, redirect count, request/response body size, and concurrency. Ambient platform credentials, cookies, proxy credentials, and cloud identity headers are never attached.
- Egress decisions record tenant, actor, integration, normalized destination class, policy version, and outcome without logging secrets or sensitive payloads.

### Revocation and suspension behavior

`RELEASE_SLOS.yaml` is normative. Tenant, membership, ancestor-key, or credential suspension increments a revocation epoch and:

- blocks new API and privileged actions on their next authorization check;
- invalidates auth caches within 15 seconds;
- terminates open WebSocket/SSE/channel/provider sessions within 30 seconds;
- revalidates queued, retried, delayed, and dead-letter work at dequeue/redrive time and again immediately before every external or durable side effect;
- revalidates the current revocation epoch between every step of multi-effect work; work revoked after dequeue is cancelled or denied before its next side effect and within 30 seconds;
- revalidates callback tokens at use and refuses signature-only stale authorization;
- limits presigned object URLs to 60 seconds and prevents issuing or refreshing them after revocation.

A stricter environment-specific value may replace these ceilings only through a reviewed change to `RELEASE_SLOS.yaml`; a looser value is a release-blocking architecture change.

## API and CLI contract

### Tenant management

Platform-only surface (exact paths finalized in G0/G1):

- create/list/get/suspend/archive tenants;
- attach/detach memberships and roles;
- inspect tenant reconciliation/usage/credential status;
- explicit break-glass tenant action with reason.

Tenant surface:

- read own tenant metadata and usage limits;
- manage instances and every tenant-owned resource authorized by role/scopes;
- manage bounded child credentials/memberships if role permits.

### Compatibility

- Existing `/api/v2` tenant operations may infer the tenant from a tenant key to minimize client churn.
- Tenant headers are advisory only for multi-membership human sessions and must match validated membership.
- `auth validate`, OpenAPI extensions, SDKs, and CLI status show credential class, tenant ID/slug, role, scopes, constraints, and expiry without secrets.
- Legacy `instanceIds`/`instanceAllowlist` remain transitional during migration but cannot override or widen tenant ownership; they are deprecated and removed only after all clients/keys migrate.

### Public and bootstrap surfaces

- Inventory and classify unauthenticated health/info/metrics/OpenAPI/A2A/well-known/webhook/callback endpoints. Public endpoints expose no tenant inventory, counts, identifiers, connection state, consumer offsets, or resource existence unless an explicit privacy contract approves it.
- Webhook/source secrets and callback tokens establish tenant from a server-side source record and signed audience; request body/header tenant claims cannot select ownership.
- Startup seeding, migrations, schedulers, plugin loading, primary-key initialization, and startup banners are control-plane operations with explicit credential class. The current primary-key bootstrap must not create or print a plaintext god key from the normal data plane.
- Readiness checks expose a non-sensitive migration/fleet compatibility epoch so rollout automation can refuse unsafe mixed versions without disclosing tenant data.

## Data migration strategy

### Additive phase

1. Create tenant/control-plane tables and ownership manifest tooling.
2. Add nullable `tenant_id` columns and supporting indexes to tenant tables without changing reads.
3. Add dual-write tenant propagation derived from trusted ownership roots.
4. Record every source-row→tenant decision in a migration ledger with source PK, tenant ID, rule, pre-image/checksum, post-image/checksum, inverse or compensating action, WAL/LSN high-water mark, writer epoch, and status. No person/key rewrite begins until its inverse/write-ahead ledger entry is durable.

### Legacy mapping rules

- Every current instance receives one explicitly approved tenant mapping.
- Descendants derive tenant from composite ownership paths and are reconciled against all reachable parents.
- Persons/identities spanning mapped tenants are cloned per tenant and all references are rewired deterministically.
- A legacy key restricted only to instances that all map to one tenant may become a tenant key after scope/role review.
- A key spanning multiple tenants is never silently converted to a tenant key: classify as a platform automation/admin credential, split explicitly, or revoke.
- Unrestricted/god keys migrate to the separate platform credential class only with explicit owner and purpose.
- Global/null-instance access rules, settings, plugin state, and provider/storage config require an explicit platform/tenant/split decision; ambiguity goes to quarantine.
- Unowned/orphan rows are not exposed. They remain quarantined with counts and identifiers in a restricted reconciliation report.

### Backfill and reconciliation

- Backfill in bounded batches with resumable checkpoints and idempotent writes.
- Compute per-table counts, null-owner counts, orphan counts, cross-tenant FK violations, hashes/checksums, and sampled semantic comparisons before/after.
- Run against a restored production snapshot in an isolated environment before production.
- Require zero unresolved tenant-owned rows before `NOT NULL`, composite FKs, and RLS enforcement.
- Use `NOT VALID` constraints where helpful, validate online, then make ownership non-null.
- Before final reconciliation, enter an ownership-write fence: all legacy writers are drained or rejected by epoch, ownership-root mutation is paused or routed through the tenant-aware dual writer, the high-water WAL/LSN is recorded, post-snapshot writes are replayed/compensated, and a final atomic reconciliation proves no gap before constraints/RLS activate.

### Mixed-version compatibility state machine

The release must define and test explicit states rather than relying on a generic feature flag:

1. **Additive/legacy-safe:** schema accepts old and new binaries; tenant mode is off; new binaries dual-write ownership and version event envelopes.
2. **Fleet-compatible:** every HTTP pod, scheduler, plugin, worker, CLI/admin writer, and event producer/consumer reports a minimum tenant-aware compatibility epoch. Old producers are drained/blocked before the next state.
3. **Backlog-safe:** pre-tenant events/jobs/DLQs/callbacks are mapped to one tenant or quarantined; consumers dual-read known envelope versions and reject unknown/missing tenant context.
4. **Fenced transformation:** the secure rollback floor is crossed before the first production person/key/ownership rewrite that a pre-tenant binary cannot safely interpret. An immutable approval receipt activates the ownership-write fence; incompatible writers are rejected, a WAL/LSN high-water mark is fixed, backfill and post-snapshot compensation complete, and final reconciliation is atomic under the fence.
5. **Ownership/RLS enforced:** new unowned writes are impossible; reconciliation is zero; tenant columns/constraints and composite FKs are validated; `FORCE RLS` activates only after states 1–4 pass and no incompatible binary can start. A second tenant may not be created earlier.
6. **Tenant-safe release:** only tenant-safe binaries/workers serve production; queue replay and long-lived-session revocation checks pass at the new epoch.
7. **Legacy retirement:** legacy columns/envelopes/flags are removed only in a later separately approved release after backlog and rollback windows expire.

Database migration epoch, binary compatibility epoch, event envelope version, writer-fence epoch, WAL/LSN high-water mark, and minimum accepted producer/consumer versions are machine-checkable. Deployment/startup refuses an unsafe combination. Rollback targets only binaries compatible with the current epoch.

## Release and rollback strategy

### Secure rollback floor

The secure rollback floor begins immediately before the first production ownership/person/key rewrite or writer-fence transition that a pre-tenant build cannot interpret safely—not when a second tenant is created. Before that floor, additive schema and dual-write code may roll back using the durable inverse/write-ahead ledger. At and after that floor, rollback choices are:

1. previous multitenant-capable build;
2. feature-disabled but tenant-safe build retaining predicates/RLS; or
3. maintenance/read-only mode while the system rolls forward or executes a ledger-backed, explicitly approved compensation.

Disabling RLS, restoring only the pre-migration snapshot while discarding post-snapshot writes, or deploying a pre-tenant build is not an accepted rollback.

### Release gates

1. Backup and isolated restore rehearsal completed with receipts.
2. Ownership/reconciliation report has zero unresolved tenant-owned rows.
3. Runtime role verified `NOBYPASSRLS`; no superuser credential available to app containers/processes.
4. Staging has at least two synthetic tenants with overlapping natural identifiers and adversarial test matrix passing.
5. Shadow comparisons show zero unexplained tenant-authorization mismatches.
6. RLS enabled/forced in staging and canary.
7. Staging/canary soak, latency, throughput, error, denial, worker-lag, revocation, and credential-custody evidence meets every numeric threshold in `RELEASE_SLOS.yaml`; a missing measurement is a failure.
8. Each production mutation depends on the distinct, unexpired manual approval receipt defined under **Explicit human gates**. Approval to create Genie tasks is never a production approval.

### Backups and data safety

- Pre-migration database snapshot plus verified restore.
- Object-store inventory/snapshot/versioning receipt where applicable.
- Export of legacy key metadata in redacted form (IDs/prefixes/scopes/constraints/status only).
- No secret values in logs, reports, diffs, or CI artifacts.
- Tenant hard delete is disabled; lifecycle ends at archived in this release.
- Backup/restore rehearsals include the auth-plane store, tenant encryption key metadata/KMS grants, object-store versions, and queued work. A database restore without the matching encryption/auth/event state is not accepted as recoverable.

## Execution groups (proposal only; no Genie tasks before approval)

### G0 — Architecture inventory and threat model

**Depends on:** none
**Deliverables:**

- machine-readable ownership manifest for all 38 Drizzle tables plus non-Drizzle stores;
- route/service/repository/event/job/storage/cache inventory;
- ADRs for ownership classes, person split, RLS transaction context, platform-admin access, and key lineage;
- explicit legacy mapping/quarantine decision table;
- security threat model (IDOR, confused deputy, delegation, async, storage, outbound egress/SSRF, suspension/revocation, rollback);
- reviewed `RELEASE_SLOS.yaml` evidence contract with frozen workloads, soak volumes/durations, p95/p99 latency deltas, throughput/error/worker-lag floors, denial/mismatch thresholds, revocation ceilings, approval-receipt schema, and credential-custody controls.

**Gate:** human/security approval of ownership and trust boundaries.

### G1 — Tenant identity and control-plane schema

**Depends on:** G0
**Deliverables:** tenants, principals, memberships, fixed roles/policies, isolated authentication index/service, platform credential separation, tenant-key lineage, audit model, tenant lifecycle APIs behind an off-by-default flag.

**Gate:** schema/unit/contract tests; no production data mutation.

### G2 — Tenant ownership columns and constraints

**Depends on:** G1
**Deliverables:** additive tenant columns/indexes, tenant-aware unique constraints and composite FKs, dual-write propagation, migration ledger, schema drift checks.

**Gate:** clean fresh install + upgrade from snapshot; legacy behavior unchanged while flag is off.

### G3 — Request auth, repository boundary, and RLS

**Depends on:** G1, G2
**Deliverables:** immutable auth bootstrap/context, isolated auth-plane lookup, tenant transaction helper, repository/service tenant parameters, architectural/static guards against singleton/direct DB use outside the tenant boundary, RLS policies, migration/runtime role split with runtime DDL revoked, fail-closed runtime role startup, platform-admin mechanism separated from normal pool.

**Gate:** real PostgreSQL integration tests prove context reset on pooled connections, missing-context denial, `FORCE RLS`, and no superuser fallback.

### G4 — Complete synchronous surface conversion

**Depends on:** G3
**Deliverables:** tenant-scoped routes/services for instances, chats, messages, persons, media, access, agents/providers, settings, keys, events, turns, handoffs, automations, jobs, exports, search, aggregates, OpenAPI/SDK/CLI.

**Gate:** generated route/ownership coverage test fails on any tenant-capable route without declared ownership policy; adversarial UUID/list tests pass.

### G5 — Async, storage, cache, and observability conversion

**Depends on:** G3
**Deliverables:** versioned tenant-aware NATS envelopes/subjects, trusted producer policy, workers, pg-boss/jobs, backlog migration, DLQ/retry/idempotency, media/object storage, cache/rate/debounce/search namespaces, public/streaming endpoint privacy, audited default-deny tenant-egress broker plus network bypass prevention, suspension/revocation propagation, audit and traces.

**Gate:** tenant A events/jobs/media cannot affect or retrieve tenant B; malformed tenant context quarantines.

### G6 — Backfill and reconciliation tooling

**Depends on:** G2, G4, G5
**Deliverables:** dry-run/apply/resume tools, durable pre-image/inverse/compensation ledger, ownership-write fence and WAL/LSN high-water protocol, person cloning, key classification/splitting, quarantine reports, per-table reconciliation/checksums, backup/restore runbook.

**Gate:** production-snapshot rehearsal with zero unresolved owned rows and signed/redacted receipts.

### G7 — Adversarial security and performance qualification

**Depends on:** G4, G5, G6
**Deliverables:** two-tenant attack harness, direct/indirect IDOR matrix, delegation escalation tests, pooled-RLS tests, async replay tests, tenant-egress SSRF/rebinding tests, media URL/cache tests, revocation-propagation tests including revoke-after-dequeue/mid-effect, concurrency/race tests, an isolated append-only Ed25519 approval authority plus trusted signer registry and atomic compare-and-consume launcher guard for every H8/H9 hold, and the complete `RELEASE_SLOS.yaml` evidence bundle.

**Gate:** independent security review reports zero critical/high isolation findings and every numeric release threshold is present and passes; any absent measurement/receipt fails the gate.

### G8A — Staging and canary qualification (non-production)

**Depends on:** G7
**Deliverables:** staging restore/rehearsal, executable mixed-version/epoch state machine, old-producer drain proof, feature-flag/shadow observations, synthetic canary, RLS enforcement, dashboards/alerts, secure rollback rehearsal, and a complete evidence bundle measured against `RELEASE_SLOS.yaml`.

**Gate:** staging-only; no production access or mutation. All evidence thresholds pass.

### H8.1 — Manual hold: production backup/snapshot

**Type:** non-executable approval node
**Depends on:** G8A
**Unblocks:** G8B only when an immutable, unexpired `prod-backup` approval receipt satisfies the receipt schema and approver rule under **Explicit human gates**.

### G8B — Production backup and restore verification

**Depends on:** G8A, H8.1 receipt
**Deliverables:** production database/object/auth/event backup receipts and isolated restore verification. No ownership rewrite, RLS activation, release, tenant mapping, or credential mutation.

### H8.2 — Manual hold: production ownership transformation/backfill

**Type:** non-executable approval node
**Depends on:** G8B
**Unblocks:** G8C only with a distinct `prod-backfill` receipt bound to the migration tool digest, approved ownership manifest hash, target environment, database epoch, writer-fence plan, and evidence bundle hash.

### G8C — Production fenced backfill and final reconciliation

**Depends on:** G8B, H8.2 receipt
**Deliverables:** atomically persist the irreversible secure-floor marker before, or in the same control-plane compare-and-set that activates, the incompatible ownership-writer fence; no rewrite may begin first. Then persist the high-water WAL/LSN and inverse ledger, run/resume backfill, compensate post-snapshot writes, and produce zero-gap reconciliation. No RLS cutover or tenant creation.

### H8.3 — Manual hold: production constraints/RLS cutover

**Type:** non-executable approval node
**Depends on:** G8C
**Unblocks:** G8D only with a distinct `prod-rls-cutover` receipt bound to the exact schema/binary/event/writer epochs, image/commit/migration digests, reconciliation receipt, and rollback-floor plan.

### G8D — Production constraints and RLS cutover

**Depends on:** G8C, H8.3 receipt
**Deliverables:** validate ownership constraints, activate/fail-check `FORCE RLS`, enforce startup compatibility, drain/reject old workers/producers, and verify revocation/egress/runtime-role controls. No general release or tenant onboarding.

### H8.4 — Manual hold: production release

**Type:** non-executable approval node
**Depends on:** G8D
**Unblocks:** G8E only with a distinct `prod-release` receipt bound to the exact image/commit digest, compatibility epoch, canary evidence, and rollback target.

### G8E — Production tenant-safe release and soak

**Depends on:** G8D, H8.4 receipt
**Deliverables:** release only compatible tenant-safe binaries/workers, run the production canary and soak, and collect health/security evidence against `RELEASE_SLOS.yaml`. Failure enters maintenance mode or rolls forward; it never restores global-query behavior.

### H9.1 — Manual hold: developer tenant/instance mapping

**Type:** non-executable approval node
**Depends on:** G8E
**Unblocks:** G9A only with a distinct `tenant-mapping` receipt containing the approved identities, tenant IDs, instance IDs, ownership manifest hash, environment, and expiry.

### G9A — Developer tenant creation/mapping

**Depends on:** G8E, H9.1 receipt
**Deliverables:** create or map only the approved developer tenants/instances; produce redacted mapping/reconciliation receipts. No credential minting.

### H9.2 — Manual hold: per-credential mint

**Type:** non-executable approval node
**Depends on:** G9A
**Unblocks:** one G9B mint task per identity. Every identity requires its own distinct `credential-mint` receipt bound to tenant, role, scope/constraint ceiling, expiry policy, destination paths, environment, and release digest; one receipt cannot authorize a batch or another identity.

### G9B — Developer credential mint, custody, and isolation proof

**Depends on:** G9A and the matching identity-specific H9.2 receipt
**Deliverables:** mint one tenant-admin credential, write plaintext only to approved mode-`0600` and Vault destinations, produce prefix/hash-only receipts, verify full own-tenant operation, verify cross-tenant denial, and revoke/rollback on any failed custody or isolation check.

## Success Criteria

1. A first-class tenant can be created, suspended, and archived; hard delete is unavailable.
2. Every tenant-owned table and non-DB store has an approved ownership classification and enforcement implementation.
3. All tenant-owned rows have non-null tenant identity; no unresolved or cross-tenant FK violations remain after migration.
4. Tenant A can fully operate its authorized instances/resources, including instance connection/QR/restart workflows, without platform-admin access.
5. Tenant A cannot read, search, count, export, mutate, send through, react to, forward, retry, or retrieve media/jobs/events belonging to tenant B, even with tenant B UUIDs/external IDs.
6. Lists, pagination, aggregates, timelines, persons/identities, and search return only same-tenant data before pagination/counting.
7. Tenant admins can create only same-tenant child credentials within parent/policy ceilings; platform key minting and cross-tenant selection are impossible.
8. Revoking/suspending a tenant, parent key, or membership invalidates dependent access within the API/cache/session/job/callback/object ceilings in `RELEASE_SLOS.yaml`, and measured evidence is audited.
9. Normal runtime uses a verified `NOBYPASSRLS` role and refuses startup rather than falling back to superuser credentials.
10. RLS is enabled and forced on tenant tables; missing tenant context is fail-closed.
11. NATS/jobs/DLQ/idempotency/storage/cache boundaries preserve tenant identity and reject/quarantine missing context.
12. Legacy migration is rehearsed from a production snapshot, backed up, reconciled, resumable, and produces redacted receipts.
13. Secure rollback does not require disabling tenant protections or running a pre-tenant global-query build.
14. OpenAPI/SDK/CLI expose tenant/role/capability context without leaking secrets.
15. Approved developer credentials are minted only after the release and identity-specific approval receipt; each plaintext copy exists only in the mode-`0600`/Vault custody destinations in `RELEASE_SLOS.yaml`, each redacted receipt contains only approved metadata, and each credential passes positive own-tenant and negative cross-tenant verification.
16. Authentication can establish tenant context without exposing a global credential index to tenant routes, and child-key creation cannot bypass tenant/parent ceilings at the auth-plane boundary.
17. The accepted threat model explicitly distinguishes logical tenant isolation from full compromise of the shared Omni runtime; any stronger containment requirement is implemented rather than implied.
18. A machine-checkable mixed-version/event-backlog/writer-fence state machine prevents old pods/workers/producers from racing ownership transforms or running after cutover, records high-water WAL/LSN and compensation evidence, and prevents a second tenant before the secure state.
19. Unauthenticated/bootstrap surfaces expose no tenant inventory or plaintext platform credential and cannot select a tenant through caller-controlled metadata.
20. Tenant-controlled automation/webhook/provider/callback egress cannot reach loopback, private/link-local/metadata/control-plane targets, bypass the egress broker, exploit redirects/DNS rebinding, or receive ambient platform credentials.
21. Every production backup, backfill, RLS cutover, release, tenant mapping, and individual credential mint is blocked by an explicit non-executable hold and a distinct canonical Ed25519-signed receipt from an isolated append-only approval authority. Executors cannot issue/edit receipts; the launcher verifies the trusted signer/event/audience/exact tuple and atomically compare-and-consumes it so only one concurrent execution can proceed.
22. Staging/canary/release evidence meets every numeric security, revocation, soak, latency, throughput, error, worker-lag, and custody threshold in `RELEASE_SLOS.yaml`; any absent measurement fails.

## QA Criteria

### Static and schema checks

- Ownership manifest covers every Drizzle table and all discovered non-Drizzle stores.
- CI fails when a new tenant-capable table lacks `tenant_id`/classification, when a new route lacks ownership metadata, or when an event/job schema omits tenant context.
- CI architecture checks reject direct singleton/raw database access from tenant routes/services/workers unless it passes through the approved tenant transaction/repository boundary.
- Tenant-aware unique indexes and composite FKs are validated.
- SQL policy tests confirm `ENABLE` + `FORCE RLS` and runtime `rolbypassrls=false`, `rolsuper=false`.
- Privilege tests confirm runtime cannot create/alter schema objects or policies, cannot `SET ROLE`, cannot disable row security, and cannot exploit `PUBLIC`/`search_path`/`SECURITY DEFINER` privilege paths.

### HTTP/service tests

For at least tenants A and B with deliberately overlapping names, phones, JIDs, external IDs, and timestamps:

- positive CRUD/operational tests for every tenant surface;
- direct UUID cross-tenant tests for every `/:id` route;
- indirect tests for message edit/reaction/transcription/forward/media, chat participants, person timelines, event payloads, access rules, jobs, handoffs, turns, follow-ups, agents/providers, webhooks, and automations;
- list/search/count/pagination/export tests proving no pre-filter leakage;
- header/body/path tenant-confusion tests;
- WebSocket/SSE subscription and callback-token tests prove tenant A cannot subscribe to, resume, or act on tenant B state.
- key delegation/role/scope/constraint/expiry/revocation escalation tests;
- platform-admin audit and reason-required tests.
- auth-bootstrap tests prove hash/session lookup returns only immutable context, tenant routes cannot enumerate the global credential index, and child-key writes enforce ceilings transactionally across the auth-plane boundary.
- public/unauthenticated endpoint tests prove health/info/metrics/A2A/well-known/webhook/callback contracts do not leak cross-tenant counts, identifiers, status, offsets, or existence;
- tenant-egress tests cover automation URLs/headers, webhook-provider, provider `baseUrl`, callbacks, redirects, DNS rebinding, alternate IP encodings, IPv4-mapped IPv6, metadata/control-plane/private destinations, oversized responses, timeout, and attempted direct-network bypass;
- revocation tests measure the numeric ceilings in `RELEASE_SLOS.yaml` for auth caches, already-open WebSocket/SSE/channel/provider sessions, callback tokens, and privileged actions, and prove auth-plane outage fails closed.

### Database/RLS integration tests

- Real PostgreSQL, not mocks.
- Missing/invalid tenant setting: zero selects, denied inserts/updates/deletes.
- Tenant A setting: only A rows across direct and joined queries.
- Connection-pool reuse: tenant context never survives the transaction or bleeds into another request.
- Table owner/runtime role cannot bypass `FORCE RLS`.
- Composite FK rejects cross-tenant parent/child pairs.
- Concurrent insert/update/delegation races cannot produce cross-tenant or over-ceiling state.

### Async/storage tests

- Tenant A event cannot dispatch tenant B agent/instance.
- Event without tenant context goes to quarantine/DLQ and alerts.
- Unknown envelope versions, legacy backlog, duplicate/out-of-order delivery, and a producer lying about tenant context are rejected or deterministically mapped by trusted server-side ownership; no poison-loop/global fallback occurs.
- Replay/retry/dead-letter operations keep tenant identity.
- Idempotency keys include tenant.
- Tenant A cannot fetch tenant B object using guessed key, stale signed URL, cache hit, redirect, or proxy route.
- Presigned URLs never exceed the 60-second ceiling and cannot be issued/refreshed after suspension. Queued/retried/DLQ work revalidates at dequeue/redrive, immediately before every external or durable side effect, and between multi-effect steps; tests revoke after dequeue and between the first and second side effects and prove cancellation/denial within 30 seconds.
- Tenant A cannot resolve tenant B's in-memory channel/plugin registry entries; encrypted credentials/session state cannot be exported or decrypted under another tenant context.
- Search/cache/rate/debounce state does not collide across tenants.

### Migration/release tests

- Fresh install, upgrade from untenantized schema, interrupted/resumed backfill, and repeated idempotent run.
- Production-snapshot restore rehearsal with per-table counts/checksums and person/key ambiguity cases.
- Feature flag off/on, shadow reads, canary, RLS activation, and secure rollback rehearsal.
- Rolling-upgrade matrix exercises every declared schema/binary/event/writer epoch combination, old-producer drain, ownership-write fence, WAL/LSN high-water capture, post-snapshot compensation, queued-work replay, startup refusal of incompatible versions, and the rule that no second tenant exists before the secure cutover state.
- Manual-hold tests prove launchers cannot execute G8B/G8C/G8D/G8E/G9A/G9B without the matching unexpired, digest-bound receipt and that task-creation approval is rejected as a substitute. They also prove forged approver identity, canonical-payload tampering, wrong audience/policy, revoked signer, executor-issued receipt, stale approval-service event, and concurrent replay fail closed; exactly one concurrent compare-and-consume may win.
- Full repository quality gates, migration drift checks, OpenAPI regeneration/parity, CLI tests, and the exact `RELEASE_SLOS.yaml` soak/performance/security evidence all pass; absent measurements fail.

## Explicit human gates

No Genie task creation or execution is authorized by this draft. One explicit approval from **either Felipe Rosa or Leonardo Cintra BR** authorizes conversion of approved groups into Genie tasks; it authorizes no production action. True break-glass RLS/control-plane bypass requires both humans, short JIT expiry, reason/ticket, alerting, immutable audit, and post-use review.

Production mutations use non-executable hold nodes. Receipts are not executor-authored documents: an authenticated approval authority, isolated from launcher/worker/executor write credentials, converts Felipe/Leonardo's authenticated decision into a versioned canonical payload, signs it with an Ed25519 key from the platform trusted-signer registry, and stores the signed event in an append-only tamper-evident log. Executors have read/consume capability only; they cannot issue, edit, replace, or backdate approvals. At consumption, the launcher verifies the signature, signer/key status and revocation epoch, append-only event identity, audience, policy version, exact action tuple, and current evidence digests against the trusted approval authority.

A production approval is valid only when its canonical signed receipt contains:

- unique receipt ID, append-only approval event ID, hold type, nonce, audience, and policy version;
- environment and exact target/resource set;
- wish/task IDs;
- commit, image, migration, schema/binary/event/writer epoch, and evidence-bundle digests as applicable;
- authenticated approver identity, approval-authority issuer, signer key ID, Ed25519 signature, and approver rule;
- explicit decision and reason;
- UTC timestamp and expiry (maximum 24 hours unless a stricter value is defined in `RELEASE_SLOS.yaml`);
- hash/link to prerequisite backup, reconciliation, canary, or mapping evidence.

Receipt consumption is an atomic compare-and-consume against the approval authority immediately before the protected mutation. Exactly one launcher may transition an unconsumed receipt to consumed for its exact action tuple; concurrent/retried launchers fail closed. A consumed receipt is burned even if the downstream operation later fails—a retry requires a fresh human approval and receipt. The protected operation records the consumed event ID and action result in immutable audit evidence.

For H8.1–H9.2, one explicit unexpired approval from **either Felipe Rosa or Leonardo Cintra BR** is sufficient unless the action is break-glass or destructive purge. Receipts are single-purpose and non-transitive: task-materialization approval cannot satisfy a production hold; backup approval cannot authorize backfill; backfill approval cannot authorize RLS; release approval cannot authorize tenant mapping; and each credential mint requires its own identity-specific receipt. The launcher/worker must fail closed on an absent, unsigned, forged, tampered, expired, signer-revoked, stale-policy, untrusted-event, reused, target/audience-mismatched, digest/epoch-mismatched, or non-atomically-consumable receipt.

Separate holds and receipts are required before:

1. converting the proposed execution groups into Genie tasks;
2. production backup/snapshot access (H8.1);
3. production ownership transformation/backfill and writer fence (H8.2);
4. production constraints/RLS cutover (H8.3);
5. production release (H8.4);
6. creating or mapping developer tenants/instances (H9.1);
7. each individual production credential mint/rotation/reclassification (H9.2); or
8. destructive cleanup, archival purge, or legacy column removal, which additionally requires a fresh backup and explicit destructive confirmation.
