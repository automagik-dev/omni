/**
 * Reaction event handler for Slack
 *
 * Handles reaction_added and reaction_removed events
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';

export interface ReactionHandlerCallbacks {
  onReaction: (
    instanceId: string,
    messageId: string,
    chatId: string,
    userId: string,
    emoji: string,
    action: 'add' | 'remove',
  ) => Promise<void>;
}

/**
 * Set up reaction handlers on a Bolt.js app
 */
export function setupReactionHandlers(
  app: App,
  instanceId: string,
  botUserId: string | undefined,
  callbacks: ReactionHandlerCallbacks,
  logger: Logger,
): void {
  app.event('reaction_added', async ({ event }) => {
    const evt = event as unknown as Record<string, unknown>;
    const userId = evt.user as string | undefined;
    if (!userId) return;
    if (botUserId && userId === botUserId) return;

    const emoji = (evt.reaction as string) ?? '';
    const item = evt.item as Record<string, unknown> | undefined;
    if (!item) return;

    const channelId = (item.channel as string) ?? '';
    const messageTs = (item.ts as string) ?? '';

    logger.debug('Reaction added', { instanceId, channelId, messageTs, emoji, userId });

    await callbacks.onReaction(instanceId, messageTs, channelId, userId, emoji, 'add');
  });

  app.event('reaction_removed', async ({ event }) => {
    const evt = event as unknown as Record<string, unknown>;
    const userId = evt.user as string | undefined;
    if (!userId) return;
    if (botUserId && userId === botUserId) return;

    const emoji = (evt.reaction as string) ?? '';
    const item = evt.item as Record<string, unknown> | undefined;
    if (!item) return;

    const channelId = (item.channel as string) ?? '';
    const messageTs = (item.ts as string) ?? '';

    logger.debug('Reaction removed', { instanceId, channelId, messageTs, emoji, userId });

    await callbacks.onReaction(instanceId, messageTs, channelId, userId, emoji, 'remove');
  });

  logger.info('Reaction handlers registered', { instanceId });
}
