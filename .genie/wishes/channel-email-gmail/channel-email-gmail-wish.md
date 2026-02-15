# WISH: Gmail Channel via Google OAuth

> Connect Gmail accounts via OAuth 2.0 and handle emails as first-class messages with full thread, participant, and attachment fidelity

**Status:** DRAFT
**Created:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-89y

---

## Problem Statement

Omni v2 handles real-time chat channels (WhatsApp, Discord, Telegram) but lacks async communication support. Email — specifically Gmail / Google Workspace — is the backbone of business communication. Adding Gmail as a channel means:

- Users connect their own Gmail account via Google OAuth (no third-party email provider)
- Every email conversation becomes a chat with full threading, participants, and attachments preserved
- Send and receive emails through the same unified API as WhatsApp/Discord messages
- Google Workspace is used by 6M+ businesses — this is the channel that matters most for B2B

## Discovery

### What exists today?
- `channel-whatsapp` (Baileys) — Socket-based, real-time
- `channel-discord` — Bot-based, gateway WebSocket
- `channel-whatsapp-cloud` (planned) — Webhook + REST
- `channel-telegram` (planned) — Webhook + REST
- `channel-sdk` — Supports webhook-based plugins with `handleWebhook()`

### How does Gmail API work?

| Aspect | Gmail API |
|--------|-----------|
| Auth | Google OAuth 2.0 (refresh token + access token) |
| Incoming | `users.watch()` → Pub/Sub push notification → webhook |
| Outgoing | `users.messages.send()` with RFC 2822 message |
| History | `users.history.list()` — incremental sync from any point |
| Full sync | `users.messages.list()` — paginated listing |
| Threads | `users.threads.get()` — Gmail groups messages into threads |
| Media | `users.messages.attachments.get()` — per-attachment download |
| Labels | Gmail uses labels instead of folders (INBOX, SENT, STARRED, custom) |
| Rate limits | 250 quota units/user/second, 1B units/day |

### What's fundamentally different about email?

Email is **not** like chat. A single email has:

1. **Multiple recipients** — From, To (multiple), CC (multiple), BCC (multiple)
2. **Subject line** — Threads are grouped by subject
3. **Rich HTML body** — Not just plain text; inline images, styled content
4. **Multiple attachments** — A single message can have 10+ files
5. **Threading via headers** — `In-Reply-To`, `References` RFC 2822 headers
6. **Labels, not status** — An email can have multiple labels (Inbox + Important + Project-X)
7. **Read/unread is per-user** — Not delivery status
8. **Archive ≠ Delete** — Important distinction

### Current data model gaps

The DB schema was explored thoroughly. Key findings:

| Feature | Current State | Gap |
|---------|--------------|-----|
| Subject line | No field | Need `subject` on messages |
| HTML body | No field | Need `htmlContent` on messages |
| TO/CC/BCC | Not modeled | Need on messages or use `platformMetadata` |
| Multiple attachments | Single `mediaUrl` per message | Need attachment table or use JSONB |
| Email threading | `replyToMessageId` exists | Gmail `threadId` maps to `chat.externalId` |
| Participants | `chatParticipants` exists | Need email-specific roles (TO/CC/BCC) |
| Labels | No concept | Use `platformMetadata` on chats |
| Read status | `deliveryStatus` exists | Can reuse (map Gmail UNREAD label) |
| Person email | `primaryEmail` exists, indexed | Works for identity linking |

### Strategy: Minimize schema changes

Rather than adding email-specific columns to shared tables, we should:
- **Map Gmail threads → chats** (1 thread = 1 chat, `externalId` = Gmail thread ID)
- **Map Gmail messages → messages** (use existing fields where possible)
- **Store email-specific data in JSONB fields** that already exist (`platformMetadata` on chats, `rawPayload` on messages)
- **Use `messageType: 'email'`** to distinguish email messages
- **Store attachments as JSONB array** in `mediaMetadata` (each email message can list its attachments)
- **Add only essential columns** if querying/indexing is needed (e.g., `subject`)

This keeps the schema clean and avoids breaking changes for existing channels.

## Assumptions

- **ASM-1:** One Gmail account per instance (user connects their Gmail)
- **ASM-2:** OAuth tokens stored encrypted in instance config / plugin storage
- **ASM-3:** Google Cloud project with Pub/Sub API enabled (setup documented)
- **ASM-4:** We handle both personal Gmail and Google Workspace accounts
- **ASM-5:** Initial sync pulls recent threads (configurable depth, default 30 days)
- **ASM-6:** We store email HTML in `rawPayload` and extract plain text for `textContent`
- **ASM-7:** Attachments are downloaded and stored locally (same as media for other channels)

## Decisions

- **DEC-1:** New package `packages/channel-gmail/`
- **DEC-2:** Gmail threads map to chats (`chat.externalId` = Gmail thread ID)
- **DEC-3:** Email participants (To/CC/BCC) stored in `message.rawPayload` and also as `chatParticipants` when they send/receive
- **DEC-4:** HTML email body stored in `rawPayload.htmlBody`, plain text extracted to `textContent`
- **DEC-5:** Add `subject` column to messages table (nullable, only used by email) — this is worth indexing for search
- **DEC-6:** Multiple attachments per message stored as JSONB array in `mediaMetadata.attachments[]`, each attachment downloaded to local storage
- **DEC-7:** OAuth flow requires a frontend redirect component — the API provides `/auth/gmail/start` and `/auth/gmail/callback` endpoints
- **DEC-8:** Pub/Sub push subscription for real-time incoming; `history.list()` for catch-up/sync
- **DEC-9:** Labels preserved in `chat.platformMetadata.labels[]` — not a first-class field

## Risks

- **RISK-1:** Google OAuth consent screen review for `gmail.send` + `gmail.readonly` scopes (sensitive). **Mitigation:** Start with "Testing" mode (100 users), apply for verification when needed.
- **RISK-2:** Access token expires every hour. **Mitigation:** Automatic refresh via refresh token; emit `instance.disconnected` if refresh fails.
- **RISK-3:** Pub/Sub push can lag or miss notifications. **Mitigation:** Periodic `history.list()` polling as fallback (every 60s).
- **RISK-4:** Large attachments can be expensive to download/store. **Mitigation:** Configurable max attachment size, skip inline images by default.
- **RISK-5:** Email HTML can contain malicious content (XSS). **Mitigation:** Sanitize HTML before serving to UI, store raw version separately.

## Scope

### IN SCOPE

1. **OAuth flow** — `/auth/gmail/start` → Google consent → `/auth/gmail/callback` → store tokens
2. **Gmail API client** — Typed client for messages, threads, labels, attachments, watch, history
3. **Pub/Sub webhook** — Receive push notifications from Google, fetch new messages
4. **History sync** — `history.list()` for incremental sync + initial thread import
5. **Thread → Chat mapping** — Gmail threads become Omni chats with proper participant tracking
6. **Message receiving** — Parse email (From, To, CC, subject, text, HTML, attachments, inline images)
7. **Attachment handling** — Download all attachments per message, store locally, track in JSONB
8. **Message sending** — Compose RFC 2822 email with text/HTML body, attachments, reply-in-thread
9. **Reply threading** — Sending a message in a chat = replying in the Gmail thread (correct `In-Reply-To` / `References` headers)
10. **Identity linking** — Auto-link email participants to persons via `primaryEmail` match
11. **Instance lifecycle** — Connect (OAuth + watch), disconnect (stop watch), status (validate token)
12. **DB migration** — Add `subject` column to messages table

### OUT OF SCOPE

- Gmail label management (create/delete/rename labels)
- Draft management (save/edit drafts)
- Email signatures (user configures in Gmail directly)
- Calendar integration
- Google Contacts sync (separate from email)
- Spam filtering (Gmail handles this)
- Email forwarding rules
- Multiple Gmail accounts per instance
- Outlook / other email providers (future channels)
- Full-text search within email HTML bodies

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| **core** | [x] types | Add `'gmail'` to `ChannelType` |
| **channel-gmail** | [x] NEW PACKAGE | Full plugin implementation |
| **api** | [x] routes | OAuth endpoints + webhook route + plugin registration |
| **db** | [x] migration | Add `subject` column to messages table |
| **sdk** | [x] regenerate | New channel type + OAuth endpoints |
| **channel-sdk** | [ ] no changes | Already supports webhooks |
| **cli** | [ ] no changes | Channel-agnostic |
| **ui** | [x] minor | OAuth "Connect Gmail" button (can be future) |

### System Checklist

- [x] **Events**: Same events (`message.received`, `message.sent`, etc.)
- [x] **Database**: Add `subject` column to messages (nullable, backward-compatible)
- [ ] **SDK**: Regenerate after API changes
- [ ] **CLI**: No changes
- [ ] **Tests**: Unit + integration tests

## Technical Design

### Package Structure

```
packages/channel-gmail/
├── src/
│   ├── index.ts                 # Plugin export
│   ├── plugin.ts                # GmailPlugin extends BaseChannelPlugin
│   ├── client.ts                # Gmail API HTTP client (typed, with auto token refresh)
│   ├── auth.ts                  # OAuth 2.0 flow (generate URL, exchange code, refresh)
│   ├── webhook.ts               # Pub/Sub push notification handler
│   ├── types.ts                 # Gmail API types + email-specific types
│   ├── capabilities.ts          # Capability declaration
│   ├── handlers/
│   │   ├── messages.ts          # Parse Gmail message → emitMessageReceived
│   │   ├── threads.ts           # Thread sync → chat creation/update
│   │   └── history.ts           # history.list() incremental sync
│   ├── senders/
│   │   ├── compose.ts           # Build RFC 2822 message (text + HTML + attachments)
│   │   └── send.ts              # messages.send() with thread linking
│   ├── sync/
│   │   ├── initial.ts           # First-time thread import
│   │   └── incremental.ts       # history.list() catch-up
│   └── utils/
│       ├── mime.ts              # MIME parsing (extract text, HTML, attachments from multipart)
│       ├── rfc2822.ts           # Build RFC 2822 formatted messages for sending
│       ├── html-sanitize.ts     # Sanitize email HTML for safe display
│       └── mapping.ts           # Gmail ↔ Omni message format mapping
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

### OAuth Flow

```
1. User: POST /auth/gmail/start { instanceId }
   → API generates Google OAuth URL with scopes:
     - gmail.readonly (read emails)
     - gmail.send (send emails)
     - gmail.modify (mark read/unread, archive)
   → Return { authUrl } — user opens in browser

2. User grants access → Google redirects to:
   GET /auth/gmail/callback?code=xxx&state=instanceId
   → Exchange code for access_token + refresh_token
   → Store tokens securely in plugin storage
   → Call plugin.connect(instanceId)
   → Redirect user to success page

3. plugin.connect():
   → Validate token: GET users/me/profile
   → Call users.watch({ topicName, labelIds: ['INBOX'] })
   → Store historyId for incremental sync
   → Emit instance.connected with email address + profile
```

### Incoming Email Flow

```
1. New email arrives in Gmail
2. Google Pub/Sub sends push notification to:
   POST /webhooks/gmail
   Body: { message: { data: base64({ emailAddress, historyId }) } }

3. Plugin decodes notification, calls:
   GET users/me/history?startHistoryId={last}&historyTypes=messageAdded

4. For each new message ID:
   GET users/me/messages/{id}?format=full

5. Parse the Gmail message:
   ├── Extract headers: From, To, CC, BCC, Subject, In-Reply-To, References, Message-ID
   ├── Extract body:
   │   ├── text/plain → textContent
   │   └── text/html → rawPayload.htmlBody
   ├── Extract attachments:
   │   ├── For each attachment part:
   │   │   GET users/me/messages/{id}/attachments/{attachmentId}
   │   │   → Download binary → store locally
   │   │   → Track in mediaMetadata.attachments[]
   │   └── For inline images (Content-ID):
   │       → Download → store locally → rewrite HTML src references
   └── Map to Omni message

6. Thread handling:
   ├── Look up chat by externalId = Gmail threadId
   ├── If not found → create chat (name = subject, type = dm or group based on participant count)
   ├── Upsert participants from From/To/CC as chatParticipants
   └── Auto-link to persons via email → primaryEmail match

7. Emit message.received event
8. Update stored historyId for next sync
```

### Outgoing Email Flow

```
1. User: POST /chats/{chatId}/messages { content: { type: 'text', text: '...' } }

2. Plugin.sendMessage():
   ├── Look up chat → get Gmail threadId
   ├── Look up last message in thread → get Message-ID header for In-Reply-To
   ├── Get participants → build To/CC from chat participants
   ├── Compose RFC 2822 message:
   │   ├── From: connected Gmail address
   │   ├── To: chat participants (TO role)
   │   ├── CC: chat participants (CC role)
   │   ├── Subject: "Re: {original subject}"
   │   ├── In-Reply-To: {last message Message-ID}
   │   ├── References: {full thread chain}
   │   ├── Content-Type: multipart/mixed (if attachments)
   │   │   ├── text/plain (plain text body)
   │   │   ├── text/html (optional HTML body)
   │   │   └── attachments (binary parts)
   │   └── Base64url encode entire message
   ├── POST users/me/messages/send { raw, threadId }
   └── Emit message.sent event

3. Result: Email appears as reply in existing Gmail thread
```

### Data Mapping

```
Gmail Thread     →  Omni Chat
  threadId       →  chat.externalId
  subject        →  chat.name (from first message subject)
  participants   →  chatParticipants
  labels         →  chat.platformMetadata.labels

Gmail Message    →  Omni Message
  id             →  message.externalId
  threadId       →  message.chatId (via chat lookup)
  from           →  message.senderPlatformUserId (email address)
  subject        →  message.subject (NEW COLUMN)
  text/plain     →  message.textContent
  text/html      →  message.rawPayload.htmlBody
  attachments[]  →  message.mediaMetadata.attachments[] + local files
  internalDate   →  message.platformTimestamp
  In-Reply-To    →  message.replyToExternalId (mapped to Omni message)
  Message-ID     →  message.rawPayload.messageIdRfc
  labelIds       →  message.rawPayload.labels

Email Participant →  Omni Platform Identity + Chat Participant
  email address   →  platformIdentity.platformUserId
  display name    →  platformIdentity.platformUsername
  role (TO/CC)    →  chatParticipant.platformMetadata.emailRole
  person match    →  person.primaryEmail → auto-link
```

### Attachment Storage

```typescript
// Stored in message.mediaMetadata.attachments[]
interface EmailAttachment {
  attachmentId: string;       // Gmail attachment ID
  filename: string;           // Original filename
  mimeType: string;           // MIME type
  size: number;               // Size in bytes
  localPath: string;          // Path in local media storage
  contentId?: string;         // For inline images (cid:xxx in HTML)
  isInline: boolean;          // true = inline image, false = regular attachment
}
```

### Capabilities Declaration

```typescript
const GMAIL_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: true,           // Attachments
  canSendReaction: false,       // Email doesn't have reactions
  canSendTyping: false,         // No typing indicators
  canReceiveReadReceipts: false, // Tracking pixels are unreliable and unethical
  canReceiveDeliveryReceipts: false,
  canEditMessage: false,        // Can't edit sent emails
  canDeleteMessage: false,      // Can't unsend emails (trash is local)
  canReplyToMessage: true,      // Email threading
  canForwardMessage: true,      // Forward emails
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  canHandleGroups: true,        // CC/BCC = group conversation
  canHandleBroadcast: false,
  canSendButtons: false,
  canSendPoll: false,

  maxMessageLength: 0,          // No limit (emails can be very long)
  supportedMediaTypes: [
    { mimeType: '*/*', maxSize: 25 * 1024 * 1024 },  // 25MB per attachment (Gmail limit)
  ],
  maxFileSize: 25 * 1024 * 1024,  // 25MB max attachment
};
```

### Instance Config Schema

```typescript
const GmailConfigSchema = z.object({
  // OAuth tokens (stored after OAuth flow completes)
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenExpiry: z.number(),          // Unix timestamp

  // Google Cloud project
  clientId: z.string(),
  clientSecret: z.string(),
  pubsubTopic: z.string(),          // projects/{project}/topics/{topic}

  // Sync settings
  initialSyncDays: z.number().default(30),
  maxAttachmentSize: z.number().default(25 * 1024 * 1024),
  downloadInlineImages: z.boolean().default(true),
  skipLargeAttachments: z.boolean().default(false),
});
```

## Execution Groups

### Group A: Foundation (OAuth + Client + Plugin)

**Goal:** Working package with OAuth flow, Gmail API client, and plugin skeleton

**Packages:** `core`, `channel-gmail`, `api`

**Deliverables:**
- [ ] Add `'gmail'` to `ChannelType` in `@omni/core`
- [ ] Create `packages/channel-gmail/` with package.json, tsconfig
- [ ] Implement OAuth 2.0 flow (generate auth URL, exchange code, refresh tokens)
- [ ] Implement `GmailClient` — typed Gmail API client with auto token refresh
  - `getProfile()`, `listMessages()`, `getMessage()`, `sendMessage()`
  - `getAttachment()`, `listHistory()`, `watch()`, `stopWatch()`
- [ ] Implement `GmailPlugin` extending `BaseChannelPlugin`
  - `connect()` — validate token, call watch(), start history tracking
  - `disconnect()` — call stopWatch(), cleanup
  - `getStatus()` — validate token via getProfile()
- [ ] API routes: `POST /auth/gmail/start`, `GET /auth/gmail/callback`
- [ ] Register plugin in API's channel registry

**Acceptance Criteria:**
- [ ] `make typecheck` passes
- [ ] OAuth flow works (redirects to Google, exchanges code, stores tokens)
- [ ] Plugin connects and sets up Pub/Sub watch

### Group B: Email Processing (Receive + Send + Threads + Attachments)

**Goal:** Full email processing with proper threading, participants, and attachments

**Packages:** `channel-gmail`, `db`

**Deliverables:**
- [ ] DB migration: add `subject` column to messages table (nullable)
- [ ] MIME parser — extract text/HTML/attachments from multipart Gmail messages
- [ ] Incoming email handler:
  - Parse headers (From, To, CC, Subject, In-Reply-To, References)
  - Extract plain text → `textContent`, HTML → `rawPayload.htmlBody`
  - Download attachments → local storage → track in `mediaMetadata.attachments[]`
  - Download inline images → rewrite HTML `cid:` references to local URLs
- [ ] Thread → Chat mapping (create/update chats from Gmail threads)
- [ ] Participant tracking (upsert chatParticipants from email addresses, auto-link to persons)
- [ ] RFC 2822 message composer for sending (text + HTML + attachments + proper threading headers)
- [ ] Message sending: compose → `messages.send()` with `threadId` for proper threading
- [ ] Pub/Sub webhook handler (decode notification → history.list() → process new messages)
- [ ] Incremental sync via `history.list()` (periodic fallback)
- [ ] Initial sync — import recent threads on first connect
- [ ] HTML sanitizer for safe display

**Acceptance Criteria:**
- [ ] Incoming email → thread created as chat → message stored with subject, text, HTML, attachments
- [ ] Multiple attachments per email all downloaded and tracked
- [ ] Inline images preserved in HTML with rewritten local URLs
- [ ] Reply in chat → sent as properly-threaded email (appears in same Gmail thread)
- [ ] Participants from To/CC tracked and auto-linked to persons by email
- [ ] Incremental sync picks up emails missed by Pub/Sub

### Group C: Integration + Tests

**Goal:** Full platform integration, tested and reliable

**Packages:** `channel-gmail`, `api`, `sdk`

**Deliverables:**
- [ ] Pub/Sub webhook route in API (`POST /webhooks/gmail`)
- [ ] End-to-end flow: OAuth → connect → receive email → send reply
- [ ] Token refresh reliability (auto-refresh on 401, emit disconnect on failure)
- [ ] Profile sync (email address, display name from Google profile)
- [ ] Unit tests: MIME parser, RFC 2822 composer, OAuth flow, history sync
- [ ] Integration tests: webhook → message flow, send → Gmail API call
- [ ] Regenerate SDK
- [ ] CLAUDE.md for the package

**Acceptance Criteria:**
- [ ] `make check` passes (typecheck + lint + test)
- [ ] OAuth → connect → receive → reply works end-to-end
- [ ] Token auto-refresh works transparently
- [ ] Large emails with many attachments handled gracefully
- [ ] HTML emails render safely (no XSS)
- [ ] Identity auto-linking: email sender matched to existing person by email

## Success Criteria

- [ ] Gmail plugin loads and registers alongside other channels
- [ ] User can connect their Gmail via OAuth
- [ ] Incoming emails create properly threaded chats with all participants
- [ ] Email subject, text body, HTML body, and all attachments preserved
- [ ] Inline images in HTML emails preserved with local URLs
- [ ] Replying in a chat sends a properly threaded email reply
- [ ] Participants auto-linked to existing persons by email address
- [ ] Token refresh happens transparently
- [ ] `make check` passes
- [ ] No breaking changes to existing channels or schema

## Dependencies

**Internal:**
- `@omni/channel-sdk` — BaseChannelPlugin, ChannelRegistry
- `@omni/core` — Events, types, schemas
- `@omni/db` — Messages table migration

**External:**
- Google Cloud project with:
  - Gmail API enabled
  - Pub/Sub API enabled
  - OAuth 2.0 client credentials
  - Pub/Sub topic + push subscription
- Google account (personal Gmail or Workspace)
- Publicly accessible HTTPS URL for Pub/Sub push + OAuth callback

## References

- [Gmail API Reference](https://developers.google.com/gmail/api/reference/rest)
- [OAuth 2.0 for Web Server Apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail Push Notifications](https://developers.google.com/gmail/api/guides/push)
- [Gmail Message Format](https://developers.google.com/gmail/api/reference/rest/v1/users.messages)
- [RFC 2822 — Internet Message Format](https://www.rfc-editor.org/rfc/rfc2822)
