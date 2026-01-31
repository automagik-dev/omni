/**
 * Sticker message sender
 *
 * Handles sending sticker messages.
 */

import type { Client, DMChannel, MessageCreateOptions, TextChannel, ThreadChannel } from 'discord.js';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Build sticker message content
 *
 * @param stickerId - Discord sticker ID
 * @returns Message options with sticker
 */
export function buildStickerContent(stickerId: string): MessageCreateOptions {
  return {
    stickers: [stickerId],
  };
}

/**
 * Send a sticker message
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param stickerId - Discord sticker ID
 * @param replyToId - Optional message ID to reply to
 * @returns Message ID
 */
export async function sendStickerMessage(
  client: Client,
  channelId: string,
  stickerId: string,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const options = buildStickerContent(stickerId);

  if (replyToId) {
    options.reply = { messageReference: replyToId };
  }

  const result = await sendChannel.send(options);
  return result.id;
}

/**
 * Get available stickers in a guild
 *
 * @param client - Discord client
 * @param guildId - Guild ID
 * @returns Array of sticker info
 */
export async function getGuildStickers(
  client: Client,
  guildId: string,
): Promise<Array<{ id: string; name: string; description: string | null; url: string }>> {
  const guild = await client.guilds.fetch(guildId);
  const stickers = await guild.stickers.fetch();

  return stickers.map((sticker) => ({
    id: sticker.id,
    name: sticker.name,
    description: sticker.description,
    url: sticker.url,
  }));
}

/**
 * Get a specific sticker by ID
 *
 * @param client - Discord client
 * @param stickerId - Sticker ID
 * @returns Sticker info or null if not found
 */
export async function getSticker(
  client: Client,
  stickerId: string,
): Promise<{ id: string; name: string; description: string | null; url: string } | null> {
  try {
    const sticker = await client.fetchSticker(stickerId);
    return {
      id: sticker.id,
      name: sticker.name,
      description: sticker.description,
      url: sticker.url,
    };
  } catch {
    return null;
  }
}
