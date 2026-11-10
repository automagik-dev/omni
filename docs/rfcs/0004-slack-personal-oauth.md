---
rfc: "0004"
title: "Slack personal OAuth"
status: Draft
created: 2026-09-21
---
# RFC-0004: Slack personal OAuth

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | One-click connection for personal Slack identities |
| Issue | [#1235](https://github.com/automagik-dev/omni/issues/1235) (identity follow-up) |
| Design | [DESIGN](../../.genie/brainstorms/slack-personal-oauth/DESIGN.md), [WISH](../../.genie/wishes/slack-personal-oauth/WISH.md) |
| Created | 2026-09-21 |

## Summary

The operator creates one Slack app for an Omni deployment; team members connect
their own Slack identities through native OAuth. A shared Socket Mode receiver
delivers each event to the identities authorized to see it. Manual connections
remain supported, and no Omni-hosted OAuth relay is introduced.

**Happy delivery:** choose Connect Slack in Omni, approve your Slack identity, and see your personal Slack conversation appear as a connected channel.

## Motivation

Hand-creating an app and copying several tokens for every personal connection is
slow and error-prone. Independent Socket Mode receivers also divide one app's
events, so OAuth and shared reception are one delivery goal.

## Design

An operator configures a deployment app from a generated manifest. An authenticated
start creates a server-side pending record; the callback exchanges the code and
upserts one user-mode instance per workspace/user. The browser receives a nonce,
then reads the one-time result through the authenticated result endpoint.

One receiver per Slack app attaches the instances. Multi-attachment workspaces
fan out using Slack authorizations; revocation detaches affected identities.
The single-attachment path preserves legacy behavior. Bot duplication protection
is scoped to a second bot identity in the same app/workspace.

The WISH's original button target, `apps/khal-ui`, has since been removed. Its
delivery record is historical; it does not prove the present DSH onboarding path.

## Contracts introduced

- `instances.slack_team_id`, `slack_user_id`, `slack_connection_method` and the
  identity index extend legacy rows; manual instances populate identity on connect.
- Deployment settings: `slack.app.client_id`, `slack.app.client_secret`,
  `slack.app.signing_secret`, `slack.app.app_token`, and `server.public_url`.
  Settings keep env fallback and secret sealing.
- `/api/v2/slack/app`, `/slack/oauth/start`, `/slack/oauth/callback` and
  `/slack/oauth/result/:nonce` define status/start/callback/result under v2.
  Only the callback is public-by-contract; results are single-use and authenticated.
- `instance.connected` adds optional `teamId`/`actingUserId`; older producers
  need not supply them. `omni slack app setup|status` and `omni slack connect`
  expose the flow while preserving manual setup.
- `SLACK_BOT_INSTANCE_EXISTS` replaces the broad app-token guard only where two
  bot attachments would duplicate delivery; personal attachments may share an app.

## Threat model

OAuth starts require an authorized Omni caller. The callback uses signed state
and tenant context from the pending server record. Tokens stay sealed and never
enter redirects or result payloads. Reauthorization rebuilds acting clients;
Slack token revocation/uninstall disconnects the affected instances.
Pending flows are process-local; multi-replica persistence is deferred in the plan.

## Deliveries

The WISH assigns one issue/PR per group; the snapshot does not map all group numbers.

1. Foundation: identity columns/settings/events. Acceptance: connected identity
   persists. Rollback: revert compatible code and retain additive columns.
   Done 2026-09-22 https://github.com/automagik-si/omni/pull/1233
2. Receiver expansion. Acceptance: attachments share one receiver without changing
   the old path. Rollback: remove the unused module before the switch.
   Done 2026-09-22 https://github.com/automagik-si/omni/pull/1233
3. Plugin switch. Acceptance: manual instances receive the same events.
   Rollback: restore the compatible receiver, retaining identity columns.
   Done 2026-09-22 https://github.com/automagik-si/omni/pull/1250
4. API/SDK. Acceptance: repeat OAuth reuses the same identity with a single-use
   result. Rollback: stop new starts; code reverts do not revoke Slack grants.
   Done 2026-09-23 https://github.com/automagik-si/omni/pull/1255
5. Fan-out/revocation. Acceptance: users receive only authorized events and revoked
   identities disconnect. Rollback: explicitly detach/revoke shared connections.
   Done 2026-09-22 https://github.com/automagik-si/omni/pull/1250
6. CLI. Acceptance: connect completes after browser consent.
   Rollback: restore manual instructions; preserve existing credentials safely.
   Done 2026-09-22 https://github.com/automagik-si/omni/pull/1233
7. Product button. Acceptance: complete connection from the current UI, verified
   separately from the retired UI. Rollback: use the CLI/manual path.
   Open: complete connection from the current UI (needs judgment); waits on: owner
8. Docs/integration. Acceptance: documented setup matches the integrated flow.
   Rollback: correct the guide without changing stored authorizations.
   Open: documented setup matches the integrated flow (guide still describes retired dashboard redirects); waits on: team

## Progress

The WISH records integration via #1233 and docs via #1232, outside the supplied
merged-PR snapshot's range. The snapshot confirms #1250 for botless user installs,
#1246 for the acting display name and #1255 for unique/indexed Slack identity.
#1553 preserves the Slack Web API exports in the OAuth test mock.
These records do not constitute a fresh live Slack or current DSH UI acceptance.

## Open questions

No unresolved owner question is recorded in the reviewed DESIGN. Deferred
multi-replica storage and transport changes keep their original measured triggers.

## Links

- [#1250](https://github.com/automagik-dev/omni/pull/1250), [#1255](https://github.com/automagik-dev/omni/pull/1255)
- [Slack guide](../channels/slack.md)
- [RFC-0006](0006-full-multitenancy.md) — callback ownership
