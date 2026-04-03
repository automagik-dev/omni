/**
 * Gupshup channel capabilities declaration
 *
 * Defines what features the Gupshup BSP plugin supports.
 * Gupshup is a WhatsApp Business Solution Provider (REST+webhook, 1:1 only).
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

/**
 * Gupshup capabilities
 *
 * Supported:
 * - Text, media (image, audio, video, document)
 * - Contacts and location
 * - Interactive buttons
 * - Read and delivery receipts
 * - DMs (1:1 only — Gupshup BSP has no group support)
 * - Reply to message (quoted replies)
 *
 * Not supported:
 * - Reactions (not natively supported by Gupshup BSP API)
 * - Typing indicators (no BSP socket/streaming)
 * - Groups (BSP is 1:1 only)
 * - Streaming (stateless REST)
 * - Stickers, edit, delete, forward, broadcast
 */
export const GUPSHUP_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,

  // Core messaging
  canSendText: true,
  canSendMedia: true,
  canSendReaction: false,
  canSendTyping: false,

  // Receipts — Gupshup BSP provides both
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,

  // Message operations
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,

  // Rich content
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: false,
  canSendButtons: true,

  // Group/broadcast — BSP is 1:1 only
  canHandleGroups: false,
  canHandleBroadcast: false,

  // DMs — primary use case
  canHandleDMs: true,

  // Streaming — stateless REST, no progressive rendering
  canStreamResponse: false,

  // Limits
  maxMessageLength: 4096,
  maxFileSize: 100 * 1024 * 1024, // 100MB

  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 100 * 1024 * 1024 },
  ],
};
