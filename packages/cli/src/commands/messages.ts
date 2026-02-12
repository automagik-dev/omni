/**
 * Messages Commands
 *
 * omni messages search <query> --since 7d --chat <id>
 * omni messages read <id> --instance <id>
 * omni messages read --batch --instance <id> --chat <id> --ids <id1,id2,...>
 */

import type { Chat, Message, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

// ============================================================================
// Helper Types and Functions
// ============================================================================

interface ExtendedMessage extends Message {
  senderDisplayName?: string | null;
  hasMedia?: boolean;
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;
}

interface ExtendedChat extends Chat {
  unreadCount?: number;
  lastMessagePreview?: string | null;
}

/**
 * Parse duration string (e.g., "7d", "30d", "1h") to Date
 */
function parseDuration(duration: string): Date {
  const now = new Date();
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "7d", "30d", "24h"`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'm':
      return new Date(now.getTime() - value * 60 * 1000);
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Format date for display
 */
function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '-';
  const clean = text.replace(/\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 3)}...`;
}

/**
 * Get content preview from message (text or transcription/description)
 */
function getContentPreview(msg: ExtendedMessage): string {
  if (msg.textContent) return msg.textContent;
  if (msg.transcription) return `[transcription] ${msg.transcription}`;
  if (msg.imageDescription) return `[image] ${msg.imageDescription}`;
  if (msg.videoDescription) return `[video] ${msg.videoDescription}`;
  if (msg.documentExtraction) return `[doc] ${msg.documentExtraction}`;
  return '-';
}

/**
 * Build URL search params for message search
 */
function buildSearchParams(
  query: string,
  options: { chat?: string; since?: string; type?: string; limit?: number },
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('search', query);
  params.set('limit', String(options.limit ?? 20));

  if (options.since) {
    const sinceDate = parseDuration(options.since);
    params.set('since', sinceDate.toISOString());
  }
  if (options.chat) params.set('chatId', options.chat);
  if (options.type) params.set('messageType', options.type);

  return params;
}

/**
 * Fetch search results from API
 */
async function fetchSearchResults(params: URLSearchParams): Promise<ExtendedMessage[]> {
  const _cfg = (await import('../config.js')).loadConfig();
  const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
  const apiKey = _cfg.apiKey ?? '';

  const resp = await fetch(`${baseUrl}/api/v2/messages?${params}`, {
    headers: { 'x-api-key': apiKey },
  });

  if (!resp.ok) {
    const err = (await resp.json()) as { error?: string };
    throw new Error(err?.error ?? `API error: ${resp.status}`);
  }

  const data = (await resp.json()) as { items?: ExtendedMessage[] };
  return data.items ?? [];
}

/**
 * Fetch chat map for search results
 */
async function fetchChatMap(
  client: ReturnType<typeof getClient>,
  chatIds: string[],
): Promise<Map<string, ExtendedChat>> {
  const chatMap = new Map<string, ExtendedChat>();

  for (const chatId of chatIds) {
    try {
      const chat = (await client.chats.get(chatId)) as ExtendedChat;
      chatMap.set(chatId, chat);
    } catch {
      // Chat not found, skip
    }
  }

  return chatMap;
}

/**
 * Format search results for output
 */
function formatSearchResults(
  messages: ExtendedMessage[],
  chatMap: Map<string, ExtendedChat>,
): { chat: string; time: string; type: string; content: string }[] {
  return messages.map((m) => {
    const chat = chatMap.get(m.chatId);
    const chatName = chat?.name ?? chat?.externalId ?? m.chatId.slice(0, 8);

    return {
      chat: truncate(chatName, 20),
      time: formatDate(m.platformTimestamp),
      type: m.messageType,
      content: truncate(getContentPreview(m), 50),
    };
  });
}

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

  // omni messages get <id>
  messages
    .command('get <messageId>')
    .description('Get a single message by ID')
    .action(async (messageId: string) => {
      const client = getClient();

      try {
        const message = (await client.messages.get(messageId)) as ExtendedMessage;

        const items = {
          id: message.id,
          chatId: message.chatId,
          externalId: message.externalId,
          type: message.messageType,
          source: message.source,
          isFromMe: message.isFromMe ?? false,
          timestamp: formatDate(message.platformTimestamp),
          content: message.textContent ?? '-',
          hasMedia: message.hasMedia ?? false,
          transcription: message.transcription ?? '-',
          imageDescription: message.imageDescription ?? '-',
          videoDescription: message.videoDescription ?? '-',
          documentExtraction: message.documentExtraction ?? '-',
        };

        output.data(items);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get message: ${message}`);
      }
    });

  // omni messages search <query>
  messages
    .command('search <query>')
    .description('Search messages across chats')
    .option('--instance <id>', 'Instance ID (uses default if not specified)')
    .option('--chat <id>', 'Limit search to specific chat')
    .option('--since <duration>', 'Time range: 1d, 7d, 30d (default: 7d)', '7d')
    .option('--type <type>', 'Message type: text, image, audio, document')
    .option('--limit <n>', 'Max results (default: 20)', (v) => Number.parseInt(v, 10), 20)
    .action(
      async (
        query: string,
        options: {
          instance?: string;
          chat?: string;
          since?: string;
          type?: string;
          limit?: number;
        },
      ) => {
        const client = getClient();

        try {
          const params = buildSearchParams(query, options);
          const searchResults = await fetchSearchResults(params);

          if (searchResults.length === 0) {
            output.info('No messages found matching your search.');
            return;
          }

          const chatIds = [...new Set(searchResults.map((m) => m.chatId))];
          const chatMap = await fetchChatMap(client, chatIds);
          const items = formatSearchResults(searchResults, chatMap);

          output.list(items, { emptyMessage: 'No messages found.', rawData: searchResults });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Search failed: ${message}`);
        }
      },
    );

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

  // omni messages delete <messageId>
  messages
    .command('delete <messageId>')
    .description('Delete a message for everyone (WhatsApp)')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--channel-id <id>', 'Chat JID (e.g., 5511999999999@s.whatsapp.net)')
    .action(async (messageId: string, options: { instance: string; channelId: string }) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/delete-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId: options.instance,
            channelId: options.channelId,
            messageId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message deleted: ${messageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete message: ${message}`);
      }
    });

  // omni messages star <messageId>
  messages
    .command('star <messageId>')
    .description('Star a message')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--channel-id <id>', 'Chat JID')
    .action(async (messageId: string, options: { instance: string; channelId: string }) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/${messageId}/star`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId: options.instance,
            channelId: options.channelId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message starred: ${messageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to star message: ${message}`);
      }
    });

  // omni messages unstar <messageId>
  messages
    .command('unstar <messageId>')
    .description('Unstar a message')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--channel-id <id>', 'Chat JID')
    .action(async (messageId: string, options: { instance: string; channelId: string }) => {
      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/${messageId}/star`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId: options.instance,
            channelId: options.channelId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message unstarred: ${messageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unstar message: ${message}`);
      }
    });

  // omni messages edit <messageId>
  messages
    .command('edit <messageId>')
    .description('Edit a previously sent message')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--chat <chatJid>', 'Chat JID where the message was sent')
    .requiredOption('--text <text>', 'New text content')
    .action(async (messageId: string, options: { instance: string; chat: string; text: string }) => {
      try {
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/messages/edit-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId: options.instance,
            channelId: options.chat,
            messageId,
            text: options.text,
          }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Message edited: ${messageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to edit message: ${message}`);
      }
    });

  return messages;
}
