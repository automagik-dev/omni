/**
 * Slack Channel Plugin for Omni v2
 *
 * Provides Slack bot messaging via Bolt.js with Socket Mode.
 *
 * @example
 * ```typescript
 * import slackPlugin from '@omni/channel-slack';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(slackPlugin);
 * ```
 */

import { SlackPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new SlackPlugin();
export default plugin;

// Named exports
export { SlackPlugin } from './plugin';
export { SLACK_CAPABILITIES } from './capabilities';
export { SlackError, SlackErrorCode } from './types';

// Manifest
export { buildSlackManifest, REQUIRED_BOT_SCOPES, BOT_EVENTS } from './manifest';

// DM Policy
export { shouldAcceptDm } from './dm-policy';

// Markdown
export { markdownToMrkdwn, chunkMessage } from './markdown';

// Handlers
export { setupMessageHandlers, extractMessageMeta } from './handlers/messages';
export { setupReactionHandlers } from './handlers/reactions';
export { setupInteractionHandlers } from './handlers/interactions';
export { setupCommandHandlers } from './handlers/commands';
export { setupAgentSessionHandlers } from './handlers/agent-sessions';

// Senders
export { sendTextMessage, editSlackMessage, deleteSlackMessage, readMessages } from './senders/text';
export { createSlackStreamSender } from './senders/stream';
export { uploadFile, uploadFileFromUrl } from './senders/media';

// Components
export {
  button,
  staticSelect,
  externalSelect,
  usersSelect,
  channelsSelect,
  conversationsSelect,
  datePicker,
  timePicker,
  actionsBlock,
  sectionBlock,
  inputBlock,
  dividerBlock,
  buildModalView,
  prefixActionId,
  isOmniAction,
} from './components/blocks';

// Tools
export {
  addReaction,
  removeReaction,
  pinMessage,
  unpinMessage,
  listPins,
  memberInfo,
  emojiList,
  listReactions,
} from './tools';

// File handling
export { extractFileInfo, downloadSlackFile, getContentTypeFromMime } from './handlers/files';

// Config
export { resolveStreamMode, resolveStreamThrottle } from './config/stream-mode';

// Connection
export { createBoltConnection, destroyBoltConnection, checkBoltHealth } from './connection/bolt-client';

// Types
export type {
  SlackConfig,
  StreamMode,
  DmPolicy,
  ReplyToMode,
  RetryConfig,
  SlackConnectionOptions,
  SlackMessageMeta,
  SlackFileInfo,
  SlackSlashCommand,
  SlackInteractionPayload,
  SlackBlockButton,
  SlackBlockSelect,
  SlackBlockDatePicker,
  SlackBlockTimePicker,
  SlackBlockElement,
  SlackModalConfig,
  SlackManifest,
  SlackErrorCodeType,
} from './types';

export type { BoltConnection } from './connection/bolt-client';
export type { DmPolicyConfig } from './dm-policy';
export type { StreamSenderOptions } from './senders/stream';
export type { TextSendOptions } from './senders/text';
export type { MediaUploadOptions } from './senders/media';
export type { CommandPayload } from './handlers/commands';
