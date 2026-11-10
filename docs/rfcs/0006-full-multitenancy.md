---
rfc: "0006"
title: "Full multitenancy"
status: Draft
created: 2026-07-16
---
# RFC-0006: Full multitenancy

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | Bounded tenant administration and complete tenant isolation |
| Issue | [#908](https://github.com/automagik-dev/omni/issues/908) (closed bootstrap delivery) |
| Design | [Purpose/design](../../.genie/wishes/omni-full-multitenancy/PURPOSE_SPEC.md), [WISH](../../.genie/wishes/omni-full-multitenancy/WISH.md), [ADRs](README.md#earlier-records) |
| Created | 2026-07-16 |

## Summary

One tenant administrator can operate and delegate within their tenant without
access to another tenant or platform authority. Ownership is enforced across
database queries, API calls, queued work, storage, credentials and deployment.
This is one staged goal, not one RFC per execution group or ADR.

**Happy delivery:** sign into Omni as each of two tenant administrators and see only that tenant's channels, chats and agents, including after switching accounts.

## Motivation

Instance allowlists alone do not define complete tenant ownership. The plan
requires one authority model across direct and indirect resource access, event
delivery and operational lifecycle, while giving tenant admins useful control.

## Design

Authenticate on an isolated control plane, establish an immutable credential and
tenant context, then execute tenant work through a tenant transaction with forced
PostgreSQL RLS. Platform actions target one tenant explicitly and are audited.
Child credentials inherit bounded scopes, resources, expiry and lineage.

Async envelopes and storage/cache keys carry trusted tenant context. Backlogs
and legacy identities are mapped or quarantined. A staged compatibility epoch,
writer fence, reconciliation ledger and secure rollback floor govern conversion.
The frozen ADR-0001 through ADR-0010 remain the detailed decisions in Earlier records.

The WISH status is `work-approved-g0-in-progress`; the companion STATUS records
G0 evidence awaiting review and its human/security gate. These are historical
planning states: later partial merges do not prove every gate completed.

## Contracts introduced

- Tenant/control-plane schema, tenant-owned `tenant_id` columns, composite
  constraints and RLS extend the schema additively before enforcement.
- Auth context identifies credential class, principal, tenant, membership, scopes
  and explicit platform action. Unknown/cross-tenant ids are non-enumerating.
- Tenant bootstrap/root-key routes, tenant CLI/SDK and status/preflight/verify
  expose supported administration. Existing v2 clients infer tenant from keys;
  transitional instance allowlists never widen that ownership.
- Trusted event-envelope versions, tenant storage/cache namespaces and revocation
  epochs apply to workers, retries and long-lived sessions as well as HTTP.
- Auth-cache invalidation is bounded at 15 seconds, session/in-flight cancellation
  at 30 seconds, and presigned URLs at 60 seconds, as specified by the WISH.
  Loosening those ceilings requires a reviewed release-contract change.
- Compatibility/fence epochs and the minimum tenant-safe binary prevent unsafe
  rollback after ownership transformation; a generic flag cannot undo the cutover.

## Threat model

Tenant users and delegated credentials operate only within authenticated ownership.
Platform credentials are separate; production mutations require distinct signed,
unexpired, atomically consumed approvals. Revocation is checked before effects.
Shared-runtime residual risk requires the recorded human/security acceptance.
Security-gap titles only: “Tenant isolation”, “Delegation ceilings”, “Tenant egress”,
“Revocation freshness” and “Mixed-version rollback”. This draft asserts no closure.

## Deliveries

Each executable group retains its own issue/PR; unknown mappings are not invented.

1. G0: ownership inventory, threat model, ADRs and release evidence contract.
   Acceptance: independent review plus explicit ownership/trust approval.
   Rollback: revise planning artifacts; this does not authorize data conversion.
2. G1–G3: identity/control schema, ownership columns, request auth and RLS boundary.
   Acceptance: real restricted-role tenant A/B isolation. Rollback: compatible
   additive phase only; keep schema and ownership ledger.
3. G4–G6: synchronous/async/storage conversion and backfill/reconciliation tooling.
   Acceptance: complete ownership inventory and no unresolved tenant-owned rows.
   Rollback: ledger-backed compensation within the secure floor's constraints.
4. G7–G8A: adversarial qualification, signed-receipt guards and non-production canary.
   Acceptance: every normative threshold and independent security gate passes.
   Rollback: tenant-safe build or maintenance mode, with evidence retained.
5. H8/G8B–G8E and H9/G9A–G9B: separately approved production and credential steps.
   Acceptance: consume the receipt for each named action and prove isolation/custody.
   Rollback: tenant-safe recovery; never disable RLS or deploy a pre-tenant binary
   after the secure floor. The docs assignment authorizes none of these actions.

## Progress

The snapshot records #1460 for consumer tenancy, #1471 for dead-letter ownership,
#1531 for ingress/maintenance context, #1534 for multitenancy-on paired-agent
proofs, and #1556 for grant-source ownership. These are partial boundary deliveries.
Closed issues #908, #979, #981 and #982 record bootstrap/root-key/CLI/posture work;
the supplied snapshot does not identify their original merged PRs.
Neither closed issues nor later fixes establish full migration/production acceptance.

## Open questions

The plan's human decision remains explicit approval of the G0 ownership/trust
boundary, including shared-runtime residual risk. Recommendation: require that
recorded approval before the dependent groups; do not infer it from work approval.
Production mapping and each credential mint retain their separate receipt gates.

## Links

- [ADR-0001 through ADR-0010](README.md#earlier-records) — keys and files unchanged
- [Recorded status](../../.genie/wishes/omni-full-multitenancy/STATUS.md)
- [Bounded work approval](../../.genie/wishes/omni-full-multitenancy/WORK_APPROVAL.md)
- [RFC-0002](0002-paired-agents.md), [RFC-0007](0007-saas-platform-auth.md)
