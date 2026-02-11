# WISH: Telegram rawPayload Alignment

> Align Telegram channel's rawPayload with the implicit contract that downstream consumers (message-persistence, agent-dispatcher, agent-responder) depend on.

**Status:** REVIEW
**Created:** 2026-02-11
**Author:** WISH Agent
**Beads:** omni-ou4

---

## Problem

The Telegram channel plugin emits `message.received` events with a rawPayload that's missing fields the API's downstream consumers rely on. These fields are consistently provided by both WhatsApp and Discord channels.

**Current Telegram rawPayload:**
```typescript
{
  chatType: msg.chat.type,        // 'private' | 'group' | 'supergroup' | 'channel'
  displayName,                     // sender display name
  username: from.username,
  isMention,
  isForwarded: !!msg.forward_origin,
  mediaFileId: content.mediaFileId,
  filename: content.filename,
}
```

**What downstream consumers expect (from WhatsApp/Discord patterns):**

| Field | Used By | Impact When Missing |
|-------|---------|-------------------|
| `isGroup` | agent-dispatcher:296, agent-responder:202, message-persistence:135,334 | **All Telegram groups treated as DMs** — bot auto-responds to every group message |
| `pushName` | message-persistence:145,201,337,366,382; agent-dispatcher:1005; agent-responder:440 | **No sender names** on persisted messages, chat previews, or LLM context |
| `chatName` | message-persistence:309,338 | **Unnamed chats** in DB — group chats have no title |
| `isDM` | Used by Discord, optional but clarifying | Minor — derivable from isGroup |

## Decisions

- **DEC-1:** Add `isGroup`, `pushName`, `chatName` to Telegram's rawPayload — these are the minimum fields to match the implicit contract
- **DEC-2:** Keep `chatType` and `displayName` as-is — they're Telegram-specific and useful for channel-aware consumers
- **DEC-3:** `pushName` will alias `displayName` (Telegram's equivalent of WhatsApp's push name)
- **DEC-4:** `chatName` will use `msg.chat.title` for groups, `displayName` for DMs (matching Discord's pattern)
- **DEC-5:** No changes to the channel-sdk interface — rawPayload is intentionally untyped to allow channel-specific data

## Assumptions

- **ASM-1:** No other downstream consumers beyond the three identified (message-persistence, agent-dispatcher, agent-responder) depend on rawPayload fields
- **ASM-2:** The `msg.chat` grammy object always has `.title` for group/supergroup chats and `.type` is reliable
- **ASM-3:** Telegram's `from.first_name + last_name` is a reasonable equivalent to WhatsApp's pushName

## Risks

- **RISK-1:** Future channels may not provide all these fields → Mitigated: downstream consumers already use optional chaining (`rawPayload?.isGroup`)
- **RISK-2:** `chatName` for DMs using sender displayName may be wrong for chats with multiple participants → Low risk: Telegram DMs are always 1:1

## Scope

### IN SCOPE
- Add missing rawPayload fields to Telegram message handler (`isGroup`, `pushName`, `chatName`, `isDM`)
- Verify agent-dispatcher DM detection works for Telegram after fix
- Verify message-persistence creates named chats and participants with display names

### OUT OF SCOPE
- Formalizing rawPayload as a typed interface in channel-sdk (separate effort)
- Adding contact sync/caching to Telegram (not needed — grammy provides full User per message)
- Webhook mode implementation
- Adding `isFromMe` (Telegram filters bot messages already, no self-messages reach rawPayload)
- Adding `quotedMessage` object (Telegram reply handling uses `replyToId` which works)

---

## Impact Analysis

### Packages Affected
| Package | Changes | Notes |
|---------|---------|-------|
| channel-telegram | [x] handlers/messages.ts | Add rawPayload fields |
| api | [ ] no code changes | Consumers already handle these fields via optional chaining |

### System Checklist
- [ ] **Events**: No new event types. Existing `message.received` payload enriched.
- [ ] **Database**: No schema changes.
- [ ] **SDK**: No API surface changes.
- [ ] **CLI**: No changes.
- [ ] **Tests**: Telegram handler tests should verify rawPayload shape.

---

## Execution Group A: rawPayload Enrichment

**Goal:** Add missing fields to Telegram's rawPayload so downstream consumers work correctly for Telegram messages.

**Packages:** `channel-telegram`

**Deliverables:**
- [ ] Update `setupMessageHandlers` in `packages/channel-telegram/src/handlers/messages.ts` to include `isGroup`, `pushName`, `chatName`, `isDM` in rawPayload

**Target rawPayload shape:**
```typescript
{
  // Telegram-specific
  chatType: msg.chat.type,
  username: from.username,
  isMention,
  mediaFileId: content.mediaFileId,
  filename: content.filename,

  // Cross-channel contract (matches Discord/WhatsApp patterns)
  displayName,
  pushName: displayName,
  chatName: msg.chat.title || (msg.chat.type === 'private' ? displayName : undefined),
  isGroup: msg.chat.type === 'group' || msg.chat.type === 'supergroup',
  isDM: msg.chat.type === 'private',
  isForwarded: !!msg.forward_origin,
}
```

**Acceptance Criteria:**
- [ ] `rawPayload.isGroup` is `true` for group/supergroup chats, `false` otherwise
- [ ] `rawPayload.pushName` contains the sender's display name
- [ ] `rawPayload.chatName` contains the group title for groups, sender name for DMs
- [ ] `rawPayload.isDM` is `true` for private chats
- [ ] All existing rawPayload fields preserved (no breaking change)
- [ ] `make check` passes (typecheck + lint + test)

**Validation:**
- `make check`
- `bun test packages/channel-telegram/` (if tests exist)
- Manual: send message from Telegram group → verify chat persisted with name
- Manual: send DM → verify agent-dispatcher treats it as DM (auto-responds)
