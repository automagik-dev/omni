/**
 * Text message sender for Slack
 *
 * Handles:
 * - Slack mrkdwn formatting
 * - Thread reply support
 * - Ephemeral message support
 * - Identity customization (username, icon)
 * - Message chunking for 4000-char limit
 */

import type { Logger } from '@omni/channel-sdk';
import type { ChatPostMessageArguments, WebClient } from '@slack/web-api';
import { MAX_SLACK_MESSAGE_LENGTH, chunkMessage, markdownToMrkdwn } from '../markdown';
import { SlackError, SlackErrorCode } from '../types';

export interface TextSendOptions {
  /** Channel ID to send to */
  channelId: string;
  /** Text content (Markdown) */
  text: string;
  /** Thread TS for reply in thread */
  threadTs?: string;
  /** Whether to send as ephemeral (only visible to target user) */
  ephemeral?: boolean;
  /** Target user for ephemeral messages */
  ephemeralUserId?: string;
  /** Custom username */
  username?: string;
  /** Custom icon URL */
  iconUrl?: string;
  /** Custom icon emoji */
  iconEmoji?: string;
  /** Format mode: 'convert' applies mrkdwn conversion, 'passthrough' sends raw */
  formatMode?: 'convert' | 'passthrough';
}

/**
 * Send a text message to Slack
 * Returns the message timestamp (ts) which serves as the message ID
 */
export async function sendTextMessage(client: WebClient, options: TextSendOptions, logger: Logger): Promise<string> {
  const formattedText = options.formatMode === 'passthrough' ? options.text : markdownToMrkdwn(options.text);

  if (options.ephemeral && !options.ephemeralUserId) {
    throw new SlackError(
      SlackErrorCode.SEND_FAILED,
      'Ephemeral message requires ephemeralUserId — omitting it would send the message publicly',
    );
  }

  const chunks = chunkMessage(formattedText);
  let lastTs = '';

  for (const chunk of chunks) {
    try {
      if (options.ephemeral && options.ephemeralUserId) {
        const result = await client.chat.postEphemeral({
          channel: options.channelId,
          user: options.ephemeralUserId,
          text: chunk,
          thread_ts: options.threadTs,
        });
        // postEphemeral returns message_ts; use it for a unique per-send ID
        // so multiple ephemeral sends in the same chat don't collapse onto one DB record
        lastTs = (result.message_ts as string) ?? `ephemeral-${Date.now()}`;
      } else {
        const args = {
          channel: options.channelId,
          text: chunk,
          thread_ts: options.threadTs,
          username: options.username,
          icon_url: options.iconUrl,
          icon_emoji: options.iconEmoji,
        } as ChatPostMessageArguments;
        const result = await client.chat.postMessage(args);
        lastTs = (result.ts as string) ?? '';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to send text message', { error: message, channelId: options.channelId });
      throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to send message: ${message}`);
    }
  }

  return lastTs;
}

/** Slack refuses post_at further out than 120 days. */
export const MAX_SCHEDULE_AHEAD_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Schedule a text message via chat.scheduleMessage (#889).
 *
 * Returns the scheduled_message_id — the cancellation handle. This is NOT the
 * eventual message ts: the message does not exist until it is delivered.
 *
 * Unlike sendTextMessage, this does not chunk. Chunking would produce several
 * independent scheduled messages with separate handles, so a later cancel
 * could half-fire. Over-long text is rejected instead.
 */
export async function scheduleTextMessage(
  client: WebClient,
  options: TextSendOptions & { postAt: Date; replyBroadcast?: boolean },
  logger: Logger,
): Promise<string> {
  const formattedText = options.formatMode === 'passthrough' ? options.text : markdownToMrkdwn(options.text);

  if (formattedText.length > MAX_SLACK_MESSAGE_LENGTH) {
    throw new SlackError(
      SlackErrorCode.SEND_FAILED,
      `Scheduled message is ${formattedText.length} chars, over Slack's ${MAX_SLACK_MESSAGE_LENGTH} limit. Chunking is not applied when scheduling — each chunk would get its own handle and a later cancel could half-fire.`,
    );
  }

  const leadMs = options.postAt.getTime() - Date.now();
  if (leadMs <= 0) {
    throw new SlackError(SlackErrorCode.SEND_FAILED, `postAt is in the past (${options.postAt.toISOString()})`);
  }
  if (leadMs > MAX_SCHEDULE_AHEAD_MS) {
    throw new SlackError(
      SlackErrorCode.SEND_FAILED,
      `postAt is ${Math.round(leadMs / 86_400_000)} days out; Slack accepts at most 120.`,
    );
  }

  try {
    const result = await client.chat.scheduleMessage({
      channel: options.channelId,
      text: formattedText,
      // Slack expects whole seconds since epoch.
      post_at: Math.floor(options.postAt.getTime() / 1000),
      thread_ts: options.threadTs,
      reply_broadcast: options.replyBroadcast,
      username: options.username,
      icon_url: options.iconUrl,
      icon_emoji: options.iconEmoji,
    } as Parameters<WebClient['chat']['scheduleMessage']>[0]);

    const scheduledId = result.scheduled_message_id as string | undefined;
    if (!scheduledId) {
      throw new SlackError(
        SlackErrorCode.SEND_FAILED,
        'chat.scheduleMessage returned no scheduled_message_id — cannot cancel later',
      );
    }
    return scheduledId;
  } catch (error) {
    if (error instanceof SlackError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to schedule message', { error: message, channelId: options.channelId });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to schedule message: ${message}`);
  }
}

/** Cancel a message scheduled via scheduleTextMessage. */
export async function cancelScheduledSlackMessage(
  client: WebClient,
  channelId: string,
  scheduledMessageId: string,
  logger: Logger,
): Promise<void> {
  try {
    await client.chat.deleteScheduledMessage({
      channel: channelId,
      scheduled_message_id: scheduledMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to cancel scheduled message', { error: message, channelId, scheduledMessageId });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to cancel scheduled message: ${message}`);
  }
}

/**
 * Edit a previously sent message
 */
export async function editSlackMessage(
  client: WebClient,
  channelId: string,
  ts: string,
  newText: string,
  formatMode: 'convert' | 'passthrough',
  logger: Logger,
): Promise<void> {
  const formattedText = formatMode === 'passthrough' ? newText : markdownToMrkdwn(newText);

  try {
    await client.chat.update({
      channel: channelId,
      ts,
      text: formattedText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to edit message', { error: message, channelId, ts });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to edit message: ${message}`);
  }
}

/**
 * Delete a message
 */
export async function deleteSlackMessage(
  client: WebClient,
  channelId: string,
  ts: string,
  logger: Logger,
): Promise<void> {
  try {
    await client.chat.delete({
      channel: channelId,
      ts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to delete message', { error: message, channelId, ts });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to delete message: ${message}`);
  }
}

/**
 * Read messages from a channel with pagination
 */
export async function readMessages(
  client: WebClient,
  channelId: string,
  options: { limit?: number; cursor?: string },
  logger: Logger,
): Promise<{ messages: Array<Record<string, unknown>>; nextCursor?: string }> {
  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit: options.limit ?? 20,
      cursor: options.cursor,
    });

    return {
      messages: (result.messages as Array<Record<string, unknown>>) ?? [],
      nextCursor: result.response_metadata?.next_cursor || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to read messages', { error: message, channelId });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to read messages: ${message}`);
  }
}
