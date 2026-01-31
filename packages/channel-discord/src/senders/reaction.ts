/**
 * Reaction sender
 *
 * Handles adding and removing reactions from messages.
 */

import type { Client, TextChannel } from 'discord.js';

/**
 * Add a reaction to a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID to react to
 * @param emoji - Emoji to react with (unicode or custom emoji ID)
 */
export async function addReaction(client: Client, channelId: string, messageId: string, emoji: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);
  await message.react(emoji);
}

/**
 * Remove the bot's reaction from a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID to remove reaction from
 * @param emoji - Emoji to remove
 */
export async function removeReaction(
  client: Client,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  // Find the bot's reaction
  const reaction = message.reactions.cache.find((r) => r.emoji.name === emoji || r.emoji.id === emoji);

  if (reaction) {
    await reaction.users.remove(client.user?.id);
  }
}

/**
 * Remove a specific user's reaction from a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 * @param userId - User whose reaction to remove
 * @param emoji - Emoji to remove
 */
export async function removeUserReaction(
  client: Client,
  channelId: string,
  messageId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const reaction = message.reactions.cache.find((r) => r.emoji.name === emoji || r.emoji.id === emoji);

  if (reaction) {
    await reaction.users.remove(userId);
  }
}

/**
 * Remove all reactions from a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 */
export async function removeAllReactions(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);
  await message.reactions.removeAll();
}

/**
 * Remove all reactions of a specific emoji from a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 * @param emoji - Emoji to remove all reactions of
 */
export async function removeEmojiReactions(
  client: Client,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const reaction = message.reactions.cache.find((r) => r.emoji.name === emoji || r.emoji.id === emoji);

  if (reaction) {
    await reaction.remove();
  }
}
