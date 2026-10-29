/**
 * Gupshup channel capabilities declaration
 *
 * Defines what features the Gupshup Custom Integration plugin supports.
 *
 * Buttons, lists and WhatsApp Flows are sent as Custom Integration events
 * (`msg_type` BUTTONS / LIST / FLOW); the partner's Journey maps each one to
 * the matching Bot Studio node (Reply, List, WhatsApp Flow). A Journey that
 * does not branch on those types will not deliver them — see RUNBOOK.md.
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
  canCloseContact: true,
  canCloseContactWithoutText: true,
  canSendContact: false,
  canSendLocation: true,
  canSendSticker: true,
  canSendButtons: true,
  canSendFlow: true,
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
