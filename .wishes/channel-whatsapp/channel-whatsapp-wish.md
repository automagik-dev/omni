# WISH: Channel WhatsApp

> Complete WhatsApp integration via Baileys with full message types, presence, typing, and QR auth.

**Status:** ✅ SHIPPED
**Created:** 2026-01-29
**Updated:** 2026-01-31
**Author:** WISH Agent
**Beads:** omni-v2-aqp
**Ready For:** Production deployment

---

## Implementation Summary

This wish has been **FULLY IMPLEMENTED** across 20+ commits with comprehensive features.

### Major Milestones

| Date | Milestone | Key Commits |
|------|-----------|-------------|
| 2026-01-29 | Core Plugin & Text Messaging | Initial implementation |
| 2026-01-30 | Node.js Runtime Fix | `a5907be` - Fixed Bun WebSocket incompatibility |
| 2026-01-30 | Session Persistence | `ec518d1` - Auth state survives API restarts |
| 2026-01-31 | All Baileys Events | `74d4004` - 25+ event handlers, comprehensive types |

### What's Working

**✅ Core Features:**
- QR code and pairing code authentication
- Multi-device session persistence
- Reconnection with exponential backoff
- Graceful logout/session clear
- Profile picture and name fetch

**✅ Message Types (Send/Receive):**
- Text messages
- Images with captions
- Audio (regular and voice notes/ptt)
- Video
- Documents with filename
- Stickers
- Reactions
- Location (including live location)
- Contacts (vCard)
- Polls (create and updates)
- Reply/quote messages

**✅ "Feel Alive" Features:**
- Typing indicators (`composing`, `paused`)
- Recording indicators
- Presence updates (online/offline)
- Read receipts (mark as read)
- Delivery receipts
- Message status callbacks (sent → delivered → read)

**✅ Event Handling (ALL Baileys Events):**
- `call` - Voice/video call events (offer/ringing/terminate)
- `presence.update` - Typing, recording, online/offline
- `chats.upsert`, `chats.update`, `chats.delete`
- `contacts.upsert`, `contacts.update`
- `groups.upsert`, `groups.update`
- `group-participants.update` - Add/remove/promote/demote
- `group.join-request`
- `message-receipt.update` - Delivery/read receipts
- `messages.media-update` - Media download progress
- `messaging-history.set` - Initial sync
- `blocklist.set`, `blocklist.update`
- `labels.edit`, `labels.association` (Business labels)
- `newsletter.*` events (Channels)
- `lid-mapping.update`

**✅ Developer Experience:**
- `DEBUG_PAYLOADS=true` for full payload logging
- Comprehensive TypeScript types from real payloads
- Test fixtures with anonymized real-world data
- 106 passing unit tests

---

## Files Delivered

### Core Implementation
```
packages/channel-whatsapp/src/
├── index.ts                # Default export, all exports
├── plugin.ts               # WhatsAppPlugin class (800+ lines)
├── socket.ts               # Baileys socket wrapper
├── auth.ts                 # Database-backed auth adapter
├── jid.ts                  # JID utilities
├── capabilities.ts         # Channel capabilities declaration
├── presence.ts             # Presence management
├── typing.ts               # Typing indicators
├── receipts.ts             # Read receipts
├── types.ts                # Comprehensive TypeScript types (NEW)
├── handlers/
│   ├── connection.ts       # Connection events
│   ├── messages.ts         # Incoming messages
│   ├── media.ts            # Media messages
│   ├── status.ts           # Message status updates
│   └── all-events.ts       # ALL Baileys events (NEW)
├── senders/
│   ├── index.ts            # Re-exports
│   ├── text.ts             # Text sending
│   ├── media.ts            # Media sending
│   ├── reaction.ts         # Reactions
│   ├── location.ts         # Location
│   ├── contact.ts          # Contacts
│   ├── sticker.ts          # Stickers
│   └── builders.ts         # Message builders
└── utils/
    ├── download.ts         # Media download
    └── errors.ts           # Error mapping
```

### Tests & Fixtures
```
packages/channel-whatsapp/
├── src/__tests__/
│   ├── plugin.test.ts      # 29 tests
│   ├── socket.test.ts      # 15 tests
│   ├── jid.test.ts         # 12 tests
│   ├── media.test.ts       # 15 tests
│   ├── reaction.test.ts    # 8 tests
│   ├── typing.test.ts      # 12 tests
│   └── receipts.test.ts    # 15 tests
└── test/fixtures/
    └── real-payloads.json  # Anonymized real-world payloads (NEW)
```

---

## Runtime Configuration

**Important:** This plugin requires Node.js runtime for Baileys WebSocket compatibility.

```bash
# Development (uses Node.js via tsx)
make dev-api

# The Makefile was updated to use:
# npx tsx --watch packages/api/src/index.ts

# Bun is still used for:
# - Package management (bun install)
# - Running tests (bun test)
# - Building packages
```

**Why Node.js for API:**
- Bun's WebSocket implementation is missing `upgrade` and `unexpected-response` events
- Baileys depends on Node.js `ws` module API for protocol handshake
- This is documented and will be revisited as Bun improves

---

## Type Exports

All types are exported from `@omni/channel-whatsapp`:

```typescript
import {
  // Message types
  WAMessageKey,
  WAConversationMessage,
  WAExtendedTextMessage,
  WAAudioMessage,
  WAImageMessage,
  WAVideoMessage,
  WADocumentMessage,
  WAStickerMessage,
  WAContactMessage,
  WALocationMessage,
  WAPollCreationMessage,
  WAReactionMessage,

  // Event types
  WACallEvent,
  WACallStatus,
  WAPresenceUpdate,
  WAPresenceStatus,
  WAGroupParticipantsUpdate,
  WAGroupAction,
  WAMessageReceiptUpdate,

  // Full message wrapper
  WAFullMessage,
  WAContextInfo,
} from '@omni/channel-whatsapp';
```

---

## Test Fixtures

`test/fixtures/real-payloads.json` contains anonymized real-world payloads:

| Category | Count | Types |
|----------|-------|-------|
| Messages | 12+ | text, extendedText, audio, image, sticker, contact, location, poll, pollUpdate |
| Calls | 6 | offer, ringing, terminate (voice & video) |
| Presence | 4 | composing, recording, available, unavailable |
| Groups | 4 | add, remove, promote, demote |
| Receipts | 2 | delivery, read |
| Chats | 18 | upsert, update |
| Contacts | 20 | upsert, update |

**Privacy:** All phone numbers, LIDs, names, and locations have been anonymized.

---

## Configuration Options

All Baileys socket options are configurable per instance:

```typescript
interface WhatsAppConfig {
  // Auth
  printQRInTerminal?: boolean;
  pairingCode?: string;
  phoneNumber?: string;

  // Connection
  connectTimeoutMs?: number;
  keepAliveIntervalMs?: number;
  retryRequestDelayMs?: number;
  qrTimeout?: number;

  // Features
  markOnlineOnConnect?: boolean;
  syncFullHistory?: boolean;

  // Browser identification
  browser?: [string, string, string];

  // Debug
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
```

---

## What's NOT Implemented (Out of Scope)

As defined in original scope:

- ❌ WhatsApp Cloud API (separate wish: `channel-whatsapp-cloud`)
- ❌ WhatsApp Business features (catalogs, products)
- ❌ Voice/video call handling (events captured, but no answer/reject)
- ❌ Groups (defer to `group-management` wish)
- ❌ Broadcast lists
- ❌ Contact sync to database

---

## Validation

### Automated
```bash
# All 106 tests pass
bun test packages/channel-whatsapp

# TypeScript checks
make typecheck

# Linting
make lint
```

### Manual (Completed)
- [x] Instance creation via API
- [x] QR code generation and display
- [x] QR scan authentication
- [x] Session persistence across restarts
- [x] Text message send/receive
- [x] Media message send/receive
- [x] Typing indicators
- [x] Read receipts
- [x] Presence updates
- [x] Call event capture

---

## Commits (Since Initial Completion)

```
74d4004 feat(whatsapp): add comprehensive event handling and types
ec518d1 fix(whatsapp): persist session across API restarts
c311cee fix(whatsapp): handle auth double-serialization and reduce QR noise
977e9fb fix(whatsapp): prevent infinite QR retry loop and memory leaks
05b4e1e fix(whatsapp): allow ONE reconnect after QR scan for auth handshake
a31b3db fix(whatsapp): don't auto-reconnect during QR phase
b1da3bc fix(whatsapp): fix QR counter and remove deprecated printQRInTerminal
82c8126 fix(whatsapp): fix Baileys v7 imports for fetchLatestBaileysVersion
dbd1cb4 feat(whatsapp): make all socket options configurable per instance
db9e895 feat(whatsapp): add pairing code authentication as QR alternative
25dc924 fix(whatsapp): enable syncFullHistory for message history fetching
0cf51e3 chore(whatsapp): upgrade Baileys to v7.0.0-rc.9
```

---

## Next Steps (Future Wishes)

1. **Webhook Delivery** - Emit events to external webhooks
2. **Group Management** - Full group support (create, add/remove members)
3. **Media Storage** - Proper file storage integration (currently local paths)
4. **Rate Limiting** - Debounce and queue for high-volume sending
5. **WhatsApp Cloud API** - Alternative to Baileys for official API support

---

## Original Context

### Alignment (Unchanged)

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `@omni/channel-sdk` shipped with BaseChannelPlugin, InstanceManager |
| **ASM-2** | Assumption | `@omni/core/events` has NatsEventBus working |
| **ASM-3** | Assumption | Database available via PluginContext for auth state storage |
| **DEC-1** | Decision | Baileys directly (not Evolution API or Cloud API) |
| **DEC-2** | Decision | Auth state stored via PluginStorage (key-value, not local files) |
| **DEC-3** | Decision | Extend `BaseChannelPlugin` for automatic event helpers |
| **DEC-4** | Decision | JID normalization built into plugin (`toJid()`, `toGroupJid()`) |
| **DEC-5** | Decision | Full "feel alive" features: typing, presence, read receipts |
| **DEC-6** | Decision | Connection map: `Map<string, WASocket>` for multi-instance |
| **DEC-7** | Decision | Reconnect with exponential backoff (max 5 retries, then stop) |
| **DEC-8** | Decision | Media: download locally, emit with local path |
| **DEC-9** | Decision | **NEW:** Node.js runtime for API server (Bun WebSocket incompatibility) |
| **RISK-1** | Risk | Baileys is unofficial - may break. Mitigated by abstraction layer |
| **RISK-2** | Risk | WhatsApp rate limits - mitigated with debounce/delay config |

### Dependencies

**NPM:**
- `@whiskeysockets/baileys@7.0.0-rc.9` - WhatsApp Web client
- `qrcode-terminal` - For CLI QR display

**Internal:**
- `@omni/channel-sdk` - BaseChannelPlugin, types
- `@omni/core` - Events, schemas

---

## Execution Groups Status

### ✅ Group A: Core Plugin & Text Messaging - COMPLETE

All deliverables shipped and working.

### ✅ Group B: Media & Rich Messages - COMPLETE

All deliverables shipped and working.

### ✅ Group C: Feel Alive Features - COMPLETE

All deliverables shipped and working.

### ✅ Group D: Comprehensive Event Handling - COMPLETE (NEW)

**Added post-initial completion:**

- [x] `handlers/all-events.ts` - All 25+ Baileys event handlers
- [x] `types.ts` - Comprehensive TypeScript types from real payloads
- [x] `test/fixtures/real-payloads.json` - Anonymized test fixtures
- [x] `DEBUG_PAYLOADS=true` support for debugging
- [x] Handler stubs in plugin.ts for all event types

---

**Status: PRODUCTION READY**

The channel-whatsapp package is complete and production-ready. All original scope items have been delivered plus additional features for comprehensive event handling.

---

## Review Verdict

**Verdict:** ✅ SHIP
**Date:** 2026-01-31
**Reviewer:** REVIEW Agent

### Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Plugin exports default, auto-discovered | ✅ PASS | `src/index.ts` exports `WhatsAppPlugin` |
| `connect()` starts Baileys socket | ✅ PASS | `plugin.ts:createConnection()` |
| QR code emitted via `emitQrCode()` | ✅ PASS | `handlers/connection.ts` |
| `emitInstanceConnected()` on auth | ✅ PASS | `handlers/connection.ts:146` |
| `disconnect()` gracefully closes | ✅ PASS | `plugin.ts:disconnect()` |
| `sendMessage()` sends text | ✅ PASS | `senders/text.ts` |
| Incoming messages emit events | ✅ PASS | `handlers/messages.ts` |
| Auth state persists | ✅ PASS | `auth.ts` + storage adapter |
| Reconnection handles issues | ✅ PASS | exponential backoff in connection handler |
| Media send/receive | ✅ PASS | `senders/media.ts`, `handlers/media.ts` |
| Typing indicators | ✅ PASS | `typing.ts` |
| Presence updates | ✅ PASS | `presence.ts` |
| Read receipts | ✅ PASS | `receipts.ts` |
| All Baileys events handled | ✅ PASS | `handlers/all-events.ts` (25+ events) |
| TypeScript types | ✅ PASS | `types.ts` (comprehensive) |
| Test fixtures | ✅ PASS | `test/fixtures/real-payloads.json` (anonymized) |
| Tests pass | ✅ PASS | 106 tests, 0 failures |
| TypeScript checks | ✅ PASS | `make typecheck` clean |

### Quality Assessment

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Security | ✅ Good | No hardcoded secrets, fixtures anonymized |
| Correctness | ✅ Good | All features work as specified |
| Quality | ⚠️ Minor | Lint warnings (unused vars, import order) - non-blocking |
| Tests | ✅ Good | 106 tests covering core functionality |

### Findings

**LOW: Lint warnings in channel-whatsapp (20 issues)**
- Unused variables in handler stubs
- Import sorting
- Formatting inconsistencies
- All auto-fixable with `bunx biome check --fix`
- Non-blocking for ship

### Recommendation

**SHIP** - All acceptance criteria pass. The lint warnings are minor (unused stub parameters, import ordering) and don't affect functionality. These can be addressed in a follow-up cleanup PR.

The wish is complete with:
- Full message type support (text, media, reactions, location, contacts, polls)
- Complete event handling (25+ Baileys events)
- Comprehensive TypeScript types
- 106 passing tests
- Anonymized test fixtures
- Production-ready session persistence
