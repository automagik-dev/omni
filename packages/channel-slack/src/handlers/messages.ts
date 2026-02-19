/**
 * Inbound message handler for Slack
 *
 * Handles:
 * - Channel messages, DMs, thread replies
 * - User mention detection
 * - Message metadata extraction
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';
import { type DmPolicyConfig, shouldAcceptDm } from '../dm-policy';
import type { SlackMessageMeta } from '../types';

export interface MessageHandlerCallbacks {
  onMessage: (
    instanceId: string,
    externalId: string,
    chatId: string,
    from: string,
    content: { type: 'text'; text?: string },
    replyToId: string | undefined,
    rawPayload: Record<string, unknown>,
    platformTimestamp?: number,
    meta?: SlackMessageMeta,
  ) => Promise<void>;
  onDmRejected?: (instanceId: string, channelId: string, userId: string, message: string) => Promise<void>;
}

/**
 * Extract message metadata from a Slack message event
 */
export function extractMessageMeta(event: Record<string, unknown>): SlackMessageMeta {
  const channelId = (event.channel as string) ?? '';
  const threadTs = event.thread_ts as string | undefined;
  const ts = (event.ts as string) ?? '';
  const userId = (event.user as string) ?? '';
  const teamId = event.team as string | undefined;
  const channelType = event.channel_type as string | undefined;

  return {
    channelId,
    threadTs,
    ts,
    userId,
    teamId,
    isDm: channelType === 'im',
    isThreadReply: threadTs !== undefined && threadTs !== ts,
    channelType,
  };
}

/** Check if a message should be skipped (bot, subtype, own message) */
function shouldSkipMessage(msg: Record<string, unknown>, botUserId: string | undefined): boolean {
  if (msg.subtype === 'bot_message' || msg.bot_id) return true;
  if (msg.subtype === 'message_changed' || msg.subtype === 'message_deleted') return true;
  const userId = msg.user as string | undefined;
  if (!userId) return true;
  if (botUserId && userId === botUserId) return true;
  return false;
}

/** Enforce DM policy, returns true if DM should be rejected */
async function enforceDmPolicy(
  meta: SlackMessageMeta,
  userId: string,
  dmPolicyConfig: DmPolicyConfig,
  instanceId: string,
  callbacks: MessageHandlerCallbacks,
  logger: Logger,
): Promise<boolean> {
  if (!meta.isDm) return false;
  const dmCheck = shouldAcceptDm(userId, dmPolicyConfig);
  if (dmCheck.accepted) return false;
  logger.debug('DM rejected by policy', { userId, policy: dmPolicyConfig.policy });
  if (dmCheck.reason && callbacks.onDmRejected) {
    await callbacks.onDmRejected(instanceId, meta.channelId, userId, dmCheck.reason);
  }
  return true;
}

/** Build raw payload from message metadata */
function buildRawPayload(
  meta: SlackMessageMeta,
  msg: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ts: meta.ts,
    threadTs: meta.threadTs,
    // threadId: included for per_thread session strategy in agent-dispatcher
    threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
    channelType: meta.channelType,
    teamId: meta.teamId,
    isDm: meta.isDm,
    isThreadReply: meta.isThreadReply,
    files: msg.files,
    ...extra,
  };
}

/** Convert Slack timestamp to epoch ms */
function slackTsToMs(ts: string | undefined): number | undefined {
  return ts ? Math.floor(Number.parseFloat(ts) * 1000) : undefined;
}

/**
 * Set up inbound message handlers on a Bolt.js app
 */
export function setupMessageHandlers(
  app: App,
  instanceId: string,
  botUserId: string | undefined | (() => string | undefined),
  callbacks: MessageHandlerCallbacks,
  dmPolicyConfig: DmPolicyConfig,
  logger: Logger,
): void {
  // Support both static value and getter (for lazy resolution after app.start())
  const resolveBotUserId = () => (typeof botUserId === 'function' ? botUserId() : botUserId);

  // Handle all messages (channels, groups, DMs, mpim)
  app.message(async ({ message }) => {
    const msg = message as unknown as Record<string, unknown>;
    if (shouldSkipMessage(msg, resolveBotUserId())) return;

    const userId = msg.user as string;
    const meta = extractMessageMeta(msg);
    const text = (msg.text as string) ?? '';
    const currentBotUserId = resolveBotUserId();

    if (await enforceDmPolicy(meta, userId, dmPolicyConfig, instanceId, callbacks, logger)) return;

    // Detect @mention of the bot in message text (Slack format: <@U...>)
    const isMentioningInstance = currentBotUserId ? text.includes(`<@${currentBotUserId}>`) : false;

    logger.debug('Message received', {
      instanceId,
      channelId: meta.channelId,
      userId,
      isDm: meta.isDm,
      isThread: meta.isThreadReply,
      isMention: isMentioningInstance,
    });

    await callbacks.onMessage(
      instanceId,
      meta.ts,
      meta.channelId,
      userId,
      { type: 'text', text: text || undefined },
      meta.isThreadReply ? meta.threadTs : undefined,
      buildRawPayload(meta, msg, { isMentioningInstance }),
      slackTsToMs(meta.ts),
      meta,
    );
  });

  // NOTE: app_mention is NOT handled separately — app.message() already captures
  // messages that mention the bot, and the agent-dispatcher detects mentions via
  // the mentionsBot flag. Handling both would cause duplicate message.received events.

  logger.info('Message handlers registered', { instanceId });
}
