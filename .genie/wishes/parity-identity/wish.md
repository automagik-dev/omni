# Wish: Identity & Contact Parity

**Status:** READY  
**Slug:** parity-identity  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** S  

---

## Problem

Telegram has five outbound capabilities declared but not wired — all are simple "add a case to dispatch + call grammy API" fixes:

1. **Contact card send:** `canSendContact: true`, no `'contact'` case in `dispatchContent()`. grammy has `bot.api.sendContact()`.
2. **Location send:** `canSendLocation: true`, no `'location'` case in `dispatchContent()`. grammy has `bot.api.sendLocation()`.
3. **Forward message send:** `canForwardMessage: true`, no `forwardMessage()` method. grammy has `bot.api.forwardMessage()`.
4. **Profile fetch:** No `getProfile()` or user profile retrieval. grammy can get user info via `getChat()`.
5. **Edit message receive:** `allowed_updates` does NOT include `edited_message` — edits are silently dropped.

WhatsApp has all of these fully implemented (contact vCard generation, location with coordinates, forward with metadata, full profile fetch with avatar/bio/business info, edit receive via `protocolMessage` type 14).

These are small, isolated gaps that share a common pattern: declared capability → no implementation → straightforward grammy API call.

## Audit Evidence

- **Telegram contact send:** `canSendContact: true`. No `'contact'` case in `dispatchContent()`. grammy: `bot.api.sendContact(chatId, phoneNumber, firstName)`. **S effort.**
- **Telegram location send:** `canSendLocation: true`. No `'location'` case in `dispatchContent()`. grammy: `bot.api.sendLocation(chatId, latitude, longitude)`. **S effort.**
- **Telegram forward send:** `canForwardMessage: true`. No `forwardMessage()` method. grammy: `bot.api.forwardMessage(chatId, fromChatId, messageId)`. **S effort.**
- **Telegram profile fetch:** No `getProfile()`. grammy: `bot.api.getChat(chatId)` returns title, bio, photo. **S effort.**
- **Telegram edit receive:** `edited_message` not in `allowed_updates`. grammy: `bot.on('edited_message')`. **S effort.**
- **WhatsApp reference:** All five fully implemented — `buildContactContent()`, `buildLocationContent()`, `forwardMessage()`, `fetchUserProfile()`, edit handler via `protocolMessage` type 14.

## Scope

### IN

- [ ] Add `'contact'` case to Telegram `dispatchContent()` → `bot.api.sendContact()`
- [ ] Add `'location'` case to Telegram `dispatchContent()` → `bot.api.sendLocation()`
- [ ] Implement `forwardMessage()` in Telegram plugin → `bot.api.forwardMessage()`
- [ ] Implement `getProfile()` / `fetchUserProfile()` in Telegram plugin → `bot.api.getChat()` for avatar, bio, username
- [ ] Add `edited_message` to Telegram `allowed_updates`
- [ ] Wire `bot.on('edited_message')` handler to emit canonical `message.edited` event
- [ ] Ensure all five match the canonical event schemas used by WhatsApp

### OUT

- Telegram profile *update* (library-blocked — only via BotFather)
- Telegram contacts sync (library-blocked — bots don't have contact lists)
- WhatsApp identity improvements (already comprehensive)
- vCard generation for Telegram (Telegram uses structured contact fields, not vCards)
- Live location sharing (start with static location)

## Acceptance Criteria

- [ ] Sending a contact via Telegram API renders a contact card in the client
- [ ] Sending a location via Telegram API renders a map pin in the client
- [ ] Forwarding a message via Telegram API shows the forwarded message with attribution
- [ ] `fetchUserProfile()` returns avatar URL, display name, username, and bio for Telegram users
- [ ] Edited Telegram messages are received and emitted as `message.edited` events
- [ ] All five capabilities backed by real implementation (no more declared-but-not-wired)
- [ ] Canonical event schemas match WhatsApp equivalents

## Library Blockers

- **Telegram profile update:** Bots cannot change their own profile (name, avatar, bio) programmatically — only via BotFather. Library-blocked, not in scope.
- **Telegram contacts sync:** Bots don't have a contact list. Library-blocked, not in scope.
