# Wish: Group & Thread Parity

**Status:** READY  
**Slug:** parity-groups  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** M  

---

## Problem

Two distinct group-related gaps:

1. **WhatsApp declares `canHandleGroups: false` but groups work de facto.** The handler processes `@g.us` JIDs correctly, resolves `msg.key.participant` for sender identification, and group messages flow through the system fine. The capability flag is lying — it says "I can't" when it actually can. This misleads consumers, dashboards, and routing logic that check capabilities before sending.

2. **Telegram forum topics (threads) are declared but not wired.** `canHandleThreads: true` in capabilities, but there's no `message_thread_id` handling in senders or handlers. Forum topics in Telegram supergroups use thread IDs to route messages to specific topics — without this, a bot in a forum group can't reply to the correct topic or create new topics. grammy fully supports topic IDs via `message_thread_id` parameter.

Secondary gaps: WhatsApp has group metadata caching (`handleGroupsUpsert`, `handleGroupsUpdate`), Telegram has none. WhatsApp has group invite link management, Telegram doesn't implement it (though grammy supports `exportChatInviteLink`). Telegram broadcast/channel posts are declared but not received (`allowed_updates` missing `channel_post`).

## Audit Evidence

- **WhatsApp groups:** `canHandleGroups: false` in capabilities. `handlers/messages.ts` processes `@g.us` JIDs, resolves `msg.key.participant`. Group metadata cached via `handleGroupsUpsert()` / `handleGroupsUpdate()`. **De facto working, just not declared.**
- **Telegram forum topics:** `canHandleThreads: true` in capabilities. No `message_thread_id` in send or receive paths. **Gap: not-yet-implemented.** grammy supports topic IDs.
- **Telegram broadcast:** `canHandleBroadcast: true` but `allowed_updates` doesn't include `channel_post`. **Gap: not-yet-implemented.**
- **Telegram group invite:** Not implemented. grammy has `bot.api.exportChatInviteLink()`. **Gap: not-yet-implemented.**
- **WhatsApp group participant handler:** `group-participants.update` fires but handler is a TODO stub.

## Scope

### IN

- [ ] Flip WhatsApp `canHandleGroups` from `false` to `true` (reflect reality)
- [ ] Wire WhatsApp `group-participants.update` handler (currently TODO stub) to emit canonical group membership events
- [ ] Implement Telegram forum topic support: pass `message_thread_id` in outgoing messages when targeting a topic
- [ ] Extract and store `message_thread_id` from incoming Telegram messages in forum groups
- [ ] Add `threadId` / `topicId` to canonical message event schema (optional field)
- [ ] Add `channel_post` to Telegram `allowed_updates` and wire handler for broadcast channel messages
- [ ] Implement Telegram group invite link: `exportChatInviteLink()` accessible via API

### OUT

- WhatsApp group creation (already implemented)
- Telegram group creation (library-blocked — bots can't create groups)
- Telegram group participant management (ban/restrict — separate admin feature)
- WhatsApp group metadata improvements (already working well)
- Cross-channel group bridging (separate feature)
- Telegram topic creation/management (start with message routing to existing topics)

## Acceptance Criteria

- [ ] WhatsApp capabilities report `canHandleGroups: true`
- [ ] WhatsApp group participant join/leave events emitted to event bus
- [ ] Sending a message to a Telegram forum topic routes to the correct topic (not general)
- [ ] Incoming Telegram forum messages include `threadId` in the canonical event
- [ ] Telegram channel posts (broadcast) are received and processed as messages
- [ ] Telegram group invite link retrievable via API
- [ ] No regression in existing WhatsApp group message handling
- [ ] No regression in existing Telegram group message handling

## Library Blockers

- **Telegram group creation:** Bots cannot create groups via Bot API — library-blocked. Not in scope.
- **WhatsApp threads:** WhatsApp doesn't have a thread/topic concept — library-blocked for WhatsApp side. Thread support is Telegram-only.
