# WISH: Channel WhatsApp

> Complete WhatsApp integration via Baileys with full message types, presence, typing, and QR auth.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-aqp

---

## Context

WhatsApp via Baileys is the primary channel. Must support everything Baileys can do: text, media, reactions, presence, typing indicators, read receipts, and QR code authentication.

Reference:
- `docs/architecture/plugin-system.md`
- `docs/migration/v1-features-analysis.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Channel SDK exists with plugin interface |
| **ASM-2** | Assumption | EventBus is working |
| **DEC-1** | Decision | Baileys directly (not Evolution API) |
| **DEC-2** | Decision | Multi-device auth state stored locally |
| **DEC-3** | Decision | JID handling built into plugin |
| **DEC-4** | Decision | Full "feel alive" features: typing, presence, read receipts |

---

## Scope

### IN SCOPE

**Message Types:**
- [ ] Text messages (send/receive)
- [ ] Images with captions
- [ ] Audio (regular and voice notes)
- [ ] Video
- [ ] Documents
- [ ] Stickers
- [ ] Reactions
- [ ] Location
- [ ] Contacts
- [ ] Polls

**"Feel Alive" Features:**
- [ ] Typing indicators (send when processing)
- [ ] Presence (online/offline/composing)
- [ ] Read receipts (mark as read)
- [ ] Message status updates (sent/delivered/read)

**Instance Management:**
- [ ] QR code generation for auth
- [ ] Multi-device session management
- [ ] Reconnection handling
- [ ] Logout/session clear

**Other:**
- [ ] Profile picture fetch
- [ ] Contact sync
- [ ] Chat history sync
- [ ] Group support
- [ ] Broadcast lists

### OUT OF SCOPE

- WhatsApp Cloud API (future wish)
- WhatsApp Business features (catalogs, etc.)
- Voice/video calls

---

## Execution Group A: Core Plugin

**Goal:** Basic WhatsApp plugin with connection and text messaging.

**Deliverables:**
- [ ] `packages/channel-whatsapp/package.json`
- [ ] `packages/channel-whatsapp/tsconfig.json`
- [ ] `packages/channel-whatsapp/src/plugin.ts` - Main plugin class
- [ ] `packages/channel-whatsapp/src/connection.ts` - Baileys connection management
- [ ] `packages/channel-whatsapp/src/auth.ts` - Auth state management
- [ ] `packages/channel-whatsapp/src/handlers/message.ts` - Message handlers
- [ ] Text send/receive working
- [ ] QR code generation

**Acceptance Criteria:**
- [ ] Plugin implements ChannelPlugin interface
- [ ] Can connect via QR code scan
- [ ] Can send text messages
- [ ] Can receive text messages (emits `message.received`)
- [ ] Connection survives restarts (persistent auth)

**Validation:**
```bash
bun test packages/channel-whatsapp
# Manual: scan QR, send test message
```

---

## Execution Group B: Full Message Types

**Goal:** Support all message types and media.

**Deliverables:**
- [ ] `packages/channel-whatsapp/src/handlers/media.ts` - Media handling
- [ ] `packages/channel-whatsapp/src/handlers/reaction.ts` - Reactions
- [ ] `packages/channel-whatsapp/src/handlers/location.ts` - Location
- [ ] `packages/channel-whatsapp/src/handlers/contact.ts` - Contacts
- [ ] `packages/channel-whatsapp/src/handlers/poll.ts` - Polls
- [ ] `packages/channel-whatsapp/src/senders/` - All message type senders

**Acceptance Criteria:**
- [ ] Can send/receive images with captions
- [ ] Can send/receive audio (including voice notes)
- [ ] Can send/receive video
- [ ] Can send/receive documents
- [ ] Can send/receive stickers
- [ ] Can send/receive reactions
- [ ] Can send/receive location
- [ ] Can send/receive contacts

**Validation:**
```bash
# Integration tests with mock
bun test packages/channel-whatsapp/test/media.test.ts
```

---

## Execution Group C: Feel Alive Features

**Goal:** Typing, presence, and status updates.

**Deliverables:**
- [ ] `packages/channel-whatsapp/src/presence.ts` - Presence management
- [ ] `packages/channel-whatsapp/src/typing.ts` - Typing indicators
- [ ] `packages/channel-whatsapp/src/receipts.ts` - Read receipts
- [ ] `packages/channel-whatsapp/src/status.ts` - Message status tracking
- [ ] Debounce configuration support
- [ ] Message splitting with delays

**Acceptance Criteria:**
- [ ] `sendTyping(instanceId, chatId)` shows typing indicator
- [ ] Typing sent automatically when processing messages
- [ ] Presence updates emitted via events
- [ ] Read receipts work (mark chat as read)
- [ ] Message status (sent → delivered → read) tracked
- [ ] Debounce modes work: disabled, fixed, randomized
- [ ] Message splitting on `\n\n` with configurable delays

**Validation:**
```bash
# Test typing indicator
bun run packages/channel-whatsapp/test/typing-test.ts
# Test debounce
bun run packages/channel-whatsapp/test/debounce-test.ts
```

---

## Technical Notes

### Baileys Setup

```typescript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

const { state, saveCreds } = await useMultiFileAuthState(`./data/auth/${instanceId}`);
const sock = makeWASocket({
  auth: state,
  printQRInTerminal: false,
});
sock.ev.on('creds.update', saveCreds);
```

### JID Handling

```typescript
// Normalize phone to JID
function toJid(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

// Group JID
function toGroupJid(groupId: string): string {
  return `${groupId}@g.us`;
}
```

### Typing Indicator

```typescript
async sendTyping(instanceId: string, chatId: string, duration = 3000) {
  const sock = this.getSocket(instanceId);
  await sock.sendPresenceUpdate('composing', chatId);
  setTimeout(() => {
    sock.sendPresenceUpdate('paused', chatId);
  }, duration);
}
```

### Debounce Configuration

```typescript
interface MessagingConfig {
  debounceMode: 'disabled' | 'fixed' | 'randomized';
  debounceMs?: number;        // For fixed
  debounceMinMs?: number;     // For randomized
  debounceMaxMs?: number;     // For randomized
  enableAutoSplit: boolean;
  splitDelayMinMs: number;
  splitDelayMaxMs: number;
}
```

---

## Dependencies

- `@whiskeysockets/baileys`
- `@omni/channel-sdk`
- `@omni/core`

---

## Depends On

- `channel-sdk`
- `nats-events`

## Enables

- Full WhatsApp messaging capability
- Media processing pipeline
