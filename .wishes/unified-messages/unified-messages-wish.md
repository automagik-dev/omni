# WISH: Unified Messages

> Unified message and chat schema with versioning, linking, and LLM-ready preprocessing.

**Status:** FORGING
**Created:** 2026-02-01
**Author:** WISH Agent
**Beads:** omni-p5c

---

## Context

Omni v2 currently stores everything as events in `omni_events`. This works for audit logging but doesn't support:

- **Chat/conversation modeling** - No dedicated table for chats with types, participants, metadata
- **Message state tracking** - Can't track edits, deletions, version history
- **Cross-channel linking** - Participants not unified across platforms
- **LLM-ready content** - Pre-processed transcriptions/descriptions exist but not structured for context building
- **History sync** - Synced messages won't have events (no webhook triggered)

---

## Key Insight: Messages ARE the Source of Truth

```
FLOW 1: Real-time (webhook)
─────────────────────────────
Platform webhook → Event (audit) → Message (truth)
                   optional        required

FLOW 2: Historical sync (API fetch)
─────────────────────────────
Platform API → Message (truth, NO EVENT)
               required
```

**Messages table is the source of truth.** Events are an optional audit trail for real-time activity only.

---

## Problem Statement

**Current state:**
```
omni_events: { id, externalId, chatId, textContent, ... }
              ↑ chatId is just a string
              ↑ No way to track "Message X was edited at T2"
              ↑ Synced messages have no event
```

**Desired state:**
```
chats: { id, type: 'group', name: 'Family', ... }
  └── messages: { id, externalId, currentText, status: 'edited', editHistory: [...], reactions: [...] }
        ↑ Source of truth
        ↑ Works for both real-time AND synced messages
        ↑ JSONB for edit history and reactions (simple, no extra tables)
```

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Events are audit log for real-time only (synced msgs have no event) |
| **ASM-2** | Assumption | Each message has stable Omni ID + channel external ID |
| **ASM-3** | Assumption | Chat types can be unified across channels |
| **DEC-1** | Decision | **Messages table is source of truth** (not events) |
| **DEC-2** | Decision | Event links are **optional/nullable** (only for real-time) |
| **DEC-3** | Decision | **JSONB arrays** for reactions and edit history (no separate tables) |
| **DEC-4** | Decision | **Raw payload stored on messages** (for synced messages without events) |
| **DEC-5** | Decision | Hybrid chat types: unified enum + channel-specific metadata |
| **DEC-6** | Decision | Full participant tracking for cross-platform linking |
| **RISK-1** | Risk | Migration of existing events to messages - careful planning |
| **RISK-2** | Risk | Performance with large message volumes - proper indexing |

---

## Scope

### IN SCOPE

- `chats` table - Unified chat/conversation model
- `chat_participants` table - Participant tracking with cross-platform linking
- `messages` table - **Source of truth** with JSONB for reactions/history
- Message linking (replies, forwards, mentions)
- Pre-processed content fields (transcription, description, extraction)
- Raw payload on messages (for reprocessing)
- Source tracking (realtime vs sync)
- Migration strategy for existing `omni_events`

### OUT OF SCOPE

- ~~`message_versions` table~~ → Use JSONB `editHistory` array
- ~~`message_reactions` table~~ → Use JSONB `reactions` array
- Media file storage/CDN (existing `media_content` table is sufficient)
- Real-time sync implementation (separate wish)
- Agent context building logic (will use new schema)

---

## Technical Design

### Chat Types (Unified Enum)

```typescript
export const chatTypes = [
  // Common across platforms
  'dm',           // Direct message (1:1)
  'group',        // Multi-party chat (WhatsApp group, Discord group DM)

  // Channel-oriented (Discord, Slack)
  'channel',      // Public/private channel in a server
  'thread',       // Thread within a channel
  'forum',        // Forum channel with thread-per-post
  'voice',        // Voice channel (can have text)

  // Platform-specific
  'broadcast',    // WhatsApp broadcast list
  'community',    // WhatsApp community
  'announcement', // Discord announcement channel
  'stage',        // Discord stage channel
] as const;
```

### Message Sources

```typescript
export const messageSources = [
  'realtime',     // Received via webhook (has event)
  'sync',         // Fetched via history sync (NO event)
  'api',          // Sent via our API
  'import',       // Bulk imported
] as const;
```

---

## New Tables

### 1. `chats` - Unified Chat Model

```typescript
export const chats = pgTable('chats', {
  id: uuid('id').primaryKey().defaultRandom(),
  instanceId: uuid('instance_id').references(() => instances.id),

  // Identity
  externalId: varchar('external_id', { length: 255 }).notNull(), // Platform chat ID
  canonicalId: varchar('canonical_id', { length: 255 }),          // Normalized ID

  // Classification
  chatType: varchar('chat_type', { length: 50 }).notNull().$type<ChatType>(),
  channel: varchar('channel', { length: 50 }).notNull().$type<ChannelType>(),

  // Metadata
  name: varchar('name', { length: 255 }),
  description: text('description'),
  avatarUrl: text('avatar_url'),

  // Hierarchy (for threads, forums)
  parentChatId: uuid('parent_chat_id').references(() => chats.id),

  // Stats (denormalized for performance)
  participantCount: integer('participant_count').default(0),
  messageCount: integer('message_count').default(0),
  unreadCount: integer('unread_count').default(0),

  // Activity
  lastMessageAt: timestamp('last_message_at'),
  lastMessagePreview: varchar('last_message_preview', { length: 255 }),

  // Settings (channel-specific stored here)
  settings: jsonb('settings').$type<ChatSettings>(),

  // Platform metadata (full platform data)
  platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  archivedAt: timestamp('archived_at'),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  instanceExternalIdx: uniqueIndex('chats_instance_external_idx').on(table.instanceId, table.externalId),
  chatTypeIdx: index('chats_type_idx').on(table.chatType),
  parentIdx: index('chats_parent_idx').on(table.parentChatId),
  lastMessageIdx: index('chats_last_message_idx').on(table.lastMessageAt),
}));
```

### 2. `chat_participants` - Cross-Platform Participant Tracking

```typescript
export const chatParticipants = pgTable('chat_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').references(() => persons.id),
  platformIdentityId: uuid('platform_identity_id').references(() => platformIdentities.id),

  // Platform identity
  platformUserId: varchar('platform_user_id', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  avatarUrl: text('avatar_url'),

  // Role (varies by platform)
  role: varchar('role', { length: 50 }), // 'owner', 'admin', 'member', 'guest'

  // Status
  isActive: boolean('is_active').notNull().default(true),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  leftAt: timestamp('left_at'),

  // Activity
  lastSeenAt: timestamp('last_seen_at'),
  messageCount: integer('message_count').default(0),

  // Platform metadata
  platformMetadata: jsonb('platform_metadata').$type<Record<string, unknown>>(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  chatUserIdx: uniqueIndex('chat_participants_chat_user_idx').on(table.chatId, table.platformUserId),
  personIdx: index('chat_participants_person_idx').on(table.personId),
  roleIdx: index('chat_participants_role_idx').on(table.role),
}));
```

### 3. `messages` - Source of Truth

```typescript
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  chatId: uuid('chat_id').notNull().references(() => chats.id),

  // === IDENTITY ===
  externalId: varchar('external_id', { length: 255 }).notNull(), // Platform message ID

  // === SOURCE TRACKING ===
  source: varchar('source', { length: 20 }).notNull().$type<MessageSource>(),
  // 'realtime' | 'sync' | 'api' | 'import'

  // === SENDER ===
  senderPersonId: uuid('sender_person_id').references(() => persons.id),
  senderPlatformIdentityId: uuid('sender_platform_identity_id').references(() => platformIdentities.id),
  senderPlatformUserId: varchar('sender_platform_user_id', { length: 255 }),
  senderDisplayName: varchar('sender_display_name', { length: 255 }),
  isFromMe: boolean('is_from_me').notNull().default(false),

  // === CONTENT (CURRENT STATE) ===
  messageType: varchar('message_type', { length: 50 }).notNull().$type<MessageType>(),
  textContent: text('text_content'),

  // === LLM-READY PRE-PROCESSED CONTENT ===
  transcription: text('transcription'),           // Audio → text (Whisper)
  imageDescription: text('image_description'),    // Image → description (Vision)
  videoDescription: text('video_description'),    // Video → description
  documentExtraction: text('document_extraction'), // Document → text (PyMuPDF/Vision)

  // === MEDIA ===
  hasMedia: boolean('has_media').notNull().default(false),
  mediaMimeType: varchar('media_mime_type', { length: 100 }),
  mediaUrl: text('media_url'),
  mediaLocalPath: text('media_local_path'),
  mediaMetadata: jsonb('media_metadata').$type<MediaMetadata>(),

  // === MESSAGE LINKING ===
  // Reply/Quote
  replyToMessageId: uuid('reply_to_message_id').references(() => messages.id),
  replyToExternalId: varchar('reply_to_external_id', { length: 255 }),
  quotedText: text('quoted_text'),
  quotedSenderName: varchar('quoted_sender_name', { length: 255 }),

  // Forward
  forwardedFromMessageId: uuid('forwarded_from_message_id').references(() => messages.id),
  forwardedFromExternalId: varchar('forwarded_from_external_id', { length: 255 }),
  forwardCount: integer('forward_count').default(0),
  isForwarded: boolean('is_forwarded').notNull().default(false),

  // Mentions (JSONB array)
  mentions: jsonb('mentions').$type<MentionInfo[]>(),

  // === MESSAGE STATE ===
  status: varchar('status', { length: 20 }).notNull().default('active'),
  // 'active' | 'edited' | 'deleted' | 'expired'

  deliveryStatus: varchar('delivery_status', { length: 20 }).default('sent'),
  // 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

  // === EDIT TRACKING (JSONB - no separate table) ===
  editCount: integer('edit_count').notNull().default(0),
  originalText: text('original_text'),  // First version (for quick access)
  editHistory: jsonb('edit_history').$type<EditHistoryEntry[]>(),
  // [{ text: "Hello!", at: "2024-01-01T12:00:00Z" }, ...]
  editedAt: timestamp('edited_at'),
  deletedAt: timestamp('deleted_at'),

  // === REACTIONS (JSONB - no separate table) ===
  reactions: jsonb('reactions').$type<ReactionInfo[]>(),
  // [{ emoji: "👍", userId: "...", personId: "...", at: "..." }, ...]
  reactionCounts: jsonb('reaction_counts').$type<Record<string, number>>(),
  // { "👍": 5, "❤️": 3 } - denormalized for quick display

  // === RAW DATA (stored here, not just event link) ===
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
  // Full platform message object - essential for synced messages!

  // === EVENT LINKS (OPTIONAL - only for realtime) ===
  originalEventId: uuid('original_event_id').references(() => omniEvents.id),
  latestEventId: uuid('latest_event_id').references(() => omniEvents.id),
  // NULL for synced messages - they have no events!

  // === TIMESTAMPS ===
  platformTimestamp: timestamp('platform_timestamp').notNull(), // When platform says sent
  receivedAt: timestamp('received_at').notNull().defaultNow(),  // When we got it
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  chatExternalIdx: uniqueIndex('messages_chat_external_idx').on(table.chatId, table.externalId),
  chatIdx: index('messages_chat_idx').on(table.chatId),
  senderPersonIdx: index('messages_sender_person_idx').on(table.senderPersonId),
  sourceIdx: index('messages_source_idx').on(table.source),
  typeIdx: index('messages_type_idx').on(table.messageType),
  statusIdx: index('messages_status_idx').on(table.status),
  platformTimestampIdx: index('messages_platform_timestamp_idx').on(table.platformTimestamp),
  replyToIdx: index('messages_reply_to_idx').on(table.replyToMessageId),
  hasMediaIdx: index('messages_has_media_idx').on(table.hasMedia),
}));
```

---

## JSONB Types

### Edit History Entry

```typescript
interface EditHistoryEntry {
  text: string;
  at: string;  // ISO timestamp
  by?: string; // Platform user ID who edited (if available)
}
```

### Reaction Info

```typescript
interface ReactionInfo {
  emoji: string;
  platformUserId: string;
  personId?: string;      // If resolved to Omni person
  displayName?: string;
  at: string;             // ISO timestamp
  isCustomEmoji?: boolean;
  customEmojiId?: string; // Discord custom emoji
}
```

### Mention Info

```typescript
interface MentionInfo {
  platformUserId: string;
  personId?: string;
  displayName?: string;
  startIndex?: number;
  length?: number;
  type: 'user' | 'role' | 'channel' | 'everyone' | 'here';
}
```

### Media Metadata

```typescript
interface MediaMetadata {
  width?: number;
  height?: number;
  durationSeconds?: number;
  fileName?: string;
  fileSize?: number;
  isVoiceNote?: boolean;
  waveform?: number[];
  isGif?: boolean;
  processingCostUsd?: number;
  processingModel?: string;
}
```

---

## Example: 3 Edits Scenario

### Timeline
- T1: User sends "Hello"
- T2: User edits to "Hello!"
- T3: User edits to "Hello world!"
- T4: User edits to "Hello world!!"

### In `messages` table (1 row, updated)

```json
{
  "id": "msg-123",
  "externalId": "BAE5ABC123",
  "source": "realtime",

  "textContent": "Hello world!!",
  "status": "edited",
  "editCount": 3,
  "originalText": "Hello",
  "editHistory": [
    { "text": "Hello!", "at": "2024-01-01T12:01:00Z" },
    { "text": "Hello world!", "at": "2024-01-01T12:02:00Z" },
    { "text": "Hello world!!", "at": "2024-01-01T12:03:00Z" }
  ],
  "editedAt": "2024-01-01T12:03:00Z",

  "rawPayload": { /* full WhatsApp message object */ },

  "originalEventId": "evt-1",
  "latestEventId": "evt-4"
}
```

### In `omni_events` table (4 rows - audit only)

| eventType | textContent | receivedAt |
|-----------|-------------|------------|
| message.received | "Hello" | T1 |
| message.edited | "Hello!" | T2 |
| message.edited | "Hello world!" | T3 |
| message.edited | "Hello world!!" | T4 |

### Synced Message (no events)

```json
{
  "id": "msg-456",
  "externalId": "BAE5XYZ789",
  "source": "sync",

  "textContent": "Synced message",
  "status": "active",

  "rawPayload": { /* full platform data from sync */ },

  "originalEventId": null,
  "latestEventId": null
}
```

---

## Execution Group A: Schema & Tables

**Goal:** Create new tables and types.

**Deliverables:**
- [ ] Add chat types enum to schema
- [ ] Add message types enum to schema
- [ ] Add message sources enum to schema
- [ ] Create `chats` table
- [ ] Create `chat_participants` table
- [ ] Create `messages` table (with JSONB for reactions/history)
- [ ] Add relations to existing tables
- [ ] Run migration

**Acceptance Criteria:**
- [ ] `make db-push` succeeds
- [ ] `make typecheck` passes
- [ ] All indexes created properly

**Validation:**
```bash
make db-push
make typecheck
psql -c "\d chats"
psql -c "\d messages"
```

---

## Execution Group B: Services & API

**Goal:** Create services for chat and message management.

**Deliverables:**
- [ ] `ChatService` - CRUD for chats, participant management
- [ ] `MessageService` - CRUD for messages, edit tracking, reactions
- [ ] Update `PersonService` - Link participants to persons
- [ ] Add API routes for chats and messages
- [ ] Integration with event handlers (create message on event)

**Acceptance Criteria:**
- [ ] Can create/get/update chats
- [ ] Can create/get/update messages
- [ ] Can add/remove reactions (updates JSONB array)
- [ ] Can track message edits (updates JSONB array)
- [ ] Real-time events create messages with event link
- [ ] Can create messages without events (for sync)

**Validation:**
```bash
bun test packages/api/src/services/chat.test.ts
bun test packages/api/src/services/message.test.ts
```

---

## Execution Group C: Migration & Integration

**Goal:** Migrate existing events to new schema and integrate with channels.

**Deliverables:**
- [ ] Migration script: events → chats + messages
- [ ] Update WhatsApp handler to create chats/messages
- [ ] Update Discord handler to create chats/messages
- [ ] Backfill script for existing data

**Acceptance Criteria:**
- [ ] Existing conversations appear in `chats` table
- [ ] Existing messages appear in `messages` table
- [ ] New real-time messages create both event AND message
- [ ] Edit/delete events update message state + editHistory

**Validation:**
```bash
bun run scripts/migrate-events-to-messages.ts
psql -c "SELECT COUNT(*) FROM chats"
psql -c "SELECT COUNT(*) FROM messages"
psql -c "SELECT source, COUNT(*) FROM messages GROUP BY source"
```

---

## Dependencies

- None (foundational)

## Enables

- `history-sync` - Can properly sync messages into unified schema
- `send-complete` - Can track sent messages properly
- Agent context building with LLM-ready content
- Cross-platform identity resolution
- Message search and timeline features

---

## Summary: Schema Simplification

| Original Plan | Revised Plan |
|---------------|--------------|
| `messages` table | `messages` table (source of truth) |
| `message_versions` table | ~~removed~~ → JSONB `editHistory` |
| `message_reactions` table | ~~removed~~ → JSONB `reactions` |
| Events as source of truth | **Messages as source of truth** |
| Event link required | Event link **optional** (nullable) |
| Raw payload via event | Raw payload **on message** |

**Result:** 3 tables instead of 5, simpler queries, works for both real-time AND synced messages.
