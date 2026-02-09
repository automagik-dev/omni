/**
 * Telegram-specific types for the channel plugin
 */

/**
 * Telegram instance configuration
 */
export interface TelegramConfig {
  /** Bot API token from @BotFather */
  token: string;

  /** Connection mode */
  mode: 'polling' | 'webhook';

  /** Webhook URL (required for webhook mode) */
  webhookUrl?: string;

  /** Webhook secret token for verification */
  webhookSecret?: string;

  /** Update types to receive */
  allowedUpdates?: string[];
}

/**
 * Telegram chat types
 */
export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

/**
 * Extracted content from a Telegram message
 */
export interface ExtractedContent {
  type: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}
