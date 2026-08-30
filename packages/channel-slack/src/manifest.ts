/**
 * Slack App Manifest generation
 *
 * Generates a manifest with all required OAuth scopes and event subscriptions
 * for the Omni Slack bot.
 */

import type { SlackManifest, SlackSlashCommand } from './types';

/**
 * All required bot OAuth scopes for full functionality
 */
export const REQUIRED_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'chat:write.customize',
  'commands',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'pins:read',
  'pins:write',
  'reactions:read',
  'reactions:write',
  'users:read',
  'users:write',
] as const;

/**
 * All bot events to subscribe to
 */
export const BOT_EVENTS = [
  // app_mention not needed — app.message() captures mentions via <@botUserId> detection
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
  'reaction_added',
  'reaction_removed',
  'pin_added',
  'pin_removed',
  'member_joined_channel',
  'member_left_channel',
  'channel_rename',
  // Agent messaging experience (#914): fires when the user presses the native
  // stop button; subscribing is also what makes Slack SHOW that button while a
  // session is in `processing`.
  'agent_session_stopped',
] as const;

/**
 * User-token scopes for `authMode: 'user'` (#889).
 *
 * Acting as the authorizing human rather than the bot. `search:read` is the
 * one that has no bot equivalent at all — a bot token simply cannot search.
 *
 * `im:write` opens DMs (conversations.open). Note the USER scope for opening
 * a channel is `channels:write`, not the bot's `channels:manage`.
 */
const USER_SCOPES = [
  'channels:history',
  'channels:read',
  'chat:write',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'mpim:write',
  'reactions:read',
  'reactions:write',
  'search:read',
  'users:read',
] as const;

/**
 * Events delivered on the AUTHORIZING USER's behalf (#889).
 *
 * These are Slack's "Workspace Events": subscribed with user scopes, they are
 * perspectival to the member who installed the app, so the agent sees the DMs
 * and channels that person sees.
 *
 * The transport is unchanged — there is no realtime API a `xoxp` can open by
 * itself. Delivery is still Socket Mode (app-level `xapp`) or the HTTP
 * receiver; only the vantage point changes.
 *
 * @see https://docs.slack.dev/apis/events-api/
 */
const USER_EVENTS = [
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
  'reaction_added',
  'reaction_removed',
] as const;

/**
 * Build a Slack App Manifest for the Omni bot
 */
export function buildSlackManifest(options?: {
  appName?: string;
  description?: string;
  displayName?: string;
  backgroundColor?: string;
  slashCommands?: SlackSlashCommand[];
  /** Request user-token scopes and user-scoped events too (authMode 'user'). */
  includeUserScopes?: boolean;
  /**
   * Description shown in the Agent messaging experience (max 300 chars).
   * Defaults to `description`.
   */
  agentDescription?: string;
  /** Suggested prompts shown at the top of the agent's Messages tab. */
  suggestedPrompts?: Array<{ title: string; message: string }>;
}): SlackManifest {
  const {
    appName = 'Omni Bot',
    description = 'Universal omnichannel messaging bot powered by Omni v2',
    displayName = 'Omni',
    backgroundColor = '#4A154B',
    slashCommands = [],
    includeUserScopes = false,
    agentDescription,
    suggestedPrompts,
  } = options ?? {};

  return {
    display_information: {
      name: appName,
      description,
      background_color: backgroundColor,
    },
    features: {
      bot_user: {
        display_name: displayName,
        always_online: true,
      },
      // Agent messaging experience (#914). `assistant_view` is deprecated
      // (removed February 2027) and new Slack apps can only use `agent_view`.
      // Slack caps agent_description at 300 chars.
      agent_view: {
        agent_description: (agentDescription ?? description).slice(0, 300),
        ...(suggestedPrompts?.length ? { suggested_prompts: suggestedPrompts } : {}),
      },
      slash_commands:
        slashCommands.length > 0
          ? slashCommands.map((cmd) => ({
              command: cmd.command,
              description: cmd.description,
              usage_hint: cmd.usageHint,
            }))
          : undefined,
    },
    oauth_config: {
      scopes: {
        bot: [...REQUIRED_BOT_SCOPES],
        ...(includeUserScopes ? { user: [...USER_SCOPES] } : {}),
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [...BOT_EVENTS],
        ...(includeUserScopes ? { user_events: [...USER_EVENTS] } : {}),
      },
      interactivity: {
        is_enabled: true,
      },
      socket_mode_enabled: true,
    },
  };
}
