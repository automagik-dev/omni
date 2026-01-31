/**
 * Discord Channel Plugin for Omni v2
 *
 * Provides Discord bot messaging via discord.js library.
 *
 * @example
 * ```typescript
 * import discordPlugin from '@omni/channel-discord';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(discordPlugin);
 * ```
 */

import { DiscordPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new DiscordPlugin();
export default plugin;

// Named exports for flexibility
export { DiscordPlugin } from './plugin';
export { DISCORD_CAPABILITIES } from './capabilities';
export { loadToken, saveToken, clearToken, hasToken } from './auth';
export { createClient, destroyClient, isClientReady, getBotUser } from './client';
export { DiscordError, ErrorCode, mapDiscordError, isRetryable } from './utils/errors';
export { isValidSnowflake, snowflakeToDate, snowflakeToTimestamp, compareSnowflakes } from './utils/snowflake';
export { chunkMessage, chunkCodeBlock, truncate, needsChunking, MAX_MESSAGE_LENGTH } from './utils/chunking';

// Handlers
export {
  setupConnectionHandlers,
  setupMessageHandlers,
  setupReactionHandlers,
  setupInteractionHandlers,
  setupAllEventHandlers,
  resetConnectionState,
  isConnected,
} from './handlers';

// Senders
export * from './senders';

// Components
export * from './components';

// Commands
export * from './commands';

// Webhooks
export * from './webhooks';

// Types
export type {
  DiscordConfig,
  DiscordConnectionOptions,
  DiscordId,
  GuildId,
  ChannelId,
  UserId,
  MessageId,
  EmbedOptions,
  PollOptions,
  ButtonOptions,
  ButtonStyleType,
  SelectMenuOptions,
  SelectMenuOption,
  ModalOptions,
  ModalField,
  SlashCommandDefinition,
  ContextMenuDefinition,
  CommandOption,
  CommandOptionType,
  BaseInteractionPayload,
  SlashCommandPayload,
  ContextMenuPayload,
  ButtonPayload,
  SelectMenuPayload,
  ModalSubmitPayload,
  AutocompletePayload,
  ExtractedContent,
  DiscordWebhookInfo,
  WebhookSendOptions,
  DiscordMessage,
} from './types';

// Type guards
export {
  isChatInputCommand,
  isButton,
  isStringSelectMenu,
  isAnySelectMenu,
  isModalSubmit,
  isContextMenuCommand,
  isAutocomplete,
} from './types';
