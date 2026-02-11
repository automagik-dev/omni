# Wish: Provider Schemas — Single Source of Truth (Core + DB)

**Status:** DRAFT
**Slug:** `provider-schemas-single-source-of-truth`
**Created:** 2026-02-10

---

## Summary

Unify provider schema definitions across the repo so we never drift between:
- Core runtime (`packages/core`)
- API validation (`packages/core/src/schemas`)
- CLI validation (`packages/cli`)
- DB/Drizzle schema (`packages/db`)

This is a hard correctness requirement: any drift produces runtime/provider rows the type system can’t represent.

---

## Problem

We currently have multiple “sources of truth”:
- `packages/core/src/types/agent.ts` exports `PROVIDER_SCHEMAS` (intended canonical)
- `packages/core/src/schemas/common.ts` derives `ProviderSchemaEnum` via `z.enum(PROVIDER_SCHEMAS)` (good)
- CLI uses `PROVIDER_SCHEMAS` (good)
- **DB package duplicates `providerSchemas` const in `packages/db/src/schema.ts`** (bad; council flagged as 4th source)

---

## Scope

### IN
- Remove duplicated `providerSchemas` from DB schema, or enforce compile-time equivalence
- Ensure DB `AgentProvider.schema` typing is consistent with `ProviderSchema`
- Add a CI/typecheck guard that fails if schemas drift

### OUT
- New provider schemas (separate feature wishes)

---

## Acceptance Criteria

- [ ] DB schema no longer has an independent `providerSchemas` list that can drift
- [ ] One canonical tuple exists (likely `PROVIDER_SCHEMAS` in `@omni/core`)
- [ ] DB schema either imports the canonical tuple or uses `satisfies readonly ProviderSchema[]` to enforce equivalence
- [ ] `make typecheck` fails if drift is introduced intentionally (add a small compile-time assertion test)

---

## Execution Plan

### Group A: DB schema reconciliation
- Update `packages/db/src/schema.ts` to remove duplication
- Prefer:
  - `import type { ProviderSchema } from '@omni/core'`
  - `export const providerSchemas = [...] as const satisfies readonly ProviderSchema[]`
- If importing value tuple from core creates an undesirable dependency, keep DB value local but enforce via `satisfies`.

### Group B: Guardrail
- Add a compile-time assertion module in `packages/db` or `packages/core` that ensures `providerSchemas` and `PROVIDER_SCHEMAS` remain identical

---

## Notes

- This wish exists because council + independent review flagged the duplicated DB const as a merge blocker for OpenClaw provider integration.
