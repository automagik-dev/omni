/**
 * Discord.js client creation and management
 *
 * Creates a Discord client with all necessary intents for full capability.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * Create a new Discord.js client with all required intents
 *
 * Intents are configured for full channel functionality:
 * - Core messaging (guilds, messages, DMs)
 * - Reactions
 * - Typing indicators
 * - Presence (user status)
 * - Members (for mentions, user info)
 * - Voice states (join/leave/mute)
 * - Polls
 *
 * @returns Configured Discord.js Client
 */
export function createClient(): Client {
  return new Client({
    intents: [
      // Core - required for basic bot functionality
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,

      // Reactions - for emoji reactions
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.DirectMessageReactions,

      // Typing - for typing indicators
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.DirectMessageTyping,

      // Presence - for user online/offline status
      GatewayIntentBits.GuildPresences,

      // Members - for mentions, user info, member events
      GatewayIntentBits.GuildMembers,

      // Voice - for voice channel join/leave/mute events
      GatewayIntentBits.GuildVoiceStates,

      // Polls - for poll messages (Discord.js v14.18+)
      GatewayIntentBits.GuildMessagePolls,
      GatewayIntentBits.DirectMessagePolls,
    ],
    partials: [
      // Enable partial structures for DMs and reactions on uncached messages
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
      Partials.GuildMember,
    ],
  });
}

/**
 * Check if a client is connected and ready
 */
export function isClientReady(client: Client): boolean {
  return client.isReady();
}

/**
 * Get the bot user info
 */
export function getBotUser(client: Client): { id: string; username: string; discriminator: string } | null {
  if (!client.user) return null;

  return {
    id: client.user.id,
    username: client.user.username,
    discriminator: client.user.discriminator,
  };
}

/**
 * Destroy a client and release resources
 */
export async function destroyClient(client: Client): Promise<void> {
  client.removeAllListeners();
  await client.destroy();
}
