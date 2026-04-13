# Brainstorm: gupshup-channel-rewrite

**Status:** Simmering
**Started:** 2026-04-13

## Context

The existing `packages/channel-gupshup` was built for the Gupshup Partner API (old format).
A proof-of-concept (`teste-webhook-gupshup/server.js`) confirmed the real working integration on 2026-04-10.

### Key mismatches discovered:

**Inbound:**
- Current plugin expects old Gupshup format: `{ app, timestamp, version, type, payload }`
- Real webhooks are Meta/WA Business API format: `{ entry[0].changes[0].value.messages[0] }`

**Outbound:**
- Current plugin POSTs to `https://api.gupshup.io/wa/api/v1/msg` (Partner API, form-encoded)
- Real working outbound uses Gupshup Custom Integration callback URL (JSON, `msg_type` driven)

**Phone normalization:**
- Brazilian mobiles need extra-9 removal for outbound: `5551997285829` → `555197285829`

### Confirmed real payload shapes (from live DB):

**Inbound message types:** text, image, audio, video, document, sticker, location, contacts, interactive, button
**Status events:** enqueued, sent, delivered, read, failed
**Other:** billing-event, account_update

**Outbound (Custom Integration):**
```json
{
  "customer_id": "555197285829",
  "user": { "phone": "555197285829" },
  "event_id": "nx_omni_agent_reply",
  "event_time": "ISO timestamp",
  "msg_type": "TEXT | IMAGE | AUDIO | VIDEO | DOCUMENT | STICKER",
  "message_text": "...",
  "media_url": "...",
  "caption": "...",
  "filename": "..."
}
```

## Decisions

- **Scope:** Full in-place rewrite of `packages/channel-gupshup`
- **Config (per instance):** `gupshupCallbackUrl` (required), `gupshupAuthToken` (required), `gupshupEventId` (optional, default `nx_omni_agent_reply`), `webhookVerifyToken` (optional)
- **Capabilities:** `canSendLocation: true`, `canSendSticker: true`, `canSendContact: false`

## Confirmed Outbound Payload Shapes

```
TEXT:     { msg_type, message_text }
IMAGE:    { msg_type, media_url, caption? }
AUDIO:    { msg_type, media_url }
VIDEO:    { msg_type, media_url, caption? }
DOCUMENT: { msg_type, media_url, caption?, filename? }
STICKER:  { msg_type, media_url }
LOCATION: { msg_type, latitude, longitude, name?, address?, message_text? }
```

All outbound payloads also include: `customer_id`, `user.phone`, `event_id`, `event_time`
Phone normalization: `5551997285829` → `555197285829` (BR mobile extra-9 removal)

## Open Questions

- [ ] `interactive` / `button` outbound — template flows vs direct?
- [ ] Credential validation at connect time — what lightweight check to use? (old plugin used balance API which no longer applies)
