/**
 * Microsoft Teams app manifest generation.
 *
 * Generates a `manifest.json` payload conforming to Microsoft's Teams app
 * manifest schema v1.16. The manifest is what tenant admins upload to
 * Teams Admin Center to side-load the bot — Group 5 will document the upload
 * flow in detail (see `.genie/wishes/teams-channel/WISH.md`).
 */

import type { TeamsAppManifest } from './types';

/**
 * Default schema version targeted by the manifest builder.
 *
 * Teams manifest v1.16 covers everything we need today (bots in personal /
 * team / groupchat scopes plus `validDomains` for OAuth callbacks). Bumping
 * this is safe as long as the consumed shape stays backwards compatible.
 */
export const TEAMS_MANIFEST_VERSION = '1.16';

/**
 * Default scopes the bot is registered to operate in.
 *
 * - `personal` — 1:1 chats with the bot
 * - `team` — channel conversations (replies appear as channel messages)
 * - `groupchat` — multi-user chats outside of a team
 */
export const TEAMS_BOT_SCOPES = ['personal', 'team', 'groupchat'] as const;

/**
 * Required Microsoft Graph / messaging permissions surfaced in the manifest.
 *
 * Today the bot only needs the implicit `messageTeamMembers` permission to be
 * able to start proactive conversations; no Graph-level consent is required.
 */
export const TEAMS_PERMISSIONS = ['messageTeamMembers'] as const;

/**
 * Build a Teams app manifest for the Omni bot.
 *
 * `botId` is the Microsoft Entra App ID (the same value that lives in
 * `TeamsConfig.appId`).
 */
export function buildTeamsManifest(options: {
  botId: string;
  appName?: string;
  description?: string;
  developerName?: string;
  websiteUrl?: string;
  privacyUrl?: string;
  termsOfUseUrl?: string;
  iconColor?: string;
  iconOutline?: string;
  accentColor?: string;
  validDomains?: string[];
  appId?: string;
  packageName?: string;
  version?: string;
}): TeamsAppManifest {
  const {
    botId,
    appName = 'Omni Bot',
    description = 'Universal omnichannel messaging bot powered by Omni v2',
    developerName = 'Omni',
    websiteUrl = 'https://example.com/omni',
    privacyUrl = 'https://example.com/omni/privacy',
    termsOfUseUrl = 'https://example.com/omni/terms',
    iconColor = 'color.png',
    iconOutline = 'outline.png',
    accentColor = '#4A154B',
    validDomains = [],
    appId = botId,
    packageName = 'com.omni.teams',
    version = '1.0.0',
  } = options;

  return {
    $schema: `https://developer.microsoft.com/en-us/json-schemas/teams/v${TEAMS_MANIFEST_VERSION}/MicrosoftTeams.schema.json`,
    manifestVersion: TEAMS_MANIFEST_VERSION,
    version,
    id: appId,
    packageName,
    developer: {
      name: developerName,
      websiteUrl,
      privacyUrl,
      termsOfUseUrl,
    },
    name: {
      short: appName.slice(0, 30),
      full: appName,
    },
    description: {
      short: description.slice(0, 80),
      full: description,
    },
    icons: {
      outline: iconOutline,
      color: iconColor,
    },
    accentColor,
    bots: [
      {
        botId,
        scopes: [...TEAMS_BOT_SCOPES],
        supportsFiles: true,
        isNotificationOnly: false,
      },
    ],
    permissions: [...TEAMS_PERMISSIONS],
    validDomains,
  };
}
