# Wish: Agent Address Book — Per-Agent Contacts with CRUD

**Status:** PRE-WISH (quick-win PATCH already implemented)
**Slug:** `agent-address-book`
**Created:** 2026-02-12
**Beads:** `omni-s9r`

---

## Problem

Omni auto-creates `persons` when messages arrive, but:
1. **No CRUD** — agents can't enrich contacts (add email, notes, tags, metadata)
2. **No ownership** — persons are global, no concept of "my contacts" per agent/instance
3. **No agent address book** — agents can't maintain their own organized contact list
4. **No authorized humans** — no way to mark which persons are an agent's "owners" vs "contacts"

Felipe's use case: his bot (Felipe AI) needs a personal address book — search contacts by name, add emails/notes, know who to reach out to.

## Vision

Over time, Omni builds a **neural map** of people ↔ agents:
- 1 agent talking to multiple people
- Multiple people talking to 1 agent  
- Granular permissions per person-agent relationship
- Agents maintain rich contact metadata (tags, notes, relationship type, last contact date)

## What Already Exists

| Feature | Status | Location |
|---------|--------|----------|
| `persons` table | ✅ Has metadata jsonb | `packages/db/src/schema.ts` |
| GET /persons (list/search) | ✅ Works | `packages/api/src/routes/v2/persons.ts` |
| GET /persons/:id | ✅ Works | same |
| GET /persons/:id/presence | ✅ Cross-channel | same |
| GET /persons/:id/timeline | ✅ History | same |
| POST /persons/link | ✅ Identity merge | same |
| POST /persons/merge | ✅ Person merge | same |
| `persons.update()` service | ✅ Exists | `packages/api/src/services/persons.ts` |
| **PATCH /persons/:id** | ✅ Just added | Quick win in this nightly |
| Per-agent scoping | ❌ Missing | — |
| Agent ↔ Person relationship table | ❌ Missing | — |
| POST /persons (create) | ❌ Missing | — |

## Quick Win (Already Done)

Added `PATCH /persons/:id` endpoint accepting:
```json
{
  "displayName": "Cadu Cassau",
  "primaryEmail": "caducassau@gmail.com",
  "primaryPhone": "+5521967831024",
  "metadata": {
    "tags": ["amigo", "tech"],
    "notes": "Role do Chile, quer botar robôs pra trabalhar",
    "relationship": "friend",
    "nextAction": "Papo 13/02 14h"
  }
}
```

## Remaining Work (Follow-Up Wishes)

### Phase 1: CRUD Completion
- POST /persons (create person manually — not just auto-created from messages)
- DELETE /persons/:id (soft delete)
- Bulk update endpoint

### Phase 2: Agent ↔ Person Relationships
- New table: `agent_person_relationships` (agentId, personId, role, permissions, metadata)
- Roles: `owner`, `contact`, `blocked`, `vip`
- Per-agent contact list view: GET /agents/:id/contacts
- Authorized humans list per agent

### Phase 3: Smart Contact Features
- Contact enrichment from message history (auto-extract emails, names)
- Contact recommendations (who should the agent follow up with?)
- Contact activity scoring (last interaction, frequency, sentiment)
- Cross-agent contact sharing (with permissions)

## Success Criteria (Phase 1)
- [ ] PATCH /persons/:id works (✅ done)
- [ ] POST /persons works (create new)
- [ ] Agents can search and enrich contacts via API
- [ ] Felipe AI can maintain its own address book via metadata
