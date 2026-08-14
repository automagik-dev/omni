# Slack as a consultative surface: user token, first-class threads, scheduling

Closes #889 · 4 migrations

## Why

`channel-slack` only knew how to act **as the bot**: reactive, answering where it is mentioned, seeing only what the bot can see. This adds a second posture — **acting as the person** (`xoxp`): opening DMs, reading the workspace from their vantage point, and calling `search.messages`, which no bot token can.

Opening the hood, the bottleneck was not the plugin — already the most complete channel in the repo — but the **core**. Half of this PR is that.

## The finding that shaped the design

You *can* receive push with a user identity, but **not with the `xoxp` itself**. The Events API has *Workspace Events*, which are ["perspectival to a member installing your application"](https://docs.slack.dev/apis/events-api/): subscribed with user scopes (`im:history`, `mpim:history`, …), the app sees the workspace through that person's eyes.

The **transport does not change**: RTM is closed to granular apps and Socket Mode requires an app-level token. It stays Socket Mode or the HTTP receiver; only the vantage point moves.

Hence **one plugin with an `authMode`**, not two: the event machinery is identical, only the writing client swaps.

## Core (affects every channel)

### Threads became a first-class relation — `0048`

There was no representation of a thread. `threadId` rode along in the event payload purely to route `per_thread` agent sessions, and **was dropped at persistence time**. The one modelled path (`chats.parent_chat_id` + `chat_type='thread'`) is dead code: `inferChatType()` only inspects WhatsApp JID suffixes.

The practical damage: Slack sent `replyToId = thread_ts`, so **a thread reply was indistinguishable from a WhatsApp quote** once stored.

A reply points at ONE message; a thread is a sub-conversation. Different relations, different columns. `is_thread_broadcast` carries Slack's `reply_broadcast` — posted *in* the thread and mirrored to the channel — and is orthogonal to `thread_ts`, hence its own column.

No backfill: thread membership was never recorded and cannot be reconstructed. `hasBotRepliedInThread` gained the new branch while keeping the old ones, so history keeps working.

### Scheduling — `0049`

Two delivery modes, chosen by the `canScheduleMessage` capability:

- **`platform`** — the channel schedules natively (`chat.scheduleMessage`); delivery survives omni being down
- **`local`** — omni holds the message and the sweeper sends it

The row exists **even in platform mode**, deliberately: Slack's `chat.scheduledMessages.list` only returns what the *same token* scheduled, so the platform can never be the source of truth for what is pending.

The sweeper enumerates active tenants (`enumerateActiveWorkTenants`, ADR-0008) and uses `FOR UPDATE SKIP LOCKED`, so overlapping ticks cannot double-send a row.

### Permalink, per-message pin/star, `replyToMessageId` — `0051`

`reply_to_message_id` has existed since `0000` and **was never written once**; the two helpers that would resolve it had no callers either. Per-message pin/star did not exist (`ChatSettings.pinned` pins the *conversation*). Permalinks resolve lazily — one API call each, and almost no message is ever linked to.

### Channel contract

`editMessage` / `deleteMessage` / `starMessage` / `sendPresenceStatus` moved out of `'x' in plugin` and into `ChannelPlugin`. Unifying them surfaced that **the contract was silent and the inline casts were right**: `starMessage` and `deleteMessage` take a `fromMe` parameter no central declaration had. Writing only what the contract implied would have broken star/delete on WhatsApp.

## User token — `0050`

`authMode: 'bot' | 'user'`. `BoltConnection` gains an `actingClient`: the same client in bot mode, an `xoxp` client in user mode. The bot `client` **stays** — Bolt authenticates the socket with it, and it is the fallback for calls the user token has no scope for.

- **`conversations.open`** did not exist anywhere in the repo. Without it the plugin could only answer a DM that arrived, never start one — the difference between a reactive bot and a consultative agent.
- **`mpim` recognised**, with a trap: `isDm` now covers `im` and `mpim`, but `buildEnrichedPayload` derived `isGroup: !isDm`, which would file a DM with *several* people as 1:1. Hence a separate `isMpim`. On the account used for testing: **127 ims and 72 mpims** — 72 conversations previously classified as channels.
- **`search.messages`**, user-token only.

Guards: `authMode: 'user'` without a `userToken` fails loudly (otherwise every action would silently go out as the bot); a token without the `xoxp-` prefix is rejected; `searchMessages` in bot mode **throws** rather than returning an empty list, which would read as "no matches".

## Formatting (a live bug, already affecting bot mode)

The mrkdwn converter **did not escape `&`, `<`, `>`**. Text containing `<@U099>` was sent raw and Slack **rendered it as a real mention**, pinging someone unrelated to the conversation.

Also: conversion swept through fenced code (`**kwargs` in a Python sample became `*kwargs`), markdown italic came out as **bold** in Slack, and `chunkMessage` split fences leaving ``` unbalanced.

## A bug that only surfaced against the real API

Posting with a user token, the message comes back with `user` = the human **but also with a `bot_id`** (the app's). What the plugin posts is filtered by that line — no echo loop. But a message the **person types themselves** has no `bot_id`, and the self-filter compared only against `botUserId`, which comes from the bot token and never matches the human.

Consequence: in a DM between two people, the owner types, the agent reads it as inbound and may **answer on their behalf**. Not a loop — the agent talking over its own principal.

## Two governance gates changed the design

1. A denormalized `tenant_id` on `scheduled_messages` dragged the table into the historical 29-table manifest and broke the G0 / migration-0041 gates. The repo's precedent for a new table is `whatsapp_flow_keys`: tenancy derives via `instance_id` and the table stays **outside the manifest by construction**.
2. The db-access ratchet forbids growing unscoped access, and the sweeper scanned globally. Raising the ceiling would game the gate, so the sweeper now enumerates tenants.

## HTTP mode was unreachable through the API

Found by booting the server for real, after everything above passed typecheck and the suite: `profileMetadata` was missing from `updateInstanceSchema` (a PATCH returned 200 and zod stripped it), and the connect route built options from tokens alone — the only caller of `applySlackProfileMetadata` was the **restart** path. Net effect: you could configure `mode: 'http'`, the database stored it correctly, and the instance never connected that way.

Both are silent-success failures: nothing throws, nothing logs, the state is just wrong. There is a regression test that fails 3 of 5 cases if the fixes are reverted.

## Validation

**Against real Slack**, with a user token:

- **escaping confirmed dead in production** — `<@U…>` stored as `&lt;@…&gt;`, no ping; `<!channel>` likewise; `**kwargs` intact inside a code fence
- `getPermalink` · thread reply · `reply_broadcast` (with `subtype: thread_broadcast` present, proving the column maps a real distinction) · `conversations.replies` · `reactions.add` · `scheduleMessage`→`list`→`delete` · `search.messages` · idempotent `conversations.open`

**Migrations** run from scratch on a throwaway Postgres 18: 52/52; columns, defaults, indexes and FK cascade verified in the database; the four reapplied under `ON_ERROR_STOP=1` — idempotent in fact, not just by intent.

### Inbound, end to end

This branch's omni running, receiving over the Request URL and persisting:

```
messages=63 · chats=9 · events=63
chat_types: dm, group
Received · from U08JN9LGYQN · chatId C0B9DQJG3FD
```

Nine conversations and 63 messages from channels **the bot is not in** — the user perspective working, which is the point of the issue.

Three confirmations only the database could give:

- **`0` messages from the authorizing user persisted**, despite them typing during the test. The event arrived and `actingUserId` filtered it — without that fix the agent would treat its owner's words as inbound and answer over them.
- **8 messages with `thread_external_id` populated** — the `0048` column taking real data, where before it collapsed into `replyToExternalId`.
- `chat_types: dm, group` — mpim classification separating correctly.

**Suite**: typecheck 23/23 · biome clean · 5716 pass. The 6 remaining failures are the MinIO tests, which spin up a Docker container unavailable on the dev machine — they pass in CI.

## New surface

**Migrations** `0048` `0049` `0050` `0051` · **Routes** `/scheduled-messages` (CRUD), `/slack/dm/open`, `/slack/search`, `GET /messages/:id/permalink` · **CLI** `omni schedule send|list|get|cancel`, `omni slack dm|search` · **Capabilities** `canScheduleMessage`, `maxScheduleAheadMs`, `canGetPermalink`, `canPinMessage`, `canSearchMessages`

## Review notes

- `canSearchMessages` stays `false`: `ChannelCapabilities` is static on the plugin, not per instance, and declaring `true` would promise search for bot-mode instances too
- Slack has no quote API — the card is a permalink unfurl, client behaviour rather than contract. The deterministic fallback is blockquote + permalink
- `scheduleTextMessage` does **not** chunk: chunks would become several scheduled messages with separate handles, so a later cancel could half-fire
- `post_at` is sent in whole seconds, with a test pinning it (passing ms would schedule ~55k years out)
