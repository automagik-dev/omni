/**
 * Typing-indicator sender for Microsoft Teams.
 *
 * Bot Framework exposes typing as a first-class activity (`type: 'typing'`).
 * Teams renders the indicator until the next message activity from the bot
 * arrives or ~10 seconds elapse — whichever comes first. Callers do not need
 * a "stop typing" companion call.
 *
 * The activity carries no body and the connector returns no meaningful ID;
 * we still surface whatever response we receive in case the connection
 * adapter chooses to log it.
 */

import type { Logger } from '@omni/channel-sdk';
import { TeamsError, TeamsErrorCode } from '../types';
import type { TeamsSendContext } from './types';

export interface TeamsTypingSendOptions {
  /** Optional thread context — typing indicators inherit thread placement */
  replyToId?: string;
}

/**
 * Send a typing indicator to the active Teams conversation.
 *
 * `options` may be omitted when no thread context applies — the connection
 * adapter will post the typing activity to the conversation root.
 */
export async function sendTyping(
  ctx: TeamsSendContext,
  options: TeamsTypingSendOptions,
  logger: Logger,
): Promise<void> {
  try {
    await ctx.sendActivity({
      type: 'typing',
      replyToId: options.replyToId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to send Teams typing indicator', { error: message });
    if (error instanceof TeamsError) throw error;
    throw new TeamsError(TeamsErrorCode.SEND_FAILED, `Failed to send Teams typing indicator: ${message}`);
  }
}
