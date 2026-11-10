---
rfc: "0001"
title: "Omni chat threads"
status: Draft
created: 2026-11-10
---
# RFC-0001: Omni chat threads

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | A dedicated agent beside each chat |
| Issue | [#1629](https://github.com/automagik-dev/omni/issues/1629) |
| Design | Original DESIGN and WISH lost; reconstructed from #1629 and merged deliveries below |
| Created | 2026-11-10 (original design date unknown) |

## Summary

Each chat opens a dedicated agent thread with the conversation in its right pane.
The thread gets the Omni Bot's full DSH and Omni tool set, uses Auto review when
available, and lets the owner choose whether sends need confirmation for that chat.

**Happy delivery:** open a chat in Omni, see its conversation beside its dedicated agent, and switch “Always allow send” on for that chat.

## Motivation

The owner needs an agent that can act on the chat being viewed without losing its
conversation or requiring a separate general-purpose session. Issue #1629 adds
full tools, automatic permissions and the visible per-thread send control to the
already merged thread foundation.

## Design

Opening a chat reuses its dedicated DSH session and opens its phone pane once the
session has a surface. Automation turns for that chat run in the same thread.
The thread keeps the full automation tool set rather than a reduced set of tools.
The later removals of hand-offs and the separate Sessions list remain in effect.

Auto review provides the permission preset when installed and enabled. If it is
off, the thread remains usable with DSH's default permissions. The owner controls
send permission through the chat UI; permission defaults and per-thread overrides
stay separate. An automation's ask-first behavior still applies to its turn.

## Contracts introduced

- Per-chat child API keys retain parent lineage and chat constraints; existing
  parent/device credentials retain their established behavior.
- Thread records bind a chat and instance to a DSH session. Existing records are
  reused across reopen/restart rather than producing another session per click.
- The host operation `omni-thread-permissions` updates per-thread overrides.
  `sends` is `ask` or `allow`; an absent override inherits the owner's defaults.
- Full DSH and Omni tools follow the host's tool availability. Missing Auto review
  falls back to the host permissions instead of preventing the chat from opening.

## Threat model

The thread operates using a child credential constrained to its chat. The local
owner changes permission defaults and overrides; a message in the external chat
does not grant permission. Sends appear as the user's channel identity. Revoking
the child credential stops its API access; turning off the send switch restores
confirmation and cannot retract messages already sent.

## Deliveries

1. Child keys and thread foundation (#1396, #1411).
   Acceptance: reopening a chat preserves its dedicated session and scoped key.
   Rollback: revert the host feature; additive key lineage and saved rows remain.
2. Conversation placement and automation continuity (#1439, #1452, #1453).
   Acceptance: one click opens the chat's agent and phone pane together.
   Rollback: revert placement/routing behavior; existing conversations remain.
3. Full tools, Auto review and the send switch (#1629; PRs #1630, #1631).
   Acceptance: the thread has the Omni Bot's tools, exposes the switch, and opens
   with Auto review disabled. Rollback: restore previous tools/permissions;
   already completed external actions cannot be undone by reverting code.

## Progress

The supplied merged-PR snapshot records #1396 and #1411 for the foundation,
#1439 for automation turns, and #1452/#1453 for opening the phone pane.
#1440 removed hand-offs and #1441 removed the Sessions list.
#1630 delivered the #1629 tools/permissions/switch and #1631 repaired tool-set
parity and the Auto review off case. #1599/#1601 hardened thread-key regressions.
These merges establish implementation progress, not owner acceptance of this RFC.

## Open questions

No unresolved design question is recorded in #1629. The original planning files
are unavailable; this reconstruction does not invent their missing decisions.

## Links

- [#1629](https://github.com/automagik-dev/omni/issues/1629)
- [#1630](https://github.com/automagik-dev/omni/pull/1630), [#1631](https://github.com/automagik-dev/omni/pull/1631)
- [Thread host](../../apps/omni-channels-dsh/src/host/threads.js)
- [Thread tools and permission handling](../../apps/omni-channels-dsh/src/host/thread-tools.js)
