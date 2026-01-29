# WISH: Channel Discord

> Complete Discord integration with messages, slash commands, reactions, threads, embeds, presence, and moderation.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-6zm

---

## Context

Discord is a first-class channel. Must support comprehensive Discord features: messages, slash commands, reactions, threads, embeds, attachments, guild management, and presence.

Reference:
- `docs/architecture/plugin-system.md`
- `docs/migration/v1-features-analysis.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Channel SDK exists with plugin interface |
| **ASM-2** | Assumption | EventBus is working |
| **DEC-1** | Decision | Discord.js for bot functionality |
| **DEC-2** | Decision | Multi-guild support via `guildIds` config |
| **DEC-3** | Decision | Slash commands configurable per instance |
| **DEC-4** | Decision | 2000-char message chunking built-in |

---

## Scope

### IN SCOPE

**Message Types:**
- [ ] Text messages (send/receive)
- [ ] Embeds (rich content)
- [ ] Attachments (images, files)
- [ ] Reactions (add/remove/get)
- [ ] Replies (threaded)
- [ ] Mentions (@user, @role, @everyone)

**Slash Commands:**
- [ ] Register commands per guild
- [ ] Handle command interactions
- [ ] Autocomplete support
- [ ] Subcommands

**Threads:**
- [ ] Create threads
- [ ] Reply in threads
- [ ] Thread events

**Guild Management:**
- [ ] Member join/leave events
- [ ] Role change events
- [ ] Channel create/delete events
- [ ] Permission checks

**Presence:**
- [ ] Bot activity status
- [ ] User presence updates
- [ ] Typing indicators

**Moderation:**
- [ ] Kick users
- [ ] Ban users
- [ ] Timeout users
- [ ] Manage messages (delete)

### OUT OF SCOPE

- Voice channels
- Stage channels
- Forum channels (for MVP)
- Scheduled events (for MVP)

---

## Execution Group A: Core Plugin

**Goal:** Basic Discord plugin with connection and text messaging.

**Deliverables:**
- [ ] `packages/channel-discord/package.json`
- [ ] `packages/channel-discord/tsconfig.json`
- [ ] `packages/channel-discord/src/plugin.ts` - Main plugin class
- [ ] `packages/channel-discord/src/connection.ts` - Discord.js client management
- [ ] `packages/channel-discord/src/handlers/message.ts` - Message handlers
- [ ] Multi-guild support
- [ ] 2000-char message chunking

**Acceptance Criteria:**
- [ ] Plugin implements ChannelPlugin interface
- [ ] Can connect with bot token
- [ ] Can send text messages to channels
- [ ] Can receive messages (emits `message.received`)
- [ ] Messages over 2000 chars auto-chunked
- [ ] Works across multiple guilds

**Validation:**
```bash
bun test packages/channel-discord
# Manual: send message to Discord channel
```

---

## Execution Group B: Rich Features

**Goal:** Embeds, attachments, reactions, threads.

**Deliverables:**
- [ ] `packages/channel-discord/src/handlers/embed.ts` - Embed handling
- [ ] `packages/channel-discord/src/handlers/attachment.ts` - Attachments
- [ ] `packages/channel-discord/src/handlers/reaction.ts` - Reactions
- [ ] `packages/channel-discord/src/handlers/thread.ts` - Threads
- [ ] `packages/channel-discord/src/senders/` - All message type senders

**Acceptance Criteria:**
- [ ] Can send embeds with title, description, fields, images
- [ ] Can send/receive attachments
- [ ] Can add/remove reactions
- [ ] Can receive reaction events
- [ ] Can create threads
- [ ] Can reply in threads

**Validation:**
```bash
bun test packages/channel-discord/test/embeds.test.ts
bun test packages/channel-discord/test/reactions.test.ts
```

---

## Execution Group C: Slash Commands & Guild Features

**Goal:** Slash commands, guild management, moderation.

**Deliverables:**
- [ ] `packages/channel-discord/src/commands/register.ts` - Command registration
- [ ] `packages/channel-discord/src/commands/handler.ts` - Command handling
- [ ] `packages/channel-discord/src/guild/events.ts` - Guild events
- [ ] `packages/channel-discord/src/guild/moderation.ts` - Moderation actions
- [ ] `packages/channel-discord/src/presence.ts` - Presence & typing

**Acceptance Criteria:**
- [ ] Can register slash commands per guild
- [ ] Can handle slash command interactions
- [ ] Guild events (join/leave) emit events
- [ ] Can kick/ban/timeout users
- [ ] Can set bot activity status
- [ ] Typing indicators work
- [ ] User presence updates received

**Validation:**
```bash
bun test packages/channel-discord/test/commands.test.ts
# Manual: use slash command in Discord
```

---

## Technical Notes

### Discord.js Setup

```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});
```

### Message Chunking

```typescript
function chunkMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find last newline or space before limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}
```

### Slash Command Registration

```typescript
const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI assistant')
    .addStringOption(opt =>
      opt.setName('question')
        .setDescription('Your question')
        .setRequired(true)
    ),
];

await rest.put(
  Routes.applicationGuildCommands(clientId, guildId),
  { body: commands.map(c => c.toJSON()) }
);
```

### Capabilities

```typescript
const capabilities: ChannelCapabilities = {
  canSendText: true,
  canSendImage: true,
  canSendAudio: true,
  canSendVideo: true,
  canSendDocument: true,
  canSendSticker: true,
  canSendReaction: true,
  canSendLocation: false,  // Discord doesn't have native location
  canSendContact: false,   // Discord doesn't have contact cards
  canSendTyping: true,
  canReceivePresence: true,
  canEditMessage: true,
  canDeleteMessage: true,
  supportsThreads: true,
  supportsSlashCommands: true,
  maxMessageLength: 2000,
};
```

---

## Dependencies

- `discord.js`
- `@omni/channel-sdk`
- `@omni/core`

---

## Depends On

- `channel-sdk`
- `nats-events`

## Enables

- Full Discord bot capability
- Multi-guild bot management
