/**
 * Pin event handler for Slack
 *
 * Handles pin_added and pin_removed events (#889). The manifest has subscribed
 * to both since the user-token work landed; this is the consumer that turns
 * them into core events so `messages.pinned_at` / `pinned_by` reflect reality.
 *
 * Unlike reactions, the bot's own pins are NOT filtered out: a pin made
 * through our own tools (pins.add) is still platform state worth recording,
 * and recording it cannot loop — persistence only writes a column.
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';

export interface PinHandlerCallbacks {
  onPin: (
    instanceId: string,
    messageId: string,
    chatId: string,
    userId: string | undefined,
    action: 'pin' | 'unpin',
  ) => Promise<void>;
}

/**
 * Set up pin handlers on a Bolt.js app
 */
export function setupPinHandlers(app: App, instanceId: string, callbacks: PinHandlerCallbacks, logger: Logger): void {
  const handlePinEvent =
    (action: 'pin' | 'unpin') =>
    async ({ event }: { event: unknown }) => {
      const evt = event as Record<string, unknown>;
      const item = evt.item as Record<string, unknown> | undefined;
      // Files and file comments can be pinned too; only messages have a row.
      if (!item || item.type !== 'message') return;

      const message = item.message as Record<string, unknown> | undefined;
      const channelId = (item.channel as string) ?? (evt.channel_id as string) ?? '';
      const messageTs = (message?.ts as string) ?? '';
      if (!channelId || !messageTs) return;

      const userId = evt.user as string | undefined;
      logger.debug(action === 'pin' ? 'Pin added' : 'Pin removed', { instanceId, channelId, messageTs, userId });

      await callbacks.onPin(instanceId, messageTs, channelId, userId, action);
    };

  app.event('pin_added', handlePinEvent('pin'));
  app.event('pin_removed', handlePinEvent('unpin'));

  logger.info('Pin handlers registered', { instanceId });
}
