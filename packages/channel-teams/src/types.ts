/**
 * Microsoft Teams plugin local types.
 *
 * The transport layer is Bot Framework (per the brainstorm decision —
 * see .genie/brainstorms/teams-channel/DRAFT.md and DESIGN.md). All concrete
 * Bot Framework types (`TurnContext`, `Activity`, etc.) live in `botbuilder`
 * and `botframework-connector`; those packages will be wired in by Group 3.
 *
 * For the Group 2 skeleton we only declare the plugin-local config + error
 * surface so the package compiles standalone without pulling in heavyweight
 * Microsoft SDKs.
 */

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/**
 * Per-conversation overrides keyed by Teams conversation ID.
 *
 * Mirrors the `SlackChannelConfig` shape so operators have a familiar surface
 * for opt-in / opt-out and tool / skill scoping.
 */
export interface TeamsConversationConfig {
  /** Require @bot mention to trigger responses (default: false in DM, true in channel) */
  requireMention?: boolean;
  /** Restrict to these Teams user AAD IDs only (undefined = all users allowed) */
  allowedUsers?: string[];
  /** Tool overrides for this conversation (passed to agent dispatcher) */
  tools?: string[];
  /** Skill overrides for this conversation (passed to agent dispatcher) */
  skills?: string[];
}

/**
 * DM policy modes — mirrors the Slack plugin so tenant operators can reuse
 * playbooks. See `dm-policy.ts`.
 */
export type TeamsDmPolicy = 'open' | 'pairing' | 'closed';

/**
 * Reply mode for outbound messages.
 * - `off`: send to the conversation root, never as a reply
 * - `first`: reply to the first message in the thread (the activity that
 *   started the conversation)
 * - `all`: reply to the most recent message in the conversation
 */
export type TeamsReplyToMode = 'off' | 'first' | 'all';

/**
 * Rate-limit retry config — Bot Framework Connector returns standard
 * Retry-After / 429 semantics; this matches the Slack plugin's shape.
 */
export interface TeamsRetryConfig {
  /** Number of retries (default: 2) */
  retries?: number;
  /** Base delay in ms (default: 500) */
  baseDelayMs?: number;
  /** Max delay in ms (default: 3000) */
  maxDelayMs?: number;
  /** Backoff factor (default: 2) */
  factor?: number;
  /** Randomization factor (default: 0.5) */
  randomization?: number;
}

/**
 * Microsoft Teams instance configuration.
 *
 * Per-tenant model: each instance maps to one Bot Channels Registration in
 * Azure (or one Microsoft Entra app credential pair) installed inside the
 * tenant. Shared multi-tenant bots are out of scope for v1.
 */
export interface TeamsConfig {
  /** Microsoft Entra App ID (formerly MicrosoftAppId) for the bot registration */
  appId?: string;
  /** Microsoft Entra App Password / Client Secret (MicrosoftAppPassword) */
  appPassword?: string;
  /** Microsoft Entra Tenant ID — required for Single Tenant bot deployments */
  tenantId?: string;
  /**
   * App type for the Bot Framework Connector authentication.
   * Defaults to `MultiTenant` for backwards compatibility with the legacy
   * Bot Framework Service. New deployments should prefer `SingleTenant` or
   * `UserAssignedMSI`.
   */
  appType?: 'MultiTenant' | 'SingleTenant' | 'UserAssignedMSI';
  /** Service URL hint (used to short-circuit Bot Framework state warmup) */
  serviceUrl?: string;
  /** Conversation allowlist: only process activities from these conversation IDs */
  conversationAllowlist?: string[];
  /** Conversation blocklist: skip activities from these conversation IDs */
  conversationBlocklist?: string[];
  /** Per-conversation configuration overrides keyed by Teams conversation ID */
  conversations?: Record<string, TeamsConversationConfig>;
  /** DM policy configuration */
  dmPolicy?: TeamsDmPolicy;
  /** DM allowlist (AAD user IDs allowed for DMs when policy is 'pairing') */
  dmAllowlist?: string[];
  /** DM rejection message when policy denies a 1:1 chat */
  dmRejectionMessage?: string;
  /** Reply-to behaviour for outbound activities */
  replyToMode?: TeamsReplyToMode;
  /** Optional override for the bot's display name shown in Teams */
  defaultBotName?: string;
  /** Rate limit retry config */
  retryConfig?: TeamsRetryConfig;
  /**
   * Port for the built-in HTTP receiver — Teams pushes activities to a single
   * `/api/messages` endpoint owned by the bot. Defaults to 3978 (Bot Framework
   * convention) if the plugin owns its own listener; otherwise the host webhook
   * router dispatches `handleWebhook(req)` directly.
   */
  httpPort?: number;
}

/**
 * Connection options resolved from `TeamsConfig` + raw credentials.
 *
 * Group 3 will wire this into a `BotFrameworkAdapter` (or the newer
 * `CloudAdapter`) instance.
 */
export interface TeamsConnectionOptions {
  appId: string;
  appPassword: string;
  tenantId?: string;
  appType?: 'MultiTenant' | 'SingleTenant' | 'UserAssignedMSI';
  retryConfig?: TeamsRetryConfig;
  httpPort?: number;
}

/**
 * Teams activity metadata extracted at parse time.
 *
 * The Bot Framework `Activity` shape carries everything we need (channelId,
 * conversation.id, from.aadObjectId, etc.); this struct is the slimmed-down
 * version we hand to the Omni runtime.
 */
export interface TeamsActivityMeta {
  /** Bot Framework activity ID — unique per activity */
  activityId: string;
  /** Teams conversation ID (channel, group chat, or 1:1) */
  conversationId: string;
  /** Parent activity ID (set when the user replied to a thread) */
  replyToId?: string;
  /** Sender AAD object ID (preferred) or fallback `from.id` */
  userId: string;
  /** Sender display name */
  userName?: string;
  /** Microsoft Entra Tenant ID */
  tenantId?: string;
  /** Service URL the activity arrived from (needed to reply) */
  serviceUrl: string;
  /** Conversation type as reported by Teams */
  conversationType?: 'personal' | 'channel' | 'groupChat';
  /** Whether this is a 1:1 chat with the bot */
  isDm: boolean;
  /** Whether this activity is a reply inside a Teams channel thread */
  isThreadReply: boolean;
  /** Channel/team ID inside the conversation (only for channel conversations) */
  teamId?: string;
  /** Teams channel ID inside the team (only for channel conversations) */
  channelId?: string;
}

/**
 * Inbound attachment metadata extracted from a Bot Framework activity.
 */
export interface TeamsAttachmentInfo {
  /** Attachment content type (e.g. 'image/png', 'application/vnd.microsoft.card.adaptive') */
  contentType: string;
  /** Display name */
  name?: string;
  /** Download URL (Bot Framework `contentUrl`) */
  contentUrl?: string;
  /** Inline content for cards (raw JSON payload) */
  content?: unknown;
  /** Thumbnail URL when present */
  thumbnailUrl?: string;
}

/**
 * Slash-command-style invoke payload — Teams uses messaging extensions and
 * task modules rather than literal slash commands; this is the unified shape
 * we expose to the dispatcher.
 */
export interface TeamsCommand {
  /** Command name (extracted from messaging extension or text prefix) */
  command: string;
  /** Free-form arguments passed alongside the command */
  args?: string;
  /** Conversation ID the command came from */
  conversationId: string;
  /** Sender AAD ID */
  userId: string;
}

/**
 * Adaptive Card payload wrapper — kept opt-in for v1 (see DESIGN.md scope).
 */
export interface TeamsAdaptiveCard {
  /** Card schema version (e.g. '1.5') */
  version: string;
  /** Raw card body */
  body: unknown[];
  /** Optional actions array */
  actions?: unknown[];
}

/**
 * Manifest used to register the Teams app in Microsoft Teams Admin Center.
 *
 * Mirrors the `manifest.json` schema documented at
 * https://learn.microsoft.com/microsoftteams/platform/resources/schema/manifest-schema.
 * Only the fields Omni populates are typed here; everything else is permissive.
 */
export interface TeamsAppManifest {
  $schema?: string;
  manifestVersion: string;
  version: string;
  id: string;
  packageName: string;
  developer: {
    name: string;
    websiteUrl: string;
    privacyUrl: string;
    termsOfUseUrl: string;
  };
  name: {
    short: string;
    full: string;
  };
  description: {
    short: string;
    full: string;
  };
  icons: {
    outline: string;
    color: string;
  };
  accentColor: string;
  bots?: Array<{
    botId: string;
    scopes: Array<'personal' | 'team' | 'groupchat'>;
    supportsFiles?: boolean;
    isNotificationOnly?: boolean;
  }>;
  permissions?: Array<'identity' | 'messageTeamMembers'>;
  validDomains?: string[];
}

/**
 * Plugin-local error codes — extends `ChannelError` so the rest of Omni can
 * treat them uniformly (matches `SlackError` / `GupshupError`).
 */
export const TeamsErrorCode = {
  NOT_CONNECTED: 'TEAMS_NOT_CONNECTED',
  AUTH_FAILED: 'TEAMS_AUTH_FAILED',
  INVALID_CREDENTIALS: 'TEAMS_INVALID_CREDENTIALS',
  SEND_FAILED: 'TEAMS_SEND_FAILED',
  RATE_LIMITED: 'TEAMS_RATE_LIMITED',
  ATTACHMENT_FAILED: 'TEAMS_ATTACHMENT_FAILED',
  WEBHOOK_INVALID: 'TEAMS_WEBHOOK_INVALID',
  DM_REJECTED: 'TEAMS_DM_REJECTED',
  CONNECTION_FAILED: 'TEAMS_CONNECTION_FAILED',
  UNSUPPORTED_ACTIVITY: 'TEAMS_UNSUPPORTED_ACTIVITY',
} as const;

export type TeamsErrorCodeType = (typeof TeamsErrorCode)[keyof typeof TeamsErrorCode];

const TEAMS_CORE_CODE_MAP: Record<TeamsErrorCodeType, CoreErrorCode> = {
  [TeamsErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [TeamsErrorCode.AUTH_FAILED]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [TeamsErrorCode.INVALID_CREDENTIALS]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [TeamsErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [TeamsErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [TeamsErrorCode.ATTACHMENT_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [TeamsErrorCode.WEBHOOK_INVALID]: ERROR_CODES.UNKNOWN,
  [TeamsErrorCode.DM_REJECTED]: ERROR_CODES.FORBIDDEN,
  [TeamsErrorCode.CONNECTION_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
  [TeamsErrorCode.UNSUPPORTED_ACTIVITY]: ERROR_CODES.UNKNOWN,
};

export class TeamsError extends ChannelError {
  readonly channelCode: TeamsErrorCodeType;

  constructor(channelCode: TeamsErrorCodeType, message: string, recoverable = false) {
    const coreCode = TEAMS_CORE_CODE_MAP[channelCode] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'teams', undefined, { recoverable, context: { channelCode } });
    this.name = 'TeamsError';
    this.channelCode = channelCode;
  }
}
