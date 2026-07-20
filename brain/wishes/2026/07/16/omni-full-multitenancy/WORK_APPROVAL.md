---
approval_type: work-materialization
purpose_id: omni-full-multitenancy
approved_by: Felipe Rosa
approved_at: 2026-07-20T19:46:44Z
decision: approved
reviewed_wish_sha256: 67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938
materialized_wish_sha256: 80188e4064d323a2183bbbe2876a7cb7a601e1c34a4b2d2fd21bc67e14a167ad
materialization_base_commit: d6c400d05287bbf436ecd7e28c56c845b893afc9
fable_verdict: SHIP
work_scope: G0-through-G8A-non-production
production_authorized: false
credential_mint_authorized: false
---

# Work Approval — Omni Full Multitenancy

## Human authorization

Felipe Rosa supplied the following bounded authorization in the controlling Hermes session:

> I approve /work for omni-full-multitenancy: materialize G0 through G8A and begin non-production work starting with G0, applying the four Claude Fable materialization conditions. This approval grants no production access, backup, migration, writer fence, RLS activation, release, tenant mapping, credential minting, Vault change, deletion, or destructive action; H8.1 through H9.2 remain blocked behind their individual signed approval receipts.

## Authorization effect

This approval authorizes only:

1. creating one Genie task row for each executable non-production group `G0`, `G1`, `G2`, `G3`, `G4`, `G5`, `G6`, `G7`, and `G8A`;
2. preserving `H8.1` through `H9.2` only as non-executable hold nodes in the WISH, with no Genie task rows for production groups or holds;
3. beginning `G0` only;
4. performing repository-local, non-production implementation and validation through `G8A` as each WISH dependency and human gate is satisfied.

The Genie v5 task database does not enforce WISH dependency edges. A task row shown as `ready` is not dispatch authorization. The WISH DAG is authoritative, and only `G0` is dispatchable at materialization time.

## Claude Fable materialization conditions

1. Base materialized work on current `origin/dev` (`d6c400d05287bbf436ecd7e28c56c845b893afc9`) or a verified successor.
2. Make the existing `executionContext.customer.tenantId`, `OMNI_TENANT_ID`, and agent-dispatcher `tenantId`/`tenant_id` surface a mandatory G0 inventory item, with a `tenant`, `platform`, `split`, or `quarantine` disposition and a rename-or-derive decision. Caller-supplied values are never authorization context.
3. Refresh the current-state source citations and table/non-DB inventory against the materialization base during G0.
4. Bind approval to the reviewed WISH mirror hash and preserve validator output in the execution evidence.

## Frozen review evidence

- Reviewed WISH SHA-256: `67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938`
- Materialized WISH SHA-256 after the four approved administrative/G0-condition amendments: `80188e4064d323a2183bbbe2876a7cb7a601e1c34a4b2d2fd21bc67e14a167ad`
- Claude Fable review: `/home/genie/evidence/omni-full-multitenancy/fable-review-20260720T160230-0300.md`
- Frozen Fable evidence packet: `/home/genie/evidence/omni-full-multitenancy/fable-review-20260720T160230-0300.evidence-packet.txt`
- Fable verdict: `SHIP`, zero blocking findings

The absolute evidence paths above are operator references and are not declared portable repository artifacts.

## Explicitly unauthorized

This approval does not authorize any production access or mutation, including production backup/snapshot access, ownership backfill, writer-fence or secure-floor activation, RLS/constraint cutover, release, tenant creation/mapping, credential minting, Vault mutation, deletion, or destructive cleanup. No task-materialization approval can satisfy `H8.1`, `H8.2`, `H8.3`, `H8.4`, `H9.1`, or `H9.2`.
