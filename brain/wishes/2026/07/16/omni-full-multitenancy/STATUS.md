---
slug: omni-full-multitenancy
status: reviewed-awaiting-human-approval
updated_at: 2026-07-16T22:30:10Z
execution_authorized: false
---

# Status — Omni Full Multitenancy

## Current phase

Purpose/brainstorm/wish drafting and validation. No implementation tasks have been created and no production mutation has occurred.

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

## Artifacts

- `PURPOSE_SPEC.md` — purpose, decisions, invariants, scope, readiness gate.
- `BRAINSTORM_SESSION.md` — 3-lens council record and synthesis.
- `OWNERSHIP_MATRIX.md` — provisional classification of all 38 Drizzle tables and non-DB boundaries.
- `.genie/wishes/omni-full-multitenancy/WISH.md` — staged execution groups, receipt-backed holds, migration/rollback, Success Criteria, and QA Criteria.
- `RELEASE_SLOS.yaml` — numeric security/performance/revocation/custody thresholds and approval-receipt schema.
- `validate-artifacts.mjs` — repository-root artifact and WISH-mirror validator.

## Active blocker

Production developer tenant credentials must not be minted until:

1. multitenancy implementation is complete;
2. independent security review and adversarial tenant A/B/egress/revocation tests pass;
3. staging and canary release thresholds pass;
4. production is backed up, fenced, migrated, and reconciled safely; and
5. the matching canonical signed approval-authority receipt from either Felipe Rosa or Leonardo Cintra BR is atomically consumed for mapping and for each identity-specific credential mint.

## Next human decision

Felipe or Leonardo may now approve, revise, or reject conversion of the reviewed execution groups into Genie tasks. Approval authorizes task materialization only—not production access, migration, deployment, tenant mapping, credential mutation, or destructive cleanup.
