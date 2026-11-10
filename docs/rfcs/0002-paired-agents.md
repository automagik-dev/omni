---
rfc: "0002"
title: "Paired agents"
status: Draft
created: 2026-11-02
---
# RFC-0002: Paired agents

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | Agents receive only events they own |
| Issue | [#1461](https://github.com/automagik-dev/omni/issues/1461) (related delivery); later slices await their own issues |
| Design | [DESIGN](../../.genie/brainstorms/paired-agents/DESIGN.md), [slice 2 WISH](../../.genie/wishes/paired-agents-slice-2/WISH.md) |
| Created | 2026-11-02 (first tracked DESIGN; document dated 2026-11-01) |

## Summary

An agent can pair with Omni as its own principal and receive only its authorized
events through an outbound durable consumer. One declaration supports the
existing call path and a subscriber path without adding per-harness code to Omni.
This is one goal spanning the design's slices 2–7; completing slice 2 does not
complete the goal.

**Happy delivery:** pair an agent with Omni, send a message to its assigned chat, and see that agent answer while another paired agent stays quiet.

## Motivation

External agent hosts need event delivery without an inbound callback endpoint or
an operator relaying events. The existing dispatcher remains supported; switching
delivery mode must not create two responders for the same agent.

## Design

Durable consumers belong to agents. Journal provenance comes from authenticated
keys and verified sources. Grants authorize instance-less source events; instance
events still follow the agent's bindings and access decisions.

Subsequent slices add bounded child keys, declared emissions and loop guards,
transactional manifest compilation for call/subscriber modes, and a pairing
lifecycle with consent and revocation. The last slice measures real delivery.
The linked DESIGN owns the C0–C20 conditions and exact gate for dependent work.

## Contracts introduced

- `durable_consumers.agent_id`, journal producing-key/source fields and
  `agent_source_grants` add ownership/provenance without converting legacy consumers.
- `OMNI_PAIRED_AGENT_CONSUMERS` defaults off. Its status read and doctor output
  expose the posture; flag-off rows are not retrospectively backfilled.
  Later slices have separate flags and refuse activation with multitenancy enabled;
  the unflagged prerequisite fixes continue to apply in either tenancy posture.
- `events:consume` covers owned-consumer operations. The paired profile adds
  constrained `messages:send`, never owner-device or connector-invoke authority.
- Planned agent-key lineage/expiry, `delivery_mode`/`delivery_mode_since`, manifest
  events and pairing contracts extend the existing call default. Mode changes
  converge managed rows transactionally; switching back to subscriber starts now.
- Planned emission rules reserve provider namespaces, validate `publishes`, and
  stamp causation depth; sends accept idempotency keys. Legacy paths remain as
  specified in the DESIGN rather than acquiring agent authority implicitly.
- Planned pairing extends device consent with the declared sources and constrained
  verbs; approval replaces grants atomically with key minting. `omni agents graph`,
  a default 10,000-row report-only backlog limit and an audited forward seek expose
  subscriber progress without silently replaying skipped work.

## Threat model

A paired host holds a bounded agent credential, not the owner's device key.
Consumer access checks tenant and agent identity; source grants require approved
ownership. Pairing requires owner consent, and key/grant revocation removes access.
No external message may supply its own trusted producer identity.
Remaining controls are planned work; this RFC does not certify them as deployed.

## Deliveries

1. Ownership prerequisites and agent-owned consumers (merged PRs below).
   Acceptance: two agents/tenants cannot read each other's consumer deliveries.
   Rollback: disable the consumer flag; retain additive schema and provenance.
2. Slice 3: agent-bound child keys (issue/PR not yet identified in the snapshot).
   Acceptance: child authority never exceeds its parent and revocation stops it.
   Rollback: revoke paired keys and retain existing call agents.
3. Slice 4: emissions, causation and idempotency (issue/PR to be filed).
   Acceptance: undeclared emissions are refused and duplicate sends run once.
   Rollback: disable the new path; previously sent messages remain external effects.
4. Slice 5: manifest compilation and delivery mode (issue/PR to be filed).
   Acceptance: changing mode leaves exactly one managed delivery path.
   Rollback: transactional return to call mode; subscriber gaps are recorded.
5. Slice 6: consent/grants/pairing (own issue/PR to be filed).
   Acceptance: owner-approved pairing delivers only its granted source events.
   Rollback: revoke pairing and grants; preserve journal history.
6. Slice 7: measurement and controls (own issue/PR to be filed).
   Acceptance: 40 consumers at the design's A24 volume have matched-row p95
   insert-to-delivery latency under two seconds, before GitLab ships.
   Rollback: disable the slice; preserve consumer cursors and measurement history.

## Progress

The merged snapshot records prerequisites #1459, #1460, #1462/#1469,
#1475/#1478, #1488 and #1495/#1501. Slice 2 merged as #1491, #1499,
#1506, #1514, #1523 and #1534; #1537 records its SHIPPED close-out.
#1556 supplied the sanctioned grant writer and #1554 recorded the follow-up.
#1586 added `events:consume`; it is partial progress toward the wider design,
not evidence that slices 3–7 or the live delivery gate have completed.

## Open questions

No unsettled owner question is recorded in the reviewed DESIGN. Later slices and
their live acceptance evidence remain delivery work, not new design decisions.

## Links

- [RFC-0003](0003-gitlab-sdlc-connector.md) — dependent GitLab delivery
- [RFC-0006](0006-full-multitenancy.md) — tenant ownership boundary
- [#1537](https://github.com/automagik-dev/omni/pull/1537), [#1556](https://github.com/automagik-dev/omni/pull/1556), [#1586](https://github.com/automagik-dev/omni/pull/1586)
