# WISH: Contacts & Groups Sync

> Sync contacts and groups from WhatsApp and Discord with scheduled refresh and person linking.

**Status:** REVIEW
**Created:** 2026-02-01
**Author:** REVIEW Agent (descoped from history-sync)
**Beads:** omni-lgs
**Depends On:** history-sync (SHIPPED)

---

## Context

This wish was descoped from `history-sync` during review to allow Groups A & B (profile sync, message history, media) to ship as Phase 1.

With message history sync complete, users now need:
- Contact sync to see who they're messaging
- Group/guild sync to understand conversation context
- Automatic refresh to keep data current
- Linking synced contacts to existing persons

---

## Problem Statement

**Current state:**
- Messages sync but contacts don't
- No visibility into WhatsApp contacts or Discord guild members
- Groups/channels exist in messages but not as first-class entities
- No way to link external contacts to Omni persons

**Desired state:**
- WhatsApp contacts synced as platform identities
- Discord guild members synced
- Groups/guilds stored with metadata
- Contacts linked to existing persons by phone/email match
- Daily scheduled refresh

---

## Scope

### IN SCOPE

**Contact Sync:**
- `fetchContacts()` in WhatsApp plugin
- `fetchGuilds()` in Discord plugin (guild members)
- Store contacts as `platform_identities` linked to `persons`
- Link by phone number match (WhatsApp) or email (Discord)
- `POST /instances/:id/sync` with `type: "contacts"`

**Group Sync:**
- Store groups in `omni_groups` table
- WhatsApp groups with metadata (name, description, member count)
- Discord guilds/channels with metadata
- `POST /instances/:id/sync` with `type: "groups"`

**Scheduled Refresh:**
- Daily contact/group refresh job
- Configurable via settings

### OUT OF SCOPE

- Cross-platform contact merging (future)
- Contact enrichment from external sources
- Group messaging features (separate wish)

---

## Technical Approach

### Database Changes

```sql
CREATE TABLE omni_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES instances(id),
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

### Plugin Interface

```typescript
interface ContactSyncPlugin {
  fetchContacts(instanceId: string): Promise<Contact[]>;
}

interface GroupSyncPlugin {
  fetchGroups(instanceId: string): Promise<Group[]>;
}
```

---

## Execution Group A: Contact Sync

**Deliverables:**
- [x] Add `fetchContacts()` to WhatsApp plugin
- [x] Add `fetchGuildMembers()` to Discord plugin
- [x] Store contacts as persons/platform_identities
- [x] Link synced contacts to existing persons by phone match
- [x] Add `POST /instances/:id/sync` with `type: "contacts"`

**Acceptance Criteria:**
- [x] WhatsApp contacts appear as platform identities
- [x] Discord guild members synced
- [x] Contacts linked to existing persons by phone match
- [x] Can trigger contact sync via API

---

## Execution Group B: Group Sync

**Deliverables:**
- [x] Create `omni_groups` table
- [x] Add `fetchGroups()` to WhatsApp plugin
- [x] Add `fetchGuilds()` to Discord plugin
- [x] Store groups with metadata
- [x] Add `POST /instances/:id/sync` with `type: "groups"`

**Acceptance Criteria:**
- [x] WhatsApp groups stored with name, description, member count
- [x] Discord guilds/channels stored with metadata
- [x] Can trigger group sync via API

---

## Execution Group C: Scheduled Refresh

**Deliverables:**
- [x] Add scheduler job for daily contact refresh
- [x] Add scheduler job for daily group refresh
- [x] Configurable schedule via settings

**Acceptance Criteria:**
- [x] Daily refresh runs automatically
- [x] Can configure schedule via settings

---

## Validation

```bash
# Sync contacts
curl -X POST http://localhost:8881/api/v2/instances/$WHATSAPP_INSTANCE/sync \
  -d '{"type": "contacts"}'

# Check persons
curl http://localhost:8881/api/v2/persons?search=John
# Should show synced contacts

# Sync groups
curl -X POST http://localhost:8881/api/v2/instances/$WHATSAPP_INSTANCE/sync \
  -d '{"type": "groups"}'

# Check groups
curl http://localhost:8881/api/v2/instances/$WHATSAPP_INSTANCE/groups
```

---

## Settings

```typescript
{
  "sync.contacts.scheduleEnabled": true,
  "sync.contacts.scheduleCron": "0 3 * * *",   // 3 AM daily
  "sync.groups.scheduleEnabled": true,
  "sync.groups.scheduleCron": "0 4 * * *",     // 4 AM daily
}
```
