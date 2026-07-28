<!-- adr_topic: person_platform_identity_split -->
# ADR-0002 — Person / platform-identity split and per-tenant cloning

- Status: proposed (G0 gate)

## Context
`persons` is global (schema.ts:955-972, no `tenant_id`). `platform_identities`
(schema.ts:984-1024) references instances/agents/persons and its uniqueness
`(channel, instance_id, platform_user_id)` has no tenant dimension. A global person can
bridge identity across future tenant boundaries.

## Decision
- `persons` becomes tenant-owned (non-null `tenant_id`); cross-tenant merge is forbidden.
- Legacy persons whose references span multiple mapped tenants are **cloned per tenant**; all references (`platform_identities`, `chat_participants`, `messages`) are rewired deterministically to the per-tenant clone.
- `platform_identities` gains `tenant_id` (denormalized from owning instance) and a composite FK to `(tenant_id, person_id)`; uniqueness includes tenant.
- The stable cross-tenant human/service subject lives in a separate platform `principals` identity plane containing no tenant-owned business data.

## Consequences
- Phone/JID/email overlap across tenants never merges identities.
- Person timelines and participant lists return only same-tenant persons.
- Migration must record each person→tenant clone decision in the migration ledger.

## Preserves
WISH "Auth context"/"Legacy mapping rules"; Success Criteria 5, 6.
