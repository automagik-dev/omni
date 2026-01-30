/**
 * Channel capabilities declaration
 *
 * Defines what features a channel supports. Used by the platform
 * to adapt behavior based on channel limitations.
 */

/**
 * Capabilities that a channel can declare support for
 */
export interface ChannelCapabilities {
  /** Can send plain text messages */
  canSendText: boolean;

  /** Can send media (images, audio, video, documents) */
  canSendMedia: boolean;

  /** Can send reactions to messages */
  canSendReaction: boolean;

  /** Can send typing indicators */
  canSendTyping: boolean;

  /** Can receive read receipts */
  canReceiveReadReceipts: boolean;

  /** Can receive delivery receipts */
  canReceiveDeliveryReceipts: boolean;

  /** Can edit sent messages */
  canEditMessage: boolean;

  /** Can delete sent messages */
  canDeleteMessage: boolean;

  /** Can reply to specific messages (quote/thread) */
  canReplyToMessage: boolean;

  /** Can forward messages */
  canForwardMessage: boolean;

  /** Can send contact cards */
  canSendContact: boolean;

  /** Can send location pins */
  canSendLocation: boolean;

  /** Can send stickers */
  canSendSticker: boolean;

  /** Can handle group chats */
  canHandleGroups: boolean;

  /** Can handle broadcast/channel messages */
  canHandleBroadcast: boolean;

  /** Maximum message length (0 = unlimited) */
  maxMessageLength: number;

  /** Supported media types */
  supportedMediaTypes: SupportedMediaType[];

  /** Maximum file size in bytes (0 = unlimited) */
  maxFileSize: number;
}

/**
 * Media type support definition
 */
export interface SupportedMediaType {
  /** MIME type pattern (e.g., 'image/*', 'audio/mp3') */
  mimeType: string;

  /** Maximum file size for this type in bytes */
  maxSize?: number;
}

/**
 * Default capabilities - conservative defaults
 */
export const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: false,
  canSendReaction: false,
  canSendTyping: false,
  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: false,
  canForwardMessage: false,
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  canHandleGroups: false,
  canHandleBroadcast: false,
  maxMessageLength: 0,
  supportedMediaTypes: [],
  maxFileSize: 0,
};
