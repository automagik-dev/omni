# Design: gupshup-channel-rewrite

**Status:** Ready for /wish
**Date:** 2026-04-13

---

## Problem

The existing `packages/channel-gupshup` targets the wrong API (Gupshup Partner API, old format).
The confirmed working integration uses Meta/WA Business API inbound format + Gupshup Custom Integration outbound.
The current plugin is a placeholder — full rewrite required.

---

## Scope

**IN:**
- Full rewrite of `packages/channel-gupshup` (types, client, plugin, webhook handler, senders, capabilities)
- All inbound message types: text, image, audio, video, document, sticker, location, contacts, interactive, button
- All status events: enqueued (ignore), sent, delivered, read, failed → emit omni events
- All outbound types via Custom Integration: TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER, LOCATION
- Connect-time credential validation via test POST
- Phone normalization for BR mobiles
- Rewrite/update existing test suite

**OUT:**
- Outbound interactive buttons (`canSendButtons: false`)
- Outbound contacts (`canSendContact: false`)
- Typing indicators (`canSendTyping: false`)
- Gupshup Partner API (mediaapi.smsgupshup.com) — not used
- billing-event / account_update — silently ignored (return 200)

---

## Instance Config

```typescript
interface GupshupConfig {
  gupshupCallbackUrl: string;       // required — Custom Integration callback URL
  gupshupAuthToken: string;         // required — Custom Integration auth token
  gupshupEventId?: string;          // optional — default: "nx_omni_agent_reply"
  webhookVerifyToken?: string;      // optional — if set, validate ?token= on inbound
}
```

---

## Inbound Webhook — Format

Meta/WA Business API format (NOT old Gupshup format):

```
entry[0].changes[0].field            → "messages" | "billing-event" | "account_update"
entry[0].changes[0].value.messages[] → inbound messages
entry[0].changes[0].value.statuses[] → delivery/read/failed receipts
entry[0].changes[0].value.contacts[] → sender profile (name, wa_id)
entry[0].gs_app_id                   → Gupshup app ID
entry[0].id                          → WA business account ID
```

### Message Types → Omni Events

| msg.type | Key fields | Omni event |
|----------|-----------|------------|
| `text` | `text.body` | `message.received` |
| `image` | `image.{url, mime_type, caption?, sha256}` | `message.received` |
| `audio` | `audio.{url, mime_type, voice}` | `message.received` |
| `video` | `video.{url, mime_type, caption?}` | `message.received` |
| `document` | `document.{url, mime_type, filename?, caption?}` | `message.received` |
| `sticker` | `sticker.{url, mime_type, animated}` | `message.received` |
| `location` | `location.{latitude, longitude, name?, address?}` | `message.received` |
| `contacts` | `contacts[].{name.formatted_name, phones[].phone}` | `message.received` |
| `interactive` | `interactive.button_reply.{id, title}` or `list_reply` | `message.received` |
| `button` | `button.{text, payload}` | `message.received` |

### Status Events → Omni Events

| status | Omni event |
|--------|-----------|
| `enqueued` | ignore |
| `sent` | ignore (omni already emits on successful send) |
| `delivered` | `message.delivered` |
| `read` | `message.read` |
| `failed` | `message.failed` |

Status fields: `id` (external message ID), `recipient_id` (destination phone), `timestamp`

---

## Outbound — Custom Integration Payload

Base payload (all types):
```json
{
  "customer_id": "<normalized_phone>",
  "user": { "phone": "<normalized_phone>" },
  "event_id": "<gupshupEventId>",
  "event_time": "<ISO timestamp>",
  "msg_type": "<TYPE>",
  "message_text": ""
}
```

Type-specific additions:
```
TEXT:     + message_text
IMAGE:    + media_url, caption?
AUDIO:    + media_url
VIDEO:    + media_url, caption?
DOCUMENT: + media_url, caption?, filename?
STICKER:  + media_url
LOCATION: + latitude, longitude, name?, address?, message_text?
```

### Phone Normalization

BR mobile extra-9 removal (outbound only):
```
5551997285829 → 555197285829
Regex: /^(55\d{2})9(\d{8})$/ → "$1$2"
Non-BR numbers: pass through unchanged
```

---

## Connect-time Validation

POST a minimal test payload to `gupshupCallbackUrl` with the `gupshupAuthToken`.
- HTTP 401/403 → throw `GupshupError(AUTH_FAILED)`
- Check response body for error indicators (Gupshup may return 200 with error in body)
- Any other response (including 200) → proceed as connected

---

## Capabilities

```typescript
canSendText: true
canSendMedia: true
canSendSticker: true
canSendLocation: true
canSendContact: false       // Custom Integration doesn't support it
canSendButtons: false       // Custom Integration doesn't support it
canSendTyping: false        // Stateless REST — no socket
canSendReaction: false
canEditMessage: false
canDeleteMessage: false
canReplyToMessage: true     // context field on inbound
canForwardMessage: false
canReceiveReadReceipts: true
canReceiveDeliveryReceipts: true
canHandleGroups: false      // BSP is 1:1 only
canHandleDMs: true
canStreamResponse: false
maxMessageLength: 4096
maxFileSize: 100MB
```

---

## Files to Rewrite

| File | Change |
|------|--------|
| `src/types.ts` | New `GupshupConfig`, new inbound payload types (Meta format) |
| `src/client.ts` | Replace Partner API client with Custom Integration sender |
| `src/handlers/webhooks.ts` | Rewrite parser for Meta format, all 10 msg types, status events |
| `src/senders/text.ts` | Rewrite for Custom Integration |
| `src/senders/media.ts` | Rewrite for Custom Integration, add STICKER |
| `src/senders/template.ts` | Remove (template sending is now via Custom Integration flow) |
| `src/senders/interactive.ts` | Remove (not supported) |
| `src/senders/location.ts` | New — LOCATION outbound |
| `src/plugin.ts` | Update connect(), sendMessage(), handleWebhook(), capabilities |
| `src/capabilities.ts` | Update per above |
| `src/utils/errors.ts` | Keep, minor updates |
| `src/utils/identity.ts` | Update normalizePhone for outbound (BR extra-9) |
| `src/__tests__/*` | Rewrite all tests with real payload fixtures from DB |

---

## Risks

1. **Credential test POST** — Gupshup may return HTTP 200 with error in body for bad auth; check body too
2. **Phone normalization** — regex only covers BR mobiles; non-BR numbers pass through unchanged (correct)
3. **`failed` status** — must emit `message.failed` in omni; recipient_id is the destination phone
4. **`billing-event` / `account_update`** — silently return 200, no processing
5. **`webhookVerifyToken` optional** — if not configured, skip token check (open webhook)

---

## Acceptance Criteria

1. All 10 inbound message types parsed and emitted as `message.received` with correct content shape
2. `delivered`, `read`, `failed` status events emit correct omni events
3. Outbound TEXT, IMAGE, AUDIO, VIDEO, DOCUMENT, STICKER, LOCATION all POST to Custom Integration successfully
4. Connect with bad auth token → throws `GupshupError(AUTH_FAILED)`
5. Connect with good auth token → instance state = `connected`
6. BR mobile phone normalization correct on outbound
7. All existing tests pass (rewritten to use Meta-format fixtures)
