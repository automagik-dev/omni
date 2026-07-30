/**
 * Hermes (Mutant) channel capabilities declaration.
 *
 * Hermes proxies the WhatsApp Business API, so the feature set mirrors
 * WhatsApp Cloud — buttons, lists, stickers, location, contacts, templates,
 * reactions — with two notable gaps:
 *   - NO typing indicator endpoint (canSendTyping: false).
 *   - Uploads via POST /api/v2/upload are capped at 2 MB; larger media must
 *     go by public URL.
 * The 24h messaging window is enforced upstream by Meta — outside it only
 * namespaced HSM templates ship.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const HERMES_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  // Hermes exposes no presence/typing endpoint.
  canSendTyping: false,
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
  // Consumed by the follow-up runtime to disarm sequences past the window.
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
