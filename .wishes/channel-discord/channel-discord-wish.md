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
- [ ] Direct Messages (DMs) support
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
- [ ] Stickers (send/receive)
- [ ] Polls (create, receive votes)

**Interactive Components (Group C):**
- [ ] Buttons (action buttons in messages)
- [ ] Select Menus (dropdown selections)
- [ ] Modals/Forms (text input dialogs)
- [ ] Slash commands (register, handle)
- [ ] Context menu commands (right-click actions)
- [ ] Autocomplete for command options

**Discord Webhooks (Group C):**
- [ ] Create Discord webhooks
- [ ] Send via Discord webhooks (for external integrations)

### OUT OF SCOPE

- Voice channels (future wish)
- Stage channels (future)
- Forum channels (future)
- Scheduled events (future)
- Moderation (kick/ban/timeout) - defer to separate wish
- Guild management events (member join/leave) - defer

---

## Execution Group A: Core Plugin (Following WhatsApp Pattern)

**Goal:** Discord plugin with same structure as WhatsApp - connection, text messaging, events.

**File Structure (extends WhatsApp pattern):**
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
│   │   ├── messages.ts       # messageCreate, update, delete
│   │   ├── reactions.ts      # reaction add/remove
│   │   ├── interactions.ts   # buttons, menus, modals, commands
│   │   └── all-events.ts     # typing, presence, threads
│   ├── senders/
│   │   ├── index.ts
│   │   ├── builders.ts       # Unified content builder
│   │   ├── text.ts           # Text message
│   │   ├── media.ts          # Attachments
│   │   ├── embeds.ts         # Embed builder
│   │   ├── sticker.ts        # Sticker sending
│   │   ├── poll.ts           # Poll creation
│   │   └── reaction.ts       # Reaction add/remove
│   ├── components/
│   │   ├── index.ts
│   │   ├── buttons.ts        # Button builder
│   │   ├── select-menus.ts   # Select menu builder
│   │   └── modals.ts         # Modal builder
│   ├── commands/
│   │   ├── index.ts
│   │   ├── slash.ts          # Slash command registration
│   │   ├── context.ts        # Context menu commands
│   │   └── types.ts          # Command type definitions
│   ├── webhooks/
│   │   ├── index.ts
│   │   └── discord-webhooks.ts  # Discord webhook management
│   └── utils/
│       ├── errors.ts         # mapDiscordError()
│       ├── snowflake.ts      # ID validation
│       └── chunking.ts       # Message chunking
├── __tests__/
│   ├── plugin.test.ts
│   ├── handlers.test.ts
│   ├── components.test.ts
│   ├── commands.test.ts
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

**Discord.js Client Setup (all intents for full capability):**
```typescript
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      // Core
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,

      // Reactions
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessageReactions,

      // Typing
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.DirectMessageTyping,

      // Presence (for user status)
      GatewayIntentBits.GuildPresences,

      // Members (for mentions, user info)
      GatewayIntentBits.GuildMembers,

      // Polls
      GatewayIntentBits.GuildMessagePolls,
      GatewayIntentBits.DirectMessagePolls,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
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

**Goal:** Embeds, reactions, threads, stickers, polls, message operations.

**Deliverables:**
- [ ] `senders/embeds.ts` - Embed builder and sender
- [ ] `senders/reaction.ts` - Add/remove reactions
- [ ] `senders/sticker.ts` - Sticker sending
- [ ] `senders/poll.ts` - Poll creation
- [ ] `handlers/reactions.ts` - Reaction event handlers
- [ ] `handlers/messages.ts` - Update for edit/delete/poll events
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

  if (options.fields) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.image) embed.setImage(options.image);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}
```

**Poll Builder:**
```typescript
export function buildPoll(options: PollOptions): PollData {
  return {
    question: { text: options.question },
    answers: options.answers.map((a, i) => ({
      answer_id: i + 1,
      poll_media: { text: a }
    })),
    duration: options.durationHours ?? 24,
    allow_multiselect: options.multiSelect ?? false,
  };
}
```

**Acceptance Criteria:**
- [ ] Can send embeds with title, description, fields, images, footer
- [ ] Can add/remove reactions to messages
- [ ] messageReactionAdd/Remove → event emission
- [ ] Can edit/delete sent messages
- [ ] messageUpdate/Delete → event emission
- [ ] Thread creation and replies work
- [ ] Mentions parsed correctly in incoming messages
- [ ] Can send stickers by ID
- [ ] Can receive sticker messages
- [ ] Can create polls with options
- [ ] Poll vote events captured

**Validation:**
```bash
bun test packages/channel-discord/__tests__/embeds.test.ts
bun test packages/channel-discord/__tests__/reactions.test.ts
bun test packages/channel-discord/__tests__/polls.test.ts
```

---

## Execution Group C: Interactive Components & Commands

**Goal:** Full interactivity - buttons, menus, modals, slash commands, context menus.

**Deliverables:**
- [ ] `components/buttons.ts` - Button builder
- [ ] `components/select-menus.ts` - Select menu builder
- [ ] `components/modals.ts` - Modal/form builder
- [ ] `commands/slash.ts` - Slash command registration
- [ ] `commands/context.ts` - Context menu commands (right-click)
- [ ] `handlers/interactions.ts` - All interaction handlers
- [ ] `webhooks/discord-webhooks.ts` - Discord webhook management
- [ ] API endpoints for responding to interactions

**Component Builders:**
```typescript
// Buttons
export function buildButton(options: ButtonOptions): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(options.customId)
    .setLabel(options.label)
    .setStyle(options.style ?? ButtonStyle.Primary)
    .setDisabled(options.disabled ?? false);
}

// Select Menu
export function buildSelectMenu(options: SelectMenuOptions): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(options.customId)
    .setPlaceholder(options.placeholder)
    .addOptions(options.options.map(o => ({
      label: o.label,
      value: o.value,
      description: o.description,
    })));
}

// Modal
export function buildModal(options: ModalOptions): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(options.customId)
    .setTitle(options.title);

  const inputs = options.fields.map(f =>
    new TextInputBuilder()
      .setCustomId(f.customId)
      .setLabel(f.label)
      .setStyle(f.multiline ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required ?? true)
  );

  modal.addComponents(
    inputs.map(i => new ActionRowBuilder<TextInputBuilder>().addComponents(i))
  );

  return modal;
}
```

**Interaction Handler (unified):**
```typescript
client.on('interactionCreate', async (interaction) => {
  const base = {
    instanceId,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    interactionId: interaction.id,
    interactionToken: interaction.token,
  };

  // Slash commands
  if (interaction.isChatInputCommand()) {
    await plugin.emitCustomEvent('custom.discord.slash_command', {
      ...base,
      commandName: interaction.commandName,
      options: interaction.options.data,
    });
    await interaction.deferReply();
  }

  // Context menu (right-click)
  if (interaction.isContextMenuCommand()) {
    await plugin.emitCustomEvent('custom.discord.context_menu', {
      ...base,
      commandName: interaction.commandName,
      targetId: interaction.targetId,
      targetType: interaction.targetType,
    });
    await interaction.deferReply();
  }

  // Button click
  if (interaction.isButton()) {
    await plugin.emitCustomEvent('custom.discord.button', {
      ...base,
      customId: interaction.customId,
      messageId: interaction.message.id,
    });
    await interaction.deferUpdate();
  }

  // Select menu
  if (interaction.isStringSelectMenu()) {
    await plugin.emitCustomEvent('custom.discord.select_menu', {
      ...base,
      customId: interaction.customId,
      values: interaction.values,
    });
    await interaction.deferUpdate();
  }

  // Modal submit
  if (interaction.isModalSubmit()) {
    await plugin.emitCustomEvent('custom.discord.modal_submit', {
      ...base,
      customId: interaction.customId,
      fields: Object.fromEntries(
        interaction.fields.fields.map(f => [f.customId, f.value])
      ),
    });
    await interaction.deferReply();
  }

  // Autocomplete
  if (interaction.isAutocomplete()) {
    await plugin.emitCustomEvent('custom.discord.autocomplete', {
      ...base,
      commandName: interaction.commandName,
      focusedOption: interaction.options.getFocused(true),
    });
    // Autocomplete needs immediate response - handle via callback
  }
});
```

**API Endpoints for Responding:**
```typescript
// Respond to deferred interaction
POST /api/v2/discord/:instanceId/interactions/:interactionId/respond
{
  "token": "interaction_token",
  "content": "Response text",
  "embeds": [...],
  "components": [...],
  "ephemeral": false
}

// Show modal (for button/select interactions)
POST /api/v2/discord/:instanceId/interactions/:interactionId/modal
{
  "token": "interaction_token",
  "modal": { "customId": "...", "title": "...", "fields": [...] }
}

// Autocomplete response
POST /api/v2/discord/:instanceId/interactions/:interactionId/autocomplete
{
  "token": "interaction_token",
  "choices": [{ "name": "Option 1", "value": "opt1" }]
}
```

**Discord Webhooks:**
```typescript
// Create webhook for a channel
POST /api/v2/discord/:instanceId/webhooks
{ "channelId": "...", "name": "Omni Bot" }

// Send via Discord webhook (useful for external integrations)
POST /api/v2/discord/:instanceId/webhooks/:webhookId/send
{ "content": "...", "username": "Custom Name", "avatarUrl": "..." }
```

**Acceptance Criteria:**
- [ ] Can send messages with buttons
- [ ] Button clicks → `custom.discord.button` event
- [ ] Can send messages with select menus
- [ ] Select menu choices → `custom.discord.select_menu` event
- [ ] Can show modals in response to button/command
- [ ] Modal submissions → `custom.discord.modal_submit` event
- [ ] Slash commands registered per guild
- [ ] Slash commands → `custom.discord.slash_command` event
- [ ] Context menu commands work (right-click user/message)
- [ ] Autocomplete works for command options
- [ ] API endpoints respond to deferred interactions
- [ ] Can create Discord webhooks for channels
- [ ] Can send via Discord webhooks

**Validation:**
```bash
bun test packages/channel-discord/__tests__/components.test.ts
bun test packages/channel-discord/__tests__/commands.test.ts
bun test packages/channel-discord/__tests__/webhooks.test.ts
# Manual: click button, verify event emitted and response works
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
  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,
  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,

  // Rich content
  canSendEmbed: true,           // Discord-specific
  canSendSticker: true,
  canSendPoll: true,            // Discord-specific

  // Interactive components
  canSendButtons: true,         // Discord-specific
  canSendSelectMenu: true,      // Discord-specific
  canShowModal: true,           // Discord-specific
  canUseSlashCommands: true,    // Discord-specific
  canUseContextMenu: true,      // Discord-specific

  // Channels
  canHandleGroups: true,        // Guilds/servers
  canHandleDMs: true,           // Direct messages
  canHandleThreads: true,

  // Discord webhooks
  canCreateWebhooks: true,      // Discord-specific
  canSendViaWebhook: true,      // Discord-specific

  // Not supported
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,
  canForwardMessage: false,
  canSendContact: false,
  canSendLocation: false,
  canHandleBroadcast: false,
  canHandleVoice: false,        // Future

  // Limits
  maxMessageLength: 2000,
  maxEmbedFields: 25,
  maxButtonsPerRow: 5,
  maxRowsPerMessage: 5,
  maxSelectOptions: 25,
  maxFileSize: 25 * 1024 * 1024,  // 25MB (500MB for boosted servers)

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
