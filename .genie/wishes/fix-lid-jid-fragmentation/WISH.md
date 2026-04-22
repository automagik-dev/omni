# Wish: Fix LID/JID fragmentation — canonicalize WhatsApp chatId before debounce and session (#374)

| Field | Value |
|-------|-------|
| **Status** | IN-PROGRESS |
| **Slug** | `fix-lid-jid-fragmentation` |
| **Date** | 2026-04-09 |
| **Design** | Canonicalize in channel-whatsapp plugin (Option 2 from issue) |
| **Branch** | `fix/374-lid-jid-canonicalize` |

## Implementation notes (2026-04-16)

- `storeLidMapping` now populates both `lid→phone` and `phone→lid` in the
  same `Map` (the `@lid` / `@s.whatsapp.net` key namespaces don't collide).
  `publishLidMappings` filters to `@lid`-keyed entries so DB persistence only
  sees the canonical forward direction.
- `resolveCanonicalJid` was a no-op; it now upgrades phone JIDs to LID via
  `remoteJidAlt` first, then the bidirectional cache. Group / broadcast /
  newsletter JIDs short-circuit unchanged; missing mappings fall back to
  the phone JID.
- `resolveChatId` and `resolveSenderJid` call `resolveCanonicalJid` in
  LID-first mode so the chatId and sender the event publishes are already
  stable per human — debounce, session computation, and typing debounce
  all key to a single identity.
- Raw `remoteJid` is preserved on the raw payload as `rawChatId` (via
  `annotateLidResolution`) so audit trails still show what Baileys sent.
- DEC-8 legacy path (`lidFirstEnabled=false`) is untouched.
- Coverage: new `__tests__/canonicalize-jid.test.ts` asserts same-human
  collapse across `@lid`/`@s.whatsapp.net`, group passthrough, and legacy
  mode. Existing `jid.test.ts` cases were updated to reflect the real
  canonicalization behavior.

## Summary

Baileys (WhatsApp Web) routes messages from the same human under two different chatIds: `<lid>@lid` (linked-identity) and `<phone>@s.whatsapp.net` (regular JID). This fragments debounce buffers (messages that should batch together don't) and sessions (agent loses conversation history). The fix canonicalizes chatId in the WhatsApp channel plugin before publishing `message.received` events, so all downstream consumers see a single stable identity per human.

## Problem

Confirmed in production logs (testonho instance): five separate dispatches for one continuous conversation from the same human:

```json
{"chatId":"217046273028329@lid","messageCount":1}
{"chatId":"217046273028329@lid","messageCount":1}
{"chatId":"555197285829@s.whatsapp.net","messageCount":1}
{"chatId":"217046273028329@lid","messageCount":1}
{"chatId":"555197285829@s.whatsapp.net","messageCount":5}
```

**Impact:**
- Debounce is silently broken for any contact whose messages route through both LID and JID
- Session memory is fragmented — agent loses context between bursts
- Trash-emoji session clear is unreliable — only clears one of two sessions
- Typing indicator debounce doesn't work cross-identity

## Root Cause

`resolveChatId()` in `packages/channel-whatsapp/src/handlers/messages.ts:683-710` passes the raw Baileys `remoteJid` through without normalization in LID-first mode. `resolveCanonicalJid()` in `packages/channel-whatsapp/src/jid.ts:190-204` is a no-op that returns its input unchanged. The raw chatId then propagates to:

1. **Debounce buffer key**: `${instanceId}:${chatId}` in `agent-dispatcher.ts:3950-3952`
2. **Session key**: `chatId` directly in `computeSessionId()` for `per_chat` strategy at `agent-runner.ts:233`
3. **Sender identity**: `resolveSenderJid()` also passes through raw JID at `messages.ts:490-513`

The database layer (`findByExternalIdSmart()` in chats.ts) handles bidirectional lookup correctly, but debounce and session computation happen BEFORE any DB lookup, using the raw `payload.chatId`.

## Scope

### IN
- Canonicalize chatId in `resolveChatId()` to a single stable form per human
- Make `resolveCanonicalJid()` actually perform canonicalization (currently a no-op)
- Canonicalize senderId in `resolveSenderJid()` for consistent `per_user` sessions
- Make LID mapping cache bidirectional (currently only lid→phone, need phone→lid too)
- Preserve both original and canonical IDs in the event payload for debugging

### OUT
- No changes to the debounce system itself (it keys correctly once chatId is stable)
- No changes to session computation logic (it works correctly with canonical chatId)
- No DB migrations (chat cross-lookup already works via `findByExternalIdSmart`)
- No changes to other channel plugins (this is WhatsApp-specific)

## Decisions

| Decision | Rationale |
|----------|-----------|
| **Canonicalize to LID** (not phone) when in LID-first mode | LID is the default addressing mode for modern WhatsApp. Canonicalizing to LID means most messages pass through unchanged; only the occasional phone-JID message gets remapped. |
| **Canonicalize in the channel plugin**, not the dispatcher | Lower blast radius. All downstream consumers (debounce, session, typing, rate limiting) automatically get the canonical chatId. No cross-package changes needed. |
| **Bidirectional in-memory cache** | `storeLidMapping()` currently only stores lid→phone. We need phone→lid for canonicalization when a message arrives via phone JID. The `remoteJidAlt` field from Baileys provides the mapping. |
| **Preserve raw JID in payload metadata** | Store original `remoteJid` in the event payload (e.g. `rawChatId` field) so debugging and audit trails still show what Baileys sent. |

## Success Criteria

- [ ] Messages from the same human arriving under `@lid` and `@s.whatsapp.net` are batched into a single debounce buffer
- [ ] `per_chat` session produces a single session per human regardless of Baileys addressing mode
- [ ] `per_user` session produces a single session per human regardless of sender JID format
- [ ] Typing indicators from either JID form reset the correct debounce timer
- [ ] Original raw JID is preserved in the event payload for debugging
- [ ] LID mapping cache stores bidirectional mappings (lid↔phone)
- [ ] No regression in group chat handling (group JIDs are not affected)
- [ ] No regression in non-LID-first mode
- [ ] `bun run build` + `bunx biome check .` + `bun test` all clean
- [ ] PR opened targeting `dev`, linking to #374

## Execution Strategy

### Wave 1 (sequential — changes build on each other)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Make LID mapping cache bidirectional + implement `resolveCanonicalJid()` |
| 2 | engineer | Update `resolveChatId()` and `resolveSenderJid()` to use canonical resolution |

### Wave 2

| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Add tests for LID/JID canonicalization across message flows |
| review | reviewer | Validate against all criteria, run quality gates, open PR |

## Execution Groups

### Group 1: Bidirectional cache + canonical resolution — M, ~1h

**Goal:** Make `resolveCanonicalJid()` actually canonicalize JIDs using an in-memory bidirectional LID↔phone cache.

**Deliverables:**

1. **`packages/channel-whatsapp/src/jid.ts`** — `resolveCanonicalJid()` (~line 190):
   - Replace the no-op implementation with actual canonicalization logic
   - In LID-first mode: if input is `@s.whatsapp.net` and cache has phone→lid mapping, return the LID form
   - If input is `@lid`, return as-is (already canonical)
   - If input is `@s.whatsapp.net` and no mapping exists, return as-is (best effort)
   - For group JIDs (`@g.us`), return as-is (no canonicalization needed)

2. **`packages/channel-whatsapp/src/handlers/messages.ts`** or plugin.ts — `storeLidMapping()`:
   - Currently stores only lid→phone direction
   - Add reverse mapping: phone→lid in the same cache or a parallel Map
   - Both directions populated from `remoteJidAlt` when available

### Group 2: Wire canonicalization into message handlers — S, ~30 min

**Goal:** Use `resolveCanonicalJid()` in `resolveChatId()` and `resolveSenderJid()` so emitted events carry canonical IDs.

**Deliverables:**

1. **`packages/channel-whatsapp/src/handlers/messages.ts`** — `resolveChatId()` (~line 683):
   - After computing `rawChatId`, pass through `resolveCanonicalJid()` before returning
   - Store the original `rawChatId` in a metadata field on the payload for debugging

2. **`packages/channel-whatsapp/src/handlers/messages.ts`** — `resolveSenderJid()` (~line 490):
   - Same pattern: canonicalize the sender JID before returning
   - Ensures `per_user` session strategy sees consistent sender identity

### Group 3: Test coverage — S, ~30 min

**Goal:** Verify canonicalization works across message flows.

**Deliverables:**

1. **Test: same human, two JID forms, single debounce buffer**
   - Mock two messages from same contact: one via `@lid`, one via `@s.whatsapp.net`
   - Assert both resolve to the same canonical chatId
   - Assert debounce would key them to the same buffer

2. **Test: group JIDs pass through unchanged**
   - Mock a group message (`@g.us`)
   - Assert chatId is returned unchanged

3. **Test: no mapping available gracefully falls back**
   - Mock a message with `@s.whatsapp.net` and no cached mapping
   - Assert original JID is returned (no error, no crash)

4. **Test: bidirectional cache population**
   - Populate cache with a lid/phone pair
   - Assert both directions resolve correctly
