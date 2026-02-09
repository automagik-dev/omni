/**
 * Telegram Channel Plugin for Omni v2
 *
 * Provides Telegram bot messaging via grammy library.
 *
 * @example
 * ```typescript
 * import telegramPlugin from '@omni/channel-telegram';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(telegramPlugin);
 * ```
 */

import { TelegramPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new TelegramPlugin();
export default plugin;

// Named exports for flexibility
export { TelegramPlugin } from './plugin';
export { TELEGRAM_CAPABILITIES } from './capabilities';
export { createBot, destroyBot, getBot, isBotReady, getBotInfo } from './client';

// Handlers
export { setupMessageHandlers, setupReactionHandlers } from './handlers';

// Senders
export {
  sendTextMessage,
  editTextMessage,
  deleteMessage,
  sendPhoto,
  sendAudio,
  sendVideo,
  sendDocument,
  setReaction,
  removeReaction,
} from './senders';

// Utils
export { toPlatformUserId, buildDisplayName, getUsername, isPrivateChat, isGroupChat } from './utils/identity';
export { escapeMarkdownV2, stripHtml, truncateMessage, splitMessage } from './utils/formatting';

// Types
export type { TelegramConfig, TelegramChatType, ExtractedContent } from './types';
