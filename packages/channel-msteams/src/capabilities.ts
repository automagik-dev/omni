/**
 * Microsoft Teams channel capabilities declaration
 */

import type { ChannelCapabilities } from '@omni/channel-sdk';

export const MSTEAMS_CAPABILITIES: ChannelCapabilities = {
  canSendText: true,
  canSendMedia: true,
  canSendReaction: true,
  canSendTyping: true,

  canReceiveReadReceipts: false,
  canReceiveDeliveryReceipts: false,

  canEditMessage: true,
  canDeleteMessage: true,
  canReplyToMessage: true,
  canForwardMessage: false,

  canSendContact: false,
  canSendLocation: false,
  canSendSticker: false,

  canHandleGroups: true,
  canHandleBroadcast: false,

  canSendEmbed: true,
  canSendPoll: false,
  canSendButtons: true,
  canSendSelectMenu: false,
  canShowModal: false,
  canUseSlashCommands: false,
  canUseContextMenu: false,
  canHandleDMs: true,
  canHandleThreads: true,
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,
  canStreamResponse: false,

  maxMessageLength: 28000,
  supportedMediaTypes: [],
  maxFileSize: 0,
};
