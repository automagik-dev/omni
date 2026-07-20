---
slug: omni-full-multitenancy
status: work-approved-g0-starting
updated_at: 2026-07-20T19:46:44Z
execution_authorized: true
---

# Status — Omni Full Multitenancy

## Current phase

Felipe approved bounded `/work` materialization and non-production implementation through G8A. G0 is the only dispatchable group until its human/security gate passes. No production mutation is authorized or has occurred.

Nine Genie task rows now exist for G0-G8A. All rows appear `ready` because Genie v5 does not persist the WISH dependency DAG; only G0 is authorized to dispatch. Exact task IDs, derived waves, and proof that no H8/H9 or production rows exist are recorded in `WORK_MATERIALIZATION.md`.

## Completed evidence collection

- KHAW native plugin status: healthy.
- Local Brain API: healthy during initial preflight; later unavailable during final review (connection refused), recorded transparently in `BRAINSTORM_SESSION.md`.
- Genie CLI: installed and healthy enough for read-only planning; active board has no task collision for this wish.
- Source baseline: `origin/dev` at `739fd49f1cd31de759664c0dcd266f71c868e338`.
- Separate clean planning worktree: `/home/genie/worktrees/omni-full-multitenancy-wish` on `wish/omni-full-multitenancy`.
- Current Drizzle inventory: 38 tables, zero `tenant_id` columns.
- Current auth evidence inspected: API key profiles/allowlists, scope enforcer, key mint ceiling, dedicated DB role fallback behavior, direct UUID routes, and person/identity model.
- Existing tactical guard branch remains untouched: `/home/genie/worktrees/omni-tenant-scoped-instance-guard` on `fix/tenant-scoped-instance-create-guard`.
- Completed Architect lens: selected application authorization plus PostgreSQL RLS, with app-only and schema/database-per-tenant rejected/deferred as the default.
- Completed Critic lens: P0/P1 stop conditions cover tenant context, RLS/pooling, legacy keys, delegation, async, migration, rollback, storage, derived stores, persons, providers, constraints, import/delete/restore, backups, and break-glass.
- Focused artifact review returned **FAIL (0 critical, 6 high)**; first-round amendments added receipt-backed holds, writer fence/high-water/compensation, tenant-egress SSRF boundary, numeric revocation behavior, objective release SLOs, and root-relative artifact validation.
- Fresh re-review returned **FAIL (0 critical, 3 high)**: self-asserted/replayable receipts, contradictory secure-floor/fence ordering, and already-dequeued revocation gaps. These were amended with an isolated append-only Ed25519 approval authority plus atomic compare-and-consume, a secure-floor marker before/atomically with the incompatible fence, and pre-side-effect/between-step epoch checks with a 30-second in-flight ceiling.
- Final bounded re-review on WISH SHA `67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938`: **PASS — 0 critical / 0 high**. No blocking amendment remains.
- Claude Code `claude -p --model claude-fable-5` independently returned **SHIP** with no blocking findings against the frozen reviewed WISH and current `origin/dev` delta.
- Felipe's bounded work approval is recorded in `WORK_APPROVAL.md`; it authorizes G0-G8A non-production work only and explicitly excludes every H8/H9 production action.
- Materialization base refreshed to `origin/dev` at `d6c400d05287bbf436ecd7e28c56c845b893afc9`; G0 owns the full live citation/inventory refresh.

## Artifacts

- `PURPOSE_SPEC.md` — purpose, decisions, invariants, scope, readiness gate.
- `BRAINSTORM_SESSION.md` — 3-lens council record and synthesis.
- `OWNERSHIP_MATRIX.md` — provisional classification of all 38 Drizzle tables and non-DB boundaries.
- `.genie/wishes/omni-full-multitenancy/WISH.md` — staged execution groups, receipt-backed holds, migration/rollback, Success Criteria, and QA Criteria.
- `RELEASE_SLOS.yaml` — numeric security/performance/revocation/custody thresholds and approval-receipt schema.
- `validate-artifacts.mjs` — repository-root artifact and WISH-mirror validator.
- `WORK_APPROVAL.md` — exact bounded human authorization, reviewed hash, Fable conditions, and production exclusions.
- `WORK_MATERIALIZATION.md` — exact G0-G8A task IDs, WISH-derived waves, and proof that production/hold nodes were not materialized.

## Active blocker

Production developer tenant credentials must not be minted until:

1. multitenancy implementation is complete;
2. independent security review and adversarial tenant A/B/egress/revocation tests pass;
3. staging and canary release thresholds pass;
4. production is backed up, fenced, migrated, and reconciled safely; and
5. the matching canonical signed approval-authority receipt from either Felipe Rosa or Leonardo Cintra BR is atomically consumed for mapping and for each identity-specific credential mint.

## Next human decision

After G0 produces its ownership manifest, threat model, ADRs, refreshed source inventory, caller-adjacent `tenantId` disposition, and frozen release-evidence contract, Felipe or Leonardo must approve the G0 ownership/trust boundary before G1 may be dispatched. The current `/work` approval does not satisfy that gate or any H8/H9 receipt.
