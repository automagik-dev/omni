# WISH: Discord Interactivity

> Add Discord slash commands and interactive components (buttons, selects, modals) to the bot.

**Status:** DRAFT
**Created:** 2026-02-02
**Author:** WISH Agent
**Beads:** omni-ras

---

## Context

Discord supports rich interactivity beyond simple messages:

1. **Slash Commands** - `/command` style interactions registered with Discord
2. **Message Components** - Buttons, select menus, attached to messages
3. **Modals** - Pop-up forms for user input
4. **Interactions API** - Webhook-based callbacks when users interact

This would allow building interactive workflows directly in Discord - forms, confirmations, multi-step flows, etc.

**Example Use Cases:**
- `/status` slash command to check instance health
- Buttons on messages: "Approve", "Reject", "Forward"
- Select menu to pick a template response
- Modal form to collect structured data

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Discord.js supports all interaction types we need |
| **ASM-2** | Assumption | Bot has required permissions in target guilds |
| **DEC-1** | Decision | Guild commands for dev/testing, global for production |
| **DEC-2** | Decision | Interactions publish events for automation triggers |
| **DEC-3** | Decision | Deferred responses for long-running operations |
| **RISK-1** | Risk | Discord rate limits on webhook creation (10/guild/day) |
| **RISK-2** | Risk | 3-second interaction response timeout requires defer pattern |
| **RISK-3** | Risk | Global commands take ~1 hour to propagate |

---

## Scope

### IN SCOPE

**API Endpoints:**
- Send button messages
- Send select menu messages
- Update/disable message components
- Remove reactions (single, all)
- Webhook management (create, list, send, delete)
- Slash command registration

**Plugin Features:**
- Interaction webhook handler
- Interaction event types

**Automation Integration:**
- Interaction triggers
- Interaction response actions

### OUT OF SCOPE

- Voice channel interactions
- Stage channel features
- Discord Activities
- Cross-channel presence/read receipts (see `api-completeness` wish)

---

## Technical Notes

### Discord Message Components

```typescript
// Button example
{
  type: 1, // Action Row
  components: [
    {
      type: 2, // Button
      style: 1, // Primary
      label: "Approve",
      custom_id: "approve_123"
    },
    {
      type: 2,
      style: 4, // Danger
      label: "Reject",
      custom_id: "reject_123"
    }
  ]
}
```

### Slash Command Registration

```typescript
// Guild command (instant, for testing)
await rest.put(
  Routes.applicationGuildCommands(clientId, guildId),
  { body: commands }
);

// Global command (takes ~1 hour to propagate)
await rest.put(
  Routes.applicationCommands(clientId),
  { body: commands }
);
```

### Interaction Webhook Flow

```
User clicks button
    ↓
Discord sends POST to interaction endpoint
    ↓
We have 3 seconds to respond (or defer)
    ↓
Publish event: discord.interaction.button
    ↓
Automation triggers
    ↓
Respond via interaction token
```

---

## Execution Group A: Message Components API

**Goal:** Send Discord messages with buttons and select menus via API.

**Deliverables:**
- [ ] `POST /messages/send/buttons` endpoint
- [ ] `POST /messages/send/select-menu` endpoint
- [ ] `POST /messages/:id/components` endpoint (update components)
- [ ] `POST /messages/:id/components/disable` endpoint
- [ ] SDK methods for all

**API Design:**

```typescript
// POST /messages/send/buttons
{
  instanceId: string,
  to: string,
  text: string,
  buttons: Array<{
    id: string,
    label: string,
    style: "primary" | "secondary" | "success" | "danger" | "link",
    url?: string,      // for link style
    emoji?: string,
    disabled?: boolean
  }>,
  replyTo?: string
}

// POST /messages/send/select-menu
{
  instanceId: string,
  to: string,
  text: string,
  menu: {
    id: string,
    placeholder: string,
    minValues?: number,
    maxValues?: number,
    options: Array<{
      label: string,
      value: string,
      description?: string,
      emoji?: string,
      default?: boolean
    }>
  },
  replyTo?: string
}
```

**Acceptance Criteria:**
- [ ] Can send message with clickable buttons
- [ ] Can send message with select dropdown
- [ ] Can update existing message components
- [ ] Can disable all components on a message
- [ ] Buttons support all styles (primary, success, danger, link)
- [ ] Select menus support multi-select

---

## Execution Group B: Reactions & Webhooks API

**Goal:** Full reaction control and webhook management for Discord.

**Deliverables:**
- [ ] `DELETE /messages/:id/reactions/:emoji` - remove bot's reaction
- [ ] `DELETE /messages/:id/reactions` - remove all reactions
- [ ] `POST /instances/:id/webhooks` - create channel webhook
- [ ] `GET /instances/:id/webhooks` - list channel webhooks
- [ ] `POST /instances/:id/webhooks/:id/send` - send via webhook
- [ ] `DELETE /instances/:id/webhooks/:id` - delete webhook

**API Design:**

```typescript
// DELETE /messages/:id/reactions/:emoji
{ instanceId: string, channelId: string }

// POST /instances/:id/webhooks
{
  channelId: string,
  name: string,
  avatar?: string  // URL
}

// POST /instances/:id/webhooks/:webhookId/send
{
  content?: string,
  username?: string,
  avatarUrl?: string,
  embeds?: Embed[],
  threadId?: string
}
```

**Acceptance Criteria:**
- [ ] Can remove bot's reaction from a message
- [ ] Can remove all reactions from a message
- [ ] Can create webhook in a Discord channel
- [ ] Can send message via webhook with custom identity
- [ ] Can delete webhook

**Validation:**
```bash
# Remove reaction
curl -X DELETE /api/v2/messages/{id}/reactions/👍 \
  -d '{"instanceId":"...", "channelId":"..."}'

# Create webhook
curl -X POST /api/v2/instances/{id}/webhooks \
  -d '{"channelId":"...", "name":"Bot Webhook"}'
```

---

## Execution Group C: Interactions & Slash Commands

**Goal:** Handle Discord interactions and register slash commands.

**Deliverables:**
- [ ] Interaction webhook handler in channel-discord
- [ ] Interaction event types in core (`discord.interaction.*`)
- [ ] `POST /instances/:id/commands` - register slash command
- [ ] `GET /instances/:id/commands` - list registered commands
- [ ] `DELETE /instances/:id/commands/:id` - remove command

**API Design:**

```typescript
// POST /instances/:id/commands
{
  name: string,
  description: string,
  options?: Array<{
    name: string,
    description: string,
    type: number,  // STRING=3, INTEGER=4, BOOLEAN=5, USER=6, CHANNEL=7, ROLE=8
    required?: boolean,
    choices?: Array<{ name: string, value: string | number }>
  }>,
  scope: "guild" | "global"
}
```

**Acceptance Criteria:**
- [ ] Can register guild-scoped slash command
- [ ] Can register global slash command
- [ ] Interaction events published when user interacts
- [ ] Can respond to interactions via API

---

## Dependencies

- `channel-discord` stability

## Depends On

- Automation system improvements (for full automation integration)

## Enables

- Interactive Discord bots
- Approval workflows
- Form collection
- Multi-step conversations
