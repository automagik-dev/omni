# Channel Parity Audit: Telegram ↔ WhatsApp

> Audited: 2026-02-13 by Group A  
> Scope: Every feature in both plugins, classified with file-level evidence  

## Legend

| Status | Meaning |
|--------|---------|
| ✅ implemented | Full send + receive wired through plugin |
| 📤 sender-only | Outbound send exists, no inbound handler |
| 📥 handler-only | Inbound handler exists, no outbound send |
| 🏷️ declared-but-not-wired | Capability declared `true`, but no implementation backing it |
| ❌ missing | Not declared, not implemented |

Gap classification:
- **library-blocked** — The underlying library (grammy / Baileys) cannot do it
- **not-yet-implemented** — Library supports it, we just haven't built it

---

## 1. Streaming / UX

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Response streaming (progressive edits)** | ✅ implemented | ❌ missing | TG: `TelegramStreamSender` in `senders/stream.ts`, implements `StreamSender` interface. Throttled edits with thinking blockquotes. WA: No `createStreamSender()`, no `canStreamResponse` in capabilities. **Gap: not-yet-implemented** — Baileys supports `sendMessage` + `editMessage`, so progressive edits are possible. |
| **Typing indicator (outbound)** | ✅ implemented | ✅ implemented | TG: `sendTyping()` in `plugin.ts` → `bot.api.sendChatAction('typing')`. WA: `sendTyping()` in `plugin.ts` → `sock.sendPresenceUpdate('composing')` with auto-pause. WA also has `simulateTyping()` with text-length-scaled duration. |
| **Typing indicator (inbound)** | ❌ missing | 📥 handler-only | TG: Not listening for typing events (grammy doesn't expose them for bots — **library-blocked**, Telegram Bot API limitation). WA: `presence.update` handler in `all-events.ts` → `handlePresenceUpdate()`, but handler is a TODO stub (`plugin.ts:1804`). **Gap: not-yet-implemented** (event fires, just not emitted). |
| **Markdown→native format conversion** | ✅ implemented | ✅ implemented | TG: `markdownToTelegramHtml()` in `senders/text.ts`, uses HTML parse_mode. WA: `markdownToWhatsApp()` in `senders/builders.ts` and `plugin.ts`. Both respect `messageFormatMode: 'convert' | 'passthrough'`. |
| **Smart message splitting** | ✅ implemented | ✅ implemented | TG: `splitHtmlMessage()` / `splitMessage()` in `senders/text.ts`. WA: `splitWhatsAppMessage()` in `senders/text.ts`. Both chunk at `maxMessageLength`. |
| **Human delay / anti-bot** | ❌ missing | ✅ implemented | WA: `humanDelay()` in `plugin.ts` — randomized 1.5–3.5s between outgoing actions. TG: Not needed (bots are expected to be bots on Telegram). |

---

## 2. Receipts (Read / Delivery)

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Delivery receipts (inbound)** | ❌ missing | ✅ implemented | TG: `canReceiveDeliveryReceipts: false` in capabilities. Telegram Bot API does not provide delivery receipts — **library-blocked**. WA: `messages.update` handler in `handlers/messages.ts` (`processStatusUpdate`) + `handlers/status.ts` → `handleMessageDelivered()`. |
| **Read receipts (inbound)** | ❌ missing | ✅ implemented | TG: `canReceiveReadReceipts: false` in capabilities. Telegram Bot API does not expose read receipts to bots — **library-blocked**. WA: `messages.update` status ≥ 4 → `handleMessageRead()` in both `handlers/messages.ts` and `handlers/status.ts`. |
| **Mark as read (outbound)** | ❌ missing | ✅ implemented | TG: No API to mark messages as read for bots — **library-blocked**. WA: `markAsRead()` and `markChatAsRead()` in `plugin.ts` → `sock.readMessages()`. |

---

## 3. Reactions

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Reaction send (outbound)** | ✅ implemented | ✅ implemented | TG: `setReaction()` / `removeReaction()` in `senders/reaction.ts` → `bot.api.setMessageReaction()`. Dispatched via `dispatchReaction()` in `plugin.ts`. WA: `buildReactionContent()` in `senders/builders.ts` + `sendReaction()` / `removeReaction()` in `senders/reaction.ts`. |
| **Reaction receive (inbound)** | ✅ implemented | ✅ implemented | TG: `setupReactionHandlers()` in `handlers/reactions.ts` — diffs `old_reaction` vs `new_reaction`, calls `handleReactionAdd()` / `handleReactionRemove()`. WA: Two paths — (1) `reactionMessage` extractor in `handlers/messages.ts` → `handleSpecialMessage()`, (2) `messages.reaction` event in `setupMessageHandlers()`. Both → `handleReactionReceived()`. |
| **Reaction remove (outbound)** | ✅ implemented | ✅ implemented | TG: `removeReaction()` in `senders/reaction.ts` (empty array). WA: `removeReaction()` in `senders/reaction.ts` (empty string emoji). |
| **Custom emoji reactions** | 📤 sender-only | ❌ missing | TG: grammy types support `custom_emoji` type; handler detects `isCustomEmoji`. Sending is typed but Telegram limits custom emojis to premium users. WA: WhatsApp only supports standard Unicode emoji reactions — **library-blocked**. |

---

## 4. Media

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Image send** | ✅ implemented | ✅ implemented | TG: `sendPhoto()` in `senders/media.ts`. WA: `buildImageContent()` in `senders/media.ts` + `buildImage` in `senders/builders.ts`. Supports URL + base64. |
| **Image receive** | ✅ implemented | ✅ implemented | TG: `extractPhoto()` in `handlers/messages.ts` — picks largest `PhotoSize`. WA: `imageMessage` extractor in `handlers/messages.ts` + `tryDownloadMedia()` downloads to disk. |
| **Audio send** | ✅ implemented | ✅ implemented | TG: `sendAudio()` in `senders/media.ts`. WA: `buildAudioContent()` in `senders/media.ts` + `buildAudio` in `senders/builders.ts`. WA supports PTT (voice note) with OGG/OPUS conversion via `processAudioForVoiceNote()`. |
| **Audio receive** | ✅ implemented | ✅ implemented | TG: `extractMedia()` handles `audio` + `voice` in `handlers/messages.ts`. WA: `audioMessage` extractor in `handlers/messages.ts`. |
| **Voice note (PTT) send** | ❌ missing | ✅ implemented | TG: No PTT concept — Telegram sends voice as audio. **Not applicable** (Telegram voice messages are just audio). WA: `ptt: true` in audio builder, auto-converts to OGG/OPUS via ffmpeg. |
| **Video send** | ✅ implemented | ✅ implemented | TG: `sendVideo()` in `senders/media.ts`. WA: `buildVideoContent()` in `senders/media.ts` + `buildVideo` in `senders/builders.ts`. |
| **Video receive** | ✅ implemented | ✅ implemented | TG: `extractMedia()` handles `video` + `video_note` in `handlers/messages.ts`. WA: `videoMessage` extractor in `handlers/messages.ts`. |
| **Document send** | ✅ implemented | ✅ implemented | TG: `sendDocument()` in `senders/media.ts` with filename via `InputFile`. WA: `buildDocumentContent()` in `senders/media.ts` + `buildDocument` in `senders/builders.ts`. |
| **Document receive** | ✅ implemented | ✅ implemented | TG: `extractMedia()` handles `document` in `handlers/messages.ts`. WA: `documentMessage` extractor in `handlers/messages.ts`. |
| **Sticker send** | 🏷️ declared-but-not-wired | ✅ implemented | TG: `canSendSticker: true` in capabilities, sticker receive works in handler, but `dispatchMedia()` in `plugin.ts` has no `'sticker'` case — falls through to text fallback. **Gap: not-yet-implemented** — grammy has `bot.api.sendSticker()`. WA: `buildStickerContent()` in `senders/media.ts` + `buildSticker` in `senders/builders.ts`. |
| **Sticker receive** | ✅ implemented | ✅ implemented | TG: `extractMedia()` handles `sticker` in `handlers/messages.ts` (animated + webp). WA: `stickerMessage` extractor in `handlers/messages.ts`. |
| **Media download to disk** | ❌ missing | ✅ implemented | TG: Passes `file_id` as `mediaUrl` — no download to local storage. Media served via Telegram API `getFile`. **Gap: not-yet-implemented** — grammy supports `bot.api.getFile()` + download. WA: `tryDownloadMedia()` in `handlers/messages.ts` — downloads to `data/media/{instance}/{YYYY-MM}/`. |

---

## 5. Groups / Threads

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Group message handling** | ✅ implemented | ✅ implemented (de facto) | TG: `canHandleGroups: true`. Handler detects `chat.type === 'group' | 'supergroup'` in `handlers/messages.ts`, sets `isGroup` in rawPayload. WA: `canHandleGroups: false` (declared deferred), but group messages ARE processed — `handlers/messages.ts` processes `@g.us` JIDs, resolves `msg.key.participant` for sender. Groups work de facto, just not declared. |
| **Group metadata caching** | ❌ missing | ✅ implemented | TG: Chat title extracted from `msg.chat.title` inline but not cached. WA: `handleGroupsUpsert()` / `handleGroupsUpdate()` in `plugin.ts` — caches subject/desc per group. `enrichPayloadWithChatName()` uses cache. |
| **Group creation** | ❌ missing | ✅ implemented | TG: No `groupCreate()` method. grammy supports `bot.api.createChatInviteLink()` but not group creation (bots can't create groups) — **library-blocked**. WA: `groupCreate()` in `plugin.ts` → `sock.groupCreate()`. |
| **Group invite link** | ❌ missing | ✅ implemented | TG: Not implemented. grammy has `bot.api.exportChatInviteLink()` — **not-yet-implemented**. WA: `getGroupInviteCode()`, `revokeGroupInvite()`, `joinGroup()` in `plugin.ts`. |
| **Group participant management** | ❌ missing | 📥 handler-only | TG: Not implemented. grammy supports `banChatMember`, `restrictChatMember` — **not-yet-implemented**. WA: `group-participants.update` handler in `all-events.ts` → `handleGroupParticipantsUpdate()` (TODO stub). |
| **Forum topics / Threads** | 🏷️ declared-but-not-wired | ❌ missing | TG: `canHandleThreads: true` in capabilities, but no `message_thread_id` handling in senders or handlers. **Gap: not-yet-implemented** — grammy supports topic IDs. WA: No thread support (WhatsApp doesn't have threads) — **library-blocked**. |
| **Broadcast / Channel posts** | 🏷️ declared-but-not-wired | ❌ missing | TG: `canHandleBroadcast: true`, but `allowed_updates` doesn't include `'channel_post'` — broadcasts are not received. **Gap: not-yet-implemented** — grammy supports `channel_post`. WA: `canHandleBroadcast: false` (deferred). WhatsApp broadcasts exist but are limited in Baileys — partially **library-blocked** (newsletters are separate from broadcast lists). |

---

## 6. Interactive UI (Buttons / Polls)

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Poll send** | 🏷️ declared-but-not-wired | ✅ implemented | TG: `canSendPoll: true` in capabilities, but no `sendPoll()` function or `'poll'` case in `dispatchContent()`. **Gap: not-yet-implemented** — grammy has `bot.api.sendPoll()`. WA: `buildPoll` in `senders/builders.ts` — uses Baileys poll format `{ poll: { name, values, selectableCount } }`. |
| **Poll receive** | ❌ missing | ✅ implemented | TG: `allowed_updates` doesn't include `'poll'` or `'poll_answer'` — not received. **Gap: not-yet-implemented** — grammy supports poll events. WA: `pollCreationMessage` / `pollCreationMessageV3` extractors + `pollUpdateMessage` extractor in `handlers/messages.ts`. |
| **Inline buttons send** | 🏷️ declared-but-not-wired | ❌ missing | TG: `canSendButtons: true` in capabilities, but no `InlineKeyboard` usage or callback_query processing in sendMessage flow. `allowed_updates` includes `'callback_query'` but no handler exists. **Gap: not-yet-implemented** — grammy has full inline keyboard support. WA: `canSendButtons` not declared. WhatsApp button messages are restricted to approved templates for business accounts — **library-blocked** (Baileys can't send interactive buttons without Cloud API). |
| **Button response receive** | ❌ missing | ✅ implemented | TG: No `callback_query` handler wired. **Gap: not-yet-implemented**. WA: `templateButtonReplyMessage`, `listResponseMessage`, `buttonsResponseMessage` extractors in `handlers/messages.ts`. |
| **Slash commands** | 🏷️ declared-but-not-wired | ❌ missing | TG: `canUseSlashCommands: true`, but no `bot.command()` handlers or `setMyCommands()` setup. Messages starting with `/` are treated as text. **Gap: not-yet-implemented**. WA: No slash command concept — **library-blocked**. |
| **Select menu / List** | ❌ missing | ❌ missing | TG: `canSendSelectMenu: false`. No implementation. grammy supports inline keyboards with dropdowns — **not-yet-implemented**. WA: Not declared. WhatsApp lists are template-only for business — **library-blocked**. |

---

## 7. Identity / Profile / Contacts

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Contact card send** | 🏷️ declared-but-not-wired | ✅ implemented | TG: `canSendContact: true` in capabilities, but no `'contact'` case in `dispatchContent()`. **Gap: not-yet-implemented** — grammy has `bot.api.sendContact()`. WA: `buildContactContent()` / `buildMultiContactContent()` in `senders/contact.ts` + `buildContact` in `senders/builders.ts`. Full vCard generation with phone, email, org. |
| **Contact card receive** | ✅ implemented | ✅ implemented | TG: `extractSpecial()` handles `msg.contact` in `handlers/messages.ts`. WA: `contactMessage` extractor in `handlers/messages.ts` — extracts `displayName` + phone from vCard. |
| **Location send** | 🏷️ declared-but-not-wired | ✅ implemented | TG: `canSendLocation: true` in capabilities, but no `'location'` case in `dispatchContent()`. **Gap: not-yet-implemented** — grammy has `bot.api.sendLocation()`. WA: `buildLocationContent()` in `senders/location.ts` + `buildLocation` in `senders/builders.ts`. |
| **Location receive** | ✅ implemented | ✅ implemented | TG: `extractSpecial()` handles `msg.location` in `handlers/messages.ts`. WA: `locationMessage` + `liveLocationMessage` extractors in `handlers/messages.ts`. |
| **Profile sync (own)** | ❌ missing | ✅ implemented | TG: Bot info available via `bot.botInfo` at connect, but no `getProfile()` method. **Gap: not-yet-implemented**. WA: `getProfile()` in `plugin.ts` — fetches name, avatar, bio, phone, business info. |
| **Profile update** | ❌ missing | ✅ implemented | TG: Bots can't change their profile programmatically (except via BotFather) — **library-blocked**. WA: `updateProfileName()`, `updateBio()`, `updateProfilePicture()`, `removeProfilePicture()` in `plugin.ts`. |
| **Contact/user profile fetch** | ❌ missing | ✅ implemented | TG: Not implemented. grammy can get user info via `getChat()` — **not-yet-implemented**. WA: `fetchUserProfile()` in `plugin.ts` — fetches avatar, bio, phone, business data. |
| **Contacts sync** | ❌ missing | ✅ implemented | TG: Not applicable — Telegram bots don't have a contact list. **library-blocked**. WA: `fetchContacts()` in `plugin.ts` + `handleContactsUpsert()` / `handleContactsUpdate()` + contacts cache. Includes LID→phone mapping. |
| **Forward message send** | 🏷️ declared-but-not-wired | ✅ implemented | TG: `canForwardMessage: true` in capabilities, but no `forwardMessage()` method in plugin or senders. **Gap: not-yet-implemented** — grammy has `bot.api.forwardMessage()`. WA: `forwardMessage()` in `senders/forward.ts` + `buildText` in `senders/builders.ts` handles `metadata.forward`. |
| **Forward message receive** | ✅ implemented (partial) | ✅ implemented | TG: `isForwarded: !!msg.forward_origin` set in rawPayload. Forward origin details not fully extracted. WA: Forwarded messages appear as normal messages (WhatsApp doesn't expose forward metadata in the same way). |

---

## 8. Message Lifecycle (Edit / Delete)

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Edit message (outbound)** | ✅ implemented | ✅ implemented | TG: `editTextMessage()` in `senders/text.ts` → `bot.api.editMessageText()`. Used by stream sender for progressive edits. WA: `editMessage()` in `plugin.ts` → `sock.sendMessage()` with `edit` key. |
| **Edit message (inbound)** | ❌ missing | ✅ implemented | TG: `allowed_updates` does NOT include `'edited_message'` — edits are never received. **Gap: not-yet-implemented** — grammy supports `bot.on('edited_message')`. WA: `protocolMessage` type 14 extractor + `messages.update` handler in `handlers/messages.ts` → `handleMessageEdited()`. |
| **Delete message (outbound)** | ✅ implemented | ✅ implemented | TG: `deleteMessage()` in `senders/text.ts` → `bot.api.deleteMessage()`. WA: `deleteMessage()` in `plugin.ts` → sends protocol delete message. |
| **Delete message (inbound)** | ❌ missing | ✅ implemented | TG: `allowed_updates` doesn't cover deletion events. grammy doesn't expose message deletion events for bots — **library-blocked** (Telegram doesn't notify bots of deletions). WA: `protocolMessage` type 0 extractor + `messages.delete` handler in `handlers/messages.ts` → `handleMessageDeleted()`. |

---

## 9. Connection / Lifecycle

| Feature | Telegram | WhatsApp | Notes |
|---------|----------|----------|-------|
| **Polling mode** | ✅ implemented | N/A | TG: `startPolling()` in `plugin.ts` with `drop_pending_updates: true`. |
| **Webhook mode** | 🏷️ declared-but-not-wired | N/A | TG: `startWebhook()` throws `Error('Webhook mode is not yet supported')`. **Gap: not-yet-implemented** — grammy fully supports webhooks. |
| **QR code auth** | N/A | ✅ implemented | WA: Full QR code flow with `handleQrCode()`, `clearAuthState()`, retry logic. |
| **Pairing code auth** | N/A | ✅ implemented | WA: `requestPairingCode()` in `plugin.ts`. |
| **Auto-reconnection** | ✅ implemented (via grammy) | ✅ implemented | TG: grammy handles polling reconnection with backoff. WA: `setupConnectionHandlers()` with exponential backoff + `seedAuthenticated()` for PM2 restarts. |
| **Health checks** | ✅ implemented | ❌ missing | TG: `getHealthChecks()` override — calls `bot.api.getMe()`. WA: No health check override — uses base class only. **Gap: not-yet-implemented**. |
| **History sync** | N/A | ✅ implemented | WA: Full `fetchHistory()` with anchored pagination, `handleHistorySync()`, recursive depth. |
| **Bot echo detection** | ❌ missing | ✅ implemented | TG: Bots skip messages from `from.is_bot`, but no self-echo detection needed (Telegram doesn't echo). WA: `trackSentMessageId()` / `isBotSentMessage()` in `plugin.ts` — prevents infinite reply loops. |

---

## 10. WhatsApp-Only Features (no Telegram equivalent)

| Feature | Status | Notes |
|---------|--------|-------|
| **Disappearing messages** | ✅ implemented | `setDisappearing()` in `plugin.ts`. Telegram has auto-delete but no bot API — **library-blocked**. |
| **Star messages** | ✅ implemented | `starMessage()` in `plugin.ts`. Telegram has no equivalent — **library-blocked**. |
| **Block/unblock contacts** | ✅ implemented | `blockContact()`, `unblockContact()`, `fetchBlocklist()` in `plugin.ts`. TG bots can't block — **library-blocked**. |
| **Check number registration** | ✅ implemented | `checkNumber()` in `plugin.ts` → `sock.onWhatsApp()`. TG has no equivalent. |
| **Chat modify (archive/pin/mute)** | ✅ implemented | `chatModifyAction()` in `plugin.ts`. TG bots can't manage their chat list — **library-blocked**. |
| **Privacy settings** | ✅ implemented | `fetchPrivacySettings()` in `plugin.ts`. No TG equivalent for bots. |
| **Call rejection** | ✅ implemented | `rejectCall()` in `plugin.ts`. TG has no voice call API for bots — **library-blocked**. |
| **Business profile** | ✅ implemented | `getBusinessProfile()` used in `getProfile()` / `fetchUserProfile()`. TG has no equivalent. |
| **LID→phone JID mapping** | ✅ implemented | Full LID resolution pipeline: cache, `remoteJidAlt`, `lid-mapping.update` events. WhatsApp-specific addressing. |
| **Group operations** | ✅ implemented | `groupCreate()`, `getGroupInviteCode()`, `revokeGroupInvite()`, `joinGroup()`, `updateGroupPicture()`, `fetchGroups()`. |

---

## Summary: Gap Counts

### Telegram gaps (features declared/expected but not wired)

| Gap | Classification | Effort |
|-----|---------------|--------|
| Sticker send | not-yet-implemented | S — add `'sticker'` case to `dispatchMedia()` + `bot.api.sendSticker()` |
| Contact card send | not-yet-implemented | S — add `'contact'` case to `dispatchContent()` + `bot.api.sendContact()` |
| Location send | not-yet-implemented | S — add `'location'` case to `dispatchContent()` + `bot.api.sendLocation()` |
| Forward message send | not-yet-implemented | S — add `forwardMessage()` + `bot.api.forwardMessage()` |
| Poll send | not-yet-implemented | S — add `'poll'` case + `bot.api.sendPoll()` |
| Poll receive | not-yet-implemented | S — add `'poll'` + `'poll_answer'` to `allowed_updates`, add handler |
| Inline buttons send | not-yet-implemented | M — InlineKeyboard builder + callback_query handler |
| Button/callback response receive | not-yet-implemented | M — `callback_query` handler |
| Slash commands registration | not-yet-implemented | S — `bot.api.setMyCommands()` |
| Edit message receive | not-yet-implemented | S — add `'edited_message'` to `allowed_updates`, add handler |
| Broadcast/channel post receive | not-yet-implemented | S — add `'channel_post'` to `allowed_updates` |
| Forum topics (threads) | not-yet-implemented | M — thread_id support in send/receive |
| Webhook mode | not-yet-implemented | M — HTTP handler for incoming updates |
| Media download to disk | not-yet-implemented | S — `bot.api.getFile()` + download |

### WhatsApp gaps

| Gap | Classification | Effort |
|-----|---------------|--------|
| Response streaming | not-yet-implemented | L — Need `WhatsAppStreamSender` implementing `StreamSender` interface, using edit-message for progressive updates |
| Inline buttons send | library-blocked | N/A — Baileys can't send interactive buttons (requires Cloud API) |
| Threads | library-blocked | N/A — WhatsApp doesn't have threads |
| Health check override | not-yet-implemented | S — check socket state + test send |
| Presence event emission | not-yet-implemented | S — handler fires, just needs event bus publication |
| Groups declared as supported | not-yet-implemented | S — change `canHandleGroups: false` → `true` (already works de facto) |

### Truly library-blocked (cannot be fixed on our side)

| Feature | Telegram | WhatsApp |
|---------|----------|----------|
| Delivery receipts (inbound) | ❌ Bot API doesn't provide | ✅ |
| Read receipts (inbound) | ❌ Bot API doesn't provide | ✅ |
| Mark as read (outbound) | ❌ Bots can't mark read | ✅ |
| Typing indicator (inbound) | ❌ Bots don't receive typing | Partially implemented |
| Delete message (inbound) | ❌ Bots not notified of deletions | ✅ |
| Profile update (programmatic) | ❌ Only via BotFather | ✅ |
| Contacts sync | ❌ Bots don't have contact lists | ✅ |
| Group creation | ❌ Bots can't create groups | ✅ |
| Custom emoji reactions | Premium-only limitation | ❌ Unicode-only |
| Inline buttons send | ✅ (not-yet-impl) | ❌ Requires Cloud API |
| Threads / forum topics | ✅ (not-yet-impl) | ❌ No WhatsApp threads |
