<!-- adr_topic: tenant_key_lineage_delegation_revocation -->
# ADR-0006 — Tenant-key lineage, delegation, and revocation

- Status: proposed (G0 gate)

## Context
Key creation enforces only a scope-subset ceiling (keys.ts:188-284). There is no immutable
tenant-lineage ceiling and no transitive revocation guarantee.

## Decision
Delegation invariants:
1. Child `tenant_id` == parent `tenant_id`, immutable.
2. Child scopes ⊆ parent effective scopes and tenant role ceiling.
3. Child resource constraints ⊆ parent constraints.
4. Child expiry ≤ parent expiry or tenant policy maximum.
5. Child rate/budget limits ≤ parent/tenant policy.
6. Delegation depth and `keys:delegate` are explicit; the initial release may cap depth at one if transitive revocation is unproven.
7. Parent/root/creator lineage stored and auditable.
8. Tenant suspension, key revocation, principal disablement, or ancestor revocation denies descendants immediately or via an atomic propagated status (revocation epoch).
9. Tenant admins never receive or mint the platform `*` capability.

Fixed roles: `tenant-owner`, `tenant-admin`, `tenant-operator`, `tenant-viewer`.

## Consequences
- G1 adds `tenant_key_lineage` (parent/root/depth, revocation propagation, immutable ceiling snapshot, creator).
- Revocation timings follow `RELEASE_SLOS.yaml`.

## Preserves
WISH "Tenant roles and key delegation"; Success Criteria 7, 8; QA delegation-escalation tests.
