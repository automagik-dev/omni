# WISH: API Completeness

> Expose all channel plugin capabilities through the unified API and SDK.

**Status:** REVIEW
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-cju

---

## Context

The channel plugins (WhatsApp, Discord) have extensive capabilities that aren't exposed through the API. This creates a gap where the platform can do things internally but external consumers (CLI, SDK, agents) cannot access these features.

**Principle:** Every channel capability should be accessible via the API.

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Channel plugins are stable and tested |
| **ASM-2** | Assumption | SDK auto-generation from OpenAPI will pick up new endpoints |
| **DEC-1** | Decision | Presence endpoint under `/messages/send/presence` (fits send pattern) |
| **DEC-2** | Decision | Read receipts under `/messages/:id/read` or batch endpoint |
| **DEC-3** | Decision | Profile fetching under `/instances/:id/profile/:userId` |
| **DEC-4** | Decision | Default typing duration: 5 seconds |
| **RISK-1** | Risk | Presence duration may drift with async timing |
| **RISK-2** | Risk | Discord only supports typing (no recording/paused) |

---

## Scope

### IN SCOPE

**Cross-Channel Features:**
- Send presence (typing, recording, paused)
- Mark messages as read (single, batch, chat)
- Fetch user profile
- List contacts/groups

### OUT OF SCOPE

- Account-level presence (online/offline)
- Voice channel features
- WhatsApp Business labels
- Block/unblock (TODO in plugins first)
- Discord interactive components (see `discord-interactivity` wish)
- Discord webhooks (see `discord-interactivity` wish)
- Discord slash commands (see `discord-interactivity` wish)

---

## Execution Group A: Presence & Read Receipts

**Goal:** Enable sending typing indicators and marking messages as read.

**Deliverables:**
- [ ] `POST /messages/send/presence` endpoint
- [ ] `POST /messages/:id/read` endpoint (mark single message)
- [ ] `POST /messages/read` endpoint (batch mark read)
- [ ] `POST /chats/:id/read` endpoint (mark entire chat read)
- [ ] SDK methods: `messages.sendPresence()`, `messages.markAsRead()`, `chats.markAsRead()`
- [ ] OpenAPI schema updates

**API Design:**

```typescript
// POST /messages/send/presence
{
  instanceId: string,
  to: string,           // chatId
  type: "typing" | "recording" | "paused",
  duration?: number     // ms, default 5000, 0 = until paused
}

// POST /messages/:id/read
{ instanceId: string }

// POST /messages/read (batch)
{
  instanceId: string,
  chatId: string,
  messageIds: string[]
}

// POST /chats/:id/read
{ instanceId: string }
```

**Acceptance Criteria:**
- [ ] `POST /messages/send/presence` shows typing in WhatsApp
- [ ] `POST /messages/send/presence` shows typing in Discord
- [ ] `POST /messages/send/presence` with `type: "recording"` works (WhatsApp)
- [ ] Duration auto-pauses after specified time
- [ ] Mark single message as read sends read receipt (WhatsApp)
- [ ] Mark chat as read sends read receipt for all (WhatsApp)
- [ ] SDK methods work and are typed correctly

**Validation:**
```bash
# Test presence
curl -X POST /api/v2/messages/send/presence \
  -d '{"instanceId":"...", "to":"...", "type":"typing"}'

# Test read receipt
curl -X POST /api/v2/chats/{chatId}/read \
  -d '{"instanceId":"..."}'
```

---

## Execution Group B: Profile Fetching

**Goal:** Fetch user/contact profiles on demand without full sync.

**Deliverables:**
- [ ] `GET /instances/:id/users/:userId/profile` endpoint
- [ ] `GET /instances/:id/contacts` endpoint (lightweight list)
- [ ] `GET /instances/:id/groups` endpoint (lightweight list)
- [ ] SDK methods: `instances.getUserProfile()`, `instances.listContacts()`, `instances.listGroups()`

**API Design:**

```typescript
// GET /instances/:id/users/:userId/profile
// Response:
{
  data: {
    platformUserId: string,
    displayName: string,
    username?: string,
    avatarUrl?: string,
    bio?: string,
    phone?: string,
    isBot?: boolean,
    isBusiness?: boolean,
    businessInfo?: { ... },
    platformMetadata: { ... }
  }
}

// GET /instances/:id/contacts?limit=100&cursor=...
// Response:
{
  items: Contact[],
  meta: { hasMore, cursor }
}

// GET /instances/:id/groups?limit=100&cursor=...
// Response:
{
  items: Group[],
  meta: { hasMore, cursor }
}
```

**Acceptance Criteria:**
- [ ] Can fetch WhatsApp contact profile by phone/JID
- [ ] Can fetch Discord user profile by user ID
- [ ] Contacts list returns cached contacts
- [ ] Groups list returns cached groups
- [ ] SDK methods work with proper types

**Validation:**
```bash
curl /api/v2/instances/{id}/users/+5511999999999/profile
curl /api/v2/instances/{id}/contacts?limit=50
curl /api/v2/instances/{id}/groups
```

---

## Technical Notes

### Capability Check Pattern

All new endpoints should check channel capabilities before attempting operations:

```typescript
// Check capability before operation
if (!plugin.capabilities.canSendTyping) {
  throw new OmniError({
    code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
    message: `Channel ${instance.channel} does not support typing indicators`,
  });
}
```

### Presence Types by Channel

| Channel | Supported Types |
|---------|-----------------|
| WhatsApp | typing, recording, paused |
| Discord | typing only |

### Read Receipts by Channel

| Channel | Support |
|---------|---------|
| WhatsApp | Full (single, batch, chat) |
| Discord | Not supported |

---

## Dependencies

- Channel plugins have methods implemented (they do)
- SDK auto-generation pipeline

## Enables

- CLI presence commands: `omni send --presence typing`
- CLI read commands: `omni chats read <id>`
- Agent typing indicators while generating responses
- Full Discord bot capabilities via API

---

## Priority Order

1. **Presence** - Most requested, enables agent UX
2. **Read receipts** - Completes WhatsApp feature set
3. **Profile fetching** - Useful for agents
