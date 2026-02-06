# WISH: Telegram Bot API Channel

> Telegram Bot API integration as a channel plugin

**Status:** DRAFT
**Created:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-gry

---

## Problem Statement

Telegram is one of the most popular messaging platforms globally (900M+ monthly active users). Adding Telegram as a channel unlocks a massive user base and gives our platform true omnichannel coverage alongside WhatsApp and Discord.

Telegram's Bot API is mature, well-documented, free to use, and webhook-friendly — making it an ideal fit for our event-driven architecture.

## Discovery

### What exists today?
- `channel-whatsapp` (Baileys) — Socket-based, unofficial API
- `channel-discord` — Bot-based, gateway WebSocket + REST
- `channel-sdk` — Plugin SDK with `BaseChannelPlugin`, supports webhooks natively
- Webhook infrastructure already exists in the API

### How does Telegram Bot API work?

| Aspect | Telegram Bot API |
|--------|-----------------|
| Auth | Bot token from @BotFather |
| Connection model | Webhook (preferred) or long polling |
| Incoming messages | Webhook POST with `Update` JSON |
| Outgoing messages | HTTP POST to `api.telegram.org/bot{token}/{method}` |
| Media download | `getFile` → `https://api.telegram.org/file/bot{token}/{path}` |
| Media upload | Multipart form upload via `sendPhoto`, `sendDocument`, etc. |
| Message types | Text, photo, video, audio, voice, document, sticker, location, contact, poll, animation (GIF) |
| Interactive | Inline keyboards (buttons), reply keyboards, inline mode |
| Groups | Full support (groups, supergroups, channels) |
| Rich content | Markdown/HTML formatting, link previews |
| Rate limits | 30 msg/s to different chats, 1 msg/s per chat |
| Bot API version | 8.3 (Jan 2026) |

### Key architectural insight

Telegram Bot API is **very similar to WhatsApp Cloud API** in architecture — both are webhook + REST. The main differences:

- Telegram auth is trivial (single bot token vs Meta's OAuth + app secret)
- Telegram webhook setup is programmatic (`setWebhook` API call) vs Meta's dashboard
- Telegram has inline keyboards (buttons attached to messages) — maps to our `canSendButtons`
- Telegram supports editing/deleting sent messages
- Telegram has channel (broadcast) support built-in
- No message templates (Telegram doesn't have this concept)

## Assumptions

- **ASM-1:** We use webhook mode (not long polling) for production reliability
- **ASM-2:** One bot per instance (standard Telegram model)
- **ASM-3:** Bot token obtained from @BotFather (manual step, documented)
- **ASM-4:** New `ChannelType = 'telegram'` added to core types
- **ASM-5:** We target Bot API 8.3 (latest stable)
- **ASM-6:** Webhook URL auto-registered via `setWebhook` API call on `connect()`

## Decisions

- **DEC-1:** New package `packages/channel-telegram/`
- **DEC-2:** Webhook mode only (not long polling) — fits our event-driven architecture
- **DEC-3:** Use native `fetch` for Bot API calls (no external Telegram library — the API is simple HTTP)
- **DEC-4:** `connect()` calls `setWebhook` to register our endpoint with Telegram
- **DEC-5:** `disconnect()` calls `deleteWebhook` to deregister
- **DEC-6:** Support Markdown formatting in text messages (Telegram's `parse_mode: "MarkdownV2"`)

## Risks

- **RISK-1:** Webhook requires HTTPS with valid certificate. **Mitigation:** Same as Cloud API — ngrok for dev, proper domain for prod.
- **RISK-2:** Bot tokens don't expire but can be revoked. **Mitigation:** Health check calls `getMe` to validate token.
- **RISK-3:** Telegram rate limits (30 msg/s global, 1/s per chat). **Mitigation:** Document limits, consider queue for bulk sends (future).

## Scope

### IN SCOPE

1. **Plugin skeleton** — Package setup extending `BaseChannelPlugin`
2. **Bot API client** — Typed HTTP client for Telegram Bot API
3. **Webhook handler** — Receive + route incoming `Update` objects
4. **Message receiving** — Text, photo, video, audio, voice, document, sticker, location, contact, animation
5. **Message sending** — Text (with Markdown), photo, video, audio, document, sticker, location, contact
6. **Interactive** — Inline keyboard buttons on messages, callback query handling
7. **Media pipeline** — Download via `getFile`, upload via multipart
8. **Edit/Delete** — Edit sent messages, delete messages
9. **Status tracking** — Message sent confirmation (Telegram gives immediate response)
10. **Instance lifecycle** — Connect (setWebhook), disconnect (deleteWebhook), status (getMe)
11. **Profile** — Fetch bot info via `getMe`, user info from update payloads
12. **Groups** — Handle group messages, distinguish private/group/supergroup/channel

### OUT OF SCOPE

- Inline mode (bot results in other chats)
- Telegram Payments API
- Telegram Passport (identity verification)
- Custom reply keyboards (only inline keyboards)
- Telegram channels as a separate concept (treated as group messages)
- Bot commands registration (done via @BotFather)
- Telegram Mini Apps (WebApps)
- Long polling mode

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| **core** | [x] types | Add `'telegram'` to `ChannelType` |
| **channel-sdk** | [ ] no changes | Already supports webhook-based plugins |
| **channel-telegram** | [x] NEW PACKAGE | Full plugin implementation |
| **api** | [x] routes | Register plugin + webhook route |
| **db** | [ ] no schema changes | Instances table supports any channel type |
| **sdk** | [x] regenerate | New channel type |
| **cli** | [ ] no changes | Commands are channel-agnostic |

### System Checklist

- [x] **Events**: Same events (`message.received`, `message.sent`, etc.) — no new types
- [ ] **Database**: No schema changes
- [ ] **SDK**: Regenerate after API changes
- [ ] **CLI**: No changes needed
- [ ] **Tests**: Unit tests for Bot API client, webhook handler, message mapping

## Technical Design

### Package Structure

```
packages/channel-telegram/
├── src/
│   ├── index.ts                 # Plugin export
│   ├── plugin.ts                # TelegramPlugin extends BaseChannelPlugin
│   ├── client.ts                # Bot API HTTP client (typed)
│   ├── webhook.ts               # Webhook handler + Update routing
│   ├── types.ts                 # Telegram API types (Update, Message, etc.)
│   ├── capabilities.ts          # Capability declaration
│   ├── handlers/
│   │   ├── messages.ts          # Incoming messages → emitMessageReceived
│   │   ├── callbacks.ts         # Inline keyboard callback queries
│   │   └── edits.ts             # Message edits
│   ├── senders/
│   │   ├── text.ts              # sendMessage
│   │   ├── media.ts             # sendPhoto, sendVideo, sendDocument, etc.
│   │   └── interactive.ts       # Inline keyboards
│   └── utils/
│       ├── formatting.ts        # Markdown escaping for MarkdownV2
│       └── mapping.ts           # Telegram ↔ Omni message format mapping
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

### Connection Flow

```
1. User creates instance with config:
   - botToken (from @BotFather)

2. plugin.connect(instanceId, config):
   - Validate token: GET /getMe (if 200 → valid, also gets bot username)
   - Call setWebhook: POST /setWebhook { url: "{apiBaseUrl}/webhooks/telegram?instance={instanceId}" }
   - Store config + bot info in instance map
   - Emit instance.connected with bot metadata (username, name, id)

3. Telegram sends webhooks to our endpoint:
   - POST with Update JSON body
   - Route by update type: message, edited_message, callback_query, etc.

4. plugin.disconnect(instanceId):
   - Call deleteWebhook to deregister
   - Remove from instance map
   - Emit instance.disconnected
```

### Capabilities Declaration

```typescript
const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,         // Telegram supports reactions (Bot API 7.2+)
  canSendTyping: true,           // sendChatAction("typing")
  canReceiveReadReceipts: false, // Telegram doesn't send read receipts to bots
  canReceiveDeliveryReceipts: false,
  canEditMessage: true,          // editMessageText, editMessageMedia
  canDeleteMessage: true,        // deleteMessage
  canReplyToMessage: true,       // reply_to_message_id
  canForwardMessage: true,       // forwardMessage
  canSendContact: true,          // sendContact
  canSendLocation: true,         // sendLocation
  canSendSticker: true,          // sendSticker
  canHandleGroups: true,         // Full group support
  canHandleBroadcast: true,      // Channel messages
  canSendButtons: true,          // InlineKeyboardMarkup
  canSendPoll: true,             // sendPoll

  maxMessageLength: 4096,
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 10 * 1024 * 1024 },       // 10MB photos
    { mimeType: 'video/*', maxSize: 50 * 1024 * 1024 },       // 50MB video
    { mimeType: 'audio/*', maxSize: 50 * 1024 * 1024 },       // 50MB audio
    { mimeType: 'application/*', maxSize: 50 * 1024 * 1024 },  // 50MB documents
    { mimeType: 'image/webp', maxSize: 512 * 1024 },           // 512KB stickers
    { mimeType: 'video/mp4' },                                  // GIFs (animations)
  ],
  maxFileSize: 50 * 1024 * 1024,   // 50MB max (bots can receive up to 20MB)
};
```

### Webhook Payload Processing

```
POST from Telegram → handleWebhook(request)
├── Parse JSON body (Update object)
├── Route by update type:
│   ├── update.message → handleMessage()
│   │   ├── text message    → emitMessageReceived(text)
│   │   ├── photo           → download file → emitMediaReceived + emitMessageReceived
│   │   ├── video           → download file → emitMediaReceived + emitMessageReceived
│   │   ├── audio           → download file → emitMediaReceived + emitMessageReceived
│   │   ├── voice           → download file → emitMediaReceived + emitMessageReceived
│   │   ├── document        → download file → emitMediaReceived + emitMessageReceived
│   │   ├── sticker         → download file → emitMediaReceived + emitMessageReceived
│   │   ├── animation (GIF) → download file → emitMediaReceived + emitMessageReceived
│   │   ├── location        → emitMessageReceived(location)
│   │   ├── contact         → emitMessageReceived(contact)
│   │   ├── poll            → emitMessageReceived(poll)
│   │   └── new_chat_members, left_chat_member → system events
│   ├── update.edited_message → handleEditedMessage()
│   │   └── emitMessageReceived with edit flag
│   ├── update.callback_query → handleCallbackQuery()
│   │   └── emitMessageReceived(button press) + answerCallbackQuery
│   └── update.message_reaction → handleReaction()
│       └── emitMessageReceived(reaction)
└── Return 200 OK
```

### Instance Config Schema

```typescript
const TelegramConfigSchema = z.object({
  // Bot credentials (from @BotFather)
  botToken: z.string().describe('Bot token from @BotFather'),

  // Optional webhook config
  secretToken: z.string().optional().describe('Secret token for webhook verification (X-Telegram-Bot-Api-Secret-Token)'),

  // Optional settings
  allowedUpdates: z.array(z.string()).optional().describe('Update types to receive'),
});
```

### Chat ID Format

```
Private chat:  numeric ID (e.g., 123456789)
Group:         negative numeric ID (e.g., -1001234567890)
Supergroup:    negative numeric ID with -100 prefix
Channel:       negative numeric ID with -100 prefix
Username:      @username (can be used for public chats/channels)
```

## Execution Groups

### Group A: Foundation (Plugin + Client + Types)

**Goal:** Working package with Bot API client and plugin skeleton

**Packages:** `core`, `channel-telegram`

**Deliverables:**
- [ ] Add `'telegram'` to `ChannelType` in `@omni/core`
- [ ] Create `packages/channel-telegram/` with package.json, tsconfig
- [ ] Implement `TelegramClient` — typed Bot API HTTP client
  - `getMe()`, `setWebhook()`, `deleteWebhook()`, `sendMessage()`, `getFile()`
- [ ] Implement `TelegramPlugin` extending `BaseChannelPlugin`
  - `connect()` — validate token via getMe, call setWebhook
  - `disconnect()` — call deleteWebhook, cleanup
  - `getStatus()` — call getMe to check token validity
  - `getConnectedInstances()`
- [ ] Implement webhook handler with secret token verification
- [ ] Define Zod schemas for Telegram types (Update, Message, CallbackQuery)
- [ ] Capability declaration
- [ ] Register plugin in API's channel registry

**Acceptance Criteria:**
- [ ] `make typecheck` passes with new package
- [ ] Plugin can connect (validates token + sets webhook)
- [ ] Plugin can disconnect (deletes webhook)

### Group B: Messaging (Receive + Send)

**Goal:** Bidirectional messaging through Telegram Bot API

**Packages:** `channel-telegram`

**Deliverables:**
- [ ] Incoming message handlers (text, photo, video, audio, voice, document, sticker, animation, location, contact)
- [ ] Media download via `getFile` + fetch from Telegram file server
- [ ] Message sending: text (with MarkdownV2), photo, video, audio, document, sticker, location, contact
- [ ] Inline keyboard support (buttons on messages)
- [ ] Callback query handling (button press responses)
- [ ] Reply-to support (reply_to_message_id)
- [ ] Edit/delete sent messages
- [ ] Typing indicator (sendChatAction)
- [ ] Group message handling (distinguish private vs group)

**Acceptance Criteria:**
- [ ] Incoming text → `message.received` event emitted
- [ ] Incoming photo → media downloaded + `message.received` emitted
- [ ] `sendMessage()` text → Bot API called, `message.sent` emitted
- [ ] `sendMessage()` with inline keyboard → buttons rendered in Telegram
- [ ] Button press → callback query processed, event emitted
- [ ] Group messages correctly attributed

### Group C: Integration + Tests

**Goal:** Full integration with the platform, tested

**Packages:** `channel-telegram`, `api`, `sdk`

**Deliverables:**
- [ ] Webhook route registration in API (POST `/webhooks/telegram`)
- [ ] Instance create/connect flow working end-to-end
- [ ] Profile sync via `getMe` + `getChat`
- [ ] Unit tests: Bot API client, webhook handler, message mapping
- [ ] Integration tests: webhook → event flow, send → API call
- [ ] Regenerate SDK
- [ ] CLAUDE.md for the package

**Acceptance Criteria:**
- [ ] `make check` passes (typecheck + lint + test)
- [ ] Create instance → connect → setWebhook → receive updates → messages stored
- [ ] Send message via API → delivered via Telegram
- [ ] Invalid bot token → connection refused with clear error
- [ ] Bot works in private chats and groups

## Success Criteria

- [ ] Telegram plugin loads and registers alongside WhatsApp and Discord
- [ ] Instance can be created and connected with bot token
- [ ] Incoming messages via webhook are processed and stored
- [ ] Outgoing messages (text, media, with buttons) are delivered
- [ ] Edit/delete operations work
- [ ] Group messages are handled correctly
- [ ] `make check` passes
- [ ] No changes to other channel plugins

## Dependencies

**Internal:**
- `@omni/channel-sdk` — BaseChannelPlugin, ChannelRegistry
- `@omni/core` — Events, types, schemas

**External:**
- Telegram account
- Bot created via @BotFather
- Bot token
- Publicly accessible HTTPS webhook URL

## References

- [Telegram Bot API Docs](https://core.telegram.org/bots/api)
- [Bot API Changelog](https://core.telegram.org/bots/api-changelog)
- [Webhook Guide](https://core.telegram.org/bots/webhooks)
- [Bot FAQ](https://core.telegram.org/bots/faq)
- [Available Message Types](https://core.telegram.org/bots/api#available-types)
