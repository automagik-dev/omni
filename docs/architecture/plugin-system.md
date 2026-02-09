---
title: "Plugin System"
created: 2025-01-29
updated: 2026-02-09
tags: [architecture, plugins, channels]
status: current
---

# Plugin System

> The plugin system enables true plug-and-play channel integration. Adding a new messaging platform requires zero changes to core code.

> Related: [[overview|Architecture Overview]], [[event-system|Event System]], [[provider-system|Provider System]]

## Design Goals

1. **Zero Core Changes** - New channels are added by creating a plugin package
2. **Consistent Interface** - All channels implement the same interface
3. **Independent Lifecycle** - Plugins can be started/stopped independently
4. **Event-Driven** - Plugins communicate via the event bus only
5. **Type Safety** - Full TypeScript types for plugin development

## Plugin Interface

```typescript
// packages/channel-sdk/src/types.ts

/**
 * The core interface every channel plugin must implement.
 */
export interface ChannelPlugin {
  // ==================== IDENTITY ====================

  /** Unique identifier for this channel type */
  readonly id: ChannelType;

  /** Human-readable name */
  readonly name: string;

  /** Plugin version (semver) */
  readonly version: string;

  // ==================== CAPABILITIES ====================

  /** What this channel supports */
  readonly capabilities: ChannelCapabilities;

  // ==================== LIFECYCLE ====================

  /**
   * Initialize the plugin.
   * Called once when the plugin is loaded.
   */
  initialize(config: PluginConfig, context: PluginContext): Promise<void>;

  /**
   * Shutdown the plugin.
   * Called when the application is stopping.
   */
  shutdown(): Promise<void>;

  // ==================== CONNECTION ====================

  /**
   * Connect an instance to the channel.
   * For WhatsApp, this might show a QR code.
   * For Discord, this logs in the bot.
   */
  connect(instance: InstanceConfig): Promise<ChannelConnection>;

  /**
   * Disconnect an instance.
   */
  disconnect(instanceId: string): Promise<void>;

  /**
   * Get current connection status.
   */
  getConnectionStatus(instanceId: string): Promise<ConnectionStatus>;

  // ==================== MESSAGING ====================

  /**
   * Send a text message.
   */
  sendMessage(params: SendMessageParams): Promise<SendResult>;

  /**
   * Send media (image, video, document, etc.)
   */
  sendMedia?(params: SendMediaParams): Promise<SendResult>;

  /**
   * Send a reaction to a message.
   */
  sendReaction?(params: ReactionParams): Promise<void>;

  /**
   * Send typing indicator.
   */
  sendTyping?(params: TypingParams): Promise<void>;

  // ==================== OAUTH (if applicable) ====================

  /**
   * Get OAuth provider for this channel.
   * Only needed for channels that use OAuth (Slack, etc.)
   */
  getOAuthProvider?(): OAuthProvider;

  // ==================== WEBHOOKS (if applicable) ====================

  /**
   * Register webhook routes.
   * Called during app initialization.
   */
  registerWebhooks?(router: WebhookRouter): void;
}

/**
 * Channel capabilities declaration.
 */
export interface ChannelCapabilities {
  /** Does this channel use OAuth for authentication? */
  oauth: boolean;

  /** Does this channel receive webhooks? */
  webhooks: boolean;

  /** Does this channel need polling? */
  polling: boolean;

  /** Does this channel support real-time connections? */
  realtime: boolean;

  /** Messaging capabilities */
  messaging: {
    text: boolean;
    media: boolean;
    reactions: boolean;
    threads: boolean;
    typing: boolean;
    presence: boolean;
    readReceipts: boolean;
    edit: boolean;
    delete: boolean;
  };

  /** Maximum message length */
  maxMessageLength: number;

  /** Supported media types */
  supportedMediaTypes: string[];

  /** Maximum media size in bytes */
  maxMediaSize: number;
}

/**
 * Context provided to plugins during initialization.
 */
export interface PluginContext {
  /** Event bus for publishing/subscribing */
  eventBus: EventBus;

  /** Key-value storage for plugin state */
  storage: PluginStorage;

  /** Logger instance */
  logger: Logger;

  /** Global configuration */
  config: GlobalConfig;

  /** Database access (read-only for events) */
  db: Database;
}

/**
 * Instance-specific configuration passed to connect().
 */
export interface InstanceConfig {
  id: string;
  name: string;
  channel: ChannelType;

  /** Channel-specific credentials/config (encrypted) */
  channelConfig: Record<string, any>;

  /** Agent configuration */
  agent: {
    apiUrl: string;
    apiKey?: string;
    timeout: number;
    streaming: boolean;
  };

  /** Messaging settings */
  messaging: {
    debounceMode: 'disabled' | 'fixed' | 'randomized';
    debounceMs?: number;
    enableAutoSplit: boolean;
    splitDelayMs?: number;
  };

  /** Media processing settings */
  media: {
    processAudio: boolean;
    processImages: boolean;
    processVideo: boolean;
    processDocuments: boolean;
  };
}

/**
 * Connection status response.
 */
export interface ConnectionStatus {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  connectedAt?: Date;
  metadata?: Record<string, any>;
}

/**
 * Result of sending a message.
 */
export interface SendResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
  metadata?: Record<string, any>;
}
```

## Base Plugin Class

```typescript
// packages/channel-sdk/src/base-plugin.ts

/**
 * Base class that provides common functionality for plugins.
 * Plugins can extend this or implement ChannelPlugin directly.
 */
export abstract class BaseChannelPlugin implements ChannelPlugin {
  abstract readonly id: ChannelType;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly capabilities: ChannelCapabilities;

  protected eventBus!: EventBus;
  protected storage!: PluginStorage;
  protected logger!: Logger;
  protected config!: GlobalConfig;
  protected db!: Database;

  protected connections: Map<string, any> = new Map();

  async initialize(pluginConfig: PluginConfig, context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.storage = context.storage;
    this.logger = context.logger.child({ plugin: this.id });
    this.config = context.config;
    this.db = context.db;

    this.logger.info(`Initializing ${this.name} plugin v${this.version}`);

    await this.onInitialize(pluginConfig);
  }

  async shutdown(): Promise<void> {
    this.logger.info(`Shutting down ${this.name} plugin`);

    // Disconnect all instances
    for (const instanceId of this.connections.keys()) {
      try {
        await this.disconnect(instanceId);
      } catch (error) {
        this.logger.error(`Error disconnecting ${instanceId}:`, error);
      }
    }

    await this.onShutdown();
  }

  async getConnectionStatus(instanceId: string): Promise<ConnectionStatus> {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      return { status: 'disconnected' };
    }
    return this.getStatus(connection);
  }

  // Override these in subclasses
  protected abstract onInitialize(config: PluginConfig): Promise<void>;
  protected abstract onShutdown(): Promise<void>;
  protected abstract getStatus(connection: any): ConnectionStatus;

  // Must be implemented by subclasses
  abstract connect(instance: InstanceConfig): Promise<ChannelConnection>;
  abstract disconnect(instanceId: string): Promise<void>;
  abstract sendMessage(params: SendMessageParams): Promise<SendResult>;

  // Helpers

  /**
   * Emit a normalized message event.
   */
  protected async emitMessageReceived(params: {
    instanceId: string;
    externalMessageId: string;
    sender: {
      platformUserId: string;
      platformUsername?: string;
      profileData?: Record<string, any>;
    };
    conversationId: string;
    content: MessageContent;
    timestamp: Date;
    rawPayload?: any;
  }): Promise<void> {
    await this.eventBus.publish({
      type: 'message.received',
      payload: {
        messageId: crypto.randomUUID(),
        externalMessageId: params.externalMessageId,
        channel: this.id,
        instanceId: params.instanceId,
        sender: params.sender,
        conversationId: params.conversationId,
        externalConversationId: params.conversationId,
        content: params.content,
        platformTimestamp: params.timestamp,
        rawPayload: params.rawPayload,
      },
    });
  }

  /**
   * Emit a connection status event.
   */
  protected async emitConnectionStatus(
    instanceId: string,
    status: 'connected' | 'disconnected',
    metadata?: Record<string, any>
  ): Promise<void> {
    const eventType = status === 'connected'
      ? 'channel.connected'
      : 'channel.disconnected';

    await this.eventBus.publish({
      type: eventType,
      payload: {
        instanceId,
        channel: this.id,
        ...(status === 'disconnected' && { reason: 'manual' }),
        connectionInfo: metadata,
      },
    });
  }

  /**
   * Emit QR code event (for WhatsApp-like channels).
   */
  protected async emitQrCode(instanceId: string, qrCode: string): Promise<void> {
    await this.eventBus.publish({
      type: 'channel.qr_code',
      payload: {
        instanceId,
        qrCode,
        expiresAt: new Date(Date.now() + 60000), // 1 minute
      },
    });
  }
}
```

## Example: WhatsApp Baileys Plugin

```typescript
// packages/channel-whatsapp-baileys/src/index.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { BaseChannelPlugin, ChannelCapabilities, InstanceConfig } from '@omni/channel-sdk';

export class WhatsAppBaileysPlugin extends BaseChannelPlugin {
  readonly id = 'whatsapp-baileys' as const;
  readonly name = 'WhatsApp (Baileys)';
  readonly version = '1.0.0';

  readonly capabilities: ChannelCapabilities = {
    oauth: false,
    webhooks: false,
    polling: false,
    realtime: true,

    messaging: {
      text: true,
      media: true,
      reactions: true,
      threads: false,
      typing: true,
      presence: true,
      readReceipts: true,
      edit: false,
      delete: true,
    },

    maxMessageLength: 65536,
    supportedMediaTypes: ['image/*', 'audio/*', 'video/*', 'application/*'],
    maxMediaSize: 64 * 1024 * 1024, // 64MB
  };

  protected sockets: Map<string, WASocket> = new Map();

  protected async onInitialize(): Promise<void> {
    // Nothing special needed
  }

  protected async onShutdown(): Promise<void> {
    for (const socket of this.sockets.values()) {
      socket.end(undefined);
    }
    this.sockets.clear();
  }

  protected getStatus(socket: WASocket): ConnectionStatus {
    // Baileys doesn't expose state directly, we track via events
    return { status: 'connected' };
  }

  async connect(instance: InstanceConfig): Promise<ChannelConnection> {
    const authPath = `./data/auth/whatsapp/${instance.id}`;
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Omni v2', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sockets.set(instance.id, socket);

    // Connection events
    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        await this.emitQrCode(instance.id, qr);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        this.logger.info(`Connection closed for ${instance.id}, reconnect: ${shouldReconnect}`);
        this.sockets.delete(instance.id);

        await this.emitConnectionStatus(instance.id, 'disconnected', {
          reason: reason === DisconnectReason.loggedOut ? 'logout' : 'error',
        });

        if (shouldReconnect) {
          // Reconnect after delay
          setTimeout(() => this.connect(instance), 5000);
        }
      }

      if (connection === 'open') {
        this.logger.info(`Connected: ${instance.id}`);
        await this.emitConnectionStatus(instance.id, 'connected', {
          phoneNumber: socket.user?.id,
        });
      }
    });

    // Save credentials
    socket.ev.on('creds.update', saveCreds);

    // Incoming messages
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        await this.handleIncomingMessage(instance.id, socket, msg);
      }
    });

    return {
      instanceId: instance.id,
      status: 'connecting',
    };
  }

  async disconnect(instanceId: string): Promise<void> {
    const socket = this.sockets.get(instanceId);
    if (socket) {
      await socket.logout();
      this.sockets.delete(instanceId);
    }
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const socket = this.sockets.get(params.instanceId);
    if (!socket) {
      return { success: false, error: 'Not connected' };
    }

    const jid = this.phoneToJid(params.recipient);

    try {
      const result = await socket.sendMessage(jid, { text: params.text });
      return {
        success: true,
        externalMessageId: result.key.id!,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  async sendMedia(params: SendMediaParams): Promise<SendResult> {
    const socket = this.sockets.get(params.instanceId);
    if (!socket) {
      return { success: false, error: 'Not connected' };
    }

    const jid = this.phoneToJid(params.recipient);

    let content: any;
    switch (params.media.type) {
      case 'image':
        content = {
          image: params.media.buffer ?? { url: params.media.url },
          caption: params.caption,
        };
        break;
      case 'audio':
        content = {
          audio: params.media.buffer ?? { url: params.media.url },
          ptt: params.voiceNote ?? false,
        };
        break;
      case 'video':
        content = {
          video: params.media.buffer ?? { url: params.media.url },
          caption: params.caption,
        };
        break;
      case 'document':
        content = {
          document: params.media.buffer ?? { url: params.media.url },
          fileName: params.media.filename,
          caption: params.caption,
        };
        break;
    }

    try {
      const result = await socket.sendMessage(jid, content);
      return {
        success: true,
        externalMessageId: result.key.id!,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }

  async sendReaction(params: ReactionParams): Promise<void> {
    const socket = this.sockets.get(params.instanceId);
    if (!socket) throw new Error('Not connected');

    const jid = this.phoneToJid(params.recipient);

    await socket.sendMessage(jid, {
      react: {
        text: params.emoji,
        key: {
          remoteJid: jid,
          id: params.targetMessageId,
        },
      },
    });
  }

  async sendTyping(params: TypingParams): Promise<void> {
    const socket = this.sockets.get(params.instanceId);
    if (!socket) return;

    const jid = this.phoneToJid(params.recipient);
    await socket.sendPresenceUpdate(params.typing ? 'composing' : 'paused', jid);
  }

  // Private helpers

  private async handleIncomingMessage(
    instanceId: string,
    socket: WASocket,
    msg: any
  ): Promise<void> {
    const jid = msg.key.remoteJid!;
    const sender = msg.key.participant ?? jid;

    // Extract content
    const content = await this.extractContent(socket, msg);

    // Emit normalized event
    await this.emitMessageReceived({
      instanceId,
      externalMessageId: msg.key.id!,
      sender: {
        platformUserId: this.normalizeJid(sender),
        platformUsername: msg.pushName,
        profileData: {
          name: msg.pushName,
          phone: this.jidToPhone(sender),
        },
      },
      conversationId: this.normalizeJid(jid),
      content,
      timestamp: new Date((msg.messageTimestamp as number) * 1000),
      rawPayload: msg,
    });

    // Emit media event if applicable
    if (content.media?.length) {
      for (const media of content.media) {
        await this.eventBus.publish({
          type: 'media.received',
          payload: {
            messageId: msg.key.id!,
            mediaId: media.id,
            type: media.type,
            mimeType: media.mimeType,
            size: media.size,
            duration: media.duration,
            dimensions: media.dimensions,
          },
        });
      }
    }
  }

  private async extractContent(socket: WASocket, msg: any): Promise<MessageContent> {
    const message = msg.message;
    if (!message) return { type: 'text' };

    // Text
    if (message.conversation || message.extendedTextMessage?.text) {
      return {
        type: 'text',
        text: message.conversation ?? message.extendedTextMessage?.text,
      };
    }

    // Image
    if (message.imageMessage) {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      return {
        type: 'image',
        text: message.imageMessage.caption,
        media: [{
          id: crypto.randomUUID(),
          type: 'image',
          mimeType: message.imageMessage.mimetype ?? 'image/jpeg',
          buffer: buffer as Buffer,
          dimensions: {
            width: message.imageMessage.width ?? 0,
            height: message.imageMessage.height ?? 0,
          },
        }],
      };
    }

    // Audio
    if (message.audioMessage) {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      return {
        type: 'audio',
        media: [{
          id: crypto.randomUUID(),
          type: 'audio',
          mimeType: message.audioMessage.mimetype ?? 'audio/ogg',
          buffer: buffer as Buffer,
          duration: message.audioMessage.seconds,
        }],
      };
    }

    // ... other message types

    return { type: 'text' };
  }

  /**
   * JID Resolution - WhatsApp uses multiple JID formats:
   *
   * 1. Phone-based: 1234567890@s.whatsapp.net (standard user)
   * 2. LID-based: 1234567890@lid (linked device format, newer)
   * 3. Group: 123456789-1234567890@g.us (group chats)
   * 4. Broadcast: status@broadcast (status updates)
   * 5. With device: 1234567890:1@s.whatsapp.net (multi-device suffix)
   *
   * The normalizeJid() function handles all these cases to produce
   * a consistent identifier for storage and lookup.
   */
  private normalizeJid(jid: string): string {
    // Remove domain suffix
    let normalized = jid
      .replace(/@s\.whatsapp\.net$/, '')
      .replace(/@lid$/, '')
      .replace(/@g\.us$/, '');

    // Remove device suffix (e.g., :1, :2)
    normalized = normalized.split(':')[0];

    return normalized;
  }

  private jidToPhone(jid: string): string {
    const normalized = this.normalizeJid(jid);
    // Only add + for phone-like JIDs
    if (/^\d+$/.test(normalized)) {
      return '+' + normalized;
    }
    return normalized;
  }

  private phoneToJid(phone: string): string {
    return phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
  }

  private isGroup(jid: string): boolean {
    return jid.endsWith('@g.us');
  }

  private isLid(jid: string): boolean {
    return jid.endsWith('@lid');
  }
}

// Export as default for dynamic loading
export default WhatsAppBaileysPlugin;
```

## Example: Discord Plugin with Advanced Features

```typescript
// packages/channel-discord/src/index.ts

import {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  VoiceChannel,
} from 'discord.js';
import { BaseChannelPlugin, ChannelCapabilities, InstanceConfig } from '@omni/channel-sdk';

export class DiscordPlugin extends BaseChannelPlugin {
  readonly id = 'discord' as const;
  readonly name = 'Discord';
  readonly version = '1.0.0';

  readonly capabilities: ChannelCapabilities = {
    oauth: true,        // Bot token via OAuth
    webhooks: false,    // Uses gateway, not webhooks
    polling: false,
    realtime: true,

    messaging: {
      text: true,
      media: true,
      reactions: true,
      threads: true,
      typing: true,
      presence: true,
      readReceipts: false,  // Discord doesn't support
      edit: true,
      delete: true,
    },

    maxMessageLength: 2000,  // Discord limit
    supportedMediaTypes: ['image/*', 'audio/*', 'video/*', 'application/*'],
    maxMediaSize: 25 * 1024 * 1024, // 25MB (or 100MB for boosted)
  };

  private clients: Map<string, Client> = new Map();
  private slashCommands: Map<string, SlashCommandBuilder[]> = new Map();

  protected async onInitialize(): Promise<void> {
    // Register global slash commands config from plugin config
  }

  protected async onShutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.destroy();
    }
    this.clients.clear();
  }

  protected getStatus(client: Client): ConnectionStatus {
    return {
      status: client.isReady() ? 'connected' : 'disconnected',
      metadata: {
        user: client.user?.tag,
        guilds: client.guilds.cache.size,
      },
    };
  }

  async connect(instance: InstanceConfig): Promise<ChannelConnection> {
    const { botToken, guildIds, slashCommandsEnabled, voiceEnabled } = instance.channelConfig;

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        ...(voiceEnabled ? [GatewayIntentBits.GuildVoiceStates] : []),
      ],
    });

    this.clients.set(instance.id, client);

    // Ready event
    client.once(Events.ClientReady, async (c) => {
      this.logger.info(`Discord bot ready: ${c.user.tag}`);

      // Register slash commands if enabled
      if (slashCommandsEnabled) {
        await this.registerSlashCommands(instance.id, c);
      }

      await this.emitConnectionStatus(instance.id, 'connected', {
        user: c.user.tag,
        guilds: c.guilds.cache.size,
      });
    });

    // Message handling
    client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;

      // Check if from allowed guilds
      if (guildIds?.length && !guildIds.includes(message.guildId)) return;

      await this.handleIncomingMessage(instance.id, message);
    });

    // Slash command handling
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(instance.id, interaction);
    });

    // Voice state changes (for voice features)
    if (voiceEnabled) {
      client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        await this.handleVoiceStateUpdate(instance.id, oldState, newState);
      });
    }

    await client.login(botToken);

    return {
      instanceId: instance.id,
      status: 'connecting',
    };
  }

  async disconnect(instanceId: string): Promise<void> {
    const client = this.clients.get(instanceId);
    if (client) {
      await client.destroy();
      this.clients.delete(instanceId);
    }
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const client = this.clients.get(params.instanceId);
    if (!client) {
      return { success: false, error: 'Not connected' };
    }

    try {
      const channel = await client.channels.fetch(params.recipient);
      if (!channel?.isTextBased()) {
        return { success: false, error: 'Invalid channel' };
      }

      // Handle Discord's 2000 char limit with smart splitting
      const messages = this.splitMessage(params.text, 2000);
      let lastMessageId: string | undefined;

      for (const text of messages) {
        const sent = await channel.send(text);
        lastMessageId = sent.id;

        // Add delay between split messages
        if (messages.length > 1) {
          await this.delay(300 + Math.random() * 700);
        }
      }

      return {
        success: true,
        externalMessageId: lastMessageId,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // ==================== SLASH COMMANDS ====================

  private async registerSlashCommands(instanceId: string, client: Client): Promise<void> {
    const commands = [
      new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Ask the agent a question')
        .addStringOption(option =>
          option.setName('question')
            .setDescription('Your question')
            .setRequired(true)),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check bot status'),
    ];

    this.slashCommands.set(instanceId, commands);

    const rest = new REST().setToken(client.token!);
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commands.map(c => c.toJSON()) }
    );

    this.logger.info(`Registered ${commands.length} slash commands`);
  }

  private async handleSlashCommand(instanceId: string, interaction: any): Promise<void> {
    const command = interaction.commandName;

    if (command === 'ask') {
      const question = interaction.options.getString('question');

      // Defer reply for long operations
      await interaction.deferReply();

      // Emit as message received
      await this.emitMessageReceived({
        instanceId,
        externalMessageId: interaction.id,
        sender: {
          platformUserId: interaction.user.id,
          platformUsername: interaction.user.username,
          profileData: {
            discriminator: interaction.user.discriminator,
            avatar: interaction.user.avatar,
          },
        },
        conversationId: interaction.channelId,
        content: { type: 'text', text: question },
        timestamp: new Date(),
        rawPayload: { type: 'slash_command', command, interaction },
      });

      // The response will come back via agent router → sendMessage
    }

    if (command === 'status') {
      await interaction.reply({
        content: `Bot Status: Connected\nGuilds: ${interaction.client.guilds.cache.size}`,
        ephemeral: true,
      });
    }
  }

  // ==================== VOICE INFRASTRUCTURE ====================

  private voiceConnections: Map<string, any> = new Map();

  async joinVoiceChannel(instanceId: string, channelId: string): Promise<void> {
    const client = this.clients.get(instanceId);
    if (!client) throw new Error('Not connected');

    const channel = await client.channels.fetch(channelId);
    if (!(channel instanceof VoiceChannel)) {
      throw new Error('Not a voice channel');
    }

    // Voice connection would be implemented here
    // Using @discordjs/voice for actual implementation
    this.logger.info(`Would join voice channel: ${channel.name}`);
  }

  async leaveVoiceChannel(instanceId: string, channelId: string): Promise<void> {
    const connection = this.voiceConnections.get(`${instanceId}:${channelId}`);
    if (connection) {
      connection.destroy();
      this.voiceConnections.delete(`${instanceId}:${channelId}`);
    }
  }

  private async handleVoiceStateUpdate(
    instanceId: string,
    oldState: any,
    newState: any
  ): Promise<void> {
    // Track voice channel joins/leaves
    await this.eventBus.publish({
      type: 'channel.voice_state',
      payload: {
        instanceId,
        channel: this.id,
        userId: newState.member?.user.id,
        oldChannel: oldState.channelId,
        newChannel: newState.channelId,
        isSelfMuted: newState.selfMute,
        isSelfDeafened: newState.selfDeaf,
      },
    });
  }

  // ==================== HELPERS ====================

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const messages: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        messages.push(remaining);
        break;
      }

      // Try to split at newline
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        // Try space
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        // Hard split
        splitIndex = maxLength;
      }

      messages.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return messages;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async handleIncomingMessage(instanceId: string, message: any): Promise<void> {
    await this.emitMessageReceived({
      instanceId,
      externalMessageId: message.id,
      sender: {
        platformUserId: message.author.id,
        platformUsername: message.author.username,
        profileData: {
          discriminator: message.author.discriminator,
          avatar: message.author.avatar,
          bot: message.author.bot,
        },
      },
      conversationId: message.channelId,
      content: await this.extractContent(message),
      timestamp: message.createdAt,
      rawPayload: message,
    });
  }

  private async extractContent(message: any): Promise<MessageContent> {
    const content: MessageContent = {
      type: 'text',
      text: message.content,
    };

    if (message.attachments.size > 0) {
      content.media = [];
      for (const [, attachment] of message.attachments) {
        content.media.push({
          id: attachment.id,
          type: this.getMediaType(attachment.contentType),
          mimeType: attachment.contentType,
          url: attachment.url,
          size: attachment.size,
          filename: attachment.name,
        });
      }
      content.type = content.media[0].type;
    }

    return content;
  }

  private getMediaType(mimeType: string | null): 'image' | 'audio' | 'video' | 'document' {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'document';
  }
}

export default DiscordPlugin;
```

## Channel Manager

```typescript
// packages/core/src/channels/manager.ts

export class ChannelManager {
  private plugins: Map<ChannelType, ChannelPlugin> = new Map();
  private eventBus: EventBus;
  private db: Database;
  private logger: Logger;

  constructor(context: ManagerContext) {
    this.eventBus = context.eventBus;
    this.db = context.db;
    this.logger = context.logger;
  }

  /**
   * Register a channel plugin.
   */
  async register(plugin: ChannelPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`);
    }

    await plugin.initialize({}, {
      eventBus: this.eventBus,
      storage: this.createStorage(plugin.id),
      logger: this.logger.child({ plugin: plugin.id }),
      config: this.config,
      db: this.db,
    });

    this.plugins.set(plugin.id, plugin);
    this.logger.info(`Registered plugin: ${plugin.id} v${plugin.version}`);
  }

  /**
   * Load plugins from configuration.
   */
  async loadPlugins(config: PluginsConfig): Promise<void> {
    for (const [channelId, pluginConfig] of Object.entries(config)) {
      if (!pluginConfig.enabled) continue;

      try {
        // Dynamic import
        const module = await import(pluginConfig.package);
        const PluginClass = module.default;
        const plugin = new PluginClass();

        await this.register(plugin);
      } catch (error) {
        this.logger.error(`Failed to load plugin ${channelId}:`, error);
      }
    }
  }

  /**
   * Get a plugin by channel type.
   */
  getPlugin(channel: ChannelType): ChannelPlugin {
    const plugin = this.plugins.get(channel);
    if (!plugin) {
      throw new Error(`Unknown channel: ${channel}`);
    }
    return plugin;
  }

  /**
   * Connect an instance.
   */
  async connectInstance(instance: InstanceConfig): Promise<ChannelConnection> {
    const plugin = this.getPlugin(instance.channel);
    return plugin.connect(instance);
  }

  /**
   * Disconnect an instance.
   */
  async disconnectInstance(instanceId: string, channel: ChannelType): Promise<void> {
    const plugin = this.getPlugin(channel);
    await plugin.disconnect(instanceId);
  }

  /**
   * Send a message.
   */
  async sendMessage(params: SendMessageParams & { channel: ChannelType }): Promise<SendResult> {
    const plugin = this.getPlugin(params.channel);
    return plugin.sendMessage(params);
  }

  /**
   * Get all registered channels.
   */
  getChannels(): ChannelInfo[] {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      capabilities: p.capabilities,
    }));
  }

  /**
   * Shutdown all plugins.
   */
  async shutdown(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.shutdown();
      } catch (error) {
        this.logger.error(`Error shutting down ${plugin.id}:`, error);
      }
    }
    this.plugins.clear();
  }

  private createStorage(pluginId: string): PluginStorage {
    // Use NATS KV for plugin storage
    return {
      get: async (key) => this.kvStore.get(`${pluginId}:${key}`),
      set: async (key, value, ttl) => this.kvStore.put(`${pluginId}:${key}`, value, { ttl }),
      delete: async (key) => this.kvStore.delete(`${pluginId}:${key}`),
    };
  }
}
```

## Plugin Configuration

```yaml
# config/plugins.yaml

channels:
  whatsapp-baileys:
    enabled: true
    package: "@omni/channel-whatsapp-baileys"

  whatsapp-cloud:
    enabled: true
    package: "@omni/channel-whatsapp-cloud"
    config:
      appId: ${WHATSAPP_APP_ID}
      appSecret: ${WHATSAPP_APP_SECRET}

  discord:
    enabled: true
    package: "@omni/channel-discord"

  slack:
    enabled: true
    package: "@omni/channel-slack"
    config:
      clientId: ${SLACK_CLIENT_ID}
      clientSecret: ${SLACK_CLIENT_SECRET}

  telegram:
    enabled: true
    package: "@omni/channel-telegram"

  # Custom plugin example
  custom-sms:
    enabled: false
    package: "./plugins/custom-sms"
    config:
      apiKey: ${CUSTOM_SMS_API_KEY}
```

## Plugin Architecture: Monorepo + External

Omni uses a hybrid approach for channel plugins:

```
┌─────────────────────────────────────────────────────────────────┐
│                        OMNI-V2 MONOREPO                          │
│                                                                  │
│  packages/                                                       │
│  ├── core/                    # Core system                      │
│  ├── api/                     # HTTP API                         │
│  ├── channel-sdk/             # Published: @omni/channel-sdk     │
│  ├── channel-whatsapp/        # Official: @omni/channel-whatsapp │
│  ├── channel-discord/         # Official: @omni/channel-discord  │
│  └── channel-slack/           # Official: @omni/channel-slack    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ npm install
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL PLUGINS (npm)                       │
│                                                                  │
│  omni-channel-telegram        # Community maintained             │
│  omni-channel-matrix          # Community maintained             │
│  omni-channel-signal          # Community maintained             │
│  @yourcompany/omni-sms        # Private/custom channel           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

| Approach | Used For | Reason |
|----------|----------|--------|
| **Monorepo** | Official channels (WhatsApp, Discord, Slack) | Tight integration, atomic updates, same release cycle |
| **npm packages** | Community/custom channels | Independence, different maintainers, private channels |
| **NOT submodules** | - | Git submodules are painful, avoided entirely |

### Plugin Discovery & Loading

```typescript
// omni.config.ts

import { defineConfig } from '@omni/core';

export default defineConfig({
  channels: [
    // Official channels (bundled in monorepo)
    '@omni/channel-whatsapp',
    '@omni/channel-discord',
    '@omni/channel-slack',

    // External channels (npm install first)
    'omni-channel-telegram',
    '@yourcompany/omni-sms',

    // Local development
    './plugins/my-custom-channel',
  ],
});
```

```typescript
// packages/core/src/channels/loader.ts

import { ChannelPlugin } from '@omni/channel-sdk';
import { logger } from '../logger';

export async function loadChannels(channelPaths: string[]): Promise<ChannelPlugin[]> {
  const plugins: ChannelPlugin[] = [];

  for (const path of channelPaths) {
    try {
      // Dynamic import - works with npm packages and local paths
      const module = await import(path);

      // Support both default export and named export
      const PluginClass = module.default ?? module.plugin;

      if (!PluginClass) {
        logger.warn(`No plugin export found in ${path}`);
        continue;
      }

      // Instantiate plugin
      const plugin: ChannelPlugin = typeof PluginClass === 'function'
        ? new PluginClass()
        : PluginClass;

      // Validate plugin interface
      validatePluginInterface(plugin);

      plugins.push(plugin);
      logger.info(`Loaded channel plugin: ${plugin.id} v${plugin.version}`);
    } catch (error) {
      logger.error(`Failed to load channel plugin: ${path}`, error);
    }
  }

  return plugins;
}

function validatePluginInterface(plugin: ChannelPlugin): void {
  const required = ['id', 'name', 'version', 'capabilities', 'connect', 'disconnect', 'sendMessage'];

  for (const prop of required) {
    if (!(prop in plugin)) {
      throw new Error(`Plugin missing required property: ${prop}`);
    }
  }
}
```

---

## Creating External Plugins

External plugins are npm packages that depend on `@omni/channel-sdk`.

### Package Structure

```
omni-channel-telegram/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Main export
│   ├── plugin.ts         # Plugin implementation
│   └── types.ts          # Channel-specific types
├── README.md
└── LICENSE
```

### package.json

```json
{
  "name": "omni-channel-telegram",
  "version": "1.0.0",
  "description": "Telegram channel plugin for Omni",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["omni", "omni-channel", "telegram"],
  "peerDependencies": {
    "@omni/channel-sdk": "^2.0.0"
  },
  "dependencies": {
    "grammy": "^1.21.0"
  },
  "devDependencies": {
    "@omni/channel-sdk": "^2.0.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "bun test"
  }
}
```

### Plugin Implementation

```typescript
// omni-channel-telegram/src/index.ts

import {
  BaseChannelPlugin,
  ChannelCapabilities,
  InstanceConfig,
  ChannelConnection,
  SendMessageParams,
  SendResult,
  defineChannel,
} from '@omni/channel-sdk';
import { Bot, Context } from 'grammy';

// Option 1: Class-based (recommended for complex plugins)
export class TelegramPlugin extends BaseChannelPlugin {
  readonly id = 'telegram' as const;
  readonly name = 'Telegram';
  readonly version = '1.0.0';

  readonly capabilities: ChannelCapabilities = {
    oauth: false,
    webhooks: true,
    polling: true,
    realtime: true,
    messaging: {
      text: true,
      media: true,
      reactions: true,
      threads: false,
      typing: true,
      presence: false,
      readReceipts: true,
      edit: true,
      delete: true,
    },
    maxMessageLength: 4096,
    supportedMediaTypes: ['image/*', 'audio/*', 'video/*', 'application/*'],
    maxMediaSize: 50 * 1024 * 1024, // 50MB
  };

  private bots: Map<string, Bot> = new Map();

  protected async onInitialize(): Promise<void> {
    this.logger.info('Telegram plugin initialized');
  }

  protected async onShutdown(): Promise<void> {
    for (const bot of this.bots.values()) {
      await bot.stop();
    }
    this.bots.clear();
  }

  protected getStatus(bot: Bot): ConnectionStatus {
    return { status: 'connected' };
  }

  async connect(instance: InstanceConfig): Promise<ChannelConnection> {
    const { botToken } = instance.channelConfig;

    const bot = new Bot(botToken);
    this.bots.set(instance.id, bot);

    // Handle incoming messages
    bot.on('message', async (ctx) => {
      await this.handleIncomingMessage(instance.id, ctx);
    });

    // Start bot
    bot.start();

    await this.emitConnectionStatus(instance.id, 'connected', {
      botUsername: bot.botInfo?.username,
    });

    return {
      instanceId: instance.id,
      status: 'connected',
    };
  }

  async disconnect(instanceId: string): Promise<void> {
    const bot = this.bots.get(instanceId);
    if (bot) {
      await bot.stop();
      this.bots.delete(instanceId);
    }
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const bot = this.bots.get(params.instanceId);
    if (!bot) {
      return { success: false, error: 'Not connected' };
    }

    try {
      const result = await bot.api.sendMessage(params.recipient, params.text);
      return {
        success: true,
        externalMessageId: result.message_id.toString(),
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async handleIncomingMessage(instanceId: string, ctx: Context): Promise<void> {
    if (!ctx.message || !ctx.from) return;

    await this.emitMessageReceived({
      instanceId,
      externalMessageId: ctx.message.message_id.toString(),
      sender: {
        platformUserId: ctx.from.id.toString(),
        platformUsername: ctx.from.username ?? ctx.from.first_name,
        profileData: {
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          languageCode: ctx.from.language_code,
        },
      },
      conversationId: ctx.chat!.id.toString(),
      content: {
        type: 'text',
        text: ctx.message.text ?? '',
      },
      timestamp: new Date(ctx.message.date * 1000),
      rawPayload: ctx.message,
    });
  }

  // Webhook support
  registerWebhooks(router: WebhookRouter): void {
    router.post('/webhook/telegram/:instanceId', async (req, res) => {
      const { instanceId } = req.params;
      const bot = this.bots.get(instanceId);

      if (bot) {
        await bot.handleUpdate(req.body);
      }

      res.sendStatus(200);
    });
  }
}

// Default export for dynamic loading
export default TelegramPlugin;


// Option 2: Functional style (simpler plugins)
export const telegramPlugin = defineChannel({
  id: 'telegram',
  name: 'Telegram',
  version: '1.0.0',

  capabilities: {
    // ... same as above
  },

  async connect(instance, ctx) {
    const bot = new Bot(instance.channelConfig.botToken);
    ctx.storage.set('bot', bot);

    bot.on('message', async (msg) => {
      await ctx.emitMessageReceived({ /* ... */ });
    });

    await bot.start();
    return { instanceId: instance.id, status: 'connected' };
  },

  async disconnect(instanceId, ctx) {
    const bot = await ctx.storage.get('bot');
    await bot?.stop();
  },

  async sendMessage(params, ctx) {
    const bot = await ctx.storage.get('bot');
    const result = await bot.api.sendMessage(params.recipient, params.text);
    return { success: true, externalMessageId: result.message_id.toString() };
  },
});
```

### Publishing to npm

```bash
# Build
npm run build

# Test locally first
npm link
cd /path/to/omni-v2
npm link omni-channel-telegram

# Publish
npm publish --access public
```

### Using External Plugins

```bash
# Install the plugin
npm install omni-channel-telegram

# Add to config
# omni.config.ts
export default defineConfig({
  channels: [
    '@omni/channel-whatsapp',
    'omni-channel-telegram',  // ← External plugin
  ],
});

# Create an instance
omni instances create --name "My Telegram Bot" --channel telegram
```

---

## Creating a New Plugin (In Monorepo)

For official plugins maintained in the monorepo:

### Step 1: Create Package

```bash
mkdir packages/channel-newchannel
cd packages/channel-newchannel
npm init -y
```

### Step 2: Implement Interface

```typescript
// packages/channel-newchannel/src/index.ts

import { BaseChannelPlugin, ChannelCapabilities } from '@omni/channel-sdk';

export class NewChannelPlugin extends BaseChannelPlugin {
  readonly id = 'newchannel' as const;
  readonly name = 'New Channel';
  readonly version = '1.0.0';

  readonly capabilities: ChannelCapabilities = {
    oauth: false,
    webhooks: true,
    // ... define capabilities
  };

  protected async onInitialize(): Promise<void> {
    // Setup code
  }

  protected async onShutdown(): Promise<void> {
    // Cleanup code
  }

  async connect(instance: InstanceConfig): Promise<ChannelConnection> {
    // Connect to the channel
  }

  async disconnect(instanceId: string): Promise<void> {
    // Disconnect
  }

  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    // Send message
  }

  registerWebhooks(router: WebhookRouter): void {
    router.post('/webhook/newchannel/:instanceId', async (req, res) => {
      // Handle incoming webhook
    });
  }
}

export default NewChannelPlugin;
```

### Step 3: Add to Configuration

```yaml
# config/plugins.yaml
channels:
  newchannel:
    enabled: true
    package: "@omni/channel-newchannel"
```

### Step 4: Done!

The new channel is now available without any changes to core code.
