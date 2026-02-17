/**
 * Agent tools for Slack interactions
 *
 * Provides tool functions that agents can use:
 * - react / removeReaction
 * - pinMessage / unpinMessage / listPins
 * - memberInfo
 * - emojiList
 * - editSlackMessage / deleteSlackMessage (re-exported from senders/text)
 * - readMessages (re-exported from senders/text)
 */

import type { Logger } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';
import { SlackError, SlackErrorCode } from './types';

/**
 * Add a reaction to a message
 */
export async function addReaction(
  client: WebClient,
  channelId: string,
  messageTs: string,
  emoji: string,
  logger: Logger,
): Promise<void> {
  // Remove colons if present (e.g., :thumbsup: → thumbsup)
  const name = emoji.replace(/^:|:$/g, '');
  try {
    await client.reactions.add({
      channel: channelId,
      timestamp: messageTs,
      name,
    });
  } catch (error) {
    logger.error('Failed to add reaction', { channelId, messageTs, emoji, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to add reaction: ${error}`);
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  client: WebClient,
  channelId: string,
  messageTs: string,
  emoji: string,
  logger: Logger,
): Promise<void> {
  const name = emoji.replace(/^:|:$/g, '');
  try {
    await client.reactions.remove({
      channel: channelId,
      timestamp: messageTs,
      name,
    });
  } catch (error) {
    logger.error('Failed to remove reaction', { channelId, messageTs, emoji, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to remove reaction: ${error}`);
  }
}

/**
 * Pin a message in a channel
 */
export async function pinMessage(
  client: WebClient,
  channelId: string,
  messageTs: string,
  logger: Logger,
): Promise<void> {
  try {
    await client.pins.add({
      channel: channelId,
      timestamp: messageTs,
    });
  } catch (error) {
    logger.error('Failed to pin message', { channelId, messageTs, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to pin message: ${error}`);
  }
}

/**
 * Unpin a message in a channel
 */
export async function unpinMessage(
  client: WebClient,
  channelId: string,
  messageTs: string,
  logger: Logger,
): Promise<void> {
  try {
    await client.pins.remove({
      channel: channelId,
      timestamp: messageTs,
    });
  } catch (error) {
    logger.error('Failed to unpin message', { channelId, messageTs, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to unpin message: ${error}`);
  }
}

/**
 * List pinned messages in a channel
 */
export async function listPins(
  client: WebClient,
  channelId: string,
  logger: Logger,
): Promise<Array<Record<string, unknown>>> {
  try {
    const result = await client.pins.list({ channel: channelId });
    return (result.items as Array<Record<string, unknown>>) ?? [];
  } catch (error) {
    logger.error('Failed to list pins', { channelId, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to list pins: ${error}`);
  }
}

/**
 * Get member/user info
 */
export async function memberInfo(client: WebClient, userId: string, logger: Logger): Promise<Record<string, unknown>> {
  try {
    const result = await client.users.info({ user: userId });
    return (result.user as Record<string, unknown>) ?? {};
  } catch (error) {
    logger.error('Failed to get member info', { userId, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to get member info: ${error}`);
  }
}

/**
 * Get workspace emoji list
 */
export async function emojiList(client: WebClient, logger: Logger): Promise<Record<string, string>> {
  try {
    const result = await client.emoji.list();
    return (result.emoji as Record<string, string>) ?? {};
  } catch (error) {
    logger.error('Failed to get emoji list', { error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to get emoji list: ${error}`);
  }
}

/**
 * List reactions on a message
 */
export async function listReactions(
  client: WebClient,
  channelId: string,
  messageTs: string,
  logger: Logger,
): Promise<Array<{ name: string; count: number; users: string[] }>> {
  try {
    const result = await client.reactions.get({
      channel: channelId,
      timestamp: messageTs,
    });
    const message = result.message as Record<string, unknown> | undefined;
    const reactions = (message?.reactions ?? []) as Array<{ name: string; count: number; users: string[] }>;
    return reactions;
  } catch (error) {
    logger.error('Failed to list reactions', { channelId, messageTs, error: String(error) });
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Failed to list reactions: ${error}`);
  }
}
