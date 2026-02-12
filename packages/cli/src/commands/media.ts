/**
 * Media Commands — browse and download media items
 *
 * omni media ls [--instance <id>] [--chat <id>] [--since <dt>] [--until <dt>]
 *               [--type <types>] [--limit <n>] [--remote-only] [--cached-only]
 * omni media download --message <uuid>
 * omni media download --chat <uuid> --external <id>
 *
 * @see media-drive-download wish
 */

import { Command } from 'commander';
import { loadConfig } from '../config.js';
import * as output from '../output.js';
import { resolveChatId, resolveInstanceId, resolveMessageId } from '../resolve.js';

// ============================================================================
// TYPES
// ============================================================================

interface LsOptions {
  instance?: string;
  chat?: string;
  since?: string;
  until?: string;
  type?: string;
  limit?: number;
  remoteOnly?: boolean;
  cachedOnly?: boolean;
  full?: boolean;
}

interface DownloadOptions {
  message?: string;
  chat?: string;
  external?: string;
}

interface MediaMessage {
  id: string;
  chatId: string;
  chatName?: string | null;
  platformTimestamp?: string | null;
  mediaMimeType?: string | null;
  mediaLocalPath?: string | null;
  mediaUrl?: string | null;
  senderDisplayName?: string | null;
  instanceId?: string | null;
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;
  messageType?: string;
}

interface MessagesResponse {
  items?: MediaMessage[];
}

interface DownloadResponse {
  messageId: string;
  instanceId: string;
  mediaMimeType: string;
  mediaLocalPath: string;
  downloadUrl: string;
  cached: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Build URL with query parameters */
function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  let url = `${baseUrl}/api/v2/${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** Parse API error response */
function parseErrorMessage(err: { error?: { message?: string } | string }): string | undefined {
  if (typeof err?.error === 'string') return err.error;
  if (typeof err?.error === 'object') return err.error?.message;
  return undefined;
}

/** Generic API call helper for direct fetch requests */
async function apiCall(
  path: string,
  method = 'GET',
  body?: unknown,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const config = loadConfig();
  const baseUrl = (config.apiUrl ?? 'http://localhost:8882').replace(/\/$/, '');
  const apiKey = config.apiKey ?? '';

  const headers: Record<string, string> = { 'x-api-key': apiKey };
  if (body) headers['Content-Type'] = 'application/json';

  const url = buildUrl(baseUrl, path, query);
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: { message?: string } | string };
    throw new Error(parseErrorMessage(err) ?? `API error: ${resp.status}`);
  }

  return resp.json();
}

/** Determine cached status from message */
function isCached(msg: MediaMessage): boolean {
  return !!msg.mediaLocalPath && msg.mediaLocalPath.length > 0;
}

/** Map of friendly type names to mime prefixes */
const TYPE_PREFIX_MAP: Record<string, string> = {
  audio: 'audio/',
  image: 'image/',
  video: 'video/',
  document: 'application/',
};

/** Parse comma-separated media types and return valid prefixes */
function parseMediaTypes(typeStr: string | undefined): string[] | undefined {
  if (!typeStr) return undefined;
  const types = typeStr.split(',').map((t) => t.trim().toLowerCase());
  const prefixes: string[] = [];
  for (const t of types) {
    const prefix = TYPE_PREFIX_MAP[t];
    if (prefix) {
      prefixes.push(prefix);
    } else {
      output.warn(`Unknown media type: ${t}. Valid: audio,image,video,document`);
    }
  }
  return prefixes.length > 0 ? prefixes : undefined;
}

/** Format timestamp for display */
function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Get media processing content (transcription/description) */
function getMediaContent(msg: MediaMessage): string | null {
  if (msg.transcription) return msg.transcription;
  if (msg.imageDescription) return msg.imageDescription;
  if (msg.videoDescription) return msg.videoDescription;
  if (msg.documentExtraction) return msg.documentExtraction;
  return null;
}

/** Truncate text with ellipsis */
function truncateText(text: string | null | undefined, maxLen: number): string {
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

/** Apply client-side filters (type, remote/cached) to messages */
function applyFilters(items: MediaMessage[], options: LsOptions): MediaMessage[] {
  let result = items;

  const typePrefixes = parseMediaTypes(options.type);
  if (typePrefixes) {
    result = result.filter((msg) => {
      const mime = msg.mediaMimeType ?? '';
      return typePrefixes.some((prefix) => mime.startsWith(prefix));
    });
  }

  if (options.remoteOnly) {
    result = result.filter((msg) => !isCached(msg));
  }
  if (options.cachedOnly) {
    result = result.filter((msg) => isCached(msg));
  }

  return result;
}

// ============================================================================
// COMMANDS
// ============================================================================

/** List media items (metadata only, no download) */
async function handleLs(options: LsOptions): Promise<void> {
  const limit = Math.min(options.limit ?? 20, 100);

  // Resolve IDs
  const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;
  const chatId = options.chat ? await resolveChatId(options.chat) : undefined;

  // Build query params for GET /messages with hasMedia=true
  const query: Record<string, string | number | boolean | undefined> = {
    hasMedia: true,
    limit,
  };

  if (instanceId) query.instanceId = instanceId;
  if (chatId) query.chatId = chatId;
  if (options.since) query.since = options.since;
  if (options.until) query.until = options.until;

  const result = (await apiCall('messages', 'GET', undefined, query)) as MessagesResponse;
  const items = applyFilters(result.items ?? [], options);

  if (items.length === 0) {
    output.info('No media items found.');
    return;
  }

  // Format for table display
  const maxContentLen = options.full ? 0 : 50;
  const rows = items.map((msg) => {
    const content = getMediaContent(msg);
    return {
      id: msg.id.slice(0, 8),
      chat: msg.chatName ?? msg.chatId?.slice(0, 8) ?? '-',
      timestamp: formatTimestamp(msg.platformTimestamp),
      type: msg.messageType ?? 'media',
      status: isCached(msg) ? 'cached' : 'remote',
      sender: msg.senderDisplayName ?? '-',
      content: content ? (maxContentLen > 0 ? truncateText(content, maxContentLen) : content) : '-',
    };
  });

  output.list(rows);
}

/** Build MessageRef body from download options */
function buildMessageRef(options: DownloadOptions): Record<string, string> {
  if (options.message) {
    return { messageId: options.message };
  }
  // Caller guarantees chat and external are defined at this point
  return { chatId: options.chat ?? '', externalId: options.external ?? '' };
}

/** Download a single media item */
async function handleDownload(options: DownloadOptions): Promise<void> {
  // Validate: must provide --message OR (--chat AND --external)
  if (!options.message && !(options.chat && options.external)) {
    output.error('Provide either --message <uuid> or both --chat <uuid> and --external <id>');
  }
  if (options.message && (options.chat || options.external)) {
    output.error('Provide either --message or --chat/--external, not both');
  }

  // Resolve IDs
  const messageId = options.message ? await resolveMessageId(options.message, options.chat) : undefined;
  const chatId = options.chat ? await resolveChatId(options.chat) : undefined;

  const body = buildMessageRef({
    message: messageId,
    chat: chatId,
    external: options.external,
  });
  const response = (await apiCall('messages/media/download', 'POST', body)) as { data: DownloadResponse };
  const result = response.data;

  output.success(`Downloaded: ${result.mediaMimeType}`);
  output.info(`Local path: ${result.mediaLocalPath}`);
  output.info(`URL: ${result.downloadUrl}`);
  output.info(`Cached: ${result.cached}`);
}

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export function createMediaCommand(): Command {
  const media = new Command('media').description('Browse and download media items');

  // omni media ls
  media
    .command('ls')
    .description('List media items with transcriptions/descriptions (use "omni messages get <id>" for full details)')
    .option('--instance <id>', 'Filter by instance UUID')
    .option('--chat <id>', 'Filter by chat UUID')
    .option('--since <datetime>', 'ISO datetime (e.g., 2026-01-01T00:00:00Z)')
    .option('--until <datetime>', 'ISO datetime')
    .option('--type <types>', 'Comma-separated: audio,image,video,document')
    .option('--limit <n>', 'Max results (default: 20, max: 100)', (v) => Number.parseInt(v, 10), 20)
    .option('--remote-only', 'Only show items not yet downloaded')
    .option('--cached-only', 'Only show items already downloaded')
    .option('--full', 'Show full content without truncation')
    .action(async (options: LsOptions) => {
      try {
        await handleLs(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list media: ${message}`);
      }
    });

  // omni media download
  media
    .command('download')
    .description('Download a single media item')
    .option('--message <uuid>', 'Message ID (UUID)')
    .option('--chat <uuid>', 'Chat ID (UUID, used with --external)')
    .option('--external <id>', 'External message ID (used with --chat)')
    .action(async (options: DownloadOptions) => {
      try {
        await handleDownload(options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to download media: ${message}`);
      }
    });

  return media;
}
