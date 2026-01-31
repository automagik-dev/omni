/**
 * Reaction event handlers for Discord client
 *
 * Handles emoji reactions add/remove events.
 */

import { createLogger } from '@omni/core';
import type { Client, MessageReaction, PartialMessageReaction, PartialUser, User } from 'discord.js';
import type { DiscordPlugin } from '../plugin';

const log = createLogger('discord:reactions');

/**
 * Process reaction add
 */
async function processReactionAdd(
  plugin: DiscordPlugin,
  instanceId: string,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Skip bot reactions
  if (user.bot) {
    return;
  }

  // Fetch full reaction if partial
  const fullReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
  if (!fullReaction) {
    log.debug('Could not fetch partial reaction', { instanceId });
    return;
  }

  const emoji = fullReaction.emoji.name ?? fullReaction.emoji.id ?? '?';
  const messageId = fullReaction.message.id;
  const chatId = fullReaction.message.channel.id;
  const userId = user.id;

  await plugin.handleReactionReceived(instanceId, messageId, chatId, userId, emoji, 'add');
}

/**
 * Process reaction remove
 */
async function processReactionRemove(
  plugin: DiscordPlugin,
  instanceId: string,
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
): Promise<void> {
  // Skip bot reactions
  if (user.bot) {
    return;
  }

  // Fetch full reaction if partial
  const fullReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
  if (!fullReaction) {
    log.debug('Could not fetch partial reaction', { instanceId });
    return;
  }

  const emoji = fullReaction.emoji.name ?? fullReaction.emoji.id ?? '?';
  const messageId = fullReaction.message.id;
  const chatId = fullReaction.message.channel.id;
  const userId = user.id;

  await plugin.handleReactionReceived(instanceId, messageId, chatId, userId, emoji, 'remove');
}

/**
 * Set up reaction event handlers for a Discord client
 *
 * @param client - Discord.js Client instance
 * @param plugin - Discord plugin instance
 * @param instanceId - Instance identifier
 */
export function setupReactionHandlers(client: Client, plugin: DiscordPlugin, instanceId: string): void {
  // Reaction added
  client.on('messageReactionAdd', async (reaction, user) => {
    await processReactionAdd(plugin, instanceId, reaction, user);
  });

  // Reaction removed
  client.on('messageReactionRemove', async (reaction, user) => {
    await processReactionRemove(plugin, instanceId, reaction, user);
  });

  // All reactions removed from a message
  client.on('messageReactionRemoveAll', async (message, reactions) => {
    log.debug('All reactions removed', {
      instanceId,
      messageId: message.id,
      channelId: message.channel.id,
      count: reactions.size,
    });
    // We could emit an event for this, but it's not common in messaging contexts
  });

  // All reactions of a specific emoji removed
  client.on('messageReactionRemoveEmoji', async (reaction) => {
    log.debug('Emoji reactions removed', {
      instanceId,
      messageId: reaction.message.id,
      channelId: reaction.message.channel.id,
      emoji: reaction.emoji.name,
    });
  });
}
