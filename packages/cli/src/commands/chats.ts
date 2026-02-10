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

import type { Channel, Chat, Message } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'];

// ============================================================================
// Helper Types - Extended fields from API (SDK types incomplete)
// ============================================================================

interface ExtendedChat extends Chat {
  unreadCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  messageCount?: number;
}

interface ExtendedMessage extends Message {
  senderDisplayName?: string | null;
  senderPlatformUserId?: string | null;
  hasMedia?: boolean;
  mediaMimeType?: string | null;
  mediaMetadata?: { filename?: string; size?: number; duration?: number } | null;
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format chat name - use name if available, otherwise format externalId
 */
function formatChatName(chat: ExtendedChat): string {
  if (chat.name) return chat.name;

  // Format WhatsApp-style external IDs (e.g., "5551999237715@s.whatsapp.net")
  const externalId = chat.externalId;
  if (externalId.includes('@s.whatsapp.net')) {
    const phone = externalId.replace('@s.whatsapp.net', '');
    return phone.length > 10 ? `+${phone}` : phone;
  }
  if (externalId.includes('@g.us')) {
    return externalId.replace('@g.us', ' (group)');
  }

  return externalId;
}

/**
 * Format relative time - "5m ago", "2h ago", "yesterday", etc.
 */
function formatRelativeTime(date: Date | string | null | undefined): string {
  if (!date) return '-';

  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format time as HH:MM
 */
function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Same calendar day → just time
  if (d.toDateString() === now.toDateString()) return time;
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  // Within 7 days → day name
  if (diffDays < 7) {
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${day} ${time}`;
  }
  // Older → compact date
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${month}-${dayNum} ${time}`;
}

/** Module-level truncation limit — set by --full flag or default */
let _truncateMax = 200;

/**
 * Truncate text with ellipsis
 */
function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '-';
  if (maxLen <= 0) return text; // 0 or negative = no truncation
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

/**
 * Get media type badge for display
 */
function getMediaBadge(type: string): string {
  const badges: Record<string, string> = {
    audio: '[AUDIO]',
    image: '[IMAGE]',
    video: '[VIDEO]',
    document: '[DOC]',
    sticker: '[STICKER]',
    contact: '[CONTACT]',
    location: '[LOCATION]',
  };
  return badges[type] ?? `[${type.toUpperCase()}]`;
}

/**
 * Get media content description (transcription/description/extraction)
 */
function getMediaDescription(msg: ExtendedMessage): string | null {
  if (msg.transcription) return msg.transcription;
  if (msg.imageDescription) return msg.imageDescription;
  if (msg.videoDescription) return msg.videoDescription;
  if (msg.documentExtraction) return msg.documentExtraction;
  return null;
}

/**
 * Format sender name
 */
function formatSender(msg: ExtendedMessage): string {
  if (msg.isFromMe) return 'You';
  return msg.senderDisplayName ?? 'Unknown';
}

/**
 * Check if message is a media type
 */
function isMediaMessage(msg: ExtendedMessage): boolean {
  return msg.hasMedia === true || ['audio', 'image', 'video', 'document', 'sticker'].includes(msg.messageType);
}

/**
 * Format duration as MM:SS
 */
function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Build content string for rich message display
 */
function buildRichContent(msg: ExtendedMessage): string {
  const isMedia = isMediaMessage(msg);
  if (!isMedia) {
    return truncate(msg.textContent, _truncateMax) ?? '-';
  }

  const badge = getMediaBadge(msg.messageType);
  const parts = [badge];

  const filename = msg.mediaMetadata?.filename;
  if (filename) parts.push(filename);

  const duration = msg.mediaMetadata?.duration;
  if (duration) parts.push(formatDuration(duration));

  const descLimit = _truncateMax > 0 ? Math.min(_truncateMax, 80) : 0;
  const mediaDesc = getMediaDescription(msg);
  if (mediaDesc) {
    parts.push(`- "${truncate(mediaDesc, descLimit)}"`);
  } else if (msg.textContent) {
    parts.push(`- "${truncate(msg.textContent, descLimit)}"`);
  }

  return parts.join(' ');
}

/**
 * Format messages for rich display
 */
function formatRichMessages(
  messages: ExtendedMessage[],
): { time: string; from: string; type: string; content: string }[] {
  return messages.map((m) => ({
    time: formatTime(m.platformTimestamp),
    from: truncate(formatSender(m), 15),
    type: isMediaMessage(m) ? m.messageType : 'text',
    content: buildRichContent(m),
  }));
}

/**
 * Format messages for standard display
 */
function formatStandardMessages(messages: ExtendedMessage[]): {
  id: string;
  from: string;
  senderId: string;
  type: string;
  content: string;
  fromMe: string;
  timestamp: string | null;
}[] {
  return messages.map((m) => ({
    id: m.id,
    from: formatSender(m),
    senderId: m.senderPlatformUserId ?? '-',
    type: m.messageType,
    content: _truncateMax > 0 ? truncate(m.textContent, _truncateMax) : (m.textContent ?? '-'),
    fromMe: m.isFromMe ? 'yes' : 'no',
    timestamp: m.platformTimestamp,
  }));
}

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
    .option('--unread', 'Only show chats with unread messages')
    .option('--sort <field>', 'Sort by: activity (default), unread, name')
    .option('--type <type>', 'Filter by chat type: dm, group, channel')
    .option('--verbose', 'Show full details (ID, channel, archived)')
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        search?: string;
        archived?: boolean;
        limit?: number;
        unread?: boolean;
        sort?: string;
        type?: string;
        verbose?: boolean;
      }) => {
        const client = getClient();

        try {
          const result = await client.chats.list({
            instanceId: options.instance,
            channel: options.channel,
            search: options.search,
            includeArchived: options.archived,
            limit: options.limit,
            chatType: options.type,
          });

          // Cast to extended type to access additional fields
          let chats = result.items as ExtendedChat[];

          // Client-side filtering for --unread
          if (options.unread) {
            chats = chats.filter((c) => (c.unreadCount ?? 0) > 0);
          }

          // Client-side sorting
          if (options.sort === 'unread') {
            chats.sort((a, b) => (b.unreadCount ?? 0) - (a.unreadCount ?? 0));
          } else if (options.sort === 'name') {
            chats.sort((a, b) => formatChatName(a).localeCompare(formatChatName(b)));
          }
          // Default is 'activity' - already sorted by lastMessageAt from API

          if (options.verbose) {
            // Verbose format - show full details
            const items = chats.map((c) => ({
              id: c.id,
              name: c.name ?? c.externalId,
              channel: c.channel,
              type: c.chatType,
              unread: c.unreadCount ?? 0,
              messages: c.messageCount ?? 0,
              archived: c.isArchived ? 'yes' : 'no',
            }));
            output.list(items, { emptyMessage: 'No chats found.' });
          } else {
            // Default format - compact view with preview
            const items = chats.map((c) => ({
              name: truncate(formatChatName(c), 25),
              unread: c.unreadCount ?? 0,
              'last message': truncate(c.lastMessagePreview?.replace(/\n/g, ' '), 35),
              time: formatRelativeTime(c.lastMessageAt),
            }));
            output.list(items, { emptyMessage: 'No chats found.' });
          }
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
    .description('Archive a chat (optionally on the channel too)')
    .option('--instance <id>', 'Instance ID to also archive on WhatsApp')
    .action(async (id: string, options: { instance?: string }) => {
      const client = getClient();

      try {
        if (options.instance) {
          // Call API with instanceId to archive on channel
          const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
          const apiKey = process.env.OMNI_API_KEY ?? '';
          const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ instanceId: options.instance }),
          });
          if (!resp.ok) {
            const err = (await resp.json()) as { error?: { message?: string } };
            throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
          }
        } else {
          await client.chats.archive(id);
        }
        output.success(`Chat archived: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to archive chat: ${message}`);
      }
    });

  // omni chats unarchive <id>
  chats
    .command('unarchive <id>')
    .description('Unarchive a chat (optionally on the channel too)')
    .option('--instance <id>', 'Instance ID to also unarchive on WhatsApp')
    .action(async (id: string, options: { instance?: string }) => {
      const client = getClient();

      try {
        if (options.instance) {
          const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
          const apiKey = process.env.OMNI_API_KEY ?? '';
          const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/unarchive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ instanceId: options.instance }),
          });
          if (!resp.ok) {
            const err = (await resp.json()) as { error?: { message?: string } };
            throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
          }
        } else {
          await client.chats.unarchive(id);
        }
        output.success(`Chat unarchived: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unarchive chat: ${message}`);
      }
    });

  // omni chats pin <id>
  chats
    .command('pin <id>')
    .description('Pin a chat on the channel')
    .requiredOption('--instance <id>', 'Instance ID')
    .action(async (id: string, options: { instance: string }) => {
      try {
        const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
        const apiKey = process.env.OMNI_API_KEY ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId: options.instance }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat pinned: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to pin chat: ${message}`);
      }
    });

  // omni chats unpin <id>
  chats
    .command('unpin <id>')
    .description('Unpin a chat on the channel')
    .requiredOption('--instance <id>', 'Instance ID')
    .action(async (id: string, options: { instance: string }) => {
      try {
        const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
        const apiKey = process.env.OMNI_API_KEY ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/unpin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId: options.instance }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat unpinned: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unpin chat: ${message}`);
      }
    });

  // omni chats mute <id>
  chats
    .command('mute <id>')
    .description('Mute a chat on the channel')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--duration <ms>', 'Mute duration in milliseconds (default: 8 hours)', (v) => Number.parseInt(v, 10))
    .action(async (id: string, options: { instance: string; duration?: number }) => {
      try {
        const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
        const apiKey = process.env.OMNI_API_KEY ?? '';
        const body: Record<string, unknown> = { instanceId: options.instance };
        if (options.duration) body.duration = options.duration;
        const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/mute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat muted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to mute chat: ${message}`);
      }
    });

  // omni chats unmute <id>
  chats
    .command('unmute <id>')
    .description('Unmute a chat on the channel')
    .requiredOption('--instance <id>', 'Instance ID')
    .action(async (id: string, options: { instance: string }) => {
      try {
        const baseUrl = process.env.OMNI_API_URL ?? 'http://localhost:8882';
        const apiKey = process.env.OMNI_API_KEY ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/unmute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId: options.instance }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat unmuted: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unmute chat: ${message}`);
      }
    });

  // omni chats messages <id>
  chats
    .command('messages <id>')
    .description('Get chat messages')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 20)
    .option('--before <cursor>', 'Get messages before cursor')
    .option('--after <cursor>', 'Get messages after cursor')
    .option('--rich', 'Show rich format with transcriptions/descriptions')
    .option('--media-only', 'Only show media messages')
    .option('--full', 'Show full text without truncation')
    .option('--no-truncate', 'Alias for --full')
    .action(
      async (
        id: string,
        options: {
          limit?: number;
          before?: string;
          after?: string;
          rich?: boolean;
          mediaOnly?: boolean;
          full?: boolean;
          truncate?: boolean;
        },
      ) => {
        // Set module-level truncation: --full or --no-truncate disables it
        _truncateMax = options.full || options.truncate === false ? 0 : 200;
        const client = getClient();

        try {
          const rawMessages = await client.chats.getMessages(id, {
            limit: options.limit,
            before: options.before,
            after: options.after,
          });

          // Cast to extended type
          let messages = rawMessages as ExtendedMessage[];

          // Filter media-only if requested
          if (options.mediaOnly) {
            messages = messages.filter(
              (m) => m.hasMedia || ['audio', 'image', 'video', 'document'].includes(m.messageType),
            );
          }

          if (options.rich) {
            const items = formatRichMessages(messages);
            output.list(items, { emptyMessage: 'No messages found.' });
          } else {
            const items = formatStandardMessages(messages);
            output.list(items, { emptyMessage: 'No messages found.' });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to get messages: ${message}`);
        }
      },
    );

  // omni chats participants <id>
  chats
    .command('participants <id>')
    .description('List or manage chat participants')
    .option('--add <user-id>', 'Add participant by platform user ID')
    .option('--remove <user-id>', 'Remove participant by platform user ID')
    .option('--name <name>', 'Display name for new participant')
    .option('--role <role>', 'Role for new participant')
    .action(async (id: string, options: { add?: string; remove?: string; name?: string; role?: string }) => {
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
    });

  // omni chats read <id> --instance <id>
  chats
    .command('read <id>')
    .description('Mark entire chat as read')
    .requiredOption('--instance <id>', 'Instance ID')
    .action(async (id: string, options: { instance: string }) => {
      const client = getClient();

      try {
        const result = await client.chats.markRead(id, {
          instanceId: options.instance,
        });
        output.success('Chat marked as read', result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to mark chat as read: ${message}`);
      }
    });

  // omni chats disappearing <id>
  chats
    .command('disappearing <id>')
    .description('Toggle disappearing messages for a chat')
    .requiredOption('--instance <id>', 'Instance ID')
    .option('--duration <duration>', 'Duration: off, 24h, 7d, 90d (default: 24h)', '24h')
    .action(async (id: string, options: { instance: string; duration?: string }) => {
      const validDurations = ['off', '24h', '7d', '90d'];
      const duration = options.duration ?? '24h';

      if (!validDurations.includes(duration)) {
        output.error(`Invalid duration: ${duration}. Valid: ${validDurations.join(', ')}`);
        return;
      }

      try {
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/chats/${id}/disappearing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId: options.instance,
            duration,
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }

        if (duration === 'off') {
          output.success('Disappearing messages turned off');
        } else {
          output.success(`Disappearing messages set to ${duration}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to set disappearing messages: ${message}`);
      }
    });

  return chats;
}
