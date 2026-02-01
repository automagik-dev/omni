# WISH: Send Complete

> Wire up stubbed message send API routes to channel plugins with unified person-ID resolution.

**Status:** FIX-FIRST
**Created:** 2026-02-01
**Author:** WISH Agent
**Beads:** omni-y51

---

## Context

The message sending infrastructure is 90% complete but not wired together:

- **Channel plugins** (WhatsApp, Discord) have full send implementations
- **API routes** (`/messages/*`) exist but return mock responses
- **Person identity system** works but isn't used in send flow

The gap: API routes don't call channel plugins, and you can't send to an Omni person ID.

---

## Problem Statement

**What's broken:**
```bash
# This returns a mock response, doesn't actually send
curl -X POST /api/v2/messages -d '{"instanceId": "...", "to": "+1234567890", "text": "Hello"}'
# Returns: { "messageId": "msg_fake_123", "status": "sent" }  # FAKE!
```

**What we want:**
```bash
# Actually sends via WhatsApp/Discord plugin
curl -X POST /api/v2/messages -d '{"instanceId": "...", "to": "+1234567890", "text": "Hello"}'
# Returns: { "messageId": "BAE5...", "status": "sent" }  # REAL!

# Can also use Omni person ID - auto-resolves to platform ID
curl -X POST /api/v2/messages -d '{"instanceId": "...", "to": "person-uuid-here", "text": "Hello"}'
```

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Channel plugin send methods are production-ready |
| **ASM-2** | Assumption | Person → PlatformIdentity lookup is fast enough |
| **DEC-1** | Decision | Auto-detect recipient format (UUID = person, otherwise = platform ID) |
| **DEC-2** | Decision | If person has multiple identities on channel, use most recently active |
| **DEC-3** | Decision | Store sent messages as events (outbound direction) |
| **DEC-4** | Decision | Return real external message ID from channel |
| **RISK-1** | Risk | Person may not have identity on target channel → clear error message |
| **RISK-2** | Risk | Channel plugin may fail → proper error handling with retry info |

---

## Scope

### IN SCOPE

- Wire `/messages` POST to channel plugin `sendMessage()`
- Wire `/messages/media` POST to channel plugin media send
- Wire `/messages/reaction` POST to channel plugin reaction send
- Wire `/messages/sticker`, `/messages/contact`, `/messages/location`
- Add person-ID auto-resolution in send routes
- Store outbound messages as events in `omni_events`
- Return real message IDs from channels
- Proper error handling with channel-specific codes

### OUT OF SCOPE

- New send types (polls, embeds via API - future wish)
- CLI wrapper (cli-setup wish handles this)
- History sync (separate wish)
- Rate limiting on sends (channels handle their own)

---

## Technical Approach

### Current Flow (Broken)

```
API Route → Mock Response
           (channel plugin never called)
```

### New Flow

```
API Route
    ↓
Validate request (Zod schema ✓)
    ↓
Resolve recipient:
  - If UUID format → lookup Person → get PlatformIdentity for instance's channel
  - If platform format → use directly
    ↓
Get channel plugin from registry
    ↓
Call plugin.sendMessage(instanceId, outgoingMessage)
    ↓
Store event in omni_events (direction: outbound)
    ↓
Return real message ID
```

### Recipient Resolution Logic

```typescript
async function resolveRecipient(to: string, instance: Instance): Promise<string> {
  // Check if it's a UUID (Omni person ID)
  if (isUUID(to)) {
    const person = await services.persons.getById(to);
    const identity = await services.persons.getIdentityForChannel(
      person.id,
      instance.channel
    );
    if (!identity) {
      throw new OmniError({
        code: 'RECIPIENT_NOT_ON_CHANNEL',
        message: `Person ${to} has no identity on ${instance.channel}`,
      });
    }
    return identity.platformUserId;
  }

  // Otherwise, treat as platform-specific ID
  return to;
}
```

---

## Execution Group A: Core Send Wiring

**Goal:** Wire text and media sending through channel plugins.

**Deliverables:**
- [ ] Add `sendMessage()` method to channel registry lookup
- [ ] Update `POST /messages` to call channel plugin
- [ ] Update `POST /messages/media` to call channel plugin
- [ ] Store outbound events in `omni_events`
- [ ] Return real message IDs from channels
- [ ] Add integration test for send flow

**Acceptance Criteria:**
- [ ] `POST /messages` actually sends via WhatsApp/Discord
- [ ] Message appears in recipient's app
- [ ] Event stored in database with `direction: 'outbound'`
- [ ] Response includes real `externalMessageId`

**Validation:**
```bash
# Start API with WhatsApp instance connected
curl -X POST http://localhost:8881/api/v2/messages \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceId": "'$INSTANCE_ID'", "to": "+1234567890", "text": "Test from API"}'

# Verify message received on phone
# Verify event in database
psql -c "SELECT id, direction, text_content FROM omni_events ORDER BY received_at DESC LIMIT 1"
```

---

## Execution Group B: Rich Message Types

**Goal:** Wire remaining message types (reactions, stickers, contacts, locations).

**Deliverables:**
- [ ] Update `POST /messages/reaction` to call channel plugin
- [ ] Update `POST /messages/sticker` to call channel plugin
- [ ] Update `POST /messages/contact` to call channel plugin
- [ ] Update `POST /messages/location` to call channel plugin
- [ ] Add capability checks before sending (e.g., can channel send stickers?)
- [ ] Handle unsupported message types gracefully

**Acceptance Criteria:**
- [ ] Reactions work on WhatsApp and Discord
- [ ] Stickers work on both channels
- [ ] Contacts work on WhatsApp (error on Discord - no phone-based contacts)
- [ ] Location works on WhatsApp (error on Discord - not supported)
- [ ] Capability errors return clear messages

**Validation:**
```bash
# Send reaction
curl -X POST http://localhost:8881/api/v2/messages/reaction \
  -d '{"instanceId": "'$INSTANCE_ID'", "to": "chat-id", "messageId": "msg-id", "emoji": "👍"}'

# Should fail gracefully for unsupported types
curl -X POST http://localhost:8881/api/v2/messages/location \
  -d '{"instanceId": "'$DISCORD_INSTANCE'", ...}'
# Returns: { "error": { "code": "CAPABILITY_NOT_SUPPORTED", "message": "Discord does not support location messages" }}
```

---

## Execution Group C: Person-ID Resolution

**Goal:** Enable sending to Omni person IDs with auto-resolution.

**Deliverables:**
- [ ] Add error codes to `packages/core/src/errors.ts`:
  - `RECIPIENT_NOT_ON_CHANNEL` - Person has no identity on target channel
  - `CAPABILITY_NOT_SUPPORTED` - Channel doesn't support this message type
- [ ] Add `PersonService.getIdentityForChannel(personId, channel)` method
  - Filter identities by channel type
  - Return most recently active if multiple exist (per DEC-2)
  - Return `null` if no identity found
- [ ] Add UUID detection in send routes
- [ ] Implement recipient resolution logic
- [ ] Clear error messages when person not on channel
- [ ] Add tests for resolution scenarios

**Acceptance Criteria:**
- [ ] Can send using Omni person UUID
- [ ] Auto-resolves to correct platform ID
- [ ] Works across WhatsApp and Discord
- [ ] Clear error if person not on that channel
- [ ] If multiple identities, picks most recent

**Validation:**
```bash
# Get a person ID
PERSON_ID=$(curl -s http://localhost:8881/api/v2/persons?search=John | jq -r '.items[0].id')

# Send using person ID (auto-resolves to WhatsApp number)
curl -X POST http://localhost:8881/api/v2/messages \
  -d '{"instanceId": "'$WHATSAPP_INSTANCE'", "to": "'$PERSON_ID'", "text": "Hello via person ID!"}'

# Should work!
```

---

## Dependencies

- `openapi-sync` - For proper SDK types (can proceed in parallel)

## Enables

- `cli-setup` - CLI can use real send functionality
- Automation/webhook triggers that send messages
- Agent responses that actually deliver

---

## Files to Modify

```
packages/api/src/routes/v2/messages.ts   # Main changes - wire to plugins
packages/api/src/services/persons.ts     # Add getIdentityForChannel
packages/core/src/services/events.ts     # Store outbound events
packages/core/src/errors.ts              # Add RECIPIENT_NOT_ON_CHANNEL, CAPABILITY_NOT_SUPPORTED
```

---

## Reference

- WhatsApp senders: `packages/channel-whatsapp/src/senders/`
- Discord senders: `packages/channel-discord/src/senders/`
- Channel capabilities: `packages/channel-*/src/capabilities.ts`

---

## Review Verdict

**Verdict:** FIX-FIRST
**Date:** 2026-02-01
**Reviewer:** REVIEW Agent

### Acceptance Criteria

| Group | Criterion | Status | Evidence |
|-------|-----------|--------|----------|
| A | `POST /messages/send` calls channel plugin | PASS | `messages.ts:507-587` - routes call `plugin.sendMessage()` |
| A | Event stored with `direction: 'outbound'` | PASS | `event-persistence.ts:86-125` - subscribes to `message.sent`, stores with `direction: 'outbound'` |
| A | Response includes real `externalMessageId` | PASS | `messages.ts:577-578` - returns `result.messageId` from channel |
| A | Integration test for send flow | FAIL | No test file found for send routes |
| B | `POST /messages/send/reaction` works | PASS | `messages.ts:689-764` - wired with capability check |
| B | `POST /messages/send/sticker` works | PASS | `messages.ts:769-854` - wired with capability check |
| B | `POST /messages/send/contact` works | PASS | `messages.ts:859-936` - wired with capability check |
| B | `POST /messages/send/location` works | PASS | `messages.ts:941-1023` - wired with capability check |
| B | Capability errors return clear messages | PASS | Uses `CAPABILITY_NOT_SUPPORTED` error code with channel name |
| C | Error codes added | PASS | `errors.ts:37-38` - `RECIPIENT_NOT_ON_CHANNEL`, `CAPABILITY_NOT_SUPPORTED` |
| C | `getIdentityForChannel` method | PASS | `persons.ts:116-142` - filters by channel, returns most recent |
| C | UUID detection in routes | PASS | `messages.ts:51-58` - `isUUID()` function |
| C | Recipient resolution logic | PASS | `messages.ts:71-90` - `resolveRecipient()` implemented |
| C | Tests for resolution scenarios | FAIL | No tests for `getIdentityForChannel` or `resolveRecipient` |

### Quality Gates

| Check | Status | Details |
|-------|--------|---------|
| Typecheck | PASS | All 7 packages pass |
| Tests | PASS | 636 pass, 7 skip, 0 fail |
| Lint | PASS (with warnings) | Warnings in unrelated files only |

### Findings

**LOW: Missing unit tests for new code**
- `PersonService.getIdentityForChannel()` has no tests
- `resolveRecipient()` function has no tests
- Send route handlers have no tests

The implementation is correct and complete. Event persistence for `message.sent` is tested separately. The missing tests are for new code paths added by this wish.

### Recommendation

Before shipping:
1. Add unit tests for `PersonService.getIdentityForChannel()` covering:
   - Person with single identity on channel
   - Person with multiple identities (should pick most recent)
   - Person with no identity on channel (returns null)
2. Add tests for `resolveRecipient()` covering:
   - Platform ID passthrough
   - UUID resolution to platform ID
   - UUID with no identity throws `RECIPIENT_NOT_ON_CHANNEL`

Estimated effort: Add tests to `packages/api/src/services/__tests__/persons.test.ts`
