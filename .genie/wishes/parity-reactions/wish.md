# Wish: Reaction Parity & Translation

**Status:** DONE  
**Slug:** parity-reactions  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** S  

---

## Problem

WhatsApp has a complete reaction sender (`buildReactionContent` in `senders/builders.ts`, `sendReaction()` / `removeReaction()` in `senders/reaction.ts`), but it's not wired through the plugin's `sendMessage()` dispatch path. The sender code exists but can't be triggered via the standard outgoing message API. Meanwhile, reaction *receiving* works on both channels, and Telegram's reaction *sending* is fully wired through `dispatchReaction()`.

Additionally, there's no cross-channel reaction translation layer. Telegram supports custom emoji reactions (premium-only), WhatsApp only supports standard Unicode emoji. When an agent or automation wants to react to a message, it shouldn't need to know which channel it's targeting — the system should translate or reject gracefully.

## Audit Evidence

- **Telegram reactions:** Fully implemented — `setReaction()` / `removeReaction()` in `senders/reaction.ts`, dispatched via `dispatchReaction()` in `plugin.ts`. Receive: `setupReactionHandlers()` in `handlers/reactions.ts` with diff logic.
- **WhatsApp reaction send:** `buildReactionContent()` in `senders/builders.ts` + `sendReaction()` / `removeReaction()` in `senders/reaction.ts` — **code exists but not wired through `plugin.sendMessage()`**.
- **WhatsApp reaction receive:** Two paths — (1) `reactionMessage` extractor in `handlers/messages.ts`, (2) `messages.reaction` event in `setupMessageHandlers()`. Both → `handleReactionReceived()`.
- **Custom emoji:** Telegram supports `custom_emoji` type (premium); WhatsApp only supports Unicode emoji — **library-blocked**.

## Scope

### IN

- [ ] Wire WhatsApp `sendReaction()` through `plugin.sendMessage()` dispatch (add reaction case to outgoing message handling)
- [ ] Ensure WhatsApp `removeReaction()` is accessible via the same dispatch path
- [ ] Add reaction translation layer in core: map custom emoji → closest Unicode equivalent (best-effort)
- [ ] Reject unsupported reaction types gracefully (return error, don't crash)
- [ ] Verify both channels emit canonical `message.reaction.added` / `message.reaction.removed` events

### OUT

- Custom emoji rendering on WhatsApp (library-blocked — Unicode only)
- Reaction analytics or counting
- Reaction-triggered automations (separate feature)
- Changing Telegram's premium emoji restrictions

## Acceptance Criteria

- [ ] WhatsApp reactions can be sent via the standard outgoing message API (`plugin.sendMessage()` with reaction payload)
- [ ] WhatsApp reaction removal works via the same API path
- [ ] Sending a custom emoji reaction to WhatsApp returns a clear error (not a crash or silent failure)
- [ ] Both Telegram and WhatsApp emit the same canonical reaction event schema
- [ ] Reaction round-trip works: send reaction via API → visible in client → inbound event emitted

## Library Blockers

- **WhatsApp custom emoji:** WhatsApp only supports standard Unicode emoji for reactions. This is a WhatsApp platform limitation. No workaround.
