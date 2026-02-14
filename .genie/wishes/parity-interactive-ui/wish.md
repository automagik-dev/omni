# Wish: Interactive UI Parity (Buttons, Polls, Callbacks)

**Status:** READY  
**Slug:** parity-interactive-ui  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** M  

---

## Problem

Telegram has rich interactive UI capabilities (inline buttons, callback queries, polls, slash commands) — all declared in capabilities but none actually wired:

- `canSendButtons: true` — no `InlineKeyboard` usage, no callback_query handler
- `canSendPoll: true` — no `sendPoll()` function, no `'poll'` case in `dispatchContent()`
- `canUseSlashCommands: true` — no `bot.command()` handlers, no `setMyCommands()` setup
- `allowed_updates` includes `callback_query` but no handler processes it
- `allowed_updates` doesn't include `poll` or `poll_answer`

WhatsApp has poll send/receive fully implemented (`buildPoll` in builders, poll extractors in handlers). WhatsApp inline buttons are library-blocked (requires Cloud API, Baileys can't send interactive buttons).

This means agents and automations can't use any interactive UI on Telegram despite it being the channel best suited for it, while WhatsApp's poll support works but has no Telegram equivalent.

## Audit Evidence

- **Telegram inline buttons:** `canSendButtons: true`. No `InlineKeyboard` in codebase. `callback_query` in `allowed_updates` but no handler. **Gap: not-yet-implemented.** grammy has full `InlineKeyboard` builder + `bot.callbackQuery()`.
- **Telegram polls:** `canSendPoll: true`. No `sendPoll()` or `'poll'` dispatch case. `poll`/`poll_answer` not in `allowed_updates`. **Gap: not-yet-implemented.** grammy has `bot.api.sendPoll()`.
- **Telegram slash commands:** `canUseSlashCommands: true`. No `bot.command()` or `setMyCommands()`. **Gap: not-yet-implemented.**
- **WhatsApp polls:** Fully implemented — `buildPoll` in `senders/builders.ts`, poll extractors in `handlers/messages.ts`.
- **WhatsApp buttons:** Library-blocked — Baileys can't send interactive button messages (requires WhatsApp Cloud API).
- **WhatsApp button responses:** `templateButtonReplyMessage`, `listResponseMessage`, `buttonsResponseMessage` extractors exist in handlers.

## Scope

### IN

- [ ] Implement Telegram inline button send: `InlineKeyboard` builder, wire through `dispatchContent()` or dedicated `sendButtons()` method
- [ ] Implement Telegram `callback_query` handler: receive button clicks, emit canonical `message.button_click` event
- [ ] Answer callback queries (`bot.api.answerCallbackQuery()`) to dismiss loading state
- [ ] Implement Telegram poll send: `bot.api.sendPoll()`, wire through `dispatchContent()`
- [ ] Add `poll` and `poll_answer` to Telegram `allowed_updates`
- [ ] Implement Telegram poll receive: handler for poll creation events and poll answer events
- [ ] Implement Telegram slash command registration: `bot.api.setMyCommands()` at startup, configurable per instance
- [ ] Define canonical interactive UI event types in core: `message.poll`, `message.poll_vote`, `message.button_click`

### OUT

- WhatsApp inline buttons (library-blocked — requires Cloud API)
- WhatsApp list messages (library-blocked — template-only for business)
- Telegram select menu / dropdown (lower priority, can follow later)
- Bot menu button customization
- Interactive message editing (update buttons after click) — follow-up
- Rich media cards / carousels

## Acceptance Criteria

- [ ] Sending inline buttons via Telegram API renders clickable buttons in client
- [ ] Clicking a Telegram inline button triggers `callback_query` → canonical event emitted
- [ ] Callback queries are answered (no perpetual loading spinner on button)
- [ ] Sending a poll via Telegram API renders a voteable poll in client
- [ ] Poll votes received and emitted as canonical events
- [ ] Slash commands registered at bot startup and visible in Telegram command menu
- [ ] `canSendButtons`, `canSendPoll`, `canUseSlashCommands` no longer lie — all backed by implementation
- [ ] WhatsApp poll send/receive still works (no regression)
- [ ] Canonical event schemas documented in core

## Library Blockers

- **WhatsApp inline buttons:** Baileys cannot send interactive button messages. This requires the WhatsApp Cloud API (official Business API), not the web-based protocol Baileys uses. **No workaround with current library.**
- **WhatsApp list messages:** Same limitation — requires Cloud API for list/template messages.
