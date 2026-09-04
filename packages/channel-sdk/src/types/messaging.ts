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

  /** Local media path (for media types when available) */
  localPath?: string;

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

  /** Inline buttons (Telegram, etc.) */
  buttons?: Array<{
    text: string;
    /** Callback payload (e.g. Telegram callback_data). Mutually exclusive with url. */
    data?: string;
    /** Link button URL. Mutually exclusive with data. */
    url?: string;
    /** Secondary line under the option (WhatsApp Cloud list rows). */
    description?: string;
  }>;

  /** List presentation for channels that render options as a list. */
  list?: {
    /** Section header above the options (WhatsApp Cloud). */
    sectionTitle?: string;
    /** Label of the button that opens the list (WhatsApp Cloud). */
    buttonLabel?: string;
    /** Render a list even when the option count would fit inline buttons. */
    forceList?: boolean;
  };

  /** Poll (Telegram/WhatsApp/etc.) */
  poll?: {
    question: string;
    options: string[];
    multiSelect?: boolean;
    isAnonymous?: boolean;
  };

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

  /**
   * Post into the thread AND surface it in the channel (Slack
   * `reply_broadcast`). Only meaningful alongside `threadId` — this is the
   * "quote in thread vs quote in channel" distinction (#889).
   */
  isThreadBroadcast?: boolean;

  /**
   * Procedural courtesy send (pre-dispatch auto-ack, dispatch-error feedback)
   * rather than a substantive reply. Plugins echo this into the
   * `message.sent` payload so agent replay does not treat the row as evidence
   * a turn was answered.
   */
  systemNotice?: boolean;

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

  /**
   * Handoff sends only. `false` means this channel's handoff does NOT take the
   * conversation away from the agent, so the caller must NOT set
   * `agentPaused: true` on the chat.
   *
   * The pause is right for a handoff that parks the conversation in a human
   * queue (Gupshup, asc-flow in `service` mode). It is a DEADLOCK for a channel
   * whose handoff only routes a running flow: with the agent paused the next
   * inbound turn is never dispatched, and a channel that resolves its turn from
   * `sendMessage` never resolves it. Measured on asc-flow atendimento 22289496.
   *
   * Left `undefined` by every other channel, which keeps the pause the default.
   */
  pauseAgent?: boolean;
}
