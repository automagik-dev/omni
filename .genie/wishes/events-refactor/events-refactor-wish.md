# WISH: Refactor omni_events to lean event log

> Remove duplicated content fields from omni_events and link to messages instead

**Status:** DRAFT
**Created:** 2026-02-06
**Author:** WISH Agent
**Beads:** omni-but

---

## Problem Statement

The `omni_events` table duplicates content fields that already live on `messages` and `media_content`:

```
"Hello this is a transcription"
  → messages.transcription           ← user-facing current state
  → omni_events.transcription        ← why? already on message
  → media_content.content            ← processing details (model, cost)
```

Fields duplicated across `omni_events` and `messages`:
- `textContent`
- `transcription`
- `imageDescription` / `documentExtraction`
- `mediaUrl`, `mediaMimeType`, `mediaSize`, `mediaDuration`
- `replyToExternalId`
- `chatId`, `canonicalChatId`

This triple-storage adds no value — events should be a timeline of what happened, not a copy of message content.

## Scope

### IN SCOPE

1. Add `messageId` FK column to `omni_events` → `messages.id`
2. Remove duplicated content columns from `omni_events`:
   - `textContent`, `transcription`, `imageDescription`, `documentExtraction`
   - `mediaUrl`, `mediaMimeType`, `mediaSize`, `mediaDuration`, `mediaId`
3. Keep event-specific fields that DON'T belong on messages:
   - `eventType`, `direction`, `status`, `errorMessage`, `errorStage`
   - `rawPayload`, `agentRequest`, `agentResponse`
   - `processingTimeMs`, `agentLatencyMs`, `totalLatencyMs`
   - `receivedAt`, `processedAt`, `deliveredAt`, `readAt`
4. Update all code that writes to `omni_events` to set `messageId` instead of copying content
5. Update all code that reads from `omni_events` to JOIN messages when content is needed
6. Migration script to backfill `messageId` on existing events

### OUT OF SCOPE

- Changing the `messages` table structure
- Changing the `media_content` table
- Changing the NATS event payloads

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| **db** | [x] schema, [x] migration | Remove columns, add FK |
| **api** | [x] services | Update event creation + queries |
| **core** | [ ] no changes | Event types stay the same |

## Execution Groups

### Group A: Schema + Migration + Code Updates

**Goal:** Clean `omni_events` table with `messageId` FK, no duplicated content

**Deliverables:**
- [ ] Add `messageId` FK to `omni_events`
- [ ] Migration: backfill `messageId` from existing events (match on `externalId` + `instanceId`)
- [ ] Remove duplicated content columns from schema
- [ ] Update event creation code to use `messageId`
- [ ] Update event queries to JOIN messages where content is needed
- [ ] Update any API routes that read event content directly

**Acceptance Criteria:**
- [ ] `make check` passes
- [ ] `omni_events` no longer stores message content
- [ ] Event queries that need content JOIN to messages
- [ ] Existing events have `messageId` backfilled
- [ ] No data loss

## Success Criteria

- [ ] `omni_events` is a lean event log (~15 columns instead of ~25)
- [ ] Content lives in one place: `messages` table
- [ ] Processing metadata lives in one place: `media_content` table
- [ ] All existing functionality preserved
- [ ] `make check` passes
