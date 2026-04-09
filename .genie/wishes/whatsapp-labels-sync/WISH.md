# Wish: WhatsApp native labels sync

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `whatsapp-labels-sync` |
| **Date** | 2026-04-09 |
| **Issues** | [#368](https://github.com/automagik-dev/omni/issues/368) |

## Summary

WhatsApp Business label events (`labels.edit`, `labels.association`) are received by Baileys but dropped by Omni's stub handlers. This wish wires the handlers to persist label definitions and associations, enabling label-based filtering and automation. The DB schema already has a `labels` text array on the `chats` table, and API routes for add/remove exist — this wish fills the gaps.

## Scope

### IN
- Wire `handleLabelEdit()` to persist label definitions (id, name, color) in a new `whatsapp_labels` table
- Wire `handleLabelAssociation()` to sync label ↔ chat associations to the existing `chats.labels` array
- Add a DB migration for the `whatsapp_labels` definition table
- Add `GET /instances/:id/labels` API endpoint to list labels for an instance
- Emit Omni events for label changes (`label.created`, `label.updated`, `label.deleted`, `label.associated`, `label.disassociated`)

### OUT
- Bidirectional sync (API → WhatsApp) — existing `POST/DELETE /chats/:id/label` routes handle this, but wiring them to `sock.addChatLabel()`/`sock.removeChatLabel()` is a follow-up
- Cross-channel label abstraction — this is WhatsApp-specific
- Label-based automation triggers — future wish after labels are persisted
- UI for label management

## Decisions

| Decision | Rationale |
|----------|-----------|
| New `whatsapp_labels` table for definitions | The existing `chats.labels` array stores label names per chat but not definitions (color, WhatsApp internal ID). A definition table enables proper mapping and future bidirectional sync. |
| Reuse existing `chats.labels` array for associations | Already has `addLabel()`/`removeLabel()` service methods + API routes. No need to duplicate. |
| Instance-scoped labels | WhatsApp labels are per-account (per-instance in Omni terms). The definition table is keyed by `(instanceId, labelId)`. |
| Events over webhooks | Omni's event system is the standard way to notify downstream — consistent with all other channel events. |

## Success Criteria

- [ ] `labels.edit` events from Baileys create/update/delete rows in `whatsapp_labels` table
- [ ] `labels.association` events from Baileys add/remove labels in `chats.labels` array via existing service methods
- [ ] `GET /instances/:id/labels` returns all label definitions for an instance
- [ ] Omni events emitted for all label changes (verifiable via `omni events list`)
- [ ] `bun test` passes (zero new failures)
- [ ] `bun run build` clean
- [ ] Migration runs cleanly on fresh DB

## Execution Strategy

### Wave 1 (sequential — migration first)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | DB migration + schema for `whatsapp_labels` table |

### Wave 2 (parallel — after migration)
| Group | Agent | Description |
|-------|-------|-------------|
| 2 | engineer | Wire Baileys event handlers in plugin.ts |
| 3 | engineer | Add `GET /instances/:id/labels` API route |

### Wave 3 (after Wave 2)
| Group | Agent | Description |
|-------|-------|-------------|
| 4 | engineer | Emit Omni events for label changes |
| review | reviewer | Review all groups |

## Execution Groups

### Group 1: DB migration for whatsapp_labels table

**Goal:** Create a `whatsapp_labels` table to store WhatsApp Business label definitions (id, name, color) scoped per instance.

**Deliverables:**
1. New Drizzle migration file creating `whatsapp_labels` table:
   ```sql
   CREATE TABLE whatsapp_labels (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
     label_id VARCHAR(50) NOT NULL,        -- WhatsApp internal label ID
     name VARCHAR(255) NOT NULL,
     color VARCHAR(20),                     -- hex color or color index
     predefined BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
     UNIQUE(instance_id, label_id)
   );
   ```
2. Add corresponding Drizzle schema definition in `packages/db/src/schema.ts`
3. Add index on `instance_id` for fast label listing

**Acceptance Criteria:**
- [ ] Migration runs cleanly: `bun run db:migrate`
- [ ] Schema type-checks: `bun run build` in `packages/db`
- [ ] Unique constraint on `(instance_id, label_id)` prevents duplicates

**Validation:**
```bash
cd packages/db && bun run build
```

**depends-on:** none

---

### Group 2: Wire Baileys label event handlers

**Goal:** Replace stub handlers in `plugin.ts` with real implementations that persist label data.

**Deliverables:**
1. Implement `handleLabelEdit(instanceId, label)` in `packages/channel-whatsapp/src/plugin.ts`:
   - Parse the Baileys label object (id, name, color, predefined, deleted)
   - On create/update: upsert into `whatsapp_labels` table
   - On delete: remove from `whatsapp_labels` table and clean up `chats.labels` associations
2. Implement `handleLabelAssociation(instanceId, association, type)`:
   - Parse the Baileys association object (labelId, chatId, type: 'add' | 'remove')
   - Resolve label name from `whatsapp_labels` table
   - Call existing `chats.addLabel(chatId, labelName)` or `chats.removeLabel(chatId, labelName)`
3. Add proper TypeScript types for Baileys label event payloads (reference `@whiskeysockets/baileys` types)

**Acceptance Criteria:**
- [ ] `handleLabelEdit` creates/updates/deletes label definitions
- [ ] `handleLabelAssociation` adds/removes labels on chats
- [ ] Both methods handle missing/invalid data gracefully (log + skip, never throw)
- [ ] TypeScript types match Baileys event payloads

**Validation:**
```bash
cd packages/channel-whatsapp && bun run build && bun test
```

**depends-on:** Group 1

---

### Group 3: Add GET /instances/:id/labels API route

**Goal:** Expose label definitions via the REST API so agents and UIs can query available labels.

**Deliverables:**
1. Add `GET /instances/:id/labels` route in `packages/api/src/routes/v2/` (follow existing instance-scoped route patterns)
2. Response: `{ items: WhatsappLabel[] }` with id, labelId, name, color, predefined
3. Add OpenAPI schema for the endpoint
4. Add `omni labels list --instance <id>` CLI command (optional, stretch goal)

**Acceptance Criteria:**
- [ ] `GET /instances/:id/labels` returns 200 with label array
- [ ] Empty array returned for instances with no labels
- [ ] 404 for invalid instance ID
- [ ] OpenAPI spec updated

**Validation:**
```bash
cd packages/api && bun run build && bun test
```

**depends-on:** Group 1

---

### Group 4: Emit Omni events for label changes

**Goal:** Emit structured events through Omni's event system when labels are created, updated, deleted, or associated/disassociated with chats.

**Deliverables:**
1. Define event types: `label.created`, `label.updated`, `label.deleted`, `label.associated`, `label.disassociated`
2. Emit events from `handleLabelEdit` and `handleLabelAssociation` after successful DB operations
3. Include relevant metadata: instanceId, labelId, labelName, chatId (for associations)

**Acceptance Criteria:**
- [ ] Events are emitted and visible via `omni events list`
- [ ] Event payloads include all relevant fields
- [ ] Events follow existing Omni event naming conventions

**Validation:**
```bash
cd packages/api && bun test
```

**depends-on:** Group 2

---

## QA Criteria

- [ ] Connect a WhatsApp Business account, create a label in WhatsApp → verify it appears in `whatsapp_labels` table
- [ ] Apply a label to a chat in WhatsApp → verify `chats.labels` array updated
- [ ] `GET /instances/:id/labels` returns the created labels
- [ ] `omni events list` shows label events
- [ ] Remove a label in WhatsApp → verify it's cleaned up in both tables
- [ ] `omni chats list --label <name>` still works (existing filter)
- [ ] `bun test` — zero new failures

---

## Assumptions / Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Baileys label event payload structure may vary across versions | Medium | Type the payloads defensively with optional fields; add runtime validation |
| WhatsApp Business-only feature — personal accounts don't emit label events | Low | Document in the API that labels are Business-only; gracefully handle missing events |
| Label IDs may not be globally unique across instances | Low | The unique constraint is `(instance_id, label_id)`, not `label_id` alone |
| High-volume label changes could create event spam | Low | Labels change infrequently; debouncing not needed initially |

---

## Files to Create/Modify

```
packages/db/src/schema.ts                                    # Add whatsapp_labels table definition
packages/db/drizzle/<timestamp>_add_whatsapp_labels.ts       # Migration file
packages/channel-whatsapp/src/plugin.ts                      # Wire handleLabelEdit + handleLabelAssociation
packages/api/src/routes/v2/labels.ts                         # New: GET /instances/:id/labels
packages/api/src/routes/v2/index.ts                          # Register labels route
packages/api/src/schemas/openapi/labels.ts                   # OpenAPI schema for labels
```
