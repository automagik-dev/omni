/**
 * Zenvia channel capabilities declaration.
 *
 * Declared conservatively — only what this plugin actually sends and
 * receives today. The Zenvia API also offers buttons, lists, contacts and
 * WhatsApp Flows; each one is a follow-up, not a claim.
 *
 * Handoff: the API has no transfer/assign endpoint. The only primitive is the
 * `conversation: { solution, properties }` field on an outbound message,
 * which routes the conversation to a Zenvia solution when the contact
 * replies (see `utils/handoff.ts`). Closing a conversation has no API at all,
 * so `canCloseContact` stays false.
 *
 * The 24h messaging window is enforced upstream by Meta — outside it only
 * approved templates ship.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const ZENVIA_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,
  canSendText: true,
  canSendMedia: true,
  canSendReaction: false,
  // The Zenvia API exposes no presence/typing endpoint.
  canSendTyping: false,
  canReceiveReadReceipts: true,
  canReceiveDeliveryReceipts: true,
  canEditMessage: false,
  canDeleteMessage: false,
  canReplyToMessage: true,
  canForwardMessage: false,
  canHandoff: true,
  canCloseContact: false,
  canSendContact: false,
  canSendLocation: true,
  canSendSticker: false,
  canSendButtons: false,
  canHandleGroups: false,
  canHandleBroadcast: false,
  canHandleDMs: true,
  canStreamResponse: false,
  // Meta enforces a 24h customer-service window — outside it, only templates ship.
  hasMessagingWindow: true,
  messagingWindowMs: 24 * 60 * 60 * 1000,
  maxMessageLength: 4096,
  maxFileSize: 100 * 1024 * 1024,
  supportedMediaTypes: [
    { mimeType: 'image/jpeg', maxSize: 5 * 1024 * 1024 },
    { mimeType: 'image/png', maxSize: 5 * 1024 * 1024 },
    { mimeType: 'audio/aac', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/mp4', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/mpeg', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/amr', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'audio/ogg', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'video/mp4', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'video/3gp', maxSize: 16 * 1024 * 1024 },
    { mimeType: 'application/pdf', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/msword', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.ms-excel', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.ms-powerpoint', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', maxSize: 100 * 1024 * 1024 },
    { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', maxSize: 100 * 1024 * 1024 },
    {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      maxSize: 100 * 1024 * 1024,
    },
    { mimeType: 'text/plain', maxSize: 100 * 1024 * 1024 },
  ],
  events: {
    emits: [
      'instance.connected',
      'instance.disconnected',
      'message.delivered',
      'message.failed',
      'message.read',
      'message.received',
      'message.sent',
    ],
    edits: false,
    deletes: false,
    idempotency: true,
  },
};
