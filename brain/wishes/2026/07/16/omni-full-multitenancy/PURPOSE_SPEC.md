---
slug: omni-full-multitenancy
title: Omni Full Multitenancy
status: work-approved-g0-in-progress
created_at: 2026-07-16T21:28:26Z
updated_at: 2026-07-20T19:46:44Z
source_branch: origin/dev
source_commit: d6c400d05287bbf436ecd7e28c56c845b893afc9
genie_wish: .genie/wishes/omni-full-multitenancy/WISH.md
work_approval: brain/wishes/2026/07/16/omni-full-multitenancy/WORK_APPROVAL.md
risk: critical
---

# Purpose Specification — Omni Full Multitenancy

## Objective

Turn Omni from a single-control-plane application with API-key scopes and optional instance allowlists into a fail-closed multitenant platform. Every customer/developer tenant must own its instances, chats, messages, contacts, media, agents, provider credentials, automations, jobs, events, and derived data. A tenant administrator may fully operate and delegate within that tenant without gaining any path to another tenant or to platform-global administration.

## Why now

The current production request is to issue developer credentials that can fully manage one pre-created WhatsApp instance each. The security audit found that `api_keys.instance_ids`, profile allowlists, and route scope checks are not an ownership model: direct UUID routes and indirect relations can resolve resources without proving tenant ownership. Issuing broad write credentials before first-class tenancy would create cross-tenant escape paths.

The immediate operational rule is therefore:

> Do not mint the planned developer credentials until the multitenancy release passes adversarial isolation tests and is deployed behind explicit production approval.

## Primary user stories

1. **Tenant owner:** I can create, connect, configure, restart, and delete/suspend instances owned by my tenant, and I can manage all tenant-owned messaging resources.
2. **Tenant administrator:** I can create bounded child API keys and memberships for my tenant, but cannot mint platform-admin credentials or keys for another tenant.
3. **Tenant operator/viewer:** I can perform only the scopes granted inside my tenant; resource IDs from another tenant behave as nonexistent.
4. **Platform administrator:** I can create/suspend tenants and perform explicitly audited break-glass operations without turning the normal application connection into a row-level-security bypass.
5. **Worker/plugin:** I receive a trusted tenant context with each event/job and cannot read or write outside it.
6. **Operator:** I can migrate legacy production data with dry-run manifests, reconciliation receipts, backups, canaries, and a rollback that never reopens cross-tenant access.

## Decisions locked by this purpose session

### 1. Tenancy is an ownership boundary, not an allowlist

- Introduce a first-class `tenants` aggregate and tenant memberships/principals.
- Every tenant-owned record carries a non-null `tenant_id`, including records whose tenant can also be derived through an instance/chat/message relationship.
- Cross-tenant foreign-key references are prevented with composite tenant-aware constraints.
- Tenant-owned and platform-owned rows are not mixed behind nullable `tenant_id` when separate tables/schemas can make ownership explicit.

### 2. Shared PostgreSQL with defense in depth

- Use a shared schema initially, with application-layer tenant predicates **and** PostgreSQL Row Level Security (RLS).
- The normal Omni runtime database role remains `NOSUPERUSER NOBYPASSRLS`; tenant tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Split migration/DDL and runtime roles. The production runtime role must not own tenant tables/schemas, hold `CREATE`, alter policies, `SET ROLE`, set `row_security=off`, or execute unhardened `SECURITY DEFINER` functions.
- Tenant context is set transaction-locally (`set_config(..., true)` / `SET LOCAL`) and every tenant query runs inside that transaction. A pooled session-level `SET` is forbidden.
- Missing or invalid tenant context returns no tenant rows and cannot insert tenant rows.
- The current best-effort fallback to legacy `postgres:postgres` credentials is incompatible with the multitenant security boundary and must be removed or made fail-closed before RLS becomes a release gate.
- RLS is defense in depth against query/IDOR mistakes, not a claim that one shared application process can contain a full runtime RCE. G0 must document this residual risk and obtain explicit acceptance or choose stronger per-tenant process/database credentials.

### 3. Tenant administration is bounded

- A tenant-admin role is powerful only inside one tenant.
- Tenant admins never receive the global `*` semantic. Use explicit tenant role/scopes (for example `tenant:*` as a tenant-bounded capability) while platform administration remains a separate principal/key class.
- Authentication has a bootstrap problem: tenant identity is unknown until a credential/session is validated. Use a platform-owned authentication index/service (hash/subject → credential class, tenant, principal, status, role/ceiling) that is not exposed through tenant data routes. Tenant business queries begin only after that lookup establishes immutable context.
- Child keys inherit an immutable `tenant_id`; requested scopes, resource constraints, expiry, rate limits, and delegation ability must be equal to or narrower than the parent and tenant policy.
- Revoking/suspending a tenant or ancestor credential invalidates descendants without relying on callers to rotate them manually.

### 4. Identity data is tenant-local by default

- `persons` and `platform_identities` are tenant-owned.
- A phone number, email, WhatsApp identity, or external platform ID in one tenant does not reveal or merge with a person in another tenant.
- Legacy persons connected to identities in multiple future tenants are cloned per tenant during backfill and references are rewired deterministically.
- Cross-tenant identity correlation, if ever needed, is a separate privacy-reviewed broker and is not part of this release.

### 5. Tenant context crosses every boundary

Tenant identity must be preserved and validated across:

- HTTP/REST and OpenAPI
- service/repository calls
- WebSocket/SSE or streaming surfaces
- NATS/JetStream subjects and event envelopes
- background jobs, dead letters, idempotency keys, and retries
- object-storage keys and presigned URLs
- caches and rate-limit buckets
- audit logs, traces, reconciliation reports, and tenant exports
- outbound integrations (automations, webhooks, callbacks, provider endpoints) through an audited default-deny egress broker
- suspension/revocation epochs across cached authorization, long-lived sessions, queued work, callbacks, provider sessions, and presigned URLs

A caller-provided tenant header/body field is never trusted as authority. The authenticated principal/key and tenant membership establish the context; resource ownership is verified against that context. Numeric performance, soak, revocation, receipt, and credential-custody thresholds are version-controlled in `RELEASE_SLOS.yaml` and missing evidence is a release failure.

## Security invariants

1. **One tenant per tenant key.** A tenant key cannot select or switch tenants.
2. **No IDOR.** A resource UUID from tenant B returns no data and causes no mutation when used by tenant A.
3. **No collection leakage.** Lists, search, counts, exports, pagination cursors, and aggregates are tenant-scoped before filtering and pagination.
4. **No indirect leakage.** Messages, reactions, edits, forwards, media, participants, persons, events, jobs, turns, automations, and access rules inherit and validate tenant ownership through composite constraints and query predicates.
5. **No key escalation.** A tenant admin cannot mint platform keys, broader scopes, broader resource constraints, longer-lived delegation than policy permits, or keys for another tenant.
6. **No worker leakage.** Events/jobs without a valid trusted tenant context are rejected/quarantined, not processed globally.
7. **No storage leakage.** Tenant A cannot fetch tenant B's media through guessed paths, stale presigned URLs, CDN/cache keys, or SSRF-style proxy routes.
8. **No superuser bypass in normal runtime.** Production app pods/processes cannot connect with a role that bypasses RLS.
9. **No unsafe rollback.** Once multiple tenants coexist, rollback may not deploy an older global-query build; secure maintenance mode is preferable to reopening access.
10. **No unowned writes.** New tenant-owned rows cannot be created without a valid `tenant_id` and ownership checks.
11. **No silent migration ambiguity.** Legacy rows and keys that map to multiple or zero tenants are quarantined for explicit resolution.
12. **No hard tenant deletion in the first release.** Tenant lifecycle is create → active/suspended → archived; destructive purge is a separate explicitly approved workflow.
13. **No tenant-controlled SSRF.** Automations, webhooks, callbacks, and provider endpoints cannot directly access loopback/private/link-local/metadata/control-plane networks, bypass the egress broker, exploit redirect/DNS rebinding, or receive ambient platform credentials.
14. **No stale authority.** Suspension/revocation is revalidated at dequeue/redrive, immediately before every external or durable side effect, between multi-effect steps, and at callback/privileged action time; cached/long-lived/in-flight capabilities terminate or fail within the numeric ceilings in `RELEASE_SLOS.yaml`.
15. **No self-asserted or replayed production approval.** Each backup, backfill, RLS cutover, release, tenant mapping, and credential mint depends on a distinct canonical Ed25519-signed receipt from an isolated append-only approval authority. Executors cannot issue/edit receipts and must atomically compare-and-consume the exact action tuple before mutation.

## In scope

- Tenant/principal/membership/role model
- Tenant-bound and platform-bound authentication models
- Child-key delegation ceilings and revocation lineage
- Tenant ownership for the complete data model and API surface
- RLS policies and transaction-scoped tenant context
- Tenant-aware NATS/jobs/storage/cache/observability and an audited default-deny egress broker
- Suspension/revocation propagation for caches, long-lived sessions, queued and already-dequeued/in-flight work, callbacks, provider sessions, and presigned URLs
- Isolated signed approval authority and atomic single-use receipt consumption for every production hold
- Legacy inventory, backfill, reconciliation, secure-floor marker plus writer fence/high-water/compensation ledger, staging rehearsal, canary, and secure rollback
- CLI/OpenAPI/admin UX contracts needed to create tenants and issue tenant credentials
- Adversarial cross-tenant tests and release gates
- Post-deployment creation of the approved developer tenants/keys as a separately approved operational group

## Out of scope

- Per-tenant dedicated databases or clusters in the first implementation
- Cross-tenant analytics exposed to tenant users
- Cross-tenant person/identity unification
- Billing/marketplace implementation beyond tenant quotas/budget hooks required for abuse containment
- Hard-delete/purge automation in the first release
- Minting production developer credentials before release approval
- Treating the existing instance-scoped create guard as sufficient multitenancy

## Operating constraints

- No production key rotation, instance creation, data migration, or deployment occurs during wish drafting.
- Schema changes remain additive through the compatibility phase. Production ownership/person/key transforms require durable pre-image/inverse/compensation ledger entries and cross the secure rollback floor before the first rewrite an old build cannot interpret; after that floor the system rolls forward or enters maintenance mode rather than restoring global behavior.
- One explicit approval from either Felipe Rosa or Leonardo Cintra BR is sufficient for each normal production hold, represented by a distinct immutable receipt; task-creation approval is not production approval. True break-glass bypass requires both humans.
- Secrets must never be printed in logs or planning artifacts.
- Work ships as a staged PR/release train, not one unreviewable monolithic patch.
- The tactical branch `fix/tenant-scoped-instance-create-guard` remains separate and may serve as a temporary precursor; it is not the final ownership model.

## Implementation authorization

Felipe Rosa approved `/work` on 2026-07-20 for task materialization and non-production implementation through G8A. The exact bounded authorization, reviewed WISH hash, Claude Fable verdict, and explicit production exclusions are recorded in `brain/wishes/2026/07/16/omni-full-multitenancy/WORK_APPROVAL.md`.

Materialization creates task rows for G0-G8A only. H8.1-H9.2 remain non-executable WISH hold nodes, and no production group is materialized. Because Genie v5 task rows do not enforce WISH dependency edges, only groups authorized by this document's DAG may be dispatched even when the board labels other rows `ready`.

Before G1 may start, G0 must pass its human/security gate and must:

1. refresh the ownership/source inventory against the materialization base commit;
2. classify the existing caller-adjacent `tenantId` execution metadata and prevent it from becoming tenant authority;
3. freeze the approved ownership/trust-boundary artifacts and `RELEASE_SLOS.yaml`; and
4. preserve proof that no production, credential, Vault, tenant-mapping, or destructive action occurred.
