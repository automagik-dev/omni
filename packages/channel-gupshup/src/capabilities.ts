/**
 * Gupshup channel capabilities declaration
 *
 * Defines what features the Gupshup Custom Integration plugin supports.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const GUPSHUP_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendReaction: false,
  canSendTyping: false,
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,
  canHandoff: true,
  canSendContact: false,
  canSendLocation: true,
  canSendSticker: true,
  canSendButtons: false,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  maxMessageLength: 4096,
  maxFileSize: 100 * 1024 * 1024,
  supportedMediaTypes: [
    { mimeType: 'image/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'audio/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'video/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/*', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'image/webp', maxSize: 100 * 1024 * 1024 },
  ],
};
