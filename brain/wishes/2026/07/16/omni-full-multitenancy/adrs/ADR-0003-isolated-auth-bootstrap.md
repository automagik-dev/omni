<!-- adr_topic: isolated_auth_bootstrap -->
# ADR-0003 — Isolated auth-bootstrap index/service

- Status: proposed (G0 gate)

## Context
Authentication runs before tenant context exists. `api_keys` (schema.ts:529-601) mixes the
credential hash/subject index with tenant-visible key metadata, `['*']` scopes, and legacy
instance allowlists. If tenant routes can read that index they can enumerate the global
credential space.

## Decision
Introduce an isolated platform-owned credential/session index (or auth service) that performs
only the minimal hash/subject lookup needed to establish immutable context:
`credential_class (tenant|platform)`, `tenant_id`, `principal_id`, `status`, `role/ceiling`,
`membership`.
- Tenant routes cannot enumerate this index.
- Tenant business-data queries start only after auth returns immutable context and opens a tenant transaction.
- Child-key creation crosses into the auth plane through a transactionally enforced service/procedure, never direct global-table access.
- Auth freshness (suspension, membership disablement, key/ancestor revocation, policy version) invalidates cached decisions within `RELEASE_SLOS.yaml` ceilings; the data plane fails closed when the auth plane cannot validate freshness.

## Consequences
- A separate auth-plane store/service is added in G1; tenant-visible key metadata/lineage is a distinct tenant table.
- No fallback to stale/global authority.

## Preserves
WISH "Auth context" isolated-index paragraph; Success Criterion 16; QA auth-bootstrap tests.
