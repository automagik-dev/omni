/**
 * Messages Commands
 *
 * omni messages read <id> --instance <id>
 * omni messages read --batch --instance <id> --chat <id> --ids <id1,id2,...>
 */

import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

interface ReadOptions {
  instance: string;
  batch?: boolean;
  chat?: string;
  ids?: string;
}

/** Handle batch mark read */
async function handleBatchRead(client: OmniClient, options: ReadOptions): Promise<void> {
  const { chat, ids, instance } = options;
  if (!chat) {
    output.error('--chat is required with --batch');
    return;
  }
  if (!ids) {
    output.error('--ids is required with --batch');
    return;
  }

  const messageIds = ids.split(',').map((id) => id.trim());
  const result = await client.messages.batchMarkRead({
    instanceId: instance,
    chatId: chat,
    messageIds,
  });

  output.success(`Marked ${result.messageCount ?? messageIds.length} messages as read`, result);
}

/** Handle single message mark read */
async function handleSingleRead(client: OmniClient, messageId: string, instanceId: string): Promise<void> {
  const result = await client.messages.markRead(messageId, { instanceId });
  output.success('Message marked as read', result);
}

export function createMessagesCommand(): Command {
  const messages = new Command('messages').description('Manage messages');

  messages
    .command('read [messageId]')
    .description('Mark message(s) as read')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--batch', 'Batch mode for multiple messages')
    .option('--chat <id>', 'Chat ID (required with --batch)')
    .option('--ids <ids>', 'Comma-separated message IDs (required with --batch)')
    .action(async (messageId: string | undefined, options: ReadOptions) => {
      const client = getClient();

      try {
        if (options.batch) {
          await handleBatchRead(client, options);
        } else if (messageId) {
          await handleSingleRead(client, messageId, options.instance);
        } else {
          output.error('Message ID is required (or use --batch for multiple)');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to mark as read: ${message}`);
      }
    });

  return messages;
}
