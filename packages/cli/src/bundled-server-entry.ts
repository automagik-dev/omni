/**
 * Bundled server entry point
 *
 * Pre-registers all channel plugins before starting the API server.
 * This ensures npm-installed omni ships with channels available
 * without needing monorepo filesystem discovery.
 */

import { type ChannelPlugin, channelRegistry } from '@omni/channel-sdk';

import discordPlugin from '@omni/channel-discord';
import gupshupPlugin from '@omni/channel-gupshup';
import slackPlugin from '@omni/channel-slack';
import teamsPlugin from '@omni/channel-teams';
import telegramPlugin from '@omni/channel-telegram';
import whatsappPlugin from '@omni/channel-whatsapp';

// Pre-register all bundled channel plugins
// Type assertion needed: channel plugins implement ChannelPlugin but
// some have narrower parameter types (e.g. Discord's fetchContacts)
for (const plugin of [
  telegramPlugin,
  discordPlugin,
  whatsappPlugin,
  slackPlugin,
  gupshupPlugin,
  teamsPlugin,
] as ChannelPlugin[]) {
  channelRegistry.register(plugin);
}

// Start the API server — must be a dynamic import to guarantee
// registration happens before the server reads the registry
await import('@omni/api');
