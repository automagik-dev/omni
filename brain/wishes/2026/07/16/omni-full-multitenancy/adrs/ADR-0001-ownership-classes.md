<!-- adr_topic: ownership_classes -->
# ADR-0001 — Ownership classes (tenant | platform | split | quarantine)

- Status: proposed (G0 gate)
- Wish: omni-full-multitenancy
- Base: d6c400d05287bbf436ecd7e28c56c845b893afc9

## Context
`packages/db/src/schema.ts` declares 38 tables and zero `tenant_id` columns. Ownership is
currently implicit (instance allowlists, global rows, nullable instance_id). Ambiguous
nullable ownership is unsafe for RLS.

## Decision
Every table and non-DB store is classified into exactly one of four ownership classes:
- **tenant**: non-null `tenant_id`, application predicates, tenant-aware unique/index/FK constraints, and RLS.
- **platform**: stored in separate control-plane tables/schemas, unreachable by tenant runtime roles/routes.
- **split**: a mixed global/tenant concept (keys, settings, provider catalog/config, storage config, plugin storage, audit) separated into distinct platform and tenant stores rather than nullable ownership.
- **quarantine**: legacy/ambiguous ownership that cannot be served until manually resolved.

`OWNERSHIP_MANIFEST.yaml` is the machine-readable source of truth; `validate-g0.mjs`
enforces one-to-one coverage of every Drizzle table and the allowed enum.

## Consequences
- No ambiguous resource is silently defaulted to platform/global.
- CI must fail when a new tenant-capable table lacks `tenant_id`/classification.
- Denormalized `tenant_id` on child tables is intentional so RLS/indexes/joins are fail-closed without an unscoped parent lookup.

## Preserves
WISH "Ownership classes"; Success Criterion 2; QA static/schema checks.
