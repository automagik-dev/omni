/**
 * Messages Commands
 *
 * omni messages read <id> --instance <id>
 * omni messages read --batch --instance <id> --chat <id> --ids <id1,id2,...>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createMessagesCommand(): Command {
  const messages = new Command('messages').description('Manage messages');

  // omni messages read
  messages
    .command('read [messageId]')
    .description('Mark message(s) as read')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--batch', 'Batch mode for multiple messages')
    .option('--chat <id>', 'Chat ID (required with --batch)')
    .option('--ids <ids>', 'Comma-separated message IDs (required with --batch)')
    .action(
      async (messageId?: string, options?: { instance: string; batch?: boolean; chat?: string; ids?: string }) => {
        if (!options) {
          output.error('Options are required');
          return;
        }

        const client = getClient();

        try {
          if (options.batch) {
            if (!options.chat) {
              output.error('--chat is required with --batch');
            }
            if (!options.ids) {
              output.error('--ids is required with --batch');
            }

            const messageIds = options.ids?.split(',').map((id) => id.trim()) ?? [];

            const result = await client.messages.batchMarkRead({
              instanceId: options.instance,
              chatId: options.chat as string,
              messageIds,
            });

            output.success(`Marked ${result.messageCount ?? messageIds.length} messages as read`, result);
          } else {
            if (!messageId) {
              output.error('Message ID is required (or use --batch for multiple)');
            }

            const result = await client.messages.markRead(messageId as string, {
              instanceId: options.instance,
            });

            output.success('Message marked as read', result);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to mark as read: ${message}`);
        }
      },
    );

  return messages;
}
