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
import hermesPlugin from '@omni/channel-hermes';
import slackPlugin from '@omni/channel-slack';
import telegramPlugin from '@omni/channel-telegram';
import whatsappPlugin from '@omni/channel-whatsapp';
import whatsappBusinessPlugin from '@omni/channel-whatsapp-business';

// Pre-register all bundled channel plugins
// Type assertion needed: channel plugins implement ChannelPlugin but
// some have narrower parameter types (e.g. Discord's fetchContacts)
for (const plugin of [
  telegramPlugin,
  discordPlugin,
  whatsappPlugin,
  whatsappBusinessPlugin,
  slackPlugin,
  gupshupPlugin,
  hermesPlugin,
] as ChannelPlugin[]) {
  channelRegistry.register(plugin);
}

// A2A is opt-in — gated by the same A2A_ENABLED flag that mounts the JSON-RPC
// route in @omni/api. Without this the route returns "A2A channel not available"
// (channelRegistry.get('a2a') is empty) and a2a instances fail to (re)connect,
// since the bundled distribution never registered the plugin. Dynamic import so
// it's excluded from the registry when A2A is disabled.
if (process.env.A2A_ENABLED === 'true') {
  const { default: a2aPlugin } = await import('@omni/channel-a2a');
  channelRegistry.register(a2aPlugin as ChannelPlugin);
}

// Start the API server — must be a dynamic import to guarantee
// registration happens before the server reads the registry
await import('@omni/api');
