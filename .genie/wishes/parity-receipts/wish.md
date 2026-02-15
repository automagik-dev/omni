# Wish: Receipt Normalization

**Status:** READY  
**Slug:** parity-receipts  
**Created:** 2026-02-13  
**Depends on:** channel-parity-telegram-whatsapp  
**Complexity:** M  

---

## Problem

Receipt handling (delivery, read, mark-as-read) is inconsistent across channels. WhatsApp has robust receipt support through multiple handlers (`processStatusUpdate`, `handleMessageDelivered`, `handleMessageRead`, `markAsRead`), but the events are emitted through two overlapping paths (`handlers/messages.ts` and `handlers/status.ts`) with no canonical event schema. Telegram receipts are fully library-blocked (Bot API doesn't expose delivery/read receipts to bots), but we have no canonical "receipt" event type to normalize what WhatsApp provides — or what future channels may support.

The lack of a normalized receipt event means consumers (AI agents, dashboards, automations) must understand per-channel receipt semantics instead of subscribing to a single canonical event.

## Audit Evidence

- **WhatsApp delivery receipts:** `messages.update` handler in `handlers/messages.ts` → `processStatusUpdate()` + `handlers/status.ts` → `handleMessageDelivered()`. Two code paths for the same concept.
- **WhatsApp read receipts:** `messages.update` status ≥ 4 → `handleMessageRead()` in both `handlers/messages.ts` and `handlers/status.ts`.
- **WhatsApp mark-as-read:** `markAsRead()` and `markChatAsRead()` in `plugin.ts` → `sock.readMessages()`.
- **Telegram:** `canReceiveDeliveryReceipts: false`, `canReceiveReadReceipts: false`. Bot API does not provide these — **library-blocked**. No mark-as-read API for bots.
- **WhatsApp presence (typing inbound):** `presence.update` fires but handler at `plugin.ts:1804` is a TODO stub.

## Scope

### IN

- [ ] Define canonical receipt event types in `packages/core`: `message.delivered`, `message.read`, `message.sent` (ack levels)
- [ ] Consolidate WhatsApp's dual receipt paths (`handlers/messages.ts` + `handlers/status.ts`) into a single canonical flow
- [ ] Emit normalized receipt events to the event bus (NATS)
- [ ] Wire the WhatsApp presence/typing inbound handler (currently a TODO stub) to emit `contact.typing` events
- [ ] Document receipt capabilities per channel in plugin metadata (which receipt types each channel can provide)
- [ ] Add `markAsRead()` to the base plugin interface as an optional method
- [ ] Ensure WhatsApp `markAsRead` is accessible via API (if not already)

### OUT

- Telegram receipt support (library-blocked — Bot API limitation, nothing we can do)
- UI/dashboard for receipt visualization (separate concern)
- End-to-end encryption receipt verification
- Changing WhatsApp's underlying receipt mechanics

## Acceptance Criteria

- [ ] Canonical receipt event schemas exist in `packages/core/src/events/`
- [ ] WhatsApp emits `message.delivered` and `message.read` events through a single consolidated handler
- [ ] No duplicate receipt events from the two current WhatsApp paths
- [ ] `contact.typing` event emitted when WhatsApp presence update fires
- [ ] `markAsRead()` available in base plugin interface (optional, throws if unsupported)
- [ ] Telegram plugin correctly reports `canReceiveDeliveryReceipts: false` / `canReceiveReadReceipts: false` (no false promises)
- [ ] Receipt events include: `messageId`, `chatId`, `instanceId`, `timestamp`, `receiptType`, `participantId` (for groups)

## Library Blockers

- **Telegram Bot API:** Delivery and read receipts are not exposed to bots. This is a Telegram platform limitation, not a grammy limitation. No workaround exists. Telegram will always report `canReceiveDeliveryReceipts: false`.
- **Telegram mark-as-read:** Bots cannot mark messages as read. Library-blocked.
