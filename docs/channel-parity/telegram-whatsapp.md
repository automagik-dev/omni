# Channel Parity Matrix: Telegram ↔ WhatsApp

> **Canonical reference** for feature parity between the Telegram (grammy) and WhatsApp (Baileys) channel plugins.
> Audited 2026-02-13 from source code. Updated alongside implementation changes.

This document maps every declared `ChannelCapabilities` flag and every observable feature
across both plugins, classifying each as **match**, **degrade** (graceful fallback possible),
**blocked** (library/platform limitation), or **out-of-scope** (not applicable to the channel).

**Related documents:**
- [Full audit notes with file-level evidence](../../.genie/wishes/channel-parity-telegram-whatsapp/audit-notes.md)
- [Follow-up wishes](#13-follow-up-wishes) (8 implementation tasks below)

---

## 1. `ChannelCapabilities` Flag Alignment

Every flag from `packages/channel-sdk/src/types/capabilities.ts`, with the value declared in
each plugin's `capabilities.ts` and the real implementation status from the audit.

| Flag | Telegram declared | Telegram real | WhatsApp declared | WhatsApp real | Verdict |
|------|:-:|:-:|:-:|:-:|---------|
| `canSendText` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canSendMedia` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canSendReaction` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canSendTyping` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canReceiveReadReceipts` | `false` | ❌ library-blocked | `true` | ✅ implemented | **blocked** (TG) |
| `canReceiveDeliveryReceipts` | `false` | ❌ library-blocked | `true` | ✅ implemented | **blocked** (TG) |
| `canEditMessage` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canDeleteMessage` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canReplyToMessage` | `true` | ✅ implemented | `true` | ✅ implemented | **match** |
| `canForwardMessage` | `true` | 🏷️ declared, not wired | `true` | ✅ implemented | **degrade** (TG send missing) |
| `canSendContact` | `true` | 🏷️ declared, not wired | `true` | ✅ implemented | **degrade** (TG send missing) |
| `canSendLocation` | `true` | 🏷️ declared, not wired | `true` | ✅ implemented | **degrade** (TG send missing) |
| `canSendSticker` | `true` | 🏷️ declared, not wired | `true` | ✅ implemented | **degrade** (TG send missing) |
| `canHandleGroups` | `true` | ✅ implemented | `false` | ✅ works de facto | **degrade** (WA flag wrong) |
| `canHandleBroadcast` | `true` | 🏷️ declared, not wired | `false` | ❌ missing | **degrade** (TG not wired) |
| `canSendEmbed` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canSendPoll` | `true` | 🏷️ declared, not wired | `true` | ✅ implemented | **degrade** (TG send missing) |
| `canSendButtons` | `true` | 🏷️ declared, not wired | _undefined_ | ❌ library-blocked | **blocked** (WA Cloud API only) / **degrade** (TG not wired) |
| `canSendSelectMenu` | `false` | ❌ n/a | _undefined_ | ❌ library-blocked | **blocked** (WA) / **out-of-scope** |
| `canShowModal` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canUseSlashCommands` | `true` | 🏷️ declared, not wired | _undefined_ | ❌ library-blocked | **blocked** (WA) / **degrade** (TG not wired) |
| `canUseContextMenu` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canHandleDMs` | `true` | ✅ implemented | _undefined_ | ✅ implemented (default) | **match** |
| `canHandleThreads` | `true` | 🏷️ declared, not wired | _undefined_ | ❌ library-blocked | **blocked** (WA no threads) / **degrade** (TG not wired) |
| `canCreateWebhooks` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canSendViaWebhook` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canHandleVoice` | `false` | ❌ n/a | _undefined_ | ❌ n/a | **out-of-scope** |
| `canStreamResponse` | `true` | ✅ implemented | _undefined_ | ❌ missing | **degrade** (WA not-yet-impl) |
| `maxMessageLength` | `4096` | — | `65536` | — | platform difference |
| `maxFileSize` | `50 MB` | — | `100 MB` | — | platform difference |

---

## 2. Streaming / UX

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Response streaming (progressive edits) | ✅ `TelegramStreamSender` | ❌ missing | **degrade** | Baileys has `sendMessage` + `editMessage`; progressive edits are possible but `WhatsAppStreamSender` is unwritten. |
| Typing indicator (outbound) | ✅ `bot.api.sendChatAction('typing')` | ✅ `sock.sendPresenceUpdate('composing')` | **match** | WA also has `simulateTyping()` with text-length-scaled duration. |
| Typing indicator (inbound) | ❌ library-blocked | 📥 handler exists, not emitted | **blocked** (TG) | TG Bot API does not expose typing events to bots. WA fires `presence.update` but handler is a TODO stub. |
| Markdown → native format | ✅ `markdownToTelegramHtml()` (HTML) | ✅ `markdownToWhatsApp()` | **match** | Both respect `messageFormatMode: 'convert' | 'passthrough'`. |
| Smart message splitting | ✅ `splitHtmlMessage()` | ✅ `splitWhatsAppMessage()` | **match** | Both split at `maxMessageLength`, respecting code blocks. |
| Human delay / anti-bot | ❌ not needed | ✅ `humanDelay()` default 1.5–3.5 s | **out-of-scope** | Telegram bots are expected to be bots; WA timing is configurable via `WHATSAPP_HUMAN_DELAY_*` env vars. |

---

## 3. Receipts

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Delivery receipts (inbound) | ❌ `canReceiveDeliveryReceipts: false` | ✅ `processStatusUpdate` / `handleMessageDelivered` | **blocked** (TG) | Telegram Bot API does not provide delivery receipts. |
| Read receipts (inbound) | ❌ `canReceiveReadReceipts: false` | ✅ status ≥ 4 → `handleMessageRead` | **blocked** (TG) | Telegram Bot API does not expose read state to bots. |
| Mark as read (outbound) | ❌ library-blocked | ✅ `sock.readMessages()` | **blocked** (TG) | Bots cannot mark messages as read on Telegram. |

---

## 4. Reactions

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Reaction send | ✅ `bot.api.setMessageReaction()` | ✅ `buildReactionContent()` | **match** | |
| Reaction receive | ✅ `setupReactionHandlers()` diffs old/new | ✅ `reactionMessage` extractor + `messages.reaction` | **match** | |
| Reaction remove | ✅ empty array | ✅ empty string emoji | **match** | |
| Custom emoji reactions | 📤 premium-only limitation | ❌ Unicode-only | **blocked** (both) | TG: `custom_emoji` type requires premium. WA: only standard Unicode emoji. |

---

## 5. Media

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Image send | ✅ `sendPhoto()` | ✅ `buildImageContent()` | **match** | |
| Image receive | ✅ `extractPhoto()` picks largest `PhotoSize` | ✅ `imageMessage` extractor + `tryDownloadMedia()` | **match** | |
| Audio send | ✅ `sendAudio()` | ✅ `buildAudioContent()` | **match** | |
| Audio receive | ✅ `extractMedia()` handles `audio` + `voice` | ✅ `audioMessage` extractor | **match** | |
| Voice note (PTT) send | ❌ not applicable | ✅ `ptt: true` + OGG/OPUS via ffmpeg | **out-of-scope** | Telegram voice messages are just audio, no PTT concept. |
| Video send | ✅ `sendVideo()` | ✅ `buildVideoContent()` | **match** | |
| Video receive | ✅ `extractMedia()` handles `video` + `video_note` | ✅ `videoMessage` extractor | **match** | |
| Document send | ✅ `sendDocument()` | ✅ `buildDocumentContent()` | **match** | |
| Document receive | ✅ `extractMedia()` handles `document` | ✅ `documentMessage` extractor | **match** | |
| Sticker send | 🏷️ declared, no `dispatchMedia` case | ✅ `buildStickerContent()` | **degrade** (TG) | grammy has `bot.api.sendSticker()` — needs wiring. |
| Sticker receive | ✅ handles `sticker` (animated + webp) | ✅ `stickerMessage` extractor | **match** | |
| Media download to disk | ❌ passes `file_id` as URL | ✅ `tryDownloadMedia()` → `data/media/` | **degrade** (TG) | grammy supports `bot.api.getFile()` + download — not wired. |

---

## 6. Groups / Threads

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Group message handling | ✅ `canHandleGroups: true` | ✅ works de facto (`@g.us` JIDs) | **match** (effectively) | WA declares `false` but processes group messages. Flag should be `true`. |
| Group metadata caching | ❌ not cached | ✅ `handleGroupsUpsert()` / `handleGroupsUpdate()` | **degrade** (TG) | TG extracts `chat.title` inline but doesn't cache. |
| Group creation | ❌ library-blocked | ✅ `sock.groupCreate()` | **blocked** (TG) | Telegram bots cannot create groups. |
| Group invite link | ❌ not implemented | ✅ `getGroupInviteCode()` / `revokeGroupInvite()` / `joinGroup()` | **degrade** (TG) | grammy has `bot.api.exportChatInviteLink()` — not wired. |
| Group participant mgmt | ❌ not implemented | 📥 handler stub | **degrade** (both) | TG: grammy supports `banChatMember`. WA: handler fires but not emitted. |
| Forum topics / threads | 🏷️ declared, not wired | ❌ library-blocked | **blocked** (WA) | WhatsApp doesn't have threads. TG: grammy supports `message_thread_id`. |
| Broadcast / channel posts | 🏷️ declared, `channel_post` not in `allowed_updates` | ❌ `canHandleBroadcast: false` | **degrade** (TG not wired) | WA broadcasts are limited in Baileys (newsletters ≠ broadcast lists). |

---

## 7. Interactive UI

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Poll send | 🏷️ declared, no `sendPoll()` | ✅ `buildPoll` | **degrade** (TG) | grammy has `bot.api.sendPoll()` — not wired. |
| Poll receive | ❌ not in `allowed_updates` | ✅ `pollCreationMessage` + `pollUpdateMessage` | **degrade** (TG) | grammy supports poll events. |
| Inline buttons send | 🏷️ declared, no `InlineKeyboard` usage | ❌ library-blocked | **blocked** (WA) | WA buttons require Cloud API (not Baileys). TG: needs `InlineKeyboard` builder + `callback_query` handler. |
| Button response receive | ❌ no `callback_query` handler | ✅ `buttonsResponseMessage` extractor | **degrade** (TG) | grammy fully supports `callback_query`. |
| Slash commands | 🏷️ declared, no `setMyCommands` | ❌ library-blocked | **blocked** (WA) | No slash command concept in WhatsApp. TG: needs `bot.api.setMyCommands()`. |
| Select menu / list | ❌ `canSendSelectMenu: false` | ❌ library-blocked | **blocked** (WA) | WA lists are template-only (business/Cloud API). TG: could use inline keyboards. |

---

## 8. Identity / Profile / Contacts

| Feature | Telegram | WhatsApp | Verdict | Notes |
|---------|----------|----------|---------|-------|
| Contact card send | 🏷️ declared, no `dispatchContent` case | ✅ `buildContactContent()` / vCard | **degrade** (TG) | grammy has `bot.api.sendContact()` — not wired. |
| Contact card receive | ✅ `extractSpecial()` handles `msg.contact` | ✅ `contactMessage` extractor + vCard | **match** | |
| Location send | 🏷️ declared, no `dispatchContent` case | ✅ `buildLocationContent()` | **degrade** (TG) | grammy has `bot.api.sendLocation()` — not wired. |
| Location receive | ✅ `extractSpecial()` handles `msg.location` | ✅ `locationMessage` + `liveLocationMessage` | **match** | |
| Profile sync (own) | ❌ not implemented | ✅ `getProfile()` (name, avatar, bio, phone) | **degrade** (TG) | grammy has `bot.botInfo` at connect — partial data available. |
| Profile update | ❌ library-blocked | ✅ `updateProfileName()` / `updateBio()` / etc. | **blocked** (TG) | Telegram bots can only update profile via BotFather. |
| User profile fetch | ❌ not implemented | ✅ `fetchUserProfile()` | **degrade** (TG) | grammy has `getChat()` — not wired. |
| Contacts sync | ❌ library-blocked | ✅ `fetchContacts()` + cache + LID mapping | **blocked** (TG) | Telegram bots don't have a contact list. |
| Forward message send | 🏷️ declared, no `forwardMessage()` | ✅ `forwardMessage()` in `senders/forward.ts` | **degrade** (TG) | grammy has `bot.api.forwardMessage()` — not wired. |
| Forward message receive | ✅ partial (`isForwarded` flag) | ✅ processed as normal | **match** | TG sets `isForwarded: !!msg.forward_origin` but doesn't extract full origin details. |
| Edit message receive | ❌ `edited_message` not in `allowed_updates` | ✅ `handleMessageEdited()` | **degrade** (TG) | grammy supports `bot.on('edited_message')` — not wired. |
| Delete message receive | ❌ library-blocked | ✅ `handleMessageDeleted()` | **blocked** (TG) | Telegram does not notify bots of message deletions. |

---

## 9. Degradation Strategy Rules

When a feature is **degrade** (one channel can do it, the other can't yet):

| Strategy | When to apply | Example |
|----------|---------------|---------|
| **Silent drop** | Feature is cosmetic or non-critical | Streaming on WA: just send the final message. |
| **Fallback to text** | Content can be represented as text | Sticker send on TG: send as image or `[sticker: <name>]` text. |
| **Log + skip** | Feature is receive-only; loss is tolerable | Edit receive on TG: log that an edit event was missed. |
| **Declare incapable** | Consumer should check `capabilities` first | Receipts on TG: `canReceiveReadReceipts: false` — callers must check. |
| **Emit partial event** | Half the data is available | Forward receive on TG: emit event with `isForwarded: true` but no origin details. |

General principle: **never error on a missing capability**. Degrade gracefully, log at `debug` level,
and let the capabilities flags be the contract consumers check.

---

## 10. Library Constraints & Blockers

### Telegram Bot API limitations (grammy)

These are **permanent platform constraints** — Telegram's Bot API does not expose them, regardless of library version.

| Constraint | Impact |
|------------|--------|
| No delivery receipts for bots | `canReceiveDeliveryReceipts` permanently `false` |
| No read receipts for bots | `canReceiveReadReceipts` permanently `false` |
| Bots can't mark messages as read | No outbound "mark read" capability |
| Bots don't receive typing events | No inbound typing indicator |
| Bots can't see message deletions | No inbound delete events |
| Bots can't create groups | Group creation is user-only |
| Bots can't update own profile programmatically | Profile changes via BotFather only |
| Bots don't have a contact list | No contacts sync possible |
| Custom emoji reactions are premium-only | Send works for premium users; not universally available |

### Baileys (WhatsApp Web) limitations

| Constraint | Impact |
|------------|--------|
| No interactive buttons (lists, buttons, templates) | Requires WhatsApp Cloud API; Baileys uses the Web protocol which blocks these for non-business accounts |
| No thread/topic concept | WhatsApp doesn't have forum-style threads; `canHandleThreads` is permanently `false` |
| No slash commands | WhatsApp has no command registration mechanism |
| Broadcast list support is partial | Baileys exposes broadcast JIDs but sending is unreliable; newsletters are a separate API |
| Custom emoji reactions not supported | WhatsApp restricts reactions to standard Unicode emoji |
| Rate limits ≈ human hand speed | Baileys mimics the WhatsApp Web client; sending too fast triggers rate limits and temporary bans. Use `humanDelay()` (default 1.5–3.5 s) and `simulateTyping()` (text-length-scaled) to stay safe. Both are configurable via `WHATSAPP_*` env vars. This is **not** API throughput — it's anti-automation detection. |
| Session stability | Baileys uses a reverse-engineered protocol; connection can drop. Exponential backoff + `seedAuthenticated()` required. |

---

## 11. Rate Limit Notes

| Channel | Model | Details |
|---------|-------|---------|
| **Telegram** | API throughput | Bot API allows ~30 msg/s globally, ~1 msg/s per chat in groups. grammy handles 429 retries automatically. |
| **WhatsApp** | Human hand speed | Baileys ≈ web client; rate is limited by anti-bot detection, not an API quota. `humanDelay()` defaults to 1.5–3.5 s between actions. `simulateTyping()` scales delay to message length. Outbound timing and rate-limit backoff are configurable via `WHATSAPP_*` env vars. Sending too fast → temp ban (24 h in severe cases). |

---

## 12. Summary

### Totals

| Category | Count |
|----------|------:|
| **Match** (both channels implement) | 20 |
| **Degrade** (one side missing, fixable) | 16 |
| **Blocked** (library/platform limitation) | 12 |
| **Out-of-scope** (not applicable to one/both) | 8 |

### Matches (no work needed)

Text, media send/receive (image, audio, video, document), reactions (send/receive/remove),
typing (outbound), edit message (outbound), delete message (outbound), reply-to-message,
markdown conversion, smart splitting, sticker receive, contact receive, location receive,
forward receive, group message handling, DMs.

### Degraded (fixable — implementation work)

| # | Feature | Blocking channel | Effort |
|---|---------|------------------|--------|
| 1 | Response streaming | WhatsApp | L — needs `WhatsAppStreamSender` |
| 2 | Sticker send | Telegram | S — add `dispatchMedia` case |
| 3 | Contact card send | Telegram | S — add `dispatchContent` case |
| 4 | Location send | Telegram | S — add `dispatchContent` case |
| 5 | Forward message send | Telegram | S — add `forwardMessage()` |
| 6 | Poll send | Telegram | S — add `sendPoll()` |
| 7 | Poll receive | Telegram | S — add to `allowed_updates` |
| 8 | Inline buttons / callback | Telegram | M — `InlineKeyboard` + handler |
| 9 | Button response receive | Telegram | M — `callback_query` handler |
| 10 | Slash commands | Telegram | S — `setMyCommands()` |
| 11 | Broadcast receive | Telegram | S — add `channel_post` to `allowed_updates` |
| 12 | Forum topics / threads | Telegram | M — `message_thread_id` support |
| 13 | Edit message receive | Telegram | S — add `edited_message` to `allowed_updates` |
| 14 | Media download to disk | Telegram | S — `getFile()` + download |
| 15 | Group invite link | Telegram | S — `exportChatInviteLink()` |
| 16 | WA groups declared flag | WhatsApp | S — flip `canHandleGroups` to `true` |

### Blocked (cannot fix in Omni)

Delivery receipts (TG), read receipts (TG), mark-as-read (TG), inbound typing (TG),
inbound delete (TG), group creation (TG), profile update (TG), contacts sync (TG),
custom emoji reactions (both), interactive buttons (WA/Baileys), threads (WA),
slash commands (WA).

---

## 13. Follow-up Wishes

**8 implementation tasks** created from this audit, prioritized by impact:

| # | Slug | Complexity | Priority | Description |
|---|------|------------|----------|-------------|
| 1 | [parity-streaming](../../.genie/wishes/parity-streaming/wish.md) | L | 🔴 HIGH | WhatsApp StreamSender (progressive edits) — biggest UX gap |
| 2 | [parity-reactions](../../.genie/wishes/parity-reactions/wish.md) | S | ✅ SHIPPED | Wire WhatsApp reaction send through plugin |
| 3 | [parity-identity](../../.genie/wishes/parity-identity/wish.md) | S | ✅ SHIPPED | Wire Telegram contact/location/sticker/forward send |
| 4 | [parity-media](../../.genie/wishes/parity-media/wish.md) | M | 🟡 READY | Telegram sticker send + media download to disk |
| 5 | [parity-groups](../../.genie/wishes/parity-groups/wish.md) | M | 🟡 READY | Flip WhatsApp canHandleGroups + wire Telegram threads/broadcast |
| 6 | [parity-interactive-ui](../../.genie/wishes/parity-interactive-ui/wish.md) | M | 🟡 READY | Telegram buttons/polls/slash commands |
| 7 | [parity-receipts](../../.genie/wishes/parity-receipts/wish.md) | M | 🟢 BLOCKED | Canonical receipt events (mostly library-blocked) |
| 8 | [baileys-resilience](../../.genie/wishes/baileys-resilience/wish.md) | L | 🟢 STRATEGIC | Version pinning + abstraction layer |

### Execution Recommendations

**Quick wins (ship first):**
- ✅ parity-reactions (SHIPPED)
- ✅ parity-identity (SHIPPED)
- ✅ parity-streaming (SHIPPED)
- parity-groups (M) — mostly capability flips + event wiring
- parity-media (M) — sticker send is trivial, download is ~2hr

**Biggest impact (prioritize next):**
- parity-interactive-ui (M) — unlocks agent automation with buttons/polls
- parity-groups (M) — threads enable multi-topic bots

**Strategic (schedule later):**
- baileys-resilience (L) — insulates from library churn
- parity-receipts (M) — mostly blocked until libraries ship receipt events

### Dependency Graph

```
parity-streaming → (none)
parity-reactions → (none)
parity-identity → (none)
parity-media → (none)
parity-groups → (none)
parity-interactive-ui → (none — but benefits from parity-groups for forum polls)
parity-receipts → (blocked by library support)
baileys-resilience → (should run before breaking changes, no hard dependency)
```

All wishes are **independent** — can be executed in parallel or any order.
