/**
 * Microsoft Teams Channel Plugin for Omni v2
 *
 * Provides Microsoft Teams messaging via the Bot Framework Connector REST
 * protocol. The plugin is auto-discovered by the channel-sdk scanner — no
 * manual registration is needed in production.
 *
 * @example
 * ```typescript
 * import teamsPlugin from '@omni/channel-teams';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * channelRegistry.register(teamsPlugin);
 * ```
 */

import { channelRegistry } from '@omni/channel-sdk';
import { TeamsPlugin } from './plugin';

const plugin = new TeamsPlugin();
channelRegistry.register(plugin);

export default plugin;

// ─────────────────────────────────────────────────────────────
// Named exports
// ─────────────────────────────────────────────────────────────

export { TeamsPlugin } from './plugin';
export { TEAMS_CAPABILITIES } from './capabilities';
export { TeamsError, TeamsErrorCode } from './types';

// Manifest
export { buildTeamsManifest, TEAMS_BOT_SCOPES, TEAMS_PERMISSIONS, TEAMS_MANIFEST_VERSION } from './manifest';

// DM Policy
export { shouldAcceptDm } from './dm-policy';
export type { TeamsDmPolicyConfig } from './dm-policy';

// Markdown
export { markdownToTeams, chunkMessage } from './markdown';

// Tools (Group 3 / Group 4 supply real implementations)
export { addReaction, removeReaction, editMessage, deleteMessage, memberInfo } from './tools';

// Senders (Group 4)
export {
  sendTextMessage,
  sendMediaMessage,
  sendMediaFromBuffer,
  sendMediaFromUrl,
  sendReaction,
  sendTyping,
  mapEmojiToTeamsReaction,
  createBotFrameworkSendContext,
} from './senders';
export type {
  TeamsTextFormatMode,
  TeamsTextSendOptions,
  TeamsMediaKind,
  TeamsMediaSendOptions,
  TeamsReactionSendOptions,
  TeamsTypingSendOptions,
  TeamsOutboundActivity,
  TeamsOutboundActivityType,
  TeamsOutboundAttachment,
  TeamsReactionDescriptor,
  TeamsReactionType,
  TeamsResourceResponse,
  TeamsSendContext,
  BotFrameworkSendContextOptions,
} from './senders';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type {
  TeamsConfig,
  TeamsConversationConfig,
  TeamsConnectionOptions,
  TeamsDmPolicy,
  TeamsReplyToMode,
  TeamsRetryConfig,
  TeamsActivityMeta,
  TeamsAttachmentInfo,
  TeamsCommand,
  TeamsAdaptiveCard,
  TeamsAppManifest,
  TeamsErrorCodeType,
} from './types';
