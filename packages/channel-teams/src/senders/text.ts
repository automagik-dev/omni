/**
 * Text message sender for Microsoft Teams.
 *
 * Builds Bot Framework `message` activities. Honors:
 * - Markdown → Teams render conversion (via `markdown.ts`)
 * - Per-chat chunking around the visible 4,000-char Teams limit
 * - `replyToId` for threaded replies in channel conversations
 *
 * Edits / deletions are out of scope for v1 (see `senders/types.ts`).
 */

import type { Logger } from '@omni/channel-sdk';
import { chunkMessage, markdownToTeams } from '../markdown';
import { TeamsError, TeamsErrorCode } from '../types';
import type { TeamsSendContext } from './types';

export type TeamsTextFormatMode = 'convert' | 'passthrough';

export interface TeamsTextSendOptions {
  /** Message body */
  text: string;
  /** When set, Teams renders the new activity as a thread reply */
  replyToId?: string;
  /**
   * `convert` (default) runs the markdown normalisation pipeline.
   * `passthrough` ships the text exactly as supplied.
   */
  formatMode?: TeamsTextFormatMode;
}

/**
 * Send a (possibly chunked) text message to Teams.
 *
 * Returns the activity ID of the **last** chunk — that's the ID downstream
 * code should reference for replies, edits, or reactions.
 */
export async function sendTextMessage(
  ctx: TeamsSendContext,
  options: TeamsTextSendOptions,
  logger: Logger,
): Promise<string> {
  const formatMode = options.formatMode ?? 'convert';
  const formatted = formatMode === 'passthrough' ? options.text : markdownToTeams(options.text);

  if (formatted.trim().length === 0) {
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, 'Cannot send empty Teams message');
  }

  const chunks = chunkMessage(formatted);

  let lastActivityId = '';

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] ?? '';
    try {
      const response = await ctx.sendActivity({
        type: 'message',
        text: chunk,
        textFormat: formatMode === 'passthrough' ? 'plain' : 'markdown',
        // Only thread the first chunk — follow-up chunks render inline so the
        // chat doesn't fork into a tree of micro-replies.
        replyToId: i === 0 ? options.replyToId : undefined,
      });
      lastActivityId = response.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send Teams text activity', {
        error: message,
        chunkIndex: i,
        totalChunks: chunks.length,
      });
      if (error instanceof TeamsError) throw error;
      throw new TeamsError(TeamsErrorCode.SEND_FAILED, `Failed to send Teams message: ${message}`);
    }
  }

  return lastActivityId;
}
