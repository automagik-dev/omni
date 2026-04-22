/**
 * Twilio WhatsApp channel capabilities.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

const FIVE_MB = 5 * 1024 * 1024;
const FIVE_HUNDRED_KB = 500 * 1024;

export const TWILIO_WHATSAPP_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendReaction: false,
  canSendTyping: true,
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: false,
  canForwardMessage: false,
  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,
  canSendButtons: false,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  hasMessagingWindow: true,
  messagingWindowMs: 24 * 60 * 60 * 1000,
  maxMessageLength: 1600,
  maxFileSize: FIVE_MB,
  supportedMediaTypes: [
    { mimeType: 'image/jpeg', maxSize: FIVE_MB },
    { mimeType: 'image/jpg', maxSize: FIVE_MB },
    { mimeType: 'image/png', maxSize: FIVE_MB },
    { mimeType: 'image/gif', maxSize: FIVE_MB },
    { mimeType: 'audio/*', maxSize: FIVE_HUNDRED_KB },
    { mimeType: 'video/*', maxSize: FIVE_HUNDRED_KB },
    { mimeType: 'application/*', maxSize: FIVE_HUNDRED_KB },
  ],
};
