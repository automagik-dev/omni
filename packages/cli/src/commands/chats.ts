/**
 * Chat Commands
 *
 * omni chats list --instance <id>
 * omni chats get <id>
 * omni chats create --instance <id> --external-id <ext>
 * omni chats update <id> --name <name>
 * omni chats delete <id>
 * omni chats archive <id>
 * omni chats unarchive <id>
 * omni chats messages <id>
 * omni chats participants <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import type { Channel } from '@omni/sdk';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'];

export function createChatsCommand(): Command {
  const chats = new Command('chats').description('Manage chats');

  // omni chats list
  chats
    .command('list')
    .description('List chats')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--search <query>', 'Search by name')
    .option('--archived', 'Include archived chats')
    .option('--limit <n>', 'Limit results', Number.parseInt)
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        search?: string;
        archived?: boolean;
        limit?: number;
      }) => {
        const client = getClient();

        try {
          const result = await client.chats.list({
            instanceId: options.instance,
            channel: options.channel,
            search: options.search,
            includeArchived: options.archived,
            limit: options.limit,
          });

          const items = result.items.map((c) => ({
            id: c.id,
            name: c.name ?? c.externalId,
            channel: c.channel,
            type: c.chatType,
            archived: c.isArchived ? 'yes' : 'no',
          }));

          output.list(items, { emptyMessage: 'No chats found.' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to list chats: ${message}`);
        }
      },
    );

  // omni chats get <id>
  chats
    .command('get <id>')
    .description('Get chat details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const chat = await client.chats.get(id);
        output.data(chat);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get chat: ${message}`, undefined, 3);
      }
    });

  // omni chats create
  chats
    .command('create')
    .description('Create a chat record')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--external-id <id>', 'External chat ID from the channel')
    .requiredOption('--channel <type>', `Channel type (${VALID_CHANNELS.join(', ')})`)
    .option('--type <type>', 'Chat type (private, group)', 'private')
    .option('--name <name>', 'Chat name')
    .option('--description <desc>', 'Chat description')
    .action(
      async (options: {
        instance: string;
        externalId: string;
        channel: string;
        type?: string;
        name?: string;
        description?: string;
      }) => {
        if (!VALID_CHANNELS.includes(options.channel as Channel)) {
          output.error(`Invalid channel: ${options.channel}`, {
            validChannels: VALID_CHANNELS,
          });
        }

        const client = getClient();

        try {
          const chat = await client.chats.create({
            instanceId: options.instance,
            externalId: options.externalId,
            channel: options.channel as Channel,
            chatType: options.type ?? 'private',
            name: options.name,
            description: options.description,
          });

          output.success(`Chat created: ${chat.id}`, {
            id: chat.id,
            externalId: chat.externalId,
            channel: chat.channel,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to create chat: ${message}`);
        }
      },
    );

  // omni chats update <id>
  chats
    .command('update <id>')
    .description('Update a chat')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .action(async (id: string, options: { name?: string; description?: string }) => {
      if (!options.name && !options.description) {
        output.error('At least one of --name or --description is required');
      }

      const client = getClient();

      try {
        const chat = await client.chats.update(id, {
          name: options.name,
          description: options.description,
        });

        output.success(`Chat updated: ${chat.id}`, {
          id: chat.id,
          name: chat.name,
          description: chat.description,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update chat: ${message}`);
      }
    });

  // omni chats delete <id>
  chats
    .command('delete <id>')
    .description('Delete a chat')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.chats.delete(id);
        output.success(`Chat deleted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete chat: ${message}`);
      }
    });

  // omni chats archive <id>
  chats
    .command('archive <id>')
    .description('Archive a chat')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const chat = await client.chats.archive(id);
        output.success(`Chat archived: ${chat.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to archive chat: ${message}`);
      }
    });

  // omni chats unarchive <id>
  chats
    .command('unarchive <id>')
    .description('Unarchive a chat')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const chat = await client.chats.unarchive(id);
        output.success(`Chat unarchived: ${chat.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unarchive chat: ${message}`);
      }
    });

  // omni chats messages <id>
  chats
    .command('messages <id>')
    .description('Get chat messages')
    .option('--limit <n>', 'Limit results', Number.parseInt, 20)
    .option('--before <cursor>', 'Get messages before cursor')
    .option('--after <cursor>', 'Get messages after cursor')
    .action(async (id: string, options: { limit?: number; before?: string; after?: string }) => {
      const client = getClient();

      try {
        const messages = await client.chats.getMessages(id, {
          limit: options.limit,
          before: options.before,
          after: options.after,
        });

        const items = messages.map((m) => ({
          id: m.id,
          type: m.messageType,
          content: m.textContent ?? '-',
          fromMe: m.isFromMe ? 'yes' : 'no',
          timestamp: m.platformTimestamp,
        }));

        output.list(items, { emptyMessage: 'No messages found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get messages: ${message}`);
      }
    });

  // omni chats participants <id>
  chats
    .command('participants <id>')
    .description('List or manage chat participants')
    .option('--add <user-id>', 'Add participant by platform user ID')
    .option('--remove <user-id>', 'Remove participant by platform user ID')
    .option('--name <name>', 'Display name for new participant')
    .option('--role <role>', 'Role for new participant')
    .action(
      async (
        id: string,
        options: { add?: string; remove?: string; name?: string; role?: string },
      ) => {
        const client = getClient();

        try {
          if (options.add) {
            const participant = await client.chats.addParticipant(id, {
              platformUserId: options.add,
              displayName: options.name,
              role: options.role,
            });
            output.success(`Participant added: ${participant.platformUserId}`, participant);
          } else if (options.remove) {
            await client.chats.removeParticipant(id, options.remove);
            output.success(`Participant removed: ${options.remove}`);
          } else {
            // List participants
            const participants = await client.chats.listParticipants(id);

            const items = participants.map((p) => ({
              id: p.id,
              userId: p.platformUserId,
              name: p.displayName ?? '-',
              role: p.role ?? '-',
            }));

            output.list(items, { emptyMessage: 'No participants found.' });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to manage participants: ${message}`);
        }
      },
    );

  return chats;
}
