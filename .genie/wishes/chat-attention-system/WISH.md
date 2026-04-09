# Wish: Chat Attention System

| Field | Value |
|-------|-------|
| **Status** | SHIPPED |
| **Slug** | `chat-attention-system` |
| **Date** | 2025-03-10 |
| **Origin** | `.genie/brainstorms/omni-vs-friend-comparison/DESIGN.md` |

## Summary

Add three new capabilities to the chats system: (1) **pending/attention detection** via denormalized `lastMessageFromMe` field, (2) **chat visibility** to hide private conversations from agents entirely, and (3) **labels** as a text array for custom tagging (follow-up, todo, etc). These close the gap with a friend's personal "omni" project that has `check_pending.py`, `blocked.txt`, and `dataset.csv`.

## Scope

### IN
- Schema: `lastMessageFromMe`, `visibility`, `labels` columns on chats table
- Single Drizzle migration for all three
- Backfill script for `lastMessageFromMe` on existing chats
- message-persistence plugin: maintain `lastMessageFromMe` on every message
- ChatService: `pendingOnly`, `attentionOnly`, `label`, visibility filters
- MessageService: exclude messages from hidden chats
- API routes: query params + `hide/unhide/label/unlabel` action endpoints
- SDK: new params on `ListChatsParams`
- CLI: `--pending`, `--attention`, `--label`, `--hidden` flags + `hide/unhide/label/unlabel` commands
- Skills: update `omni-chats` and `omni-messages` SKILL.md

### OUT
- Separate labels table (future if label metadata needed)
- Rule-based visibility via access_rules extension
- WhatsApp Business label sync (existing TODOs, separate wish)
- Snooze/remind timers
- Triage workflow / spam classification
- UI changes (CLI-only for now)

## Decisions

1. **Denormalize `lastMessageFromMe`** — hot query path, O(1) filter beats JOIN
2. **`visibility` field on chat** — simple per-chat toggle, rule-based later
3. **`labels` as `text[]`** — lightweight, SQL `ANY()` filterable, no JOIN
4. **`--attention` umbrella** — `unreadCount > 0 OR lastMessageFromMe = false OR 'follow-up' = ANY(labels)`
5. **Hidden chats return 404** — true privacy, agent can't confirm existence

## Success Criteria

- [ ] `omni chats list --pending` returns chats where last msg is not from me AND has unreads
- [ ] `omni chats list --attention` returns union of unread + pending + follow-up labeled
- [ ] `omni chats hide/unhide <id>` toggles visibility
- [ ] `omni chats list` excludes hidden; `--hidden` includes them
- [ ] `omni chats label/unlabel <id> <label>` manages labels
- [ ] `omni chats list --label follow-up` filters by label
- [ ] Message persistence updates `lastMessageFromMe` on every new message
- [ ] Backfill populates `lastMessageFromMe` for all existing chats
- [ ] Hidden chat messages excluded from `GET /messages` by default
- [ ] Skills `omni-chats` and `omni-messages` updated with new commands

---

## Execution Groups

### Group 1: Schema + Migration

**Goal:** Add all three columns to chats table and generate migration.

**Deliverables:**
- Add to chats table in `packages/db/src/schema.ts` (after line ~923):
  - `lastMessageFromMe: boolean('last_message_from_me')` (nullable, null = unknown)
  - `visibility: varchar('visibility', { length: 20 }).notNull().default('visible')`
  - `labels: text('labels').array().notNull().default(sql`'{}'::text[]`)`
- Export updated `Chat` type (inferred from schema)
- Generate Drizzle migration: `cd packages/db && bunx drizzle-kit generate`

**Acceptance criteria:**
- [ ] Schema compiles without errors
- [ ] Migration file generated in `packages/db/drizzle/`
- [ ] `bun run build` succeeds in packages/db

**Validation:**
```bash
cd packages/db && bun run build && ls -la drizzle/*.sql | tail -1
```

---

### Group 2: Message Persistence — Maintain `lastMessageFromMe`

**Goal:** Keep the denormalized field in sync on every message.

**Deliverables:**
- Update `ChatService.updateLastMessage()` at `packages/api/src/services/chats.ts` (line ~544) to accept and set `isFromMe: boolean` parameter
- Update call site in `packages/api/src/plugins/message-persistence.ts` (line ~498) to pass `message.isFromMe` to `updateLastMessage()`
- Write backfill SQL script at `packages/db/scripts/backfill-last-message-from-me.sql`:
  ```sql
  UPDATE chats SET last_message_from_me = sub.is_from_me
  FROM (
    SELECT DISTINCT ON (chat_id) chat_id, is_from_me
    FROM messages
    WHERE deleted_at IS NULL
    ORDER BY chat_id, platform_timestamp DESC
  ) sub
  WHERE chats.id = sub.chat_id;
  ```

**Acceptance criteria:**
- [ ] `updateLastMessage` sets `lastMessageFromMe` on chat record
- [ ] Backfill script runs without errors on existing data
- [ ] After backfill, chats with last inbound msg have `lastMessageFromMe = false`

**Validation:**
```bash
cd packages/api && bun run build
```

---

### Group 3: Chat Service Filters

**Goal:** Add all new filtering capabilities to the chat service layer.

**Deliverables:**
- Extend `ListChatsOptions` at `packages/api/src/services/chats.ts` (line ~31):
  - `pendingOnly?: boolean`
  - `attentionOnly?: boolean`
  - `label?: string`
  - `includeHidden?: boolean`
- Add conditions in `list()` method (after line ~153, following `unreadOnly` pattern):
  - `pendingOnly`: `lastMessageFromMe = false AND unreadCount > 0`
  - `attentionOnly`: `unreadCount > 0 OR lastMessageFromMe = false OR 'follow-up' = ANY(labels)`
  - `label`: `label = ANY(labels)`
  - visibility: exclude `visibility = 'hidden'` unless `includeHidden = true`
- Add `hide()`, `unhide()` methods (follow `archive()`/`unarchive()` pattern at line ~567)
- Add `addLabel()`, `removeLabel()` methods using SQL array_append/array_remove
- Update `get()` to return 404 for hidden chats (unless includeHidden flag)

**Acceptance criteria:**
- [ ] All new filter options compile and are type-safe
- [ ] `pendingOnly` and `attentionOnly` produce correct SQL conditions
- [ ] `hide/unhide` toggle visibility field
- [ ] `addLabel/removeLabel` use SQL array operations

**Validation:**
```bash
cd packages/api && bun run build
```

---

### Group 4: Message Service — Hidden Chat Filtering

**Goal:** Exclude messages from hidden chats in message listings.

**Deliverables:**
- Update `MessageService.list()` at `packages/api/src/services/messages.ts` (line ~154):
  - When joining to chats table (already happens for instanceIds filter), add condition `chats.visibility = 'visible'` by default
  - Add `includeHidden?: boolean` option to skip this filter

**Acceptance criteria:**
- [ ] `GET /messages` excludes messages from hidden chats
- [ ] `GET /messages?includeHidden=true` includes them

**Validation:**
```bash
cd packages/api && bun run build
```

---

### Group 5: API Routes

**Goal:** Expose all new capabilities via REST endpoints.

**Deliverables:**
- Update `listQuerySchema` at `packages/api/src/routes/v2/chats.ts` (line ~89):
  - `pendingOnly: z.coerce.boolean().optional()`
  - `attentionOnly: z.coerce.boolean().optional()`
  - `label: z.string().optional()`
  - `includeHidden: z.coerce.boolean().default(false)`
- Add action endpoints (follow archive/unarchive pattern at line ~297):
  - `POST /chats/:id/hide`
  - `POST /chats/:id/unhide`
  - `POST /chats/:id/label` with body `{ label: string }`
  - `DELETE /chats/:id/label` with body `{ label: string }`
- Update GET `/chats/:id` to respect hidden visibility

**Acceptance criteria:**
- [ ] All new query params accepted and forwarded to service
- [ ] Hide/unhide endpoints return updated chat
- [ ] Label/unlabel endpoints return updated chat
- [ ] GET single hidden chat returns 404

**Validation:**
```bash
cd packages/api && bun run build
```

---

### Group 6: SDK + CLI

**Goal:** Expose features to SDK consumers and CLI users.

**Deliverables:**
- Update `ListChatsParams` in `packages/sdk/src/client.ts` (line ~397):
  - `pendingOnly?: boolean`, `attentionOnly?: boolean`, `label?: string`, `includeHidden?: boolean`
- Add SDK methods: `chats.hide()`, `chats.unhide()`, `chats.addLabel()`, `chats.removeLabel()`
- Update CLI list command in `packages/cli/src/commands/chats.ts` (line ~547):
  - `--pending`, `--attention`, `--label <name>`, `--hidden` flags
- Add CLI commands (follow archive/unarchive pattern at line ~719):
  - `omni chats hide <id>`
  - `omni chats unhide <id>`
  - `omni chats label <id> <label>`
  - `omni chats unlabel <id> <label>`

**Acceptance criteria:**
- [ ] SDK types compile
- [ ] CLI `--pending`, `--attention`, `--label`, `--hidden` flags work
- [ ] CLI `hide/unhide/label/unlabel` commands work
- [ ] `omni chats list --attention --json` returns valid JSON

**Validation:**
```bash
cd packages/sdk && bun run build && cd ../cli && bun run build
```

---

### Group 7: Skills Update

**Goal:** Update existing skill docs so agents know about new features.

**Deliverables:**
- Update `plugins/omni/skills/omni-chats/SKILL.md`:
  - Add `--pending`, `--attention`, `--label`, `--hidden` to list examples
  - Add `hide/unhide/label/unlabel` commands section
- Update `plugins/omni/skills/omni-messages/SKILL.md`:
  - Note that hidden chat messages are excluded by default

**Acceptance criteria:**
- [ ] Skills reference all new CLI commands and flags
- [ ] Examples are copy-pasteable and correct

**Validation:**
```bash
grep -c "attention\|pending\|label\|hidden\|hide\|unhide" plugins/omni/skills/omni-chats/SKILL.md
```

---

## Dependencies

- None (self-contained within Omni v2 monorepo)

## Assumptions / Risks

- **Backfill performance:** Large chat tables may take time. Batched SQL mitigates.
- **Pagination correctness:** Visibility filter MUST be in SQL WHERE, not post-filter.
- **Null handling:** `lastMessageFromMe = null` (new chats with no messages) should not appear in pending. Use `lastMessageFromMe = false` explicitly.
- **Label convention:** `--attention` hardcodes `follow-up` label. May need config later.
