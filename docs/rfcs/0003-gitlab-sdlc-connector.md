---
rfc: "0003"
title: "GitLab SDLC connector"
status: Draft
created: 2026-11-06
---
# RFC-0003: GitLab SDLC connector

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | GitLab lifecycle events reach their owning agent team |
| Issue | Remaining connector/measurement issues not identified in the supplied snapshot |
| Design | [DESIGN](../../.genie/brainstorms/gitlab-sdlc-connector/DESIGN.md), [WISH](../../.genie/wishes/gitlab-sdlc-connector/WISH.md) |
| Created | 2026-11-06 (first tracked DESIGN/WISH; documents dated 2026-11-01) |

## Summary

One GitLab webhook carries lifecycle events into typed, connector-owned Omni
ingress. Subscriptions choose the events and their targets; paired agents receive
only the source events they are granted. The goal includes ingress, the GitLab
provider and delivery measurement, with paired-agent delivery owned by RFC-0002.

**Happy delivery:** merge a GitLab merge request and see its owning captain acknowledge the merge in the team's conversation without anyone relaying it.

## Motivation

The team currently relies on manual relays for issues, pushes, merge requests,
review notes, CI, releases and deployments. A multiplexed provider hook needs a
typed ingress contract before it can reliably feed a team of agents.

## Design

Connector ingress verifies the delivery once and records one journal event with
the provider body and all matching subscription/automation ids. Only named
targets run; a target-less subscription serves authorized consumers without
triggering an automation. Unmatched verified deliveries increment counters.

The GitLab connector is events-only and stores no GitLab API token. Its verifier
mode is fixed by stored configuration. Provider ids make retries idempotent.
The provider and measurement slices wait for the recorded live paired-agent
minimum; shipping ingress alone does not satisfy that operator-held gate.

## Contracts introduced

- Connector-keyed `POST /api/v2/connectors/hooks/:connectorId` sits beside the existing
  subscription-keyed `POST /api/v2/connectors/events/:subscriptionId` route.
  `ingress = subscription | connector` is immutable; old rows default to subscription.
- Connector hook-secret storage, unmatched counters and nullable target/secret
  fields have explicit constraints. Existing ClickUp URLs, secrets and envelopes
  retain their subscription semantics.
- `connector.{provider}.*`, `connector.>` and `publishConnector` define the typed
  publisher path; provider payloads cannot select trusted routing metadata.
- Typed rows carry `subscriptionIds[]` and `targetAutomationIds[]`, with one body;
  legacy `connector.event` keeps its original single-target envelope.
- GitLab maps issue/push/merge-request/note/pipeline/job/tag/release/deployment
  deliveries to `connector.gitlab.*`; ids use `webhook-id`, then `Idempotency-Key`,
  then the raw-body digest. CLI subscriptions/hook-secret flags extend old commands.

## Threat model

The public hook is authenticated by the connector's sealed verification secret.
Tenant selection comes from the stored connector, not provider-supplied ownership.
Management reads require authenticated scopes; secrets never appear in events.
Revoking a hook secret or subscription removes that ingress/delivery authority.
The operator alone holds any API credential used for measurement fixtures.
Security follow-up titles: “GitHub action-bearing types”, “Dependant rewrite”,
and “Dead-letter retries”; their migration is outside this goal.

## Deliveries

1. Slice 1, groups 1–5: core safety, additive schema, management API, ingress,
   then CLI/SDK (one PR per group; merged numbers below).
   Acceptance: verified typed delivery journals once and reaches only its targets;
   existing ClickUp behavior is preserved. Rollback: remove new subscriptions and
   revert compatible code; retain additive columns and existing subscription rows.
2. Slice 2, group 6: GitLab connector (issue/PR not yet identified).
   Acceptance: real/test provider fixtures cover the typed vocabulary and verifier
   modes after the live prerequisite. Rollback: disable the hook and connector.
3. Slice 4, group 7: measurement (its own issue/PR after go-live).
   Acceptance: seven days before/after show at least 99% delivery with every miss
   explained and zero-event categories exercised. Rollback: disable the hook;
   acknowledge that delivered notifications and measurement history remain.

## Progress

Slice 1 merged as #1465 (core), #1468 (schema), #1472 (management), #1477
(ingress) and #1482 (CLI/SDK). #1628 published the planning records.
The snapshot contains no merged GitLab provider or measurement delivery.
The WISH explicitly leaves groups 6 and 7 behind the paired-agent live gate.

## Open questions

The reviewed plan records no unresolved owner design question. The operator still
needs to record the live prerequisite and actual provider-header evidence before
cutover; these are the plan's existing evidence gates.

## Links

- [RFC-0002](0002-paired-agents.md)
- [#1477](https://github.com/automagik-dev/omni/pull/1477), [#1482](https://github.com/automagik-dev/omni/pull/1482)
- [#1628](https://github.com/automagik-dev/omni/pull/1628) — planning publication
