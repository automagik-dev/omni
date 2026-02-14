/**
 * Messaging types for sending messages through channels
 */

import type { ContentType } from '@omni/core/types';

/**
 * Content for outgoing messages
 */
export interface OutgoingContent {
  /** Content type */
  type: ContentType;

  /** Text content (for text, caption) */
  text?: string;

  /** Media URL (for media types) */
  mediaUrl?: string;

  /** MIME type for media */
  mimeType?: string;

  /** Filename for documents */
  filename?: string;

  /** Caption for media */
  caption?: string;

  /** Reaction emoji (for reaction type) */
  emoji?: string;

  /** Target message ID (for reaction type) */
  targetMessageId?: string;

  /** Contact details (for contact type) */
  contact?: {
    name: string;
    phone?: string;
    email?: string;
  };

  /** Location details (for location type) */
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };

  /** PIX payment details (for pix type, WhatsApp Brazil) */
  pix?: {
    merchantName: string;
    key: string;
    keyType: 'PHONE' | 'EMAIL' | 'CPF' | 'EVP';
  };
}

/**
 * Well-known metadata keys for outgoing messages.
 *
 * Plugins may read these from `OutgoingMessage.metadata` to adjust behavior.
 */
export interface MessageMetadata {
  /**
   * Format conversion mode for text messages.
   * - `'convert'` (default): convert markdown to the channel's native syntax
   * - `'passthrough'`: send raw text without conversion
   */
  messageFormatMode?: 'convert' | 'passthrough';

  /** Additional plugin-specific metadata */
  [key: string]: unknown;
}

/**
 * Outgoing message structure
 */
export interface OutgoingMessage {
  /** Recipient identifier (chat ID, user ID, etc.) */
  to: string;

  /** Optional thread/topic identifier (e.g. Telegram forum topic) */
  threadId?: string;

  /** Message content */
  content: OutgoingContent;

  /** ID of message to reply to */
  replyTo?: string;

  /** Additional metadata for the channel (see MessageMetadata for well-known keys) */
  metadata?: MessageMetadata;
}

/**
 * Result of sending a message
 */
export interface SendResult {
  /** Whether the send was successful */
  success: boolean;

  /** Platform-assigned message ID */
  messageId?: string;

  /** Error message if failed */
  error?: string;

  /** Error code if failed */
  errorCode?: string;

  /** Whether the error is retryable */
  retryable?: boolean;

  /** Timestamp of send attempt */
  timestamp: number;
}
