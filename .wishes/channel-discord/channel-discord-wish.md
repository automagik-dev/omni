# WISH: Channel Discord

> Discord.js integration following WhatsApp patterns: same structure, same events, Discord-specific features.

**Status:** READY
**Created:** 2026-01-29
**Updated:** 2026-01-31
**Author:** WISH Agent
**Beads:** omni-v2-6zm

---

## Context

Discord is a first-class channel. This implementation follows the **exact patterns** established in `channel-whatsapp`:
- Same file structure
- Same handler organization
- Same event emission patterns
- Discord-specific adaptations

**Key Differences from WhatsApp:**
| Aspect | WhatsApp | Discord |
|--------|----------|---------|
| Library | Baileys | discord.js |
| Auth | QR code + session | Bot token |
| IDs | Phone/JID | Snowflake (19-digit) |
| Groups | Deferred | Built-in (servers/channels) |
| Rich Content | Location, contacts | Embeds, buttons, components |
| Receipts | Delivery + read | None |
| Rate Limiting | Rare | Common |

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Channel SDK exists with BaseChannelPlugin |
| **ASM-2** | Assumption | EventBus is working |
| **ASM-3** | Assumption | WhatsApp patterns are the template to follow |
| **DEC-1** | Decision | discord.js v14 for bot functionality |
| **DEC-2** | Decision | Token-based auth (stored in PluginStorage like WhatsApp creds) |
| **DEC-3** | Decision | Multi-guild: one instance = one bot token (can be in many guilds) |
| **DEC-4** | Decision | 2000-char message chunking built-in |
| **DEC-5** | Decision | Defer slash commands to Group B (core messaging first) |
| **DEC-6** | Decision | Map Discord channels → Omni `chatId`, users → `personId` |

---

## Scope

### IN SCOPE

**Core (Group A):**
- [ ] Plugin structure matching WhatsApp (plugin.ts, handlers/, senders/)
- [ ] Token-based authentication (stored in PluginStorage)
- [ ] Text messages (send/receive)
- [ ] Attachments (images, files up to 25MB)
- [ ] Replies
- [ ] Typing indicators
- [ ] Multi-guild support (one bot, many servers)
- [ ] 2000-char message chunking

**Rich Features (Group B):**
- [ ] Embeds (rich content with title, description, fields, images)
- [ ] Reactions (add/remove/receive events)
- [ ] Mentions (@user, @role, @channel)
- [ ] Message editing/deleting
- [ ] Thread support (create, reply in thread)

**Slash Commands (Group C):**
- [ ] Register commands per guild
- [ ] Handle command interactions
- [ ] Defer to automations (events-ext) for complex flows

### OUT OF SCOPE

- Voice channels (future)
- Stage channels (future)
- Forum channels (future)
- Scheduled events (future)
- Moderation (kick/ban/timeout) - defer to separate wish
- Guild management events (member join/leave) - defer
- Components (buttons, select menus) - defer to slash commands enhancement

---

## Execution Group A: Core Plugin (Following WhatsApp Pattern)

**Goal:** Discord plugin with same structure as WhatsApp - connection, text messaging, events.

**File Structure (mirrors WhatsApp):**
```
packages/channel-discord/
├── src/
│   ├── index.ts              # Public exports
│   ├── plugin.ts             # DiscordPlugin extends BaseChannelPlugin
│   ├── types.ts              # Discord-specific types
│   ├── auth.ts               # Token storage/loading
│   ├── client.ts             # Discord.js client creation + intents
│   ├── capabilities.ts       # ChannelCapabilities
│   ├── handlers/
│   │   ├── index.ts
│   │   ├── connection.ts     # ready, disconnect, reconnect
│   │   ├── messages.ts       # messageCreate parsing
│   │   └── all-events.ts     # typing, presence
│   ├── senders/
│   │   ├── index.ts
│   │   ├── builders.ts       # Unified content builder
│   │   ├── text.ts           # Text message
│   │   └── media.ts          # Attachments
│   └── utils/
│       ├── errors.ts         # mapDiscordError()
│       └── snowflake.ts      # ID validation
├── __tests__/
│   ├── plugin.test.ts
│   ├── handlers.test.ts
│   └── fixtures/
├── package.json
└── tsconfig.json
```

**Deliverables:**
- [ ] Package setup (package.json, tsconfig.json)
- [ ] `plugin.ts` - DiscordPlugin class extending BaseChannelPlugin
- [ ] `auth.ts` - Token storage in PluginStorage
- [ ] `client.ts` - Discord.js Client with required intents
- [ ] `handlers/connection.ts` - ready, disconnect, error handlers
- [ ] `handlers/messages.ts` - messageCreate → emitMessageReceived
- [ ] `senders/text.ts` - Text message sending with chunking
- [ ] `senders/media.ts` - Attachment sending
- [ ] `utils/errors.ts` - mapDiscordError() for API errors
- [ ] `capabilities.ts` - Discord capabilities declaration
- [ ] Unit tests

**Discord.js Client Setup:**
```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
    ],
  });
}
```

**Acceptance Criteria:**
- [ ] Plugin extends BaseChannelPlugin (like WhatsApp)
- [ ] `connect()` loads token from storage, creates Client, logs in
- [ ] `disconnect()` properly destroys Client
- [ ] `sendMessage()` sends text to channel with chunking
- [ ] `getStatus()` returns connection state
- [ ] messageCreate → emitMessageReceived with correct payload
- [ ] ready → emitInstanceConnected
- [ ] disconnect → emitInstanceDisconnected
- [ ] Error handling maps Discord API errors to OmniError
- [ ] Works across multiple guilds (one bot token, many servers)

**Validation:**
```bash
bun test packages/channel-discord
make typecheck
```

---

## Execution Group B: Rich Features

**Goal:** Embeds, reactions, message editing, threads.

**Deliverables:**
- [ ] `senders/embeds.ts` - Embed builder and sender
- [ ] `senders/reaction.ts` - Add/remove reactions
- [ ] `handlers/reactions.ts` - Reaction event handlers
- [ ] `handlers/messages.ts` - Update for edit/delete events
- [ ] Thread support in message sending
- [ ] Message editing support
- [ ] Mention parsing (@user, @role, @channel)

**Embed Builder:**
```typescript
export function buildEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setDescription(options.description)
    .setColor(options.color ?? 0x5865F2);

  if (options.fields) {
    embed.addFields(options.fields);
  }
  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }
  if (options.image) {
    embed.setImage(options.image);
  }
  if (options.footer) {
    embed.setFooter({ text: options.footer });
  }

  return embed;
}
```

**Acceptance Criteria:**
- [ ] Can send embeds with title, description, fields, images, footer
- [ ] Can add reactions to messages
- [ ] Can remove reactions from messages
- [ ] messageReactionAdd → emitMessageReceived (type: 'reaction')
- [ ] messageReactionRemove → event emission
- [ ] Can edit sent messages
- [ ] Can delete messages
- [ ] messageUpdate → event emission
- [ ] messageDelete → event emission
- [ ] Thread creation and replies work
- [ ] Mentions parsed correctly in incoming messages

**Validation:**
```bash
bun test packages/channel-discord/__tests__/embeds.test.ts
bun test packages/channel-discord/__tests__/reactions.test.ts
```

---

## Execution Group C: Slash Commands

**Goal:** Register and handle slash commands, emit as events for automation integration.

**Deliverables:**
- [ ] `commands/register.ts` - Command registration via REST API
- [ ] `commands/handler.ts` - interactionCreate handler
- [ ] `commands/types.ts` - Slash command type definitions
- [ ] Update `plugin.ts` with command registration on connect
- [ ] Emit `custom.discord.command` events for automation

**Command Registration:**
```typescript
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export async function registerCommands(
  token: string,
  clientId: string,
  guildId: string,
  commands: SlashCommandBuilder[]
): Promise<void> {
  const rest = new REST().setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: commands.map(c => c.toJSON()) }
  );
}
```

**Command Handling:**
```typescript
// Emit as event for automation to handle
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Emit event instead of handling directly
  await plugin.emitCustomEvent('custom.discord.command', {
    instanceId,
    commandName: interaction.commandName,
    options: interaction.options.data,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    // Include interaction ID for deferred responses
    interactionId: interaction.id,
    interactionToken: interaction.token,
  });

  // Defer reply - automation will respond via API
  await interaction.deferReply();
});
```

**Acceptance Criteria:**
- [ ] Commands registered on bot connect (per guild or global)
- [ ] interactionCreate → emits `custom.discord.command` event
- [ ] Command options parsed and included in event payload
- [ ] Interaction deferred for async response
- [ ] API endpoint to respond to deferred interaction
- [ ] Commands configurable via instance settings

**Validation:**
```bash
bun test packages/channel-discord/__tests__/commands.test.ts
# Manual: trigger /ask command, verify event emitted
```

---

## Technical Notes

### ID Mapping (Discord ↔ Omni)

| Discord | Omni | Example |
|---------|------|---------|
| Channel ID | `chatId` | `"1234567890123456789"` |
| User ID | `from.id` / `personId` | `"9876543210987654321"` |
| Message ID | `externalId` | `"1111111111111111111"` |
| Guild ID | (context) | stored but not primary key |

### Token Auth (like WhatsApp creds)

```typescript
// auth.ts - Mirror WhatsApp auth pattern
export async function loadToken(storage: PluginStorage, instanceId: string): Promise<string | null> {
  const data = await storage.get(`${instanceId}:token`);
  return data?.token ?? null;
}

export async function saveToken(storage: PluginStorage, instanceId: string, token: string): Promise<void> {
  await storage.set(`${instanceId}:token`, { token });
}

export async function clearToken(storage: PluginStorage, instanceId: string): Promise<void> {
  await storage.delete(`${instanceId}:token`);
}
```

### Message Chunking (same as WhatsApp)

```typescript
export function chunkMessage(text: string, maxLength = 2000): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt === -1) splitAt = maxLength;

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}
```

### Error Mapping (like mapBaileysError)

```typescript
// utils/errors.ts
import { DiscordAPIError } from 'discord.js';

export function mapDiscordError(error: unknown): OmniError {
  if (error instanceof DiscordAPIError) {
    const code = (() => {
      switch (error.code) {
        case 50001: return ErrorCode.MISSING_ACCESS;
        case 50013: return ErrorCode.MISSING_PERMISSIONS;
        case 50027: return ErrorCode.RATE_LIMITED;
        case 10008: return ErrorCode.UNKNOWN_MESSAGE;
        case 10003: return ErrorCode.UNKNOWN_CHANNEL;
        default: return ErrorCode.DISCORD_API_ERROR;
      }
    })();

    return new OmniError({
      code,
      message: error.message,
      context: { discordCode: error.code },
      recoverable: error.code === 50027, // Rate limit is recoverable
    });
  }
  return new OmniError({ code: ErrorCode.UNKNOWN, message: String(error) });
}
```

### Capabilities

```typescript
export const DISCORD_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,
  canReceiveReadReceipts: false,  // Discord doesn't have read receipts
  canReceiveDeliveryReceipts: false,
  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: false,
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: true,
  canHandleGroups: true,
  canHandleBroadcast: false,
  maxMessageLength: 2000,
  maxFileSize: 25 * 1024 * 1024,  // 25MB for regular servers
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 25 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 25 * 1024 * 1024 },
  ],
};
```

### Handler Pattern (mirrors WhatsApp)

```typescript
// handlers/messages.ts
export function setupMessageHandlers(
  client: Client,
  plugin: DiscordPlugin,
  instanceId: string
): void {
  client.on('messageCreate', async (message) => {
    // Skip bot messages
    if (message.author.bot) return;

    // Extract content type
    const content = extractContent(message);

    // Emit event (same as WhatsApp)
    await plugin.handleMessageReceived(
      instanceId,
      message.id,           // externalId
      message.channelId,    // chatId
      message.author.id,    // from
      content,
      message.reference?.messageId,  // replyToId
      message                // rawMessage
    );
  });
}
```

---

## Dependencies

**NPM:**
- `discord.js` ^14.x
- `pino` (same logger as WhatsApp)

**Internal:**
- `@omni/channel-sdk` - BaseChannelPlugin, ChannelCapabilities
- `@omni/core` - EventBus, OmniError

---

## Depends On

- `channel-sdk` ✅ SHIPPED
- `nats-events` ✅ SHIPPED

## Enables

- Full Discord bot capability
- Multi-guild bot management
- Integration with automations (events-ext) via `custom.discord.command` events
