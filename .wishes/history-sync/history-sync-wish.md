# WISH: History Sync

> Sync message history, contacts, and groups from channels with rate-limiting and configurable depth.

**Status:** DRAFT
**Created:** 2026-02-01
**Author:** WISH Agent
**Beads:** omni-rnc
**Depends On:** send-complete (recommended but not blocking)

---

## Context

When connecting a new instance (e.g., WhatsApp number), users want to:
- Import existing message history
- Sync contacts and groups
- Have a complete view of conversations in Omni

Currently:
- WhatsApp Baileys has `syncFullHistory` on initial connect
- No on-demand "sync last N days" API
- No scheduled sync for contacts/groups
- No rate limiting to avoid platform throttling

---

## Problem Statement

**Current state:**
- Connect WhatsApp → get initial sync (limited, no control)
- No way to trigger "sync last 30 days" after connection
- Contacts/groups not synced or refreshed
- Risk of hitting rate limits on platforms

**Desired state:**
- On-demand: `POST /instances/:id/sync` with configurable depth
- On-connect: Automatic initial sync (already partial)
- Scheduled: Periodic contact/group refresh
- Rate-limited: Built-in throttling to avoid platform bans
- Deduplication: Don't import same message twice

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Platforms allow fetching historical messages (WhatsApp via Baileys, Discord via API) |
| **ASM-2** | Assumption | Rate limits are known per platform |
| **DEC-1** | Decision | Sync is async job, returns job ID for status polling |
| **DEC-2** | Decision | Default sync depth: 7 days. Max: unlimited ("all time") |
| **DEC-3** | Decision | Dedupe by external message ID |
| **DEC-4** | Decision | Contacts/groups sync runs daily by default |
| **DEC-5** | Decision | Rate limits configurable per channel in settings |
| **RISK-1** | Risk | WhatsApp may ban for aggressive syncing → conservative defaults |
| **RISK-2** | Risk | Large history sync may take hours → progress tracking needed |
| **RISK-3** | Risk | Discord rate limits are strict → per-channel cooldowns |

---

## Scope

### IN SCOPE

- `POST /instances/:id/sync` - On-demand sync API
- Sync job queue with status tracking
- Message history sync (WhatsApp, Discord)
- Contact sync (WhatsApp)
- Group/server sync (WhatsApp groups, Discord guilds/channels)
- Configurable sync depth (7d, 30d, 90d, all)
- Built-in rate limiting per platform
- Message deduplication
- Progress events (sync.started, sync.progress, sync.completed)

### OUT OF SCOPE

- Media file downloading (just metadata for now)
- Cross-channel message merging (messages stay in their channel)
- Real-time message streaming (we already have webhooks for this)
- Telegram/Slack sync (future channels)

---

## Technical Approach

### Sync Job Architecture

```
POST /instances/:id/sync
         ↓
Create SyncJob record (status: pending)
         ↓
Queue job in NATS JetStream
         ↓
Return job ID immediately
         ↓
Worker picks up job
         ↓
Fetch messages from channel (rate-limited)
         ↓
Dedupe against existing events
         ↓
Store new messages in omni_events
         ↓
Emit progress events
         ↓
Mark job complete
```

### Rate Limiting Strategy

| Platform | Messages/min | Contacts/min | Cooldown on 429 |
|----------|--------------|--------------|-----------------|
| WhatsApp | 30 | 60 | 60s exponential |
| Discord | 50 | 100 | 60s exponential |

### Sync Depth Options

```typescript
type SyncDepth = '7d' | '30d' | '90d' | '1y' | 'all';

// Translates to:
const sinceDates = {
  '7d': subDays(now, 7),
  '30d': subDays(now, 30),
  '90d': subDays(now, 90),
  '1y': subYears(now, 1),
  'all': null,  // No date filter
};
```

### Deduplication

```typescript
// Before inserting, check if externalId exists
const existing = await db.query.omniEvents.findFirst({
  where: and(
    eq(omniEvents.instanceId, instanceId),
    eq(omniEvents.externalId, message.externalId)
  )
});

if (!existing) {
  await db.insert(omniEvents).values(messageEvent);
}
```

---

## Execution Group A: Sync Job Infrastructure

**Goal:** Build the job queue and basic sync API.

**Deliverables:**
- [ ] Create `sync_jobs` table (id, instanceId, status, type, config, progress, createdAt, completedAt)
- [ ] Create `SyncService` with job creation and status methods
- [ ] Add `POST /instances/:id/sync` endpoint
- [ ] Add `GET /instances/:id/sync/:jobId` for status
- [ ] Set up NATS consumer for sync jobs
- [ ] Emit sync events (sync.started, sync.progress, sync.completed, sync.failed)

**Acceptance Criteria:**
- [ ] Can create sync job via API
- [ ] Job appears in `sync_jobs` table
- [ ] Can poll job status
- [ ] Events emitted at each stage

**Validation:**
```bash
# Start a sync
JOB_ID=$(curl -X POST http://localhost:8881/api/v2/instances/$INSTANCE_ID/sync \
  -d '{"type": "messages", "depth": "7d"}' | jq -r '.data.jobId')

# Check status
curl http://localhost:8881/api/v2/instances/$INSTANCE_ID/sync/$JOB_ID
# Returns: { "status": "in_progress", "progress": { "fetched": 150, "stored": 148, "duplicates": 2 }}
```

---

## Execution Group B: Message History Sync

**Goal:** Implement message fetching with rate limiting and deduplication.

**Deliverables:**
- [ ] Add `fetchHistory(since, until)` to WhatsApp plugin
- [ ] Add `fetchHistory(channelId, since, until)` to Discord plugin
- [ ] Implement rate limiter with exponential backoff
- [ ] Implement message deduplication logic
- [ ] Store synced messages in `omni_events`
- [ ] Track progress (fetched, stored, skipped)
- [ ] Handle partial failures gracefully

**Acceptance Criteria:**
- [ ] WhatsApp: Can sync last 7 days of messages
- [ ] Discord: Can sync last 7 days from a channel
- [ ] No duplicate messages in database
- [ ] Respects rate limits (observe no 429 errors)
- [ ] Progress updates visible via job status

**Validation:**
```bash
# Sync messages
curl -X POST http://localhost:8881/api/v2/instances/$WHATSAPP_INSTANCE/sync \
  -d '{"type": "messages", "depth": "30d"}'

# Wait for completion, then check
psql -c "SELECT COUNT(*) FROM omni_events WHERE instance_id = '$WHATSAPP_INSTANCE'"
# Should show synced messages
```

---

## Execution Group C: Contacts & Groups Sync

**Goal:** Sync contacts and groups with scheduled refresh.

**Deliverables:**
- [ ] Add `fetchContacts()` to WhatsApp plugin
- [ ] Add `fetchGuilds()` to Discord plugin
- [ ] Store contacts as persons/platform_identities
- [ ] Store groups in `omni_groups` table (new)
- [ ] Add scheduled job for daily contact refresh
- [ ] Add `POST /instances/:id/sync` with `type: "contacts"` or `type: "groups"`
- [ ] Link synced contacts to existing persons where possible

**Acceptance Criteria:**
- [ ] WhatsApp contacts appear as platform identities
- [ ] Discord guild members synced
- [ ] Contacts linked to existing persons by phone match
- [ ] Groups/guilds stored with metadata
- [ ] Daily refresh runs automatically

**Validation:**
```bash
# Sync contacts
curl -X POST http://localhost:8881/api/v2/instances/$WHATSAPP_INSTANCE/sync \
  -d '{"type": "contacts"}'

# Check persons
curl http://localhost:8881/api/v2/persons?search=John
# Should show synced contacts
```

---

## Database Changes

### New Table: `sync_jobs`

```sql
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES omni_instances(id),
  type VARCHAR(50) NOT NULL,  -- 'messages', 'contacts', 'groups', 'all'
  status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  config JSONB NOT NULL DEFAULT '{}',  -- { depth: '30d', channelId: '...' }
  progress JSONB NOT NULL DEFAULT '{}',  -- { fetched: 0, stored: 0, duplicates: 0 }
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### New Table: `omni_groups` (optional, can defer)

```sql
CREATE TABLE omni_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES omni_instances(id),
  external_id VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  description TEXT,
  member_count INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(instance_id, external_id)
);
```

---

## Dependencies

- `send-complete` - Recommended before this (establishes channel plugin patterns)
- `openapi-sync` - For SDK types

## Enables

- Complete conversation history in Omni
- Contact management and search
- Group messaging features
- Analytics on historical data

---

## Settings

```typescript
// Settings for rate limiting (configurable via /settings)
{
  "sync.whatsapp.messagesPerMinute": 30,
  "sync.whatsapp.contactsPerMinute": 60,
  "sync.discord.messagesPerMinute": 50,
  "sync.discord.contactsPerMinute": 100,
  "sync.defaultDepth": "7d",
  "sync.contacts.scheduleEnabled": true,
  "sync.contacts.scheduleCron": "0 3 * * *",  // 3 AM daily
}
```
