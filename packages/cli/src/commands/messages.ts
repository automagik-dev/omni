/**
 * Messages Commands
 *
 * omni messages search <query> --since 7d --chat <id>
 * omni messages read <id> --instance <id>
 * omni messages read --batch --instance <id> --chat <id> --ids <id1,id2,...>
 */

import type { Chat, Message, OmniClient } from '@omni/sdk';
import { Command, Option } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveChatId, resolveInstanceId, resolveMessageId } from '../resolve.js';

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
    const err = (await resp.json()) as { error?: unknown };
    const errorMsg = typeof err?.error === 'string' ? err.error : `API error: ${resp.status}`;
    throw new Error(errorMsg);
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

  const chatId = await resolveChatId(chat);
  const instanceId = await resolveInstanceId(instance);
  const messageIdInputs = ids.split(',').map((id) => id.trim());

  // Resolve each message ID
  const messageIds = await Promise.all(messageIdInputs.map((id) => resolveMessageId(id, chatId)));

  const result = await client.messages.batchMarkRead({
    instanceId,
    chatId,
    messageIds,
  });

  output.success(`Marked ${result.messageCount ?? messageIds.length} messages as read`, result);
}

/** Handle single message mark read */
async function handleSingleRead(client: OmniClient, messageId: string, instanceId: string): Promise<void> {
  const resolvedMessageId = await resolveMessageId(messageId);
  const resolvedInstanceId = await resolveInstanceId(instanceId);
  const result = await client.messages.markRead(resolvedMessageId, { instanceId: resolvedInstanceId });
  output.success('Message marked as read', result);
}

export function createMessagesCommand(): Command {
  const messages = new Command('messages').description('Manage messages (use "get" for transcriptions/descriptions)');

  // omni messages get <id>
  messages
    .command('get <messageId>')
    .description('Get full message details including transcription/description fields')
    .action(async (messageId: string) => {
      const client = getClient();

      try {
        const resolvedMessageId = await resolveMessageId(messageId);
        const message = (await client.messages.get(resolvedMessageId)) as ExtendedMessage;

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
    .description('Search messages across chats (includes transcriptions/descriptions in results)')
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
    .requiredOption('--chat <chatJid>', 'Chat JID (e.g., 5551997285829@s.whatsapp.net)')
    .addOption(new Option('--channel-id <chatId>', '(deprecated alias for --chat)').hideHelp())
    .action(async (messageId: string, options: { instance: string; chat?: string; channelId?: string }) => {
      try {
        const channelId = options.chat ?? options.channelId;
        if (!channelId) {
          output.error('--chat is required');
          return;
        }
        const resolvedMessageId = await resolveMessageId(messageId);
        const instanceId = await resolveInstanceId(options.instance);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/delete-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
            channelId,
            messageId: resolvedMessageId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message deleted: ${resolvedMessageId}`);
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
    .requiredOption('--chat <chatJid>', 'Chat JID (e.g., 5551997285829@s.whatsapp.net)')
    .addOption(new Option('--channel-id <chatId>', '(deprecated alias for --chat)').hideHelp())
    .action(async (messageId: string, options: { instance: string; chat?: string; channelId?: string }) => {
      try {
        const channelId = options.chat ?? options.channelId;
        if (!channelId) {
          output.error('--chat is required');
          return;
        }
        const resolvedMessageId = await resolveMessageId(messageId);
        const instanceId = await resolveInstanceId(options.instance);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/${resolvedMessageId}/star`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
            channelId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message starred: ${resolvedMessageId}`);
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
    .requiredOption('--chat <chatJid>', 'Chat JID (e.g., 5551997285829@s.whatsapp.net)')
    .addOption(new Option('--channel-id <chatId>', '(deprecated alias for --chat)').hideHelp())
    .action(async (messageId: string, options: { instance: string; chat?: string; channelId?: string }) => {
      try {
        const channelId = options.chat ?? options.channelId;
        if (!channelId) {
          output.error('--chat is required');
          return;
        }
        const resolvedMessageId = await resolveMessageId(messageId);
        const instanceId = await resolveInstanceId(options.instance);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/${resolvedMessageId}/star`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
            channelId,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Message unstarred: ${resolvedMessageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unstar message: ${message}`);
      }
    });

  // omni messages remove-reaction <messageId>
  messages
    .command('remove-reaction <messageId>')
    .description('Remove a reaction from a message')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--emoji <emoji>', 'Emoji to remove')
    .action(async (messageId: string, options: { instance: string; emoji: string }) => {
      try {
        const resolvedMessageId = await resolveMessageId(messageId);
        const instanceId = await resolveInstanceId(options.instance);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/messages/${resolvedMessageId}/reactions`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
            emoji: options.emoji,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        output.success(`Reaction removed from message: ${resolvedMessageId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to remove reaction: ${message}`);
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
        const resolvedMessageId = await resolveMessageId(messageId, options.chat);
        const instanceId = await resolveInstanceId(options.instance);
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/messages/edit-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
            channelId: options.chat,
            messageId: resolvedMessageId,
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

  // omni messages close-contact — terminal close for a chat (parallel to handoff).
  // Wraps POST /api/v2/messages/send/close-contact. Use cases: cliente atual SAC,
  // sale closed by agent, lead refused N times, lead asked to be removed.
  messages
    .command('close-contact')
    .description(
      'Close a chat terminally (won/lost) or with a soft cooldown (redirected_sac/unqualified/no_response/other)',
    )
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--chat <chatId>', 'Chat DB UUID to close')
    .requiredOption('--to <recipient>', 'Recipient phone or platform ID')
    .requiredOption('--text <text>', 'Farewell message shown to the lead')
    .requiredOption('--outcome <outcome>', 'Outcome: won | lost | redirected_sac | unqualified | no_response | other')
    .option('--reason <reason>', 'Free-text rationale persisted in close_contact_logs')
    .option('--close-fields <jsonOrPath>', 'Structured BI/CRM payload — inline JSON or path to a JSON file')
    .action(handleCloseContact);

  return messages;
}

const VALID_CLOSE_OUTCOMES = ['won', 'lost', 'redirected_sac', 'unqualified', 'no_response', 'other'] as const;

interface CloseContactOptions {
  instance: string;
  chat: string;
  to: string;
  text: string;
  outcome: string;
  reason?: string;
  closeFields?: string;
}

async function parseCloseFields(raw: string): Promise<Record<string, unknown>> {
  // Try parsing as inline JSON first; fall back to reading a file.
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  const fs = await import('node:fs/promises');
  const text = await fs.readFile(trimmed, 'utf-8');
  return JSON.parse(text) as Record<string, unknown>;
}

interface CloseContactResult {
  messageId?: string;
  terminal?: boolean;
  closeUntil?: string | null;
  escalated?: boolean;
}

async function postCloseContact(body: Record<string, unknown>): Promise<CloseContactResult> {
  const _cfg = (await import('../config.js')).loadConfig();
  const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
  const apiKey = _cfg.apiKey ?? '';

  const resp = await fetch(`${baseUrl}/api/v2/messages/send/close-contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const errMsg = typeof err.error === 'string' ? err.error : (err.error?.message ?? `API error: ${resp.status}`);
    throw new Error(errMsg);
  }
  const data = (await resp.json()) as { data?: CloseContactResult };
  return data.data ?? {};
}

async function buildCloseContactBody(options: CloseContactOptions): Promise<Record<string, unknown> | null> {
  let closeFields: Record<string, unknown> | undefined;
  if (options.closeFields) {
    try {
      closeFields = await parseCloseFields(options.closeFields);
    } catch (err) {
      output.error(`Failed to parse --close-fields: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    }
  }

  const instanceId = await resolveInstanceId(options.instance);
  const resolvedChatId = await resolveChatId(options.chat);

  const body: Record<string, unknown> = {
    instanceId,
    chatId: resolvedChatId,
    to: options.to,
    text: options.text,
    outcome: options.outcome,
  };
  if (options.reason) body.reason = options.reason;
  if (closeFields) body.closeFields = closeFields;
  return body;
}

async function handleCloseContact(options: CloseContactOptions): Promise<void> {
  if (!(VALID_CLOSE_OUTCOMES as readonly string[]).includes(options.outcome)) {
    output.error(`Invalid --outcome '${options.outcome}'. Must be one of: ${VALID_CLOSE_OUTCOMES.join(', ')}`);
    return;
  }

  try {
    const body = await buildCloseContactBody(options);
    if (!body) return; // already errored out

    const result = await postCloseContact(body);
    const cooldownPart = result.closeUntil ? `, closeUntil=${result.closeUntil}` : '';
    output.success(
      `Chat closed (${options.outcome}): terminal=${result.terminal ?? false}, escalated=${result.escalated ?? false}${cooldownPart}`,
    );
  } catch (err) {
    output.error(`Failed to close contact: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
