/**
 * Slack-specific type definitions for the channel plugin
 */

/**
 * Connection mode for Slack plugin
 */
export type SlackConnectionMode = 'socket' | 'http';

/**
 * Which identity outbound actions are performed as (#889).
 *
 * - `bot` (default): posts as the app's bot user via `xoxb`.
 * - `user`: posts as the human who authorized the app, via `xoxp`. Actions
 *   are indistinguishable from the person doing them by hand, and it unlocks
 *   `search.messages`, which no bot token can call.
 *
 * This is NOT a transport switch. There is no realtime API that a user token
 * can open on its own: RTM is closed to granular apps, and Socket Mode
 * requires an app-level `xapp`. Inbound always arrives over Socket Mode or
 * the HTTP receiver; what changes in `user` mode is that the app subscribes
 * to *user-scoped* events (`im:history`, `mpim:history`, …), so it sees the
 * workspace from that person's perspective.
 *
 * @see https://docs.slack.dev/apis/events-api/ — "Workspace Events … are
 *   perspectival to a member installing your application"
 */
export type SlackAuthMode = 'bot' | 'user';

/**
 * Per-channel configuration overrides.
 * Fields set here take precedence over instance-level defaults.
 */
export interface SlackChannelConfig {
  /** Require bot mention to trigger responses (default: false) */
  requireMention?: boolean;
  /** Restrict to these user IDs only (undefined = all users allowed) */
  allowedUsers?: string[];
  /** Tool overrides for this channel (passed to agent dispatcher) */
  tools?: string[];
  /** Skill overrides for this channel (passed to agent dispatcher) */
  skills?: string[];
}

/**
 * Slack instance configuration
 */
export interface SlackConfig {
  /** Bot User OAuth Token (xoxb-...) */
  botToken?: string;
  /**
   * User OAuth Token (xoxp-...). Required when `authMode` is 'user'.
   * Actions taken with it are attributed to the human who authorized the app.
   */
  userToken?: string;
  /**
   * Identity for outbound actions: 'bot' (default) or 'user'.
   * See {@link SlackAuthMode} — this does not change the inbound transport.
   */
  authMode?: SlackAuthMode;
  /** App-Level Token for Socket Mode (xapp-...) */
  appToken?: string;
  /** Signing Secret for request verification (required for HTTP mode) */
  signingSecret?: string;
  /** Connection mode: 'socket' (default) or 'http' */
  mode?: SlackConnectionMode;
  /** Channel allowlist: only process messages from these channel IDs */
  channelAllowlist?: string[];
  /** Channel blocklist: skip messages from these channel IDs */
  channelBlocklist?: string[];
  /** Per-channel configuration overrides keyed by channel ID */
  channels?: Record<string, SlackChannelConfig>;
  /** Stream mode for progressive responses */
  streamMode?: StreamMode;
  /** Stream throttle interval in ms (default: 1000) */
  streamThrottleMs?: number;
  /** DM policy configuration */
  dmPolicy?: DmPolicy;
  /** DM allowlist (user IDs allowed for DMs when policy is 'pairing') */
  dmAllowlist?: string[];
  /** DM rejection message when policy denies a DM */
  dmRejectionMessage?: string;
  /** Auto-threading mode */
  replyToMode?: ReplyToMode;
  /** Custom username for messages */
  defaultUsername?: string;
  /** Custom icon URL for messages */
  defaultIconUrl?: string;
  /** Custom icon emoji for messages */
  defaultIconEmoji?: string;
  /** Rate limit retry config */
  retryConfig?: RetryConfig;
  /**
   * Port for the built-in HTTP receiver (HTTP mode only).
   * When mode is 'http', Bolt.js starts an HTTP server on this port to receive
   * Slack event payloads. Configure your Slack app's Event Request URL to point
   * at this port (e.g. https://your-host:<httpPort>/slack/events).
   * Defaults to 3001.
   */
  httpPort?: number;
  /**
   * Ack reaction emoji sent on message receipt (e.g. "eyes").
   * Set to false or omit to disable.
   */
  ackReaction?: string | false;
  /**
   * Remove the ack reaction after reply is sent. Default: true.
   * Only applies when ackReaction is set.
   */
  removeAckAfterReply?: boolean;
}

/**
 * Stream mode for progressive response rendering
 */
export const STREAM_MODES = ['replace', 'status_final', 'off', 'native'] as const;
export type StreamMode = (typeof STREAM_MODES)[number];

/**
 * DM policy for controlling direct message access
 */
export type DmPolicy = 'open' | 'pairing' | 'closed';

/**
 * Auto-threading mode
 */
export type ReplyToMode = 'off' | 'first' | 'all';

/**
 * Rate limit retry configuration
 */
export interface RetryConfig {
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
 * Slack connection options passed to Bolt.js
 */
export interface SlackConnectionOptions {
  botToken: string;
  /**
   * User token (`xoxp`). Required when authMode is 'user' — outbound calls go
   * out as the authorizing human. The bot token is still required alongside
   * it: Bolt authenticates the socket with it, and it is the fallback for
   * calls the user token has no scope for.
   */
  userToken?: string;
  /** Identity used for outbound actions (default: 'bot'). */
  authMode?: SlackAuthMode;
  /** Required for Socket Mode; not used for HTTP mode */
  appToken?: string;
  /** Required for HTTP mode; optional for Socket Mode */
  signingSecret?: string;
  retryConfig?: RetryConfig;
  /** Connection mode (default: 'socket') */
  mode?: SlackConnectionMode;
  /** Port for the built-in HTTP receiver (HTTP mode only, default: 3001) */
  httpPort?: number;
}

/**
 * Slack message metadata extracted from events
 */
export interface SlackMessageMeta {
  /** Channel ID */
  channelId: string;
  /** Thread timestamp (for threaded messages) */
  threadTs?: string;
  /** Message timestamp (unique ID in Slack) */
  ts: string;
  /** User ID of the sender */
  userId: string;
  /** Team/workspace ID */
  teamId?: string;
  /** Whether this is a direct conversation — covers both `im` and `mpim` (#889). */
  isDm: boolean;
  /**
   * Whether this is specifically a multi-person DM (`mpim`). Distinct from
   * isDm because an mpim has several humans in it, so 1:1 assumptions
   * (a single counterpart, using their name as the chat name) do not hold.
   */
  isMpim?: boolean;
  /** Whether this is a thread reply */
  isThreadReply: boolean;
  /** Channel type: channel, group, im, mpim */
  channelType?: string;
}

/**
 * Slack file attachment metadata
 */
export interface SlackFileInfo {
  /** File ID */
  id: string;
  /** File name */
  name: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** URL for private download (requires bot token) */
  urlPrivateDownload?: string;
  /** URL for private view */
  urlPrivate?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
}

/**
 * Slash command definition for registration
 */
export interface SlackSlashCommand {
  /** Command name (e.g., '/omni') */
  command: string;
  /** Description shown in Slack */
  description: string;
  /** Usage hint */
  usageHint?: string;
}

/**
 * Interaction payload from Slack
 */
export interface SlackInteractionPayload {
  /** Instance ID */
  instanceId: string;
  /** Action type */
  type: 'button' | 'select' | 'modal_submit' | 'modal_close';
  /** Action ID (omni: prefixed) */
  actionId: string;
  /** User who triggered the action */
  userId: string;
  /** Channel ID (if applicable) */
  channelId?: string;
  /** Thread TS (if applicable) */
  threadTs?: string;
  /** Selected value(s) */
  value?: string;
  values?: string[];
  /** Modal private_metadata (for context round-tripping) */
  privateMetadata?: string;
  /** Raw payload */
  rawPayload?: Record<string, unknown>;
}

/**
 * Slack Block Kit element types
 */
export interface SlackBlockButton {
  type: 'button';
  text: string;
  actionId: string;
  value?: string;
  style?: 'primary' | 'danger';
  url?: string;
}

export interface SlackBlockSelect {
  type: 'static_select' | 'external_select' | 'users_select' | 'channels_select' | 'conversations_select';
  actionId: string;
  placeholder?: string;
  options?: Array<{ text: string; value: string }>;
}

export interface SlackBlockDatePicker {
  type: 'datepicker';
  actionId: string;
  placeholder?: string;
  initialDate?: string;
}

export interface SlackBlockTimePicker {
  type: 'timepicker';
  actionId: string;
  placeholder?: string;
  initialTime?: string;
}

export type SlackBlockElement = SlackBlockButton | SlackBlockSelect | SlackBlockDatePicker | SlackBlockTimePicker;

/**
 * Modal view configuration
 */
export interface SlackModalConfig {
  /** Trigger ID from interaction */
  triggerId: string;
  /** Modal title (max 24 chars) */
  title: string;
  /** Submit button text */
  submitText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Private metadata for context round-tripping */
  privateMetadata?: string;
  /** Input blocks */
  blocks: unknown[];
  /** Callback ID for the view */
  callbackId?: string;
}

/**
 * App manifest with OAuth scopes
 */
export interface SlackManifest {
  display_information: {
    name: string;
    description?: string;
    background_color?: string;
  };
  features: {
    bot_user: {
      display_name: string;
      always_online: boolean;
    };
    /**
     * Agent messaging experience (#914). Replaces the deprecated
     * `assistant_view` (gone February 2027); the switch is one-way per app.
     */
    agent_view?: {
      agent_description: string;
      suggested_prompts?: Array<{
        title: string;
        message: string;
      }>;
    };
    slash_commands?: Array<{
      command: string;
      description: string;
      usage_hint?: string;
    }>;
  };
  oauth_config: {
    scopes: {
      bot: string[];
      /** User-token scopes, requested only for authMode 'user' (#889). */
      user?: string[];
    };
  };
  settings: {
    event_subscriptions: {
      bot_events: string[];
      /** Events delivered on the authorizing user's behalf (#889). */
      user_events?: string[];
    };
    interactivity?: {
      is_enabled: boolean;
    };
    socket_mode_enabled: boolean;
  };
}

import { ChannelError, type ErrorCode as CoreErrorCode, ERROR_CODES } from '@omni/core';

/**
 * Error codes for the Slack plugin
 */
export const SlackErrorCode = {
  NOT_CONNECTED: 'SLACK_NOT_CONNECTED',
  INVALID_TOKEN: 'SLACK_INVALID_TOKEN',
  SEND_FAILED: 'SLACK_SEND_FAILED',
  RATE_LIMITED: 'SLACK_RATE_LIMITED',
  FILE_UPLOAD_FAILED: 'SLACK_FILE_UPLOAD_FAILED',
  FILE_DOWNLOAD_FAILED: 'SLACK_FILE_DOWNLOAD_FAILED',
  INTERACTION_FAILED: 'SLACK_INTERACTION_FAILED',
  COMMAND_FAILED: 'SLACK_COMMAND_FAILED',
  DM_REJECTED: 'SLACK_DM_REJECTED',
  CONNECTION_FAILED: 'SLACK_CONNECTION_FAILED',
} as const;

export type SlackErrorCodeType = (typeof SlackErrorCode)[keyof typeof SlackErrorCode];

/**
 * Map Slack-specific error codes to core ErrorCode
 */
const SLACK_CORE_CODE_MAP: Record<SlackErrorCodeType, CoreErrorCode> = {
  [SlackErrorCode.NOT_CONNECTED]: ERROR_CODES.CHANNEL_NOT_CONNECTED,
  [SlackErrorCode.INVALID_TOKEN]: ERROR_CODES.CHANNEL_AUTH_FAILED,
  [SlackErrorCode.SEND_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [SlackErrorCode.RATE_LIMITED]: ERROR_CODES.CHANNEL_RATE_LIMITED,
  [SlackErrorCode.FILE_UPLOAD_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [SlackErrorCode.FILE_DOWNLOAD_FAILED]: ERROR_CODES.CHANNEL_SEND_FAILED,
  [SlackErrorCode.INTERACTION_FAILED]: ERROR_CODES.UNKNOWN,
  [SlackErrorCode.COMMAND_FAILED]: ERROR_CODES.UNKNOWN,
  [SlackErrorCode.DM_REJECTED]: ERROR_CODES.FORBIDDEN,
  [SlackErrorCode.CONNECTION_FAILED]: ERROR_CODES.CHANNEL_CONNECTION_FAILED,
};

/**
 * Typed Slack error — extends core ChannelError
 */
export class SlackError extends ChannelError {
  readonly channelCode: SlackErrorCodeType;

  constructor(channelCode: SlackErrorCodeType, message: string, recoverable = false) {
    const coreCode = SLACK_CORE_CODE_MAP[channelCode] ?? ERROR_CODES.UNKNOWN;
    super(coreCode, message, 'slack', undefined, { recoverable, context: { channelCode } });
    this.name = 'SlackError';
    this.channelCode = channelCode;
  }
}
