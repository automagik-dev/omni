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
}): SlackManifest {
  const {
    appName = 'Omni Bot',
    description = 'Universal omnichannel messaging bot powered by Omni v2',
    displayName = 'Omni',
    backgroundColor = '#4A154B',
    slashCommands = [],
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
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: [...BOT_EVENTS],
      },
      interactivity: {
        is_enabled: true,
      },
      socket_mode_enabled: true,
    },
  };
}
