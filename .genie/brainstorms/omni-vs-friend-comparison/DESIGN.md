# Design: Chat Attention System (Pending + Visibility + Labels)

## Problem

Users have no way to: (1) see which conversations need their attention (unread + pending reply + deferred), (2) hide private conversations from agents, or (3) label conversations for follow-up. A friend's personal "omni" project solves parts of this with scripts (`check_pending.py`, `blocked.txt`, `dataset.csv`). We need native equivalents in Omni v2.

## Scope

### IN
- Add `lastMessageFromMe` denormalized field to chats (for pending reply detection)
- Add `visibility` field to chats (`visible` | `hidden`) for agent privacy
- Add `labels` text array to chats for custom tagging
- New CLI flags: `--pending`, `--attention`, `--label <name>`, `--hidden`
- New CLI commands: `omni chats hide/unhide`, `omni chats label/unlabel`
- New API query params: `pendingOnly`, `attentionOnly`, `label`, `includeHidden`
- New API endpoints: `POST /chats/:id/hide`, `POST /chats/:id/unhide`, `POST /chats/:id/label`, `DELETE /chats/:id/label`
- Backfill script for `lastMessageFromMe` on existing chats
- Update message-persistence to maintain `lastMessageFromMe` on new messages
- Update existing skills/agents to understand visibility, labels, and attention filters
- Single Drizzle migration for all three schema changes

### OUT
- Separate labels table (future, if needed)
- Rule-based visibility (extend access_rules) — future enhancement
- WhatsApp Business label sync (existing TODOs, separate wish)
- Snooze/remind with timers
- Triage workflow / spam classification

## Decisions

### 1. Denormalize `lastMessageFromMe` (not JOIN)
- **Rationale:** Chat list is a hot query. JOIN to messages table to find last msg direction is expensive. Denormalized boolean on chats table is O(1) filter.
- **Trade-off:** Must maintain on every message insert/update in message-persistence plugin.

### 2. `visibility` field on chat (not access_rules extension)
- **Rationale:** Simpler first step. Per-chat toggle. Rule-based can come later.
- **Trade-off:** Manual per-chat, no pattern matching. Acceptable for v1.

### 3. `labels` as text[] array (not separate table)
- **Rationale:** Labels are lightweight user metadata. Array allows SQL `ANY()` filtering without JOINs. Free-form is fine for now.
- **Trade-off:** No label metadata (color, description). No "list all labels" without UNNEST. Acceptable for v1.

### 4. `--attention` as umbrella filter
- **Rationale:** Combines three signals into one actionable view: `unreadCount > 0 OR lastMessageFromMe = false OR labels && '{follow-up}'`
- **Trade-off:** The label component is convention-based (expects 'follow-up' label). Could be configurable later.

### 5. Hidden chats return 404 on direct access
- **Rationale:** True privacy — agent cannot even confirm existence.
- **Trade-off:** If user hides a chat by accident, they need `--hidden` flag to find it again.

## Risks

- **Backfill accuracy:** `lastMessageFromMe` backfill needs to query last message per chat. For large datasets this could be slow. Mitigate with batched SQL update.
- **Pagination with visibility filter:** Must be in SQL WHERE clause, not post-filter, otherwise page sizes become unpredictable.
- **Migration on existing deployments:** Single migration, additive columns with defaults. Low risk.
- **Label sprawl:** Free-form labels could get messy. Consider documenting recommended labels (`follow-up`, `todo`, `vip`, `spam`).

## Acceptance Criteria

### Check Pending / Attention
- [ ] `omni chats list --pending` shows only chats where `lastMessageFromMe = false` AND `unreadCount > 0`
- [ ] `omni chats list --attention` shows chats where `unreadCount > 0 OR lastMessageFromMe = false OR 'follow-up' in labels`
- [ ] New messages update `lastMessageFromMe` correctly (inbound → false, outbound → true)
- [ ] Backfill script correctly populates `lastMessageFromMe` for all existing chats
- [ ] API: `GET /chats?pendingOnly=true` and `GET /chats?attentionOnly=true` work

### Chat Visibility
- [ ] `omni chats hide <id>` sets visibility to 'hidden'
- [ ] `omni chats unhide <id>` sets visibility to 'visible'
- [ ] `omni chats list` excludes hidden chats by default
- [ ] `omni chats list --hidden` includes hidden chats
- [ ] `GET /chats/:id` returns 404 for hidden chats (unless `includeHidden=true`)
- [ ] `GET /messages` excludes messages from hidden chats by default
- [ ] API: `POST /chats/:id/hide` and `POST /chats/:id/unhide` work

### Labels
- [ ] `omni chats label <id> follow-up` adds label to chat
- [ ] `omni chats unlabel <id> follow-up` removes label from chat
- [ ] `omni chats list --label follow-up` filters by label
- [ ] API: `POST /chats/:id/label` with `{ label: "follow-up" }` works
- [ ] API: `DELETE /chats/:id/label` with `{ label: "follow-up" }` works
- [ ] Labels visible in chat list and chat detail responses

### Skills/Agents Update
- [ ] Existing agent skills that list chats are aware of `--attention` flag
- [ ] Skills that interact with chats respect visibility (hidden chats not shown)
- [ ] Skills documentation updated with new label/visibility/attention capabilities

## Files to Change

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `lastMessageFromMe`, `visibility`, `labels` to chats table |
| `packages/db/drizzle/` | Generated migration |
| `packages/api/src/services/chats.ts` | Add filters: pendingOnly, attentionOnly, label, visibility |
| `packages/api/src/services/messages.ts` | Filter messages from hidden chats |
| `packages/api/src/routes/v2/chats.ts` | New query params + hide/unhide/label endpoints |
| `packages/api/src/plugins/message-persistence.ts` | Update lastMessageFromMe on message insert |
| `packages/sdk/src/client.ts` | Add pendingOnly, attentionOnly, label, includeHidden to ListChatsParams |
| `packages/cli/src/commands/chats.ts` | Add --pending, --attention, --label, --hidden flags + hide/unhide/label commands |
| Backfill script (new) | SQL to populate lastMessageFromMe for existing chats |

## Dependencies
- None (self-contained within Omni v2 monorepo)
