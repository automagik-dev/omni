<!-- adr_topic: platform_admin_target_tenant_access -->
# ADR-0005 — Platform-admin target-tenant access

- Status: proposed (G0 gate)

## Context
Platform administration must operate across tenants for lifecycle/support without becoming a
normal-data-plane `BYPASSRLS` connection.

## Decision
- Platform-admin operations use separate credentials/routes and an explicit target-tenant context.
- Platform administrators do NOT obtain a normal-data-plane `BYPASSRLS` connection. They act against ONE explicit target tenant through the same forced-RLS transaction boundary.
- Cross-tenant control metadata/aggregates use narrow, audited control-plane views/services, not ad-hoc superuser queries.
- Every platform-admin action is audited with actor, target tenant, reason, request ID, and before/after metadata.
- Break-glass true RLS/control-plane bypass requires dual approval (Felipe + Leonardo), short JIT expiry, reason/ticket, alerting, immutable audit, and post-use review.

## Consequences
- G3 separates the platform-admin mechanism from the normal pool; G1 adds `platform_api_keys` and audit model.

## Preserves
WISH "Auth context" platform-admin paragraph and "Explicit human gates" break-glass rule; Success Criterion 7.
