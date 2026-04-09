# Wish: Fix Person Deduplication — One Human, One Person

| Field | Value |
|-------|-------|
| **Status** | READY |
| **Slug** | `fix-person-deduplication` |
| **Date** | 2026-04-05 |
| **Design** | Traced live — 7 duplicate persons for a single user (Felipe Rosa) |

## Summary
The identity graph creates duplicate Person records for the same human across instances, LID addressing modes, and channels. A single user (Felipe Rosa) has 7 Person records because: (1) WhatsApp LID numbers are stored as phone numbers, (2) cross-instance matching doesn't check `platformUserId`, and (3) `resolvedSenderPhone` from the raw payload is ignored during person linking. This wish fixes the identity resolution pipeline and cleans up existing data so one human = one person.

## Scope
### IN
- **Use `resolvedSenderPhone` for person linking** when sender is LID-addressed
- **Cross-instance person matching** by `platformUserId` when phone/email match fails
- **Fix LID-as-phone data corruption** — persons with fake LID phone numbers
- **Orphan cleanup** — delete persons with zero identities
- **Data migration** — merge duplicate persons for existing data
- **Sync worker LID guard** — prevent sync from creating LID-phone persons

### OUT
- Cross-channel matching (WhatsApp ↔ Telegram) — requires manual linking or shared identifier, separate feature
- Person merge UI/CLI — the merge function exists (`mergePersons()`), manual merge is future work
- Changes to the Person data model schema — only runtime logic and data cleanup
- Event backfill — existing events with `personId: null` are not retroactively patched

## Decisions
| Decision | Rationale |
|----------|-----------|
| Use `resolvedSenderPhone` from rawPayload for LID senders | WhatsApp already resolves LID → phone server-side and includes it in every message. The data is there, we just don't use it for person matching. |
| Cross-instance match by `platformUserId` + `channel` | Same platformUserId on same channel across instances = same human. The identity is per-instance (UNIQUE constraint), but the person should be shared. |
| Data migration as a standalone script, not a DB migration | One-time cleanup of existing corruption. Running it as a Drizzle migration risks blocking schema migrations on failure. |
| Don't backfill event `personId` | Events are immutable records. New events will have correct links. Historical analysis can join through messages or identities. |

## Success Criteria
- [ ] `omni persons search "Felipe Rosa"` returns ≤ 2 persons (1 WhatsApp + 1 Telegram, until cross-channel linking ships)
- [ ] New messages from LID-addressed senders link to the correct person (the one with the real phone)
- [ ] No persons exist with `primaryPhone` matching LID format (`+\d{14,}` without valid country code)
- [ ] No persons exist with zero identities (orphan cleanup)
- [ ] Cross-instance messages from same sender link to same person
- [ ] `bun test` passes (all existing tests + new tests)
- [ ] `bunx tsc --noEmit` clean

## Execution Strategy

### Wave 1 (parallel — independent fixes)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Use resolvedSenderPhone for LID person linking |
| 2 | engineer | Add cross-instance person matching by platformUserId |
| 3 | engineer | Guard sync-worker against LID-as-phone |

### Wave 2 (after Wave 1 — depends on fixes being in place)
| Group | Agent | Description |
|-------|-------|-------------|
| 4 | engineer | Data migration: merge duplicates + clean orphans |

### Wave 3 (after Wave 2)
| Group | Agent | Description |
|-------|-------|-------------|
| 5 | engineer | Tests for all identity resolution paths |

## Execution Groups

### Group 1: lid-resolved-phone-linking
**Goal:** When a LID-addressed sender has `resolvedSenderPhone` in the raw payload, use that phone for person matching instead of skipping phone extraction entirely.

**Deliverables:**
1. **`packages/api/src/plugins/message-persistence.ts`** — In `processSenderIdentity()` (~line 267-272):
   - When `isLidAddressed` is true, check `payload.rawPayload?.resolvedSenderPhone` 
   - If present, format as E.164 (`+${resolvedSenderPhone}`) and pass as `matchByPhone` to `findOrCreateIdentity`
   - This replaces the current behavior of passing `undefined` as `matchByPhone` for all LID senders
   - Keep the existing `extractPhoneFromSender` skip for `platformUserId` — the LID number itself is still NOT a phone

```typescript
// Current (line 268):
const phoneNumber = isLidAddressed ? undefined : extractPhoneFromSender(platformUserId, channel);

// Fixed:
const resolvedPhone = isLidAddressed 
  ? (payload.rawPayload?.resolvedSenderPhone as string | undefined)
  : undefined;
const phoneNumber = isLidAddressed 
  ? (resolvedPhone ? `+${resolvedPhone}` : undefined)
  : extractPhoneFromSender(platformUserId, channel);
```

**Acceptance Criteria:**
- [ ] LID-addressed message with `resolvedSenderPhone` in rawPayload → person matched by phone
- [ ] LID-addressed message WITHOUT `resolvedSenderPhone` → creates new person (no regression)
- [ ] Non-LID message → unchanged behavior (extractPhoneFromSender still used)
- [ ] TypeScript compiles

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni && bunx tsc --noEmit
```

**depends-on:** none

---

### Group 2: cross-instance-person-matching
**Goal:** When creating a new identity and no phone/email match found, check if another instance already has an identity with the same `platformUserId` on the same channel and link to that person.

**Deliverables:**
1. **`packages/api/src/services/persons.ts`** — In `findPersonToLink()` (~line 219-247):
   - After phone/email matching fails, add a cross-instance lookup
   - Query `platform_identities` for matching `(channel, platformUserId)` where `personId IS NOT NULL`
   - Exclude the current `instanceId` (already checked in the caller)
   - If found, return that `personId` with `wasLinked: true`
   
2. **`packages/api/src/services/persons.ts`** — Update `findPersonToLink` signature to accept `channel` and `platformUserId`:
   - Add optional `matchByPlatformUserId?: string` and `matchByChannel?: string` to linkOptions
   - The caller already has this data in `findOrCreateIdentity`

3. **`packages/api/src/plugins/message-persistence.ts`** — Pass `platformUserId` and `channel` through linkOptions when calling `findOrCreateIdentity`

**Acceptance Criteria:**
- [ ] Same `platformUserId` on ClaudiA and Sofia → same person
- [ ] Different `platformUserId` → different persons (no false positives)
- [ ] TypeScript compiles

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni && bunx tsc --noEmit
```

**depends-on:** none

---

### Group 3: sync-worker-lid-guard
**Goal:** Prevent the sync worker from storing LID numbers as phone numbers during contact sync.

**Deliverables:**
1. **`packages/api/src/plugins/sync-worker.ts`** — In the `onContact` callback (~line 607-621):
   - Before passing `c.phone` as `matchByPhone`, validate it's a real E.164 number
   - Add guard: if `c.platformUserId` is a known LID format (numeric, >13 digits, no valid country code) and `c.phone` equals that number, skip the phone match
   - Or simpler: use the same `extractPhoneFromSender` validation to check `c.phone` before passing it

```typescript
// Validate phone before using for matching
const phone = c.phone && isValidE164Phone(c.phone) ? c.phone : undefined;
```

2. **`packages/api/src/plugins/message-persistence.ts`** — Extract `extractPhoneFromSender` to a shared utility (or export it) so sync-worker can reuse the same validation logic

**Acceptance Criteria:**
- [ ] Contact sync with LID platformUserId → person created WITHOUT fake phone
- [ ] Contact sync with real phone → person created with correct phone (no regression)
- [ ] TypeScript compiles

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni && bunx tsc --noEmit
```

**depends-on:** none

---

### Group 4: data-migration-merge-duplicates
**Goal:** Clean up existing duplicate persons and fake LID phone numbers. One-time migration script.

**Deliverables:**
1. **New file: `packages/api/scripts/fix-person-duplicates.ts`** — Standalone script:
   
   **Step 1: Fix fake LID phones**
   - Find persons where `primaryPhone` matches LID pattern (`+\d{14,}` where the number is NOT a valid E.164)
   - For each: check if a person exists with the REAL phone (from `resolvedSenderPhone` in related events/mappings)
   - If real-phone person exists: merge LID person → real person using existing `mergePersons()`
   - If not: clear the fake phone from the person record
   
   **Step 2: Merge cross-instance duplicates**
   - Find `platformUserId` values that appear in identities across multiple persons
   - Group by `(channel, platformUserId)` → if multiple `personId`s, merge into the one with the most identities/messages
   
   **Step 3: Delete orphan persons**
   - Delete persons with zero identities AND zero chat_participant references
   
   **Step 4: Report**
   - Print summary: N persons merged, N orphans deleted, N fake phones cleared

2. **`package.json` (packages/api)** — Add script: `"fix-persons": "bun run scripts/fix-person-duplicates.ts"`

**Acceptance Criteria:**
- [ ] Script runs without errors: `cd packages/api && bun run fix-persons`
- [ ] After running: `omni persons search "Felipe Rosa"` returns ≤ 2 persons
- [ ] No persons with `primaryPhone` matching LID pattern
- [ ] No persons with zero identities
- [ ] No data loss — all identities preserved, just re-linked to correct person

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni && cd packages/api && bun run fix-persons --dry-run
```

**depends-on:** Group 1, Group 2, Group 3 (migration should run after code fixes to prevent re-corruption)

---

### Group 5: tests-identity-resolution
**Goal:** Write tests covering the identity resolution paths fixed in Groups 1-3.

**Deliverables:**
1. **New file: `packages/api/src/plugins/__tests__/person-dedup.test.ts`**
   
   - **Test: LID sender with resolvedSenderPhone links to existing person**
     - Create person with phone `+5512982298888`
     - Process message from LID sender with `resolvedSenderPhone: "5512982298888"`
     - Assert: message linked to existing person, NOT a new person created
   
   - **Test: LID sender without resolvedSenderPhone creates new person**
     - Process message from LID sender without `resolvedSenderPhone`
     - Assert: new person created (no regression)
   
   - **Test: Cross-instance same platformUserId links to same person**
     - Create identity for `platformUserId: "12345"` on instance A
     - Process message from `platformUserId: "12345"` on instance B
     - Assert: same person for both identities
   
   - **Test: Different platformUserId creates different person**
     - Process messages from two different platformUserIds
     - Assert: two different persons
   
   - **Test: Sync worker skips LID-format phone**
     - Sync contact with `platformUserId: "54958418317348"` and `phone: "54958418317348"`
     - Assert: person created WITHOUT `primaryPhone`
   
   - **Test: Sync worker preserves real phone**
     - Sync contact with `platformUserId: "5512982298888@s.whatsapp.net"` and `phone: "+5512982298888"`
     - Assert: person created WITH `primaryPhone: "+5512982298888"`

**Acceptance Criteria:**
- [ ] `bun test person-dedup` passes with 6+ test cases
- [ ] All existing tests still pass

**Validation:**
```bash
cd /home/genie/workspace/agents/omni/repos/omni/packages/api && bun test person-dedup && bun test
```

**depends-on:** Group 1, Group 2, Group 3

---

## QA Criteria

_What must be verified on dev after all groups merge._

- [ ] `omni persons search "Felipe Rosa"` returns ≤ 2 results (1 WhatsApp, 1 Telegram)
- [ ] Send message from WhatsApp DM (LID-addressed) → event has correct `personId`
- [ ] Send message from WhatsApp group (LID participant) → message has correct `senderPersonId`
- [ ] Same sender on ClaudiA and Sofia → same `senderPersonId` in both messages
- [ ] `bun test` — 0 failures
- [ ] `bunx tsc --noEmit` — 0 errors
- [ ] No persons in DB with `primaryPhone` matching LID format
- [ ] No persons in DB with zero identities

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Data migration merges wrong persons | Medium | `--dry-run` flag shows what would be merged before executing. Backup DB first. |
| `resolvedSenderPhone` not always present in rawPayload | Low | Fallback: if not present, behavior unchanged (new person created). Field is consistently present in traced events. |
| Cross-instance matching creates false positives for generic platformUserIds | Low | Only match on exact `(channel, platformUserId)` — platformUserIds are channel-specific and unique per user. |
| Existing `mergePersons()` has edge cases | Low | Function exists and works — used by manual merge flow. Test before running migration. |
| WhatsApp changes LID resolution behavior | Low | The fix reads `resolvedSenderPhone` from rawPayload — if WhatsApp stops sending it, we fall back to current behavior (no regression). |

---

## Root Cause Analysis (from live trace)

### The 7 Felipe Rosas

| Person | Phone | Identity | Root Cause |
|--------|-------|----------|------------|
| `2c0f6f77` | `+5512982298888` (REAL) | ClaudiA `5512982298888@s.whatsapp.net` | Initial phone sync — correct |
| `cdf552b4` | `+54958418317348` (FAKE LID) | ClaudiA LID + Sofia LID | **Bug: LID stored as phone** |
| `a4d21037` | null | Telegram `8580070485` | Cross-channel — no shared ID (expected) |
| `76827c07` | null | ClaudiA `54958418317348@s.whatsapp.net` | **Bug: no cross-instance match** |
| `c602334e` | null | Sofia `54958418317348@s.whatsapp.net` | **Bug: no cross-instance match** |
| `6704d13d` | null | ZERO identities | **Bug: orphan from race condition** |
| `92f14d0e` | null | ZERO identities | **Bug: orphan from race condition** |

### Bug 1: LID stored as phone (`message-persistence.ts`)
- `processSenderIdentity` skips phone extraction for LID senders (correct)
- But `resolvedSenderPhone: "5512982298888"` is in the raw payload and ignored
- Result: LID sender → no phone match → new person created

### Bug 2: No cross-instance matching (`persons.ts`)
- `findPersonToLink` only checks `matchByPhone` and `matchByEmail`
- Same `platformUserId` on different instances → different person
- Result: `54958418317348` on ClaudiA → Person A, on Sofia → Person B

### Bug 3: Sync worker stores LID as phone (`sync-worker.ts`)
- `onContact` passes `c.phone` without validation
- If channel plugin returns LID number as `phone`, it becomes `primaryPhone`
- Result: Person `cdf552b4` has `primaryPhone: "+54958418317348"` (a LID, not a phone)

---

## Files to Create/Modify

```
# Group 1: LID phone linking
packages/api/src/plugins/message-persistence.ts     # Use resolvedSenderPhone for LID senders

# Group 2: Cross-instance matching
packages/api/src/services/persons.ts                 # Add platformUserId matching to findPersonToLink
packages/api/src/plugins/message-persistence.ts      # Pass platformUserId in linkOptions

# Group 3: Sync worker guard
packages/api/src/plugins/sync-worker.ts              # Validate phone before matchByPhone
packages/api/src/plugins/message-persistence.ts      # Extract phone validation to shared utility

# Group 4: Data migration
packages/api/scripts/fix-person-duplicates.ts        # NEW — one-time cleanup script

# Group 5: Tests
packages/api/src/plugins/__tests__/person-dedup.test.ts  # NEW — identity resolution tests
```

---

## GitHub Issues
- Creates new issue for person deduplication
- Blocks: `gemini-multimodal-native` (the `omni open` feature needs reliable person resolution)
