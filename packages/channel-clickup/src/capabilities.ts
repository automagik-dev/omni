/**
 * ClickUp channel capabilities (issue #1413)
 *
 * ClickUp is NOT a messaging channel. Every messaging capability is false on
 * purpose: the dispatcher must never hand it an outbound chat message, and the
 * channels panel must not advertise text/media buttons for it. What it can do
 * is a small task-action set, declared separately as `CLICKUP_TASK_CAPABILITIES`
 * so it cannot be mistaken for another messaging capability.
 */

import { DEFAULT_CAPABILITIES } from '@omni/channel-sdk';
import type { ChannelCapabilities } from '@omni/channel-sdk';

export const CLICKUP_CHANNEL_CAPABILITIES: ChannelCapabilities = {
  ...DEFAULT_CAPABILITIES,

  // No messaging, no presence, no message operations. Explicit rather than
  // inherited so a future DEFAULT_CAPABILITIES change cannot quietly enable
  // text on a channel that has no chat surface at all.
  canSendText: false,
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
  canSendEmbed: false,
  canSendPoll: false,
  canSendButtons: false,
  canSendSelectMenu: false,
  canShowModal: false,
  canUseSlashCommands: false,
  canUseContextMenu: false,
  canHandleDMs: false,
  canHandleThreads: false,
  canCreateWebhooks: false,
  canSendViaWebhook: false,
  canHandleVoice: false,
  canStreamResponse: false,
  maxMessageLength: 0,
  supportedMediaTypes: [],
  maxFileSize: 0,

  // Only lifecycle events: connecting validates the token against GET /team.
  events: {
    emits: ['instance.connected', 'instance.disconnected'],
    edits: false,
    deletes: false,
    idempotency: true,
  },
};

/**
 * The ClickUp capability set: task actions, not chat messages. Exposed on the
 * plugin as `taskCapabilities` and on `GET /instances/supported-channels`, so a
 * client can render the action surface without guessing from the plugin id.
 */
export interface ClickUpTaskCapabilities {
  canCreateTask: boolean;
  canUpdateTask: boolean;
  canComment: boolean;
  canListTasks: boolean;
}

export const CLICKUP_TASK_CAPABILITIES: ClickUpTaskCapabilities = {
  canCreateTask: true,
  canUpdateTask: true,
  canComment: true,
  canListTasks: true,
};
