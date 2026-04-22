/**
 * History Command — Read conversation messages verb
 *
 * omni history                    — show last 10 messages in open chat
 * omni history --limit 20         — show last 20 messages
 * omni history --before <msg-id>  — paginate backward
 * omni history --full             — show full content (no truncation)
 * omni history --json             — machine-readable output (global flag)
 *
 * Uses context resolution (env vars > PG context > config) for instance/chat.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext } from '../context.js';
import * as output from '../output.js';

interface HistoryOptions {
  limit?: string;
  before?: string;
  full?: boolean;
  instance?: string;
  chat?: string;
}

/** Extended message shape — the API returns more fields than the SDK type declares */
interface MessageRow {
  id: string;
  externalId: string;
  messageType: string;
  textContent?: string | null;
  platformTimestamp: string;
  isFromMe?: boolean;
  source: string;
  senderDisplayName?: string | null;
  senderPlatformUserId?: string | null;
  transcription?: string | null;
  mediaLocalPath?: string | null;
  mediaUrl?: string | null;
  [key: string]: unknown;
}

/** Truncate a string to maxLen, appending ellipsis if needed */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}…`;
}

/** Format a timestamp for human display */
function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return ts;
  }
}

/** Derive a display name for the sender */
function senderLabel(msg: MessageRow): string {
  if (msg.senderDisplayName) return msg.senderDisplayName;
  if (msg.isFromMe) return 'me';
  if (msg.senderPlatformUserId) return msg.senderPlatformUserId;
  return 'unknown';
}

/** Build a content preview from message fields */
function contentPreview(msg: MessageRow, full: boolean): string {
  const maxLen = full ? 0 : 80;
  const parts: string[] = [];

  // Primary text content
  if (msg.textContent) {
    parts.push(msg.textContent);
  }

  // Transcription for audio messages
  if (msg.transcription) {
    parts.push(`[transcription] ${msg.transcription}`);
  }

  // Media file path
  if (msg.mediaLocalPath) {
    parts.push(`[file] ${msg.mediaLocalPath}`);
  } else if (msg.mediaUrl) {
    parts.push(`[media] ${msg.mediaUrl}`);
  }

  const combined = parts.join(' | ') || '-';
  return maxLen > 0 ? truncate(combined, maxLen) : combined;
}

export function createHistoryCommand(): Command {
  return new Command('history')
    .description('Show recent messages in the open chat')
    .option('--limit <n>', 'Number of messages to fetch (default: 10)')
    .option('--before <msg-id>', 'Fetch messages before this message ID (pagination)')
    .option('--full', 'Show full content without truncation')
    .option('--instance <id>', 'Override instance (default: from context)')
    .option('--chat <id>', 'Override chat (default: from context)')
    .action(async (options: HistoryOptions) => {
      const client = getClient();

      // Resolve context
      const ctx = await resolveContext({
        instance: options.instance,
        chat: options.chat,
      });

      if (!ctx.instanceId) {
        return output.error('No instance in context. Set OMNI_INSTANCE, use --instance, or run: omni use <instance>');
      }
      if (!ctx.chatId) {
        return output.error('No chat in context. Set OMNI_CHAT, use --chat, or run: omni open <contact>');
      }

      const limit = options.limit ? Number.parseInt(options.limit, 10) : 10;
      if (Number.isNaN(limit) || limit < 1) {
        return output.error('--limit must be a positive integer');
      }

      try {
        const messages = (await client.chats.getMessages(ctx.chatId, {
          limit,
          before: options.before,
        })) as unknown as MessageRow[];

        if (messages.length === 0) {
          return output.info('No messages found.');
        }

        const format = output.getCurrentFormat();

        if (format === 'json') {
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(JSON.stringify(messages, null, 2));
          return;
        }

        // Human table output — disable cell truncation in --full mode
        if (options.full) {
          output.setMaxCellWidth(0);
        }

        const rows = messages.map((msg) => ({
          ID: msg.externalId,
          TIME: formatTime(msg.platformTimestamp),
          SENDER: senderLabel(msg),
          TYPE: msg.messageType,
          CONTENT: contentPreview(msg, !!options.full),
        }));

        output.list(rows, { rawData: messages });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to fetch history: ${message}`);
      }
    });
}
