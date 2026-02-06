# WISH: WhatsApp Business Cloud API Channel

> Official Meta WhatsApp Business Cloud API integration as a channel plugin

**Status:** DRAFT
**Created:** 2026-02-04
**Updated:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-c85

---

## Problem Statement

Our current WhatsApp integration uses Baileys (unofficial WebSocket reverse-engineering of WhatsApp Web). This works well for personal/dev use but carries real risks for production:

- **Account bans** — Meta actively detects and blocks unofficial clients
- **No business features** — No message templates, no catalog support, no verified business profile
- **Lower rate limits** — Unofficial clients can't negotiate higher throughput
- **No support** — When something breaks, we're on our own
- **History sync fragility** — Passive sync via Baileys is unreliable and incomplete

The Cloud API is Meta's official offering: hosted by Meta, free to use, with proper webhook-based architecture, up to 80 msg/s per number (upgradeable to 1,000 msg/s).

## Discovery

### What exists today?
- `channel-whatsapp` (Baileys) — Full-featured plugin with socket-based messaging, QR auth, history sync, media download
- `channel-sdk` — Mature plugin SDK with `BaseChannelPlugin`, `ChannelRegistry`, event helpers, multi-instance support
- `channel-discord` — Second channel plugin, proves the architecture works across platforms

### What's different about Cloud API vs Baileys?

| Aspect | Baileys | Cloud API |
|--------|---------|-----------|
| Auth | QR code / pairing code | OAuth + access token |
| Connection | Persistent WebSocket | Stateless HTTP (webhooks) |
| Incoming messages | Socket events | Webhook POST from Meta |
| Outgoing messages | Socket send | Graph API HTTP POST |
| Media download | Direct from WA servers | Graph API media endpoint |
| Media upload | Direct buffer | Graph API media upload |
| History | Passive sync from device | Not available (webhook-only) |
| Templates | Not supported | Full template support |
| Interactive | Limited | Buttons, lists, flows |
| Contacts/Groups | Baileys fetches | Business API endpoints |
| Connection model | Persistent (always online) | Stateless (token-valid = connected) |

### Key architectural insight

Cloud API is **stateless and webhook-driven**. There's no persistent connection to manage — the plugin is "connected" as long as the access token is valid and the webhook is configured. This means:
- No QR code flow
- No reconnection logic
- No socket management
- `connect()` just validates the token and registers webhook
- `getStatus()` checks token validity via a lightweight API call
- All incoming messages come through `handleWebhook()`

## Assumptions

- **ASM-1:** We target Graph API v21.0 (current stable)
- **ASM-2:** One phone number per instance (standard Cloud API model)
- **ASM-3:** Access tokens are managed externally (user provides them via instance config)
- **ASM-4:** We reuse the existing `ChannelType` union — need to add `'whatsapp-cloud'`
- **ASM-5:** Message templates are pre-created in Meta Business Manager — we just reference them by name

## Decisions

- **DEC-1:** New package `packages/channel-whatsapp-cloud/` — NOT a mode within the Baileys plugin. They're architecturally different (socket vs webhook).
- **DEC-2:** Share the `whatsapp` channel type family but use distinct `ChannelType = 'whatsapp-cloud'`
- **DEC-3:** Webhook signature verification is mandatory (HMAC-SHA256 with app secret)
- **DEC-4:** Media: download from Graph API and store locally via existing media pipeline
- **DEC-5:** No history sync — Cloud API doesn't support it. Only real-time messages via webhooks.

## Risks

- **RISK-1:** Webhook URL must be publicly accessible with HTTPS. **Mitigation:** Document ngrok/tunnel setup for dev, proper domain for prod.
- **RISK-2:** Access token expiration. System tokens last 60 days. **Mitigation:** Health check validates token, emit `instance.disconnected` on 401.
- **RISK-3:** Webhook delivery guarantees — Meta retries but can lag. **Mitigation:** Idempotent message processing (dedup on `message.id`).

## Scope

### IN SCOPE

1. **Plugin skeleton** — Package setup extending `BaseChannelPlugin`
2. **Graph API client** — Typed HTTP client for messaging, media, profile endpoints
3. **Webhook handler** — Receive + verify + route incoming webhooks from Meta
4. **Message receiving** — Text, media (image/video/audio/doc), location, contacts, reactions, replies
5. **Message sending** — Text, media, template, interactive (buttons/lists), location, contacts
6. **Media pipeline** — Download media from Graph API, upload media for sending
7. **Status tracking** — Delivery receipts, read receipts via webhook status updates
8. **Instance lifecycle** — Connect (validate token), disconnect, status check
9. **Profile** — Fetch business profile via Graph API
10. **Core types** — Add `'whatsapp-cloud'` to `ChannelType` union

### OUT OF SCOPE

- WhatsApp Business Management API (account settings, number management)
- Template creation/management (done in Meta Business Manager)
- Catalog/Commerce features
- WhatsApp Flows (interactive forms)
- Conversation-based pricing calculation
- Phone number registration (done in Meta portal)
- Migration from Baileys to Cloud API (future wish)

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| **core** | [x] types | Add `'whatsapp-cloud'` to `ChannelType` |
| **channel-sdk** | [ ] no changes | Already supports webhook-based plugins |
| **channel-whatsapp-cloud** | [x] NEW PACKAGE | Full plugin implementation |
| **api** | [x] routes | Register plugin + webhook route |
| **db** | [ ] no schema changes | Instances table already supports any channel type |
| **sdk** | [x] regenerate | New channel type surfaces in SDK |
| **cli** | [ ] no changes | Instance commands already channel-agnostic |
| **ui** | [ ] minor | May need cloud-specific instance setup form (future) |

### System Checklist

- [x] **Events**: Same events as Baileys (`message.received`, `message.sent`, `instance.connected`, etc.) — no new event types needed
- [ ] **Database**: No schema changes. `instances.channel` already stores arbitrary channel type strings
- [ ] **SDK**: Regenerate after API changes
- [ ] **CLI**: No changes needed — `omni send`, `omni instances` already work generically
- [ ] **Tests**: Unit tests for Graph API client, webhook handler, message mapping

## Technical Design

### Package Structure

```
packages/channel-whatsapp-cloud/
├── src/
│   ├── index.ts                 # Plugin export
│   ├── plugin.ts                # WhatsAppCloudPlugin extends BaseChannelPlugin
│   ├── client.ts                # Graph API HTTP client (typed)
│   ├── webhook.ts               # Webhook verification + routing
│   ├── types.ts                 # Cloud API types (webhook payloads, API responses)
│   ├── capabilities.ts          # Capability declaration
│   ├── handlers/
│   │   ├── messages.ts          # Incoming message → emitMessageReceived
│   │   ├── statuses.ts          # Delivery/read receipts → emitMessageDelivered/Read
│   │   └── errors.ts            # Error webhook → logging + events
│   ├── senders/
│   │   ├── text.ts              # Text message sending
│   │   ├── media.ts             # Media upload + send
│   │   ├── template.ts          # Template message sending
│   │   └── interactive.ts       # Buttons, lists
│   └── utils/
│       ├── signature.ts         # HMAC-SHA256 webhook verification
│       └── mapping.ts           # Cloud API ↔ Omni message format mapping
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

### Connection Flow (Cloud API)

```
1. User creates instance with config:
   - accessToken, phoneNumberId, businessAccountId, appSecret, webhookVerifyToken

2. plugin.connect(instanceId, config):
   - Validate token: GET /v21.0/{phoneNumberId} (if 200 → valid)
   - Store config in instance map
   - Emit instance.connected with phone number metadata
   - Webhook URL is: {apiBaseUrl}/webhooks/whatsapp-cloud?instance={instanceId}

3. Meta sends webhooks to our endpoint:
   - GET (verification challenge) → return hub.challenge
   - POST (messages/statuses) → verify signature → route to handlers

4. plugin.disconnect(instanceId):
   - Remove from instance map
   - Emit instance.disconnected
   - (Webhook URL stays configured in Meta — just stop processing)
```

### Capabilities Declaration

```typescript
const WHATSAPP_CLOUD_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: false,          // Cloud API doesn't support typing indicators
  canReceiveReadReceipts: true,  // Via webhook status updates
  canReceiveDeliveryReceipts: true,
  canEditMessage: false,         // Not supported in Cloud API
  canDeleteMessage: false,       // Not supported in Cloud API
  canReplyToMessage: true,       // context.message_id
  canForwardMessage: false,      // Not directly supported
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: true,
  canHandleGroups: true,
  canHandleBroadcast: false,
  canSendButtons: true,          // Interactive buttons
  canSendPoll: false,

  maxMessageLength: 4096,
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 5 * 1024 * 1024 },       // 5MB images
    { mimeType: 'video/*', maxSize: 16 * 1024 * 1024 },      // 16MB video
    { mimeType: 'audio/*', maxSize: 16 * 1024 * 1024 },      // 16MB audio
    { mimeType: 'application/*', maxSize: 100 * 1024 * 1024 }, // 100MB docs
    { mimeType: 'image/webp', maxSize: 500 * 1024 },          // 500KB stickers
  ],
  maxFileSize: 100 * 1024 * 1024,  // 100MB max
};
```

### Webhook Payload Processing

```
POST from Meta → handleWebhook(request)
├── Verify X-Hub-Signature-256 (HMAC-SHA256)
├── Parse JSON body
├── For each entry.changes:
│   ├── field === "messages"
│   │   ├── value.messages[] → handleIncomingMessage()
│   │   │   ├── type: text     → emitMessageReceived(text content)
│   │   │   ├── type: image    → download media → emitMediaReceived + emitMessageReceived
│   │   │   ├── type: video    → download media → emitMediaReceived + emitMessageReceived
│   │   │   ├── type: audio    → download media → emitMediaReceived + emitMessageReceived
│   │   │   ├── type: document → download media → emitMediaReceived + emitMessageReceived
│   │   │   ├── type: sticker  → download media → emitMediaReceived + emitMessageReceived
│   │   │   ├── type: location → emitMessageReceived(location content)
│   │   │   ├── type: contacts → emitMessageReceived(contact content)
│   │   │   ├── type: reaction → emitMessageReceived(reaction content)
│   │   │   ├── type: button   → emitMessageReceived(button reply)
│   │   │   └── type: interactive → emitMessageReceived(list/button reply)
│   │   └── value.statuses[] → handleStatusUpdate()
│   │       ├── status: sent      → emitMessageSent
│   │       ├── status: delivered  → emitMessageDelivered
│   │       ├── status: read       → emitMessageRead
│   │       └── status: failed     → emitMessageFailed
│   └── field === "errors" → log error
└── Return 200 OK (always — Meta requires fast ack)
```

### Instance Config Schema

```typescript
const WhatsAppCloudConfigSchema = z.object({
  // Meta App credentials
  appSecret: z.string().describe('Facebook App Secret for webhook verification'),

  // WhatsApp Business Account
  phoneNumberId: z.string().describe('WhatsApp Phone Number ID'),
  businessAccountId: z.string().describe('WhatsApp Business Account ID'),
  accessToken: z.string().describe('System User Access Token'),

  // Webhook verification
  webhookVerifyToken: z.string().describe('Custom token for webhook URL verification'),

  // Optional
  graphApiVersion: z.string().default('v21.0'),
});
```

## Execution Groups

### Group A: Foundation (Plugin + Client + Types)

**Goal:** Working package with Graph API client and plugin skeleton

**Packages:** `core`, `channel-whatsapp-cloud`

**Deliverables:**
- [ ] Add `'whatsapp-cloud'` to `ChannelType` in `@omni/core`
- [ ] Create `packages/channel-whatsapp-cloud/` with package.json, tsconfig
- [ ] Implement `WhatsAppCloudClient` — typed Graph API HTTP client
  - `sendMessage()`, `uploadMedia()`, `downloadMedia()`, `getPhoneNumberInfo()`
- [ ] Implement `WhatsAppCloudPlugin` extending `BaseChannelPlugin`
  - `connect()` — validate token, store config
  - `disconnect()` — cleanup
  - `getStatus()` — check token validity
  - `getConnectedInstances()`
- [ ] Implement webhook handler with HMAC-SHA256 verification
- [ ] Define Zod schemas for Cloud API types (webhook payloads, API responses)
- [ ] Capability declaration
- [ ] Register plugin in API's channel registry

**Acceptance Criteria:**
- [ ] `make typecheck` passes with new package
- [ ] Plugin can be instantiated and connects (validates token)
- [ ] Webhook verification challenge works (GET → return hub.challenge)

### Group B: Messaging (Receive + Send)

**Goal:** Bidirectional messaging through Cloud API

**Packages:** `channel-whatsapp-cloud`

**Deliverables:**
- [ ] Incoming message handlers (text, media, location, contacts, reaction, interactive replies)
- [ ] Media download from Graph API (GET /{media-id} → download URL → fetch binary)
- [ ] Message sending: text, media (with upload), template, interactive (buttons/lists)
- [ ] Status update handlers (sent, delivered, read, failed)
- [ ] Reply-to support (context.message_id)
- [ ] Message deduplication (idempotent on message.id)

**Acceptance Criteria:**
- [ ] Incoming text message → `message.received` event emitted
- [ ] Incoming media message → media downloaded + `message.received` emitted
- [ ] `sendMessage()` text → Graph API called, `message.sent` emitted
- [ ] `sendMessage()` media → media uploaded, message sent, `message.sent` emitted
- [ ] Template messages can be sent
- [ ] Delivery/read receipts processed

### Group C: Integration + Tests

**Goal:** Full integration with the platform, tested

**Packages:** `channel-whatsapp-cloud`, `api`, `sdk`

**Deliverables:**
- [ ] Webhook route registration in API (POST `/webhooks/whatsapp-cloud`)
- [ ] Instance create/connect flow working end-to-end
- [ ] Profile sync via Graph API (`getProfile()`)
- [ ] Unit tests: Graph API client, webhook signature, message mapping
- [ ] Integration tests: webhook → event flow, send → API call
- [ ] Regenerate SDK
- [ ] CLAUDE.md for the package

**Acceptance Criteria:**
- [ ] `make check` passes (typecheck + lint + test)
- [ ] Create instance → connect → receive webhook → message appears in DB
- [ ] Send message via API → delivered via Cloud API
- [ ] Webhook with invalid signature → rejected (401)
- [ ] Invalid token → `instance.disconnected` event

## Success Criteria

- [ ] WhatsApp Cloud API plugin loads and registers alongside Baileys
- [ ] Instance can be created and connected with access token
- [ ] Incoming messages via webhook are processed and stored
- [ ] Outgoing messages (text, media, template) are delivered
- [ ] Delivery/read receipts are tracked
- [ ] Webhook security (signature verification) is enforced
- [ ] `make check` passes
- [ ] No changes to Baileys plugin (they coexist independently)

## Dependencies

**Internal:**
- `@omni/channel-sdk` — BaseChannelPlugin, ChannelRegistry
- `@omni/core` — Events, types, schemas

**External:**
- Meta Developer Account + WhatsApp Business Account
- Verified phone number registered in Cloud API
- System User access token (created in Business Manager)
- Publicly accessible HTTPS webhook URL

## References

- [WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Webhook Setup](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Message Types Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
- [Media Endpoints](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media)
