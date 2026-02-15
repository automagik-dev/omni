# WISH: Identity Auto-Link

> Auto-create persons and platform identities when messages are received.

**Status:** SHIPPED
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-dk0

---

## Context

**Problem:** When a message is received, the sender's `personId` and `platformIdentityId` are null. This means:

1. Can't associate messages with a Person
2. Can't use person-based routing for replies
3. Contact sync creates persons, but new senders aren't linked

**Goal:** Automatically create or link sender to Person record when message received.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **DEC-1** | Decision | Auto-create person if not exists |
| **DEC-2** | Decision | Match by platform identifier (phone/userId) |
| **DEC-3** | Decision | Merge with existing person if contact sync created one |
| **ASM-1** | Assumption | Person can have multiple platform identities |

---

## Scope

### IN SCOPE

- Auto-create Person on incoming message
- Create PlatformIdentity linking person to channel
- Update message record with personId/platformIdentityId
- Match existing persons by identifier

### OUT OF SCOPE

- Person merge/deduplication UI
- Cross-channel identity linking (same person on WhatsApp + Discord)
- Contact enrichment (fetch profile from channel)

---

## Execution Group A: Auto-Link on Message

**Goal:** Messages automatically have person/identity populated.

**Beads:** omni-dk0

**Deliverables:**
- [x] Service to find-or-create Person by identifier
- [x] Service to find-or-create PlatformIdentity
- [x] Hook into message processing pipeline
- [x] Update stored message with resolved IDs

**Logic Flow:**

```
1. Message received with sender { identifier, name, ... }
2. Look up PlatformIdentity by (channelType, identifier)
3. If found → use existing personId
4. If not found:
   a. Look for Person with matching identifier in any identity
   b. If found → create PlatformIdentity linked to that Person
   c. If not → create new Person + PlatformIdentity
5. Update message with personId, platformIdentityId
```

**Acceptance Criteria:**
- [x] New sender creates Person + PlatformIdentity
- [x] Repeat sender reuses existing records
- [x] Message has non-null personId
- [x] Works for WhatsApp and Discord
