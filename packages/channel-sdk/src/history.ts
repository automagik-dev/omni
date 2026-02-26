/**
 * Shared history sync types for channel plugins
 *
 * Used by channel implementations (Discord, Slack, Telegram) to provide
 * a consistent interface for fetching message history, especially for
 * per_thread collaboration sessions.
 */

/**
 * A message in history sync format — common across all channel implementations
 */
export interface HistorySyncMessage {
  externalId: string;
  chatId: string;
  from: string;
  timestamp: Date;
  content: {
    type: string;
    text?: string;
    /** Original platform URL (for reference) */
    mediaUrl?: string;
    /** Local file path if the plugin already downloaded the media */
    localPath?: string;
    mimeType?: string;
    caption?: string;
  };
  isFromMe: boolean;
  rawPayload: unknown;
}

/**
 * Options for fetchHistory method
 *
 * Channel-specific implementations may require certain fields (e.g. Discord requires channelId).
 */
export interface FetchHistoryOptions {
  /** Channel / room / chat ID to fetch from (required for Discord, Slack, Telegram) */
  channelId?: string;
  /** Thread ID for per_thread context (Slack thread_ts, Discord thread channel ID, Telegram topic ID) */
  threadId?: string;
  /** Fetch messages since this date */
  since?: Date;
  /** Fetch messages until this date (default: now) */
  until?: Date;
  /** Maximum number of messages to fetch (default: 100) */
  limit?: number;
  /** Callback for progress updates */
  onProgress?: (fetched: number, total?: number) => void;
  /** Callback for each message synced */
  onMessage?: (message: HistorySyncMessage) => void;
}

/**
 * Result of fetchHistory operation
 */
export interface FetchHistoryResult {
  totalFetched: number;
  messages: HistorySyncMessage[];
}
