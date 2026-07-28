/**
 * WhatsApp Cloud API (Meta) channel capabilities declaration.
 *
 * Cloud API supports the richest WhatsApp feature set — buttons, lists,
 * stickers, location, contacts, interactive templates, reactions. The 24h
 * messaging window is enforced on the Meta side: outside the window only
 * approved HSM templates can be sent.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const WHATSAPP_CLOUD_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  // Typing rides on read receipts: Meta shows it by marking the newest inbound
  // message read with typing_indicator (plugin.sendTyping). ~25s, self-dismissing.
  canSendTyping: true,
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,
  canHandoff: true,
  canCloseContact: true,
  canSendContact: true,
  canSendLocation: true,
  canSendSticker: true,
  canSendButtons: true,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  // Meta enforces a 24h customer-service window — outside it, only HSM templates ship.
  // Consumed by the follow-up runtime (issue #404) to disarm sequences past the window.
  hasMessagingWindow: true,
  messagingWindowMs: 24 * 60 * 60 * 1000,
  maxMessageLength: 4096,
  maxFileSize: 100 * 1024 * 1024,
  supportedMediaTypes: [
    { mimeType: 'image/jpeg', maxSize: 5 * 1024 * 1024 },
    { mimeType: 'image/png', maxSize: 5 * 1024 * 1024 },
    { mimeType: 'image/webp', maxSize: 100 * 1024 }, // stickers
    { mimeType: 'audio/aac', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/mp4', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/mpeg', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/amr', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/ogg', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'video/mp4', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'video/3gp', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'application/pdf', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.ms-powerpoint', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/msword', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.ms-excel', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', maxSize: 100 * 1024 * 1024 },
    {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      maxSize: 100 * 1024 * 1024,
    },
    { mimeType: 'text/plain', maxSize: 100 * 1024 * 1024 },
  ],
};
