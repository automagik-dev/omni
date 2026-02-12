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

import type { Channel, Chat, Message, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveChatId, resolveInstanceId } from '../resolve.js';

const VALID_CHANNELS: Channel[] = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'];

/** Build a map of instanceId → instance name for display */
async function buildInstanceNameMap(client: OmniClient): Promise<Map<string, string>> {
  try {
    const result = await client.instances.list();
    const map = new Map<string, string>();
    for (const inst of result.items) {
      map.set(inst.id, inst.name);
    }
    return map;
  } catch {
    return new Map();
  }
}

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

interface ChatWithCanonical extends ExtendedChat {
  canonicalId?: string | null;
}

/**
 * Format chat name - use name if available, otherwise format externalId.
 * Handles @lid JIDs by trying canonicalId first, then showing truncated LID.
 */
function formatChatName(chat: ChatWithCanonical): string {
  if (chat.name) return chat.name;

  // Try canonicalId first (resolved phone JID for @lid chats)
  const identifier = chat.canonicalId || chat.externalId;

  // Format WhatsApp-style external IDs (e.g., "5551999237715@s.whatsapp.net")
  if (identifier.includes('@s.whatsapp.net')) {
    const phone = identifier.replace('@s.whatsapp.net', '');
    return phone.length > 10 ? `+${phone}` : phone;
  }
  if (identifier.includes('@g.us')) {
    return identifier.replace('@g.us', ' (group)');
  }
  // Show truncated LID for unresolvable @lid JIDs
  if (identifier.endsWith('@lid')) {
    const lidNum = identifier.replace('@lid', '');
    return `LID:${lidNum.slice(0, 8)}...`;
  }

  return identifier;
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

/**
 * Format timestamp for standard (agent) display — compact ISO: YYYY-MM-DD HH:MM
 * Machine-parseable, unambiguous, includes full date always.
 */
function formatTimestamp(date: Date | string | null | undefined): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${dy} ${h}:${mi}`;
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
 * Get media type icon for display
 */
function getMediaIcon(type: string): string {
  const icons: Record<string, string> = {
    audio: '🎤',
    image: '📷',
    video: '🎥',
    document: '📄',
    sticker: '🎨',
    contact: '👤',
    location: '📍',
  };
  return icons[type] ?? '📎';
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
 * Parse "since" duration string (e.g., "7d", "30d", "1h") to Date
 */
function parseSinceDuration(duration: string): Date {
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
 * Apply client-side filters to messages
 */
function applyMessageFilters(
  messages: ExtendedMessage[],
  options: {
    audioOnly?: boolean;
    imagesOnly?: boolean;
    videosOnly?: boolean;
    docsOnly?: boolean;
    search?: string;
    since?: string;
  },
): ExtendedMessage[] {
  let filtered = messages;

  // Media type filters
  if (options.audioOnly) {
    filtered = filtered.filter((m) => m.messageType === 'audio');
  } else if (options.imagesOnly) {
    filtered = filtered.filter((m) => m.messageType === 'image');
  } else if (options.videosOnly) {
    filtered = filtered.filter((m) => m.messageType === 'video');
  } else if (options.docsOnly) {
    filtered = filtered.filter((m) => m.messageType === 'document');
  }

  // Search filter
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter((m) => {
      const textContent = m.textContent?.toLowerCase() ?? '';
      const transcription = m.transcription?.toLowerCase() ?? '';
      const imageDesc = m.imageDescription?.toLowerCase() ?? '';
      const videoDesc = m.videoDescription?.toLowerCase() ?? '';
      const docExtract = m.documentExtraction?.toLowerCase() ?? '';
      return (
        textContent.includes(searchLower) ||
        transcription.includes(searchLower) ||
        imageDesc.includes(searchLower) ||
        videoDesc.includes(searchLower) ||
        docExtract.includes(searchLower)
      );
    });
  }

  // Time filter
  if (options.since) {
    const sinceDate = parseSinceDuration(options.since);
    filtered = filtered.filter((m) => {
      if (!m.platformTimestamp) return false;
      const msgDate = new Date(m.platformTimestamp);
      return msgDate >= sinceDate;
    });
  }

  return filtered;
}

/**
 * Build content string for rich message display
 */
function buildRichContent(msg: ExtendedMessage): string {
  const isMedia = isMediaMessage(msg);
  if (!isMedia) {
    return truncate(msg.textContent, _truncateMax) ?? '-';
  }

  const icon = getMediaIcon(msg.messageType);
  const parts = [icon];

  const filename = msg.mediaMetadata?.filename;
  if (filename) parts.push(filename);

  const duration = msg.mediaMetadata?.duration;
  if (duration) parts.push(`(${formatDuration(duration)})`);

  // Show full descriptions when not truncating, otherwise use larger limit
  const descLimit = _truncateMax > 0 ? Math.min(_truncateMax, 200) : 0;
  const mediaDesc = getMediaDescription(msg);
  if (mediaDesc) {
    parts.push(`"${truncate(mediaDesc, descLimit)}"`);
  } else if (msg.textContent) {
    parts.push(`"${truncate(msg.textContent, descLimit)}"`);
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
  timestamp: string;
}[] {
  return messages.map((m) => ({
    id: m.id,
    from: formatSender(m),
    senderId: m.senderPlatformUserId ?? '-',
    type: m.messageType,
    content: _truncateMax > 0 ? truncate(m.textContent, _truncateMax) : (m.textContent ?? '-'),
    fromMe: m.isFromMe ? 'yes' : 'no',
    timestamp: formatTimestamp(m.platformTimestamp),
  }));
}

/** Display chat list in verbose or compact format */
function displayChatList(
  chatItems: ExtendedChat[],
  instanceNames: Map<string, string>,
  options: { instance?: string; verbose?: boolean },
): void {
  if (options.verbose) {
    const items = chatItems.map((c) => ({
      id: c.id,
      name: c.name ?? c.externalId,
      instance: instanceNames.get(c.instanceId) ?? c.instanceId.slice(0, 8),
      channel: c.channel,
      type: c.chatType,
      unread: c.unreadCount ?? 0,
      messages: c.messageCount ?? 0,
      archived: c.isArchived ? 'yes' : 'no',
    }));
    output.list(items, { emptyMessage: 'No chats found.', rawData: chatItems });
  } else {
    const showInstance = !options.instance && instanceNames.size > 0;
    const items = chatItems.map((c) => {
      const row: Record<string, string | number> = {
        id: c.id.slice(0, 8),
        name: truncate(formatChatName(c), 30),
      };
      if (showInstance) {
        row.instance = instanceNames.get(c.instanceId) ?? c.instanceId.slice(0, 8);
      }
      row.unread = c.unreadCount ?? 0;
      row['last message'] = truncate(c.lastMessagePreview?.replace(/\n/g, ' '), 50) ?? '-';
      row.time = formatRelativeTime(c.lastMessageAt);
      return row;
    });
    output.list(items, { emptyMessage: 'No chats found.', rawData: chatItems });
  }
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
    .option('--all', 'Include newsletters and broadcasts')
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
        all?: boolean;
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
            unreadOnly: options.unread || undefined,
            sort: (options.sort as 'activity' | 'unread' | 'name') || undefined,
            // Filter out newsletters and broadcasts server-side (use --all to include)
            excludeChatTypes: options.all ? undefined : 'channel,broadcast',
          });

          // Cast to extended type to access additional fields
          const chats = result.items as ExtendedChat[];

          // Build instance name lookup for multi-instance display
          const instanceNames = options.instance ? new Map<string, string>() : await buildInstanceNameMap(client);
          displayChatList(chats, instanceNames, options);
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
        const chatId = await resolveChatId(id);
        const chat = await client.chats.get(chatId);
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
        const chatId = await resolveChatId(id);
        const chat = await client.chats.update(chatId, {
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
        const chatId = await resolveChatId(id);
        await client.chats.delete(chatId);
        output.success(`Chat deleted: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;

        if (instanceId) {
          // Call API with instanceId to archive on channel
          const _cfg = (await import('../config.js')).loadConfig();
          const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
          const apiKey = _cfg.apiKey ?? '';
          const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/archive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ instanceId }),
          });
          if (!resp.ok) {
            const err = (await resp.json()) as { error?: { message?: string } };
            throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
          }
        } else {
          await client.chats.archive(chatId);
        }
        output.success(`Chat archived: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;

        if (instanceId) {
          const _cfg = (await import('../config.js')).loadConfig();
          const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
          const apiKey = _cfg.apiKey ?? '';
          const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/unarchive`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            body: JSON.stringify({ instanceId }),
          });
          if (!resp.ok) {
            const err = (await resp.json()) as { error?: { message?: string } };
            throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
          }
        } else {
          await client.chats.unarchive(chatId);
        }
        output.success(`Chat unarchived: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat pinned: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/unpin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat unpinned: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const body: Record<string, unknown> = { instanceId };
        if (options.duration) body.duration = options.duration;
        const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/mute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat muted: ${chatId}`);
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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const _cfg = (await import('../config.js')).loadConfig();
        const baseUrl = _cfg.apiUrl ?? 'http://localhost:8882';
        const apiKey = _cfg.apiKey ?? '';
        const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/unmute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({ instanceId }),
        });
        if (!resp.ok) {
          const err = (await resp.json()) as { error?: { message?: string } };
          throw new Error(err?.error?.message ?? `API error: ${resp.status}`);
        }
        output.success(`Chat unmuted: ${chatId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unmute chat: ${message}`);
      }
    });

  // omni chats messages <id>
  chats
    .command('messages <id>')
    .description('List chat messages (use "omni messages get <id>" for full single message)')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 100)
    .option('--before <cursor>', 'Get messages before cursor')
    .option('--after <cursor>', 'Get messages after cursor')
    .option('--compact', 'Show compact format (minimal fields, no transcriptions)')
    .option('--media-only', 'Only show media messages (all types)')
    .option('--audio-only', 'Only show audio messages')
    .option('--images-only', 'Only show image messages')
    .option('--videos-only', 'Only show video messages')
    .option('--docs-only', 'Only show document messages')
    .option('--search <text>', 'Filter messages containing text (case-insensitive)')
    .option('--since <duration>', 'Only show messages since duration ago (e.g., "1h", "7d", "30d")')
    .option('--truncate <n>', 'Truncate text to N chars (0 = no truncation, default: no truncation)', (v) =>
      Number.parseInt(v, 10),
    )
    .action(
      async (
        id: string,
        options: {
          limit?: number;
          before?: string;
          after?: string;
          compact?: boolean;
          mediaOnly?: boolean;
          audioOnly?: boolean;
          imagesOnly?: boolean;
          videosOnly?: boolean;
          docsOnly?: boolean;
          search?: string;
          since?: string;
          truncate?: number;
        },
      ) => {
        // No truncation by default (user already scoped to a specific chat)
        _truncateMax = options.truncate ?? 0;
        // Also disable table cell truncation when showing full content
        if (_truncateMax === 0) output.setMaxCellWidth(0);
        const client = getClient();

        try {
          const chatId = await resolveChatId(id);
          const rawMessages = await client.chats.getMessages(chatId, {
            limit: options.limit,
            before: options.before,
            after: options.after,
            mediaOnly: options.mediaOnly || undefined,
          });

          // Cast to extended type and apply filters
          let messages = rawMessages as ExtendedMessage[];
          messages = applyMessageFilters(messages, options);

          // Default to rich format (shows transcriptions), use --compact for minimal view
          if (options.compact) {
            const items = formatStandardMessages(messages);
            output.list(items, { emptyMessage: 'No messages found.', rawData: messages });
          } else {
            const items = formatRichMessages(messages);
            output.list(items, { emptyMessage: 'No messages found.', rawData: messages });
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
        const chatId = await resolveChatId(id);
        if (options.add) {
          const participant = await client.chats.addParticipant(chatId, {
            platformUserId: options.add,
            displayName: options.name,
            role: options.role,
          });
          output.success(`Participant added: ${participant.platformUserId}`, participant);
        } else if (options.remove) {
          await client.chats.removeParticipant(chatId, options.remove);
          output.success(`Participant removed: ${options.remove}`);
        } else {
          // List participants
          const participants = await client.chats.listParticipants(chatId);

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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const result = await client.chats.markRead(chatId, {
          instanceId,
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
        const chatId = await resolveChatId(id);
        const instanceId = await resolveInstanceId(options.instance);
        const config = (await import('../config.js')).loadConfig();
        const baseUrl = config.apiUrl ?? 'http://localhost:8882';
        const apiKey = config.apiKey ?? '';

        const resp = await fetch(`${baseUrl}/api/v2/chats/${chatId}/disappearing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            instanceId,
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
