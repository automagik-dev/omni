/**
 * Inbound message handler for Slack
 *
 * Handles:
 * - Channel messages, DMs, thread replies
 * - User mention detection
 * - Message metadata extraction
 * - Channel allowlist/blocklist filtering
 * - Per-channel config (requireMention, allowedUsers, tools, skills)
 * - Dedup: drops duplicate events (same channel:ts)
 * - Debounce: batches rapid messages from the same sender (file attachments bypass)
 */

import { sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache, Logger } from '@omni/channel-sdk';
import { buildConversationKey } from '@omni/core';
import type { DebounceManager } from '@omni/core';
import type { App } from '@slack/bolt';
import { resolveChannelConfig } from '../config/channel-config';
import { type DmPolicyConfig, shouldAcceptDm } from '../dm-policy';
import type { SlackChannelConfig, SlackMessageMeta } from '../types';

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

/** Optional reliability options (dedup + debounce) */
export interface ReliabilityOptions {
  /** Drop duplicate Slack events with the same channel:ts */
  dedupeCache?: DedupeCache;
  /**
   * Batch rapid messages from the same sender within a debounce window.
   * File attachments always bypass the debouncer and are processed immediately.
   */
  debounceManager?: DebounceManager;
}

/** Stored args for a debounced message — preserved in DebouncedMessage.payload */
export interface SlackDebouncedArgs {
  externalId: string;
  chatId: string;
  from: string;
  content: { type: 'text'; text?: string };
  replyToId: string | undefined;
  rawPayload: Record<string, unknown>;
  platformTimestamp: number | undefined;
  meta: SlackMessageMeta;
}

/**
 * Channel-level filtering configuration.
 * Subset of SlackConfig used for per-channel message filtering.
 */
export interface ChannelFilterConfig {
  /** Only process messages from these channel IDs (undefined = all channels) */
  channelAllowlist?: string[];
  /** Skip messages from these channel IDs (undefined = no blocklist) */
  channelBlocklist?: string[];
  /** Per-channel configuration overrides keyed by channel ID */
  channels?: Record<string, SlackChannelConfig>;
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
    // 'im' is a 1:1 DM; 'mpim' is a multi-person DM. Both are direct
    // conversations rather than channels, and both were previously misread as
    // channels because only 'im' was checked (#889).
    isDm: channelType === 'im' || channelType === 'mpim',
    // Kept distinct from isDm: an mpim has several humans in it, so anything
    // that means "one person on the other side" (chatName, 1:1 assumptions)
    // must not treat it like an im.
    isMpim: channelType === 'mpim',
    isThreadReply: threadTs !== undefined && threadTs !== ts,
    channelType,
  };
}

/**
 * Check if a message should be skipped (bot, subtype, own message).
 *
 * `selfUserIds` is every identity this instance posts AS. In bot mode that is
 * just the bot user; in user mode (#889) it also includes the authorizing
 * human, and that second entry is not optional:
 *
 * A message the plugin itself posts with a user token carries a `bot_id` (the
 * app's) and is caught by the first line — so there is no echo loop. But a
 * message the HUMAN types themselves, from their phone, carries no bot_id and
 * their own user id. Comparing only against the bot user id would let the
 * agent treat its own principal's typing as inbound and answer their
 * counterpart on their behalf. Verified live against Slack.
 */
export function shouldSkipMessage(msg: Record<string, unknown>, selfUserIds: Array<string | undefined>): boolean {
  if (msg.subtype === 'bot_message' || msg.bot_id) return true;
  if (msg.subtype === 'message_changed' || msg.subtype === 'message_deleted') return true;
  const userId = msg.user as string | undefined;
  if (!userId) return true;
  if (selfUserIds.some((id) => id && id === userId)) return true;
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
    isMpim: meta.isMpim === true,
    isThreadReply: meta.isThreadReply,
    files: msg.files,
    ...extra,
  };
}

/** Convert Slack timestamp to epoch ms */
function slackTsToMs(ts: string | undefined): number | undefined {
  return ts ? Math.floor(Number.parseFloat(ts) * 1000) : undefined;
}

/** Check if a channel should be skipped per allowlist/blocklist config */
function isChannelBlocked(channelId: string, filterConfig: ChannelFilterConfig | undefined): boolean {
  if (filterConfig?.channelAllowlist && filterConfig.channelAllowlist.length > 0) {
    return !filterConfig.channelAllowlist.includes(channelId);
  }
  return filterConfig?.channelBlocklist?.includes(channelId) ?? false;
}

/** Check if a message should be dropped per per-channel config */
function isDroppedByChannelConfig(
  channelConfig: ReturnType<typeof resolveChannelConfig>,
  userId: string,
  isDm: boolean,
  isMentioningInstance: boolean,
): boolean {
  if (!isDm && channelConfig.requireMention && !isMentioningInstance) return true;
  if (channelConfig.allowedUsers && channelConfig.allowedUsers.length > 0) {
    return !channelConfig.allowedUsers.includes(userId);
  }
  return false;
}

/** Queue a non-file message to the debounce manager */
function queueToDebouncer(
  debounceManager: DebounceManager,
  instanceId: string,
  userId: string,
  text: string,
  meta: SlackMessageMeta,
  content: { type: 'text'; text?: string },
  rawPayload: Record<string, unknown>,
  platformTimestamp: number | undefined,
): void {
  const key = buildConversationKey(instanceId, userId);
  const debouncedArgs: SlackDebouncedArgs = {
    externalId: meta.ts,
    chatId: meta.channelId,
    from: userId,
    content,
    replyToId: meta.isThreadReply ? meta.threadTs : undefined,
    rawPayload,
    platformTimestamp,
    meta,
  };
  debounceManager.addMessage(
    key,
    {
      type: 'text',
      text: text || undefined,
      timestamp: platformTimestamp ?? Date.now(),
      payload: debouncedArgs as unknown as Record<string, unknown>,
    },
    { id: userId },
    instanceId,
  );
}

/** Process a single validated inbound message */
async function processMessage(
  instanceId: string,
  msg: Record<string, unknown>,
  currentBotUserId: string | undefined,
  callbacks: MessageHandlerCallbacks,
  logger: Logger,
  reliability: ReliabilityOptions | undefined,
  filterConfig: ChannelFilterConfig | undefined,
): Promise<void> {
  const userId = msg.user as string;
  const meta = extractMessageMeta(msg);
  const rawText = (msg.text as string) ?? '';

  // ── Channel allowlist/blocklist filtering ──
  if (isChannelBlocked(meta.channelId, filterConfig)) {
    logger.debug('Message dropped: channel filtered', { channelId: meta.channelId, instanceId });
    return;
  }

  // Sanitize inbound text (rejects null bytes, oversized payloads, etc.)
  let text = rawText;
  if (rawText) {
    const sanitized = sanitizeMessage(rawText, logger, { instanceId, messageId: meta.ts });
    if (!sanitized.ok) {
      logger.debug('message_dropped_sanitization', { instanceId, ts: meta.ts, reason: sanitized.rejected });
      return;
    }
    text = sanitized.text;
  }

  // ── Dedup check: drop duplicate Slack events (same channel:ts) ──
  const dedupeKey = `${meta.channelId}:${meta.ts}`;
  if (reliability?.dedupeCache?.isDuplicate(instanceId, dedupeKey, 'slack', logger)) {
    logger.debug('duplicate_slack_event_dropped', { instanceId, ts: meta.ts, channelId: meta.channelId });
    return;
  }

  const isMentioningInstance = currentBotUserId ? text.includes(`<@${currentBotUserId}>`) : false;

  // ── Per-channel config filtering (requireMention, allowedUsers) ──
  const channelConfig = resolveChannelConfig({ channels: filterConfig?.channels }, meta.channelId);
  if (isDroppedByChannelConfig(channelConfig, userId, meta.isDm, isMentioningInstance)) {
    logger.debug('Message dropped: per-channel filter', { channelId: meta.channelId, userId, instanceId });
    return;
  }

  logger.debug('Message received', {
    instanceId,
    channelId: meta.channelId,
    userId,
    isDm: meta.isDm,
    isThread: meta.isThreadReply,
    isMention: isMentioningInstance,
  });

  // Build rawPayload with channel extra (tools/skills from per-channel config)
  const channelExtra: Record<string, unknown> = { isMentioningInstance };
  if (channelConfig.tools) channelExtra.tools = channelConfig.tools;
  if (channelConfig.skills) channelExtra.skills = channelConfig.skills;

  const rawPayload = buildRawPayload(meta, msg, channelExtra);
  const platformTimestamp = slackTsToMs(meta.ts);
  const replyToId = meta.isThreadReply ? meta.threadTs : undefined;
  const content: { type: 'text'; text?: string } = { type: 'text', text: text || undefined };

  // ── File attachments bypass debouncing — always dispatch immediately ──
  const hasFiles = Boolean(msg.files && (msg.files as unknown[]).length > 0);

  if (reliability?.debounceManager && !hasFiles) {
    queueToDebouncer(
      reliability.debounceManager,
      instanceId,
      userId,
      text,
      meta,
      content,
      rawPayload,
      platformTimestamp,
    );
    return;
  }

  await callbacks.onMessage(
    instanceId,
    meta.ts,
    meta.channelId,
    userId,
    content,
    replyToId,
    rawPayload,
    platformTimestamp,
    meta,
  );
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
  filterConfig?: ChannelFilterConfig,
  reliability?: ReliabilityOptions,
  /** Authorizing human's user id when authMode is 'user' (#889). */
  actingUserId?: string | undefined | (() => string | undefined),
): void {
  const resolveBotUserId = () => (typeof botUserId === 'function' ? botUserId() : botUserId);
  const resolveActingUserId = () => (typeof actingUserId === 'function' ? actingUserId() : actingUserId);

  // Handle all messages (channels, groups, DMs, mpim)
  app.message(async ({ message }) => {
    const msg = message as unknown as Record<string, unknown>;
    if (shouldSkipMessage(msg, [resolveBotUserId(), resolveActingUserId()])) return;

    const userId = msg.user as string;
    const meta = extractMessageMeta(msg);
    if (await enforceDmPolicy(meta, userId, dmPolicyConfig, instanceId, callbacks, logger)) return;

    await processMessage(instanceId, msg, resolveBotUserId(), callbacks, logger, reliability, filterConfig);
  });

  // NOTE: app_mention is NOT handled separately — app.message() already captures
  // messages that mention the bot, and the agent-dispatcher detects mentions via
  // the mentionsBot flag. Handling both would cause duplicate message.received events.

  logger.info('Message handlers registered', { instanceId });
}
