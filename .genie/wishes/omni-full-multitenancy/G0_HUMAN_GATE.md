---
wish: omni-full-multitenancy
group: G0
gate: ownership-and-trust-boundaries
status: approved
approved_by: Felipe Rosa
approved_at: 2026-07-20T21:07:12Z
approved_tracked_diff_sha256: 9e0de7d725ed1ca852d33296137cc5d11e9b2df0ffa3387d9f939522a7ef6b50
approved_head: 63c1528d5c2e3cb4190e6a117f83c5a801a96ebb
shared_runtime_rce_residual: explicitly-accepted
production_authorized: false
credential_mint_authorized: false
---

# G0 Human/Security Gate — Approved

## Exact authenticated human decision

> I approve the frozen G0 ownership/trust contract at tracked diff SHA-256 9e0de7d725ed1ca852d33296137cc5d11e9b2df0ffa3387d9f939522a7ef6b50 and explicitly accept ADR-0010’s shared-runtime RCE residual. Complete G0 and allow G1 non-production work.

This decision was supplied by Felipe Rosa after the initial gate prompt timed out and the workflow remained fail-closed. The later explicit statement is the controlling decision.

## Approved frozen surface

- Worktree HEAD before this gate record: `63c1528d5c2e3cb4190e6a117f83c5a801a96ebb`
- Frozen tracked diff SHA-256: `9e0de7d725ed1ca852d33296137cc5d11e9b2df0ffa3387d9f939522a7ef6b50`
- Frozen review manifest: `/home/genie/evidence/omni-full-multitenancy/g0-review-freeze-20260720T203323Z.json`
- Frozen review manifest SHA-256: `2296c4dc0075a3c3b09d3ecc384bd7050242f29330b038f72677f34f5a8d0a86`
- Normative ownership manifest SHA-256: `b7288748bbc719f55f6dd3c36411bde31524355e38724b426aa69a488766bd3a`
- Materialized WISH SHA-256: `4b83568a7b88c524f20d1b71878b525aa0850c9f61db3c13a559e4b60f88784b`
- Original Fable-reviewed WISH SHA-256: `67b52d941196d4ae481b8270d33f58804f5f0d14bb8e0ccc3e1afbcd42c91938`

## Independent review evidence

- Specification-compliance review: `PASS`, zero blockers
  - Evidence: `/home/genie/evidence/omni-full-multitenancy/g0-spec-review-freeze-20260720T203323Z.md`
  - SHA-256: `db66b63a95eef0b30fc8faa765ddd0eed15dc12bd627ef8a2e5456359b0e9c45`
- Security/quality review: `PASS`, zero blockers
  - Evidence: `/home/genie/evidence/omni-full-multitenancy/g0-security-quality-review-freeze-20260720T203323Z.md`
  - SHA-256: `5cd6b2f182f7a8a34b5cfd57099bad480fb2c13c0f530255f36551d209ec3eb6`
- Claude Fable final gate: `SHIP`, zero blockers
  - Evidence: `/home/genie/evidence/omni-full-multitenancy/g0-fable-final-gate-freeze-20260720T203323Z.md`
  - SHA-256: `349563a3836943dc8b53c4686daf17ad4edb026529f1d4ae6daa8598a51f6dee`

## Decisions accepted

1. The frozen `OWNERSHIP_MANIFEST.yaml` is the binding ownership/trust-boundary contract for G1 and later implementation groups. Its `tenant|platform|split|quarantine` classifications govern over the superseded prose matrix.
2. `OmniCustomerContext.tenantId`, `OMNI_TENANT_ID`, and dispatcher `tenantId|tenant_id` are caller/data-derived labels, remain quarantined, must be renamed, and can never establish tenant authority.
3. Ambiguous or cross-owned legacy resources remain quarantined rather than defaulting to platform/global ownership.
4. ADR-0010's residual is explicitly accepted: a full RCE compromise of the shared Omni runtime defeats logical PostgreSQL RLS tenant isolation. RLS remains defense in depth against query/authorization defects, not hard containment against full runtime compromise.
5. The fail-closed `RELEASE_SLOS.yaml`, threat model, ADRs, legacy decisions, and G0 validator remain binding inputs for later groups.

## Authorized effect

- The orchestrator may commit the reviewed G0 evidence and this post-review gate record.
- Genie task `t_mrtn6ah2ac8e9c9c` may be marked done after staged-tree and commit-tree verification.
- G1 task `t_mrtn6ajg460cc591` may begin as non-production, repository-local work under the existing bounded `/work` approval.

## Still unauthorized

This G0 gate is not a production approval receipt and grants none of the following:

- production access, backup, or snapshot (`H8.1`)
- ownership backfill or incompatible-writer fence (`H8.2`)
- constraints or RLS cutover (`H8.3`)
- production release (`H8.4`)
- tenant creation or mapping (`H9.1`)
- any individual credential mint (`H9.2`)
- Vault mutation
- deletion, purge, destructive cleanup, or data destruction
- break-glass RLS/control-plane bypass, which requires both named humans

Every H8.1–H9.2 action remains fail-closed behind its own distinct canonical Ed25519-signed, atomically consumed approval receipt. This decision, any G0 task state, and all reviewer verdicts are invalid substitutes for those receipts.
