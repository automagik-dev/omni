/**
 * Reaction event handlers for Telegram bot
 *
 * Handles emoji reactions add/remove events using Bot API 7.3+ message_reaction update.
 * Compares new_reaction vs old_reaction arrays to determine added/removed reactions.
 */

import { createLogger } from '@omni/core';
import type { Bot } from 'grammy';
import type { MessageReactionUpdated, ReactionType } from 'grammy/types';
import type { TelegramPlugin } from '../plugin';
import { toPlatformUserId } from '../utils/identity';

const log = createLogger('telegram:reactions');

/**
 * Extract emoji string from a Telegram ReactionType
 */
function reactionToEmoji(reaction: ReactionType): string {
  if (reaction.type === 'emoji') return reaction.emoji;
  if (reaction.type === 'custom_emoji') return reaction.custom_emoji_id;
  return '?';
}

/** Check if a reaction in a list is a custom emoji */
function isCustomInList(reactions: readonly ReactionType[], emoji: string): boolean {
  return reactions.some((r) => reactionToEmoji(r) === emoji && r.type === 'custom_emoji');
}

/** Resolve the user ID from a message_reaction update */
function resolveUserId(update: MessageReactionUpdated): string | undefined {
  if (update.user) return update.user.is_bot ? undefined : toPlatformUserId(update.user.id);
  if (update.actor_chat) return String(update.actor_chat.id);
  return undefined;
}

/** Diff old/new reaction arrays and dispatch add/remove events */
async function processReactionDiff(
  plugin: TelegramPlugin,
  instanceId: string,
  messageId: string,
  chatId: string,
  userId: string,
  update: MessageReactionUpdated,
): Promise<void> {
  const oldEmojis = new Set(update.old_reaction.map(reactionToEmoji));
  const newEmojis = new Set(update.new_reaction.map(reactionToEmoji));

  // Added reactions: in new but not in old
  for (const emoji of newEmojis) {
    if (!oldEmojis.has(emoji)) {
      await plugin.handleReactionAdd(
        instanceId,
        messageId,
        chatId,
        userId,
        emoji,
        isCustomInList(update.new_reaction, emoji),
      );
    }
  }

  // Removed reactions: in old but not in new
  for (const emoji of oldEmojis) {
    if (!newEmojis.has(emoji)) {
      await plugin.handleReactionRemove(
        instanceId,
        messageId,
        chatId,
        userId,
        emoji,
        isCustomInList(update.old_reaction, emoji),
      );
    }
  }
}

/**
 * Set up reaction handlers for a grammy Bot
 */
export function setupReactionHandlers(bot: Bot, plugin: TelegramPlugin, instanceId: string): void {
  bot.on('message_reaction', async (ctx) => {
    const update = ctx.messageReaction;
    if (!update) return;

    const userId = resolveUserId(update);
    if (!userId) return;

    const chatId = String(update.chat.id);
    const messageId = String(update.message_id);

    await processReactionDiff(plugin, instanceId, messageId, chatId, userId, update);
  });

  log.info('Reaction handlers set up', { instanceId });
}
