/**
 * Agent Dispatcher Plugin
 *
 * Evolved from agent-responder to support multi-event triggering:
 * - message.received → text message triggers (existing behavior)
 * - reaction.received → emoji reaction triggers (new)
 * - reaction.removed → reaction removal triggers (new)
 *
 * Features:
 * - Multi-event subscription based on instance triggerEvents config
 * - Trigger type classification (dm, mention, reply, name_match, reaction)
 * - Per-user-per-channel rate limiting
 * - Reaction dedup (LRU cache)
 * - traceId generation and propagation
 * - Dispatch to any IAgentProvider (Agno, Webhook, etc.)
 * - Trigger logging to trigger_logs table
 * - Preserves existing debouncing for message events
 */

import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type AckHandle,
  type AckProvider,
  type ReactionAckConfig,
  sanitizeOutboundText,
  startAck,
} from '@omni/channel-sdk';
import type { FetchHistoryResult, HistorySyncMessage } from '@omni/channel-sdk';
import type { StreamSender } from '@omni/channel-sdk';
import {
  A2AAgentProvider,
  AgUiAgentProvider,
  type AgentTrigger,
  type AgentTriggerType,
  AgnoAgentProvider,
  type BeforeAgentStartContext,
  type BeforeMessageWriteContext,
  ClaudeCodeAgentProvider,
  type EventBus,
  type IAgentProvider,
  InMemorySessionActivityStore,
  JOURNEY_STAGES,
  type MediaProcessedPayload,
  type MessageReceivedPayload,
  NatsGenieProvider,
  OpenClawAgentProvider,
  OpenClawClient,
  type OpenClawClientConfig,
  type OpenClawProviderConfig,
  type ProviderFile,
  type ReactionReceivedPayload,
  type SessionResetConfig,
  type StreamDelta,
  WebhookAgentProvider,
  checkSessionReset,
  createLogger,
  createProviderClient,
  executeHooks,
  generateCorrelationId,
  getHookRegistry,
  getJourneyTracker,
} from '@omni/core';
import type { AgentProvider, Database } from '@omni/db';
import { agentSessions, agents } from '@omni/db';
import type { ChannelType, Instance } from '@omni/db';
import { createMediaProcessingService } from '@omni/media-processing';
import * as Sentry from '@sentry/bun';
import { and, eq } from 'drizzle-orm';
import { sentryEnabled } from '../lib/sentry-scrub';
import type { Services } from '../services';
import {
  type MessageContext,
  type SplitDelayConfig,
  calculateSplitDelay,
  computeSessionId,
  getSplitDelayConfig,
  shouldAgentReply,
} from '../services/agent-runner';
import { buildWhatsAppMessageContext, extractPhoneFromJid } from '../services/message-context';
import type { ResolvedRoute } from '../services/route-resolver';
import { getPlugin } from './loader';
import {
  type BufferedMessage,
  type DebounceConfig,
  type DispatchMetadata,
  MessageDebouncer,
} from './message-debouncer';
import { createSessionStorage } from './session-storage';

const log = createLogger('agent-dispatcher');

/** Maximum characters to include when quoting a replied-to message. */
const QUOTED_MESSAGE_MAX_CHARS = 4000;

/** Hard cap on history messages fetched for DM conversations. */
const DM_HISTORY_LIMIT = 20;

// ============================================================================
// Plugin → AckProvider adapter
// ============================================================================

/**
 * Wrap a ChannelPlugin's optional react/unreact methods as an AckProvider.
 * Returns null if the plugin doesn't support reactions.
 */
function createPluginAckProvider(
  plugin: {
    react?(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;
    unreact?(instanceId: string, chatId: string, messageId: string, emoji: string): Promise<void>;
  } | null,
): AckProvider | null {
  if (!plugin?.react || !plugin?.unreact) return null;
  const reactFn = plugin.react.bind(plugin);
  const unreactFn = plugin.unreact.bind(plugin);
  return {
    ack: (instanceId, chatId, messageId, emoji) => reactFn(instanceId, chatId, messageId, emoji),
    removeAck: (instanceId, chatId, messageId, emoji) => unreactFn(instanceId, chatId, messageId, emoji),
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Transient dispatch fields stamped onto an effectiveInstance copy by applyAgentFkOverrides.
 * These are runtime-only fields derived from the Agent entity and are NOT persisted on instances.
 */
interface DispatchFields {
  /** Agent provider UUID resolved from the Agent entity (transient — set by applyAgentFkOverrides) */
  agentProviderId?: string | null;
  /** Agent type resolved from the Agent entity (transient — set by applyAgentFkOverrides) */
  agentType?: 'agent' | 'team' | 'workflow';
  /** Provider-internal agent name resolved from the Agent entity (transient — set by applyAgentFkOverrides) */
  agentInternalId?: string;
}

/** Instance extended with transient dispatch fields for in-process agent resolution. */
type DispatchInstance = Instance & DispatchFields;

// ============================================================================
// Rate Limiter
// ============================================================================

/** Default rate limit: 5 triggers per 60-second window */
const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW_MS = 60_000;

class RateLimiter {
  /** Map of "userId:channelType:instanceId" → timestamps[] */
  private counters: Map<string, number[]> = new Map();
  private readonly windowMs: number;

  constructor(windowMs = DEFAULT_RATE_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Check if a trigger is allowed (under rate limit)
   */
  isAllowed(userId: string, channelType: string, instanceId: string, maxPerMinute: number): boolean {
    const key = `${userId}:${channelType}:${instanceId}`;
    const now = Date.now();

    // Get or create counter
    let timestamps = this.counters.get(key) ?? [];

    // Remove expired entries
    timestamps = timestamps.filter((ts) => now - ts < this.windowMs);

    if (timestamps.length >= maxPerMinute) {
      log.debug('Rate limit exceeded', { key, count: timestamps.length, limit: maxPerMinute });
      return false;
    }

    timestamps.push(now);
    this.counters.set(key, timestamps);
    return true;
  }

  /**
   * Clean up expired entries periodically
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.counters.entries()) {
      const active = timestamps.filter((ts) => now - ts < this.windowMs);
      if (active.length === 0) {
        this.counters.delete(key);
      } else {
        this.counters.set(key, active);
      }
    }
  }
}

// ============================================================================
// Reaction Dedup
// ============================================================================

class ReactionDedup {
  /** LRU-like set of "messageId:emoji:userId" */
  private seen: Map<string, number> = new Map();
  private readonly maxEntries = 10_000;
  private readonly maxPerMessage = 3; // Max triggers per unique message
  private messageCounters: Map<string, number> = new Map();

  /**
   * Check if this reaction has already been processed
   * @returns true if the reaction is a duplicate and should be skipped
   */
  isDuplicate(messageId: string, emoji: string, userId: string): boolean {
    const key = `${messageId}:${emoji}:${userId}`;

    // Check exact duplicate
    if (this.seen.has(key)) {
      return true;
    }

    // Check per-message limit
    const msgCount = this.messageCounters.get(messageId) ?? 0;
    if (msgCount >= this.maxPerMessage) {
      log.debug('Reaction per-message limit reached', { messageId, count: msgCount });
      return true;
    }

    // Record
    this.seen.set(key, Date.now());
    this.messageCounters.set(messageId, msgCount + 1);

    // Evict oldest if over limit
    if (this.seen.size > this.maxEntries) {
      const firstKey = this.seen.keys().next().value;
      if (firstKey) {
        this.seen.delete(firstKey);
        // Clean up messageCounters to prevent unbounded growth
        const evictedMessageId = firstKey.split(':')[0];
        if (evictedMessageId) {
          const count = this.messageCounters.get(evictedMessageId) ?? 0;
          if (count <= 1) {
            this.messageCounters.delete(evictedMessageId);
          } else {
            this.messageCounters.set(evictedMessageId, count - 1);
          }
        }
      }
    }

    return false;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getDebounceConfig(instance: Instance): DebounceConfig {
  return {
    mode: instance.messageDebounceMode ?? 'disabled',
    minMs: instance.messageDebounceMinMs ?? 0,
    maxMs: instance.messageDebounceMaxMs ?? 0,
    restartOnTyping: instance.messageDebounceRestartOnTyping ?? false,
    groupMs: (instance as Record<string, unknown>).messageDebounceGroupMs as number | null,
  };
}

/** Build message context for Slack channels (isReplyToBot resolved async later) */
function buildSlackMessageContext(rawPayload: Record<string, unknown>, text: string): MessageContext {
  return {
    isDirectMessage: rawPayload.isDm === true,
    mentionsBot: rawPayload.isMentioningInstance === true,
    isReplyToBot: false, // resolved async via hasBotRepliedInThread
    text,
  };
}

/** Build message context for Discord channels */
function buildDiscordMessageContext(
  rawPayload: Record<string, unknown>,
  instance: Instance,
  text: string,
): MessageContext {
  const isDirectMessage = rawPayload.isDM === true;
  const mentionedUsers = ((rawPayload.mentions as Record<string, unknown>)?.users as string[]) ?? [];
  const botId = instance.ownerIdentifier ?? '';
  const mentionsBot = (botId.length > 0 && mentionedUsers.includes(botId)) || rawPayload.isMentioningInstance === true;
  return { isDirectMessage, mentionsBot, isReplyToBot: false, text };
}

function buildMessageContext(payload: MessageReceivedPayload, instance: Instance): MessageContext {
  const rawPayload = payload.rawPayload ?? {};
  const chatId = payload.chatId ?? '';
  const text = payload.content?.text ?? '';
  const channel = instance.channel;

  if (channel === 'slack') {
    return buildSlackMessageContext(rawPayload, text);
  }

  if (channel === 'discord') {
    return buildDiscordMessageContext(rawPayload, instance, text);
  }

  return buildWhatsAppMessageContext(rawPayload, chatId, instance, text);
}

/**
 * Classify what type of trigger this message represents
 */
function classifyMessageTrigger(context: MessageContext): AgentTriggerType {
  if (context.isDirectMessage) return 'dm';
  if (context.mentionsBot) return 'mention';
  if (context.isReplyToBot) return 'reply';
  return 'name_match';
}

/** Determine WhatsApp chat type from JID format */
function whatsappChatType(chatId: string): 'dm' | 'group' | 'channel' {
  if (chatId.includes('@s.whatsapp.net')) return 'dm';
  if (chatId.includes('@lid')) return 'dm'; // LID-first: @lid is a valid DM identity
  if (chatId.includes('@g.us')) return 'group';
  if (chatId.includes('@newsletter')) return 'channel';
  return 'dm';
}

/**
 * Determine chat type from platform-specific chat ID and optional rawPayload hints
 */
function determineChatType(
  chatId: string,
  channel: string,
  rawPayload?: Record<string, unknown>,
): 'dm' | 'group' | 'channel' {
  if (channel === 'whatsapp' || channel === 'whatsapp-baileys' || channel === 'whatsapp-cloud') {
    return whatsappChatType(chatId);
  }
  if (channel === 'telegram') {
    const numId = Number(chatId);
    return !Number.isNaN(numId) && numId < 0 ? 'group' : 'dm';
  }
  if (channel === 'slack') {
    if (rawPayload?.isDm === true) return 'dm';
    return 'channel';
  }
  if (channel === 'discord') {
    if (rawPayload?.isGroup === true) return 'group';
    return 'dm';
  }
  return 'dm';
}

async function sendTypingPresence(
  channel: ChannelType,
  instanceId: string,
  chatId: string,
  state: 'composing' | 'paused',
): Promise<void> {
  try {
    const plugin = await getPlugin(channel);
    if (plugin && 'sendTyping' in plugin && typeof plugin.sendTyping === 'function') {
      const duration = state === 'composing' ? 30000 : 0;
      await plugin.sendTyping(instanceId, chatId, duration);
    }
  } catch (error) {
    log.debug('Failed to send typing presence', { error: String(error) });
  }
}

async function sendTextMessage(
  channel: ChannelType,
  instanceId: string,
  chatId: string,
  text: string,
  messageFormatMode: 'convert' | 'passthrough' = 'convert',
  replyTo?: string,
  correlationId?: string,
  senderAgentId?: string,
): Promise<void> {
  const plugin = await getPlugin(channel);
  if (!plugin) throw new Error(`Channel plugin not found: ${channel}`);

  // Strip internal routing headers and agent directives (GH #300)
  const sanitized = sanitizeOutboundText(text);
  if (!sanitized) return; // Entire message was internal metadata — nothing to send

  await plugin.sendMessage(instanceId, {
    to: chatId,
    content: { type: 'text', text: sanitized },
    replyTo,
    metadata: { messageFormatMode, correlationId, senderAgentId },
  });
}

/**
 * Send error feedback to user when agent dispatch fails.
 * Fire-and-forget — errors during feedback delivery are silently swallowed.
 */
async function sendErrorFeedback(
  channel: ChannelType,
  instanceId: string,
  chatId: string,
  error: unknown,
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  log.error('agent_dispatch_error', { channel, instanceId, chatId, error: errorMsg });
  const text = '⚠️ Sorry, I ran into an issue processing your message. Please try again.';
  await sendTextMessage(channel, instanceId, chatId, text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHANNEL_MESSAGE_LIMITS: Record<string, number> = {
  discord: 2000,
  'whatsapp-baileys': 65536,
  'whatsapp-cloud': 65536,
  slack: 40000,
  telegram: 4096,
};

const DEFAULT_MESSAGE_LIMIT = 4000;

function getMessageLimit(channel: ChannelType): number {
  return CHANNEL_MESSAGE_LIMITS[channel] ?? DEFAULT_MESSAGE_LIMIT;
}

function findSplitPoint(text: string, maxLength: number): number {
  const minSplit = maxLength * 0.5;
  const paragraphBreak = text.lastIndexOf('\n\n', maxLength);
  if (paragraphBreak > minSplit) return paragraphBreak + 2;
  const lineBreak = text.lastIndexOf('\n', maxLength);
  if (lineBreak > minSplit) return lineBreak + 1;
  const sentenceEnd = Math.max(
    text.lastIndexOf('. ', maxLength),
    text.lastIndexOf('! ', maxLength),
    text.lastIndexOf('? ', maxLength),
  );
  if (sentenceEnd > minSplit) return sentenceEnd + 2;
  const wordBreak = text.lastIndexOf(' ', maxLength);
  if (wordBreak > minSplit) return wordBreak + 1;
  return maxLength;
}

function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    const splitIndex = findSplitPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }
  return chunks.filter(Boolean);
}

// ============================================================================
// Media File Resolution
// ============================================================================

/** Base path for media storage, matching the WhatsApp handler */
const MEDIA_BASE_PATH = process.env.MEDIA_STORAGE_PATH || './data/media';

/**
 * Convert a relative media URL (/api/v2/media/...) to a local file path.
 * Returns null if the resolved path escapes the media base directory (path traversal).
 */
function resolveMediaPath(mediaUrl: string): string | null {
  const relativePath = mediaUrl.replace(/^\/api\/v2\/media\//, '');
  const fullPath = resolve(MEDIA_BASE_PATH, relativePath);
  const basePath = resolve(MEDIA_BASE_PATH);
  if (!fullPath.startsWith(`${basePath}/`) && fullPath !== basePath) {
    log.warn('Path traversal attempt blocked', { mediaUrl, resolved: fullPath, basePath });
    return null;
  }
  return fullPath;
}

/**
 * Extract ProviderFile entries from buffered messages that have media attachments.
 * Respects agentSendMediaPath instance setting — returns empty if disabled.
 */
function extractMediaFiles(messages: BufferedMessage[], agentSendMediaPath: boolean): ProviderFile[] {
  if (!agentSendMediaPath) return [];
  const files: ProviderFile[] = [];
  for (const m of messages) {
    const content = m.payload.content;
    if (content?.mediaUrl && content.mimeType) {
      const path = resolveMediaPath(content.mediaUrl);
      if (path) {
        files.push({ path, mimeType: content.mimeType });
      }
    }
  }
  return files;
}

// ============================================================================
// Media Preprocessing for Agents
// ============================================================================

/** Emoji icons for each media content type */
const MEDIA_ICONS: Record<string, string> = {
  audio: '\u{1F3B5}',
  image: '\u{1F5BC}\uFE0F',
  video: '\u{1F3A5}',
  document: '\u{1F4C4}',
};

/**
 * Map content type to the corresponding processed-text column on the messages table.
 */
function getProcessedColumn(
  contentType: string,
): 'transcription' | 'imageDescription' | 'videoDescription' | 'documentExtraction' | null {
  switch (contentType) {
    case 'audio':
      return 'transcription';
    case 'image':
      return 'imageDescription';
    case 'video':
      return 'videoDescription';
    case 'document':
      return 'documentExtraction';
    default:
      return null;
  }
}

const MEDIA_WAIT_NULL = { content: null, localPath: null } as const;

// ============================================================================
// Event-Driven Media Completion (replaces DB polling)
// ============================================================================

/** Pending media awaits, keyed by DB message UUID */
const mediaCompletions = new Map<
  string,
  { resolve: (result: { content: string; error?: string }) => void; reject: (error: Error) => void; createdAt: number }
>();

/** Cache of already-completed results (event arrived before dispatcher asked). TTL managed via setTimeout. */
const mediaResultCache = new Map<string, { content: string; error?: string }>();

/**
 * Check a single poll result: returns result if ready, 'pending' if still waiting, or null on error.
 */
function checkProcessedColumn(
  msg: { mediaUrl?: string | null; mediaLocalPath?: string | null; [key: string]: unknown } | null,
  column: string,
): { content: string; localPath: string | null } | 'error' | 'pending' {
  if (!msg) return 'pending';
  const processed = msg[column];
  if (processed == null) return 'pending';
  if (typeof processed === 'string' && processed.startsWith('[error')) return 'error';
  if (processed) {
    // Use mediaLocalPath (the actual downloaded file path) instead of mediaUrl (the platform file ID)
    const localPath = msg.mediaLocalPath ? resolve(join(MEDIA_BASE_PATH, msg.mediaLocalPath as string)) : null;
    return {
      content: processed as string,
      localPath,
    };
  }
  return 'pending';
}

/**
 * Retry a DB lookup until it returns a non-null result or 5s elapses.
 * Handles the race where message-persistence hasn't written the row yet.
 */
async function waitForRecord<T>(
  fn: () => Promise<T | null | undefined>,
  maxMs = 5_000,
  pollMs = 250,
): Promise<T | null> {
  let result = await fn();
  if (result) return result;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    result = await fn();
    if (result) return result;
  }
  return null;
}

/**
 * Await media processing via NATS event instead of DB polling.
 * Checks: DB first (already done) → event cache (arrived early) → await promise (NATS delivery).
 */
async function awaitMediaProcessing(
  services: Services,
  instanceId: string,
  chatId: string,
  externalId: string,
  contentType: string,
): Promise<{ content: string | null; localPath: string | null }> {
  const column = getProcessedColumn(contentType);
  if (!column) return MEDIA_WAIT_NULL;

  // Wait briefly for message-persistence to create the DB rows (race condition:
  // both media-processor and agent-dispatcher subscribe to message.received,
  // and the dispatcher's debounce may fire before persistence completes).
  const chat = await waitForRecord(() => services.chats.findByExternalIdSmart(instanceId, chatId));
  if (!chat) {
    log.warn('Chat not found for media wait', { instanceId, chatId });
    return MEDIA_WAIT_NULL;
  }

  const msg = await waitForRecord(() => services.messages.getByExternalId(chat.id, externalId));
  if (!msg) {
    log.warn('Message not found for media wait after retries', { instanceId, chatId, externalId });
    return MEDIA_WAIT_NULL;
  }

  // 1. Check DB — result may already be written (processing finished before debounce fired)
  const existing = checkProcessedColumn(msg, column);
  if (existing === 'error') {
    log.warn('Media processing failed (DB)', { instanceId, chatId, externalId });
    return MEDIA_WAIT_NULL;
  }
  if (existing !== 'pending') return existing;

  // 2. Check event cache — event may have arrived before dispatcher asked
  const cached = mediaResultCache.get(msg.id);
  if (cached) {
    mediaResultCache.delete(msg.id);
    if (!cached.content || cached.error) return MEDIA_WAIT_NULL;
    const localPath = msg.mediaLocalPath ? resolve(join(MEDIA_BASE_PATH, msg.mediaLocalPath as string)) : null;
    return { content: cached.content, localPath };
  }

  // 3. Await NATS event — guaranteed delivery via durable consumer
  const result = await new Promise<{ content: string; error?: string }>((resolvePromise, rejectPromise) => {
    mediaCompletions.set(msg.id, { resolve: resolvePromise, reject: rejectPromise, createdAt: Date.now() });
  });

  if (!result.content || result.error) return MEDIA_WAIT_NULL;

  // Re-read message for localPath (media storage may have updated it)
  const updated = await services.messages.getByExternalId(chat.id, externalId);
  const localPath = updated?.mediaLocalPath ? resolve(join(MEDIA_BASE_PATH, updated.mediaLocalPath as string)) : null;
  return { content: result.content, localPath };
}

/**
 * Format processed media content for the agent.
 */
/** Default content types that receive the file path (audio is excluded — already transcribed) */
const DEFAULT_SEND_MEDIA_PATH_TYPES = ['image', 'video', 'document'];

function formatProcessedMedia(
  contentType: string,
  fullPath: string | null,
  processedText: string,
  includePath: boolean,
  sendMediaPathTypes?: string[] | null,
): string {
  const icon = MEDIA_ICONS[contentType] ?? '\u{1F4CE}';
  const allowedTypes = sendMediaPathTypes ?? DEFAULT_SEND_MEDIA_PATH_TYPES;
  if (includePath && fullPath && allowedTypes.includes(contentType)) {
    return `${icon} [${fullPath}]: ${processedText}`;
  }
  return `${icon}: ${processedText}`;
}

// ============================================================================
// Quoted Message Resolution
// ============================================================================

/**
 * Get the best text representation of a message's content.
 * Prefers processed media text (transcription, description) over raw text.
 */
function getMessageContentText(msg: {
  messageType: string;
  textContent: string | null;
  transcription: string | null;
  imageDescription: string | null;
  videoDescription: string | null;
  documentExtraction: string | null;
}): string | null {
  switch (msg.messageType) {
    case 'audio':
      return msg.transcription ? `${MEDIA_ICONS.audio}: ${msg.transcription}` : (msg.textContent ?? '[audio]');
    case 'image':
      return msg.imageDescription ? `${MEDIA_ICONS.image}: ${msg.imageDescription}` : (msg.textContent ?? '[image]');
    case 'video':
      return msg.videoDescription ? `${MEDIA_ICONS.video}: ${msg.videoDescription}` : (msg.textContent ?? '[video]');
    case 'document':
      return msg.documentExtraction
        ? `${MEDIA_ICONS.document}: ${msg.documentExtraction}`
        : (msg.textContent ?? '[document]');
    default:
      return msg.textContent;
  }
}

/**
 * Resolve a quoted message into formatted text for the agent.
 * Looks up the referenced message and formats its content.
 */
export async function resolveQuotedMessage(
  services: Services,
  instanceId: string,
  chatId: string,
  replyToId: string,
): Promise<string | null> {
  try {
    const chat = await services.chats.findByExternalIdSmart(instanceId, chatId);
    if (!chat) return null;

    const quoted = await services.messages.getByExternalId(chat.id, replyToId);
    if (!quoted) return null;

    const sender = quoted.senderDisplayName ?? quoted.senderPlatformUserId ?? (quoted.isFromMe ? 'You' : 'unknown');
    const time = quoted.platformTimestamp
      ? new Date(quoted.platformTimestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '';

    const content = getMessageContentText(quoted);
    if (!content) return null;

    // Truncate long quoted content to keep context manageable
    const truncated =
      content.length > QUOTED_MESSAGE_MAX_CHARS ? `${content.slice(0, QUOTED_MESSAGE_MAX_CHARS)}...` : content;

    const timeStr = time ? ` at ${time}` : '';
    return `[Quoting ${sender}${timeStr}: ${truncated}]`;
  } catch (error) {
    log.debug('Failed to resolve quoted message', { replyToId, error: String(error) });
    return null;
  }
}

// ============================================================================
// Self-Chat Detection
// ============================================================================

/** Bot prefix for self-chat replies so the user can distinguish bot messages from their own */
const BOT_PREFIX = '\u{1F916} ';

/**
 * Check if a chat is a self-chat (user messaging themselves).
 * Compares chatId against the instance's ownerIdentifier (connected account JID).
 * Normalizes JIDs by stripping device suffix (e.g., ":0" in "5511999@s.whatsapp.net:0").
 */
function isSelfChat(chatId: string, ownerIdentifier: string | null | undefined): boolean {
  if (!ownerIdentifier) return false;
  return extractPhoneFromJid(chatId) === extractPhoneFromJid(ownerIdentifier);
}

// ============================================================================
// Response Sending
// ============================================================================

async function sendResponseParts(
  channel: ChannelType,
  instanceId: string,
  chatId: string,
  parts: string[],
  splitConfig: SplitDelayConfig,
  messageFormatMode: 'convert' | 'passthrough' = 'convert',
  replyTo?: string,
  correlationId?: string,
  senderAgentId?: string,
): Promise<void> {
  const messageLimit = getMessageLimit(channel);
  const allChunks: string[] = [];
  for (const part of parts) {
    allChunks.push(...chunkText(part, messageLimit));
  }

  // Slack needs thread_ts on every message to stay in thread.
  // WhatsApp/Discord senders only quote the first chunk internally,
  // so passing replyTo on subsequent chunks creates unwanted extra replies.
  const isSlack = channel === 'slack';

  for (const [index, chunk] of allChunks.entries()) {
    const chunkReplyTo = isSlack || index === 0 ? replyTo : undefined;
    await sendTextMessage(
      channel,
      instanceId,
      chatId,
      chunk,
      messageFormatMode,
      chunkReplyTo,
      correlationId,
      senderAgentId,
    );
    const isLastChunk = index === allChunks.length - 1;
    if (!isLastChunk) {
      const delay = calculateSplitDelay(splitConfig);
      if (delay > 0) {
        await sendTypingPresence(channel, instanceId, chatId, 'composing');
        await sleep(delay);
      }
    }
  }
  await sendTypingPresence(channel, instanceId, chatId, 'paused');
}

// ============================================================================
// Agent Execution (using existing AgentRunnerService for now)
// ============================================================================

/**
 * Wait for media processing on all media messages, returning formatted text.
 */
async function collectProcessedMedia(
  services: Services,
  instance: Instance,
  messages: BufferedMessage[],
): Promise<string[]> {
  const results: string[] = [];
  const mediaMessages = messages.filter((m) => m.payload.content?.mediaUrl && m.payload.content?.type);

  for (const m of mediaMessages) {
    const contentType = m.payload.content?.type;
    if (!contentType || !getProcessedColumn(contentType)) continue;

    let result: { content: string | null; localPath: string | null };
    try {
      result = await awaitMediaProcessing(services, instance.id, m.payload.chatId, m.payload.externalId, contentType);
    } catch (error) {
      log.warn('Media await failed', { externalId: m.payload.externalId, error: String(error) });
      result = MEDIA_WAIT_NULL;
    }

    if (result.content) {
      results.push(
        formatProcessedMedia(
          contentType,
          result.localPath,
          result.content,
          instance.agentSendMediaPath,
          instance.agentSendMediaPathTypes,
        ),
      );
    } else {
      const icon = MEDIA_ICONS[contentType] ?? '\u{1F4CE}';
      results.push(`${icon}: [media processing unavailable]`);
    }
  }
  return results;
}

/**
 * Resolve quoted messages and prepend context to message texts.
 */
async function prependQuotedContext(
  services: Services,
  instanceId: string,
  chatId: string,
  messages: BufferedMessage[],
  entries: Array<{ text: string; messageKey: string | null }>,
  messageKeyByIndex: Map<number, string>,
): Promise<void> {
  for (const [index, m] of messages.entries()) {
    const replyToId = m.payload.replyToId;
    if (!replyToId) continue;

    const quotedText = await resolveQuotedMessage(services, instanceId, chatId, replyToId);
    if (!quotedText) continue;

    const messageKey = messageKeyByIndex.get(index);
    const idx = messageKey ? entries.findIndex((entry) => entry.messageKey === messageKey) : -1;
    const existingEntry = idx >= 0 ? entries[idx] : undefined;
    if (existingEntry) {
      existingEntry.text = `${quotedText}\n${existingEntry.text}`;
    } else {
      entries.unshift({ text: quotedText, messageKey: null });
    }
  }
}

/**
 * Resolve contact name using cache-aside pattern: cache first, DB fallback
 */
async function resolveContactName(
  services: Services,
  instanceId: string,
  jid: string,
  cacheMap: Map<string, string>,
): Promise<string | null> {
  // Try cache first (fast path)
  const cachedName = cacheMap.get(jid);
  if (cachedName) return cachedName;

  // Cache miss → query database
  try {
    const chat = await services.chats.findByExternalIdSmart(instanceId, jid);
    if (chat?.name) {
      log.debug('Contact name from DB fallback', { jid, name: chat.name });
      return chat.name;
    }
  } catch (error) {
    log.warn('Failed to query DB for contact', { jid, error: String(error) });
  }

  return null;
}

type MentionStats = { resolved: number; replaced: number; unresolved: number; skipped: number };

function buildJidNameMap(mentionedContacts: Array<{ jid: string; name?: string }> | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const contact of mentionedContacts ?? []) {
    if (contact.name) map.set(contact.jid, contact.name);
  }
  return map;
}

async function applyJidMentionReplacement(
  services: Services,
  instanceId: string,
  jid: string,
  jidToName: Map<string, string>,
  text: string,
  stats: MentionStats,
): Promise<string> {
  // Extract phone number from JID (supports @s.whatsapp.net, @lid, and device IDs like :3@s.whatsapp.net)
  const phoneMatch = jid.match(/^(\d+)(@s\.whatsapp\.net|@lid|:[\d]+@s\.whatsapp\.net)$/);
  if (!phoneMatch) {
    stats.skipped++;
    return text;
  }

  const contactName = await resolveContactName(services, instanceId, jid, jidToName);
  if (!contactName) {
    stats.unresolved++;
    return text;
  }

  stats.resolved++;
  const nextText = text.replaceAll(`@${phoneMatch[1]}`, `@${contactName}`);
  if (nextText !== text) stats.replaced++;
  return nextText;
}

/**
 * Replace @phone mentions in text with actual contact names
 * Cache-aside pattern: Uses Baileys cache first, falls back to DB on miss
 */
async function replaceMentionsWithContactNames(
  services: Services,
  instanceId: string,
  text: string,
  mentionedJids: string[] | undefined,
  mentionedContacts: Array<{ jid: string; name?: string }> | undefined,
): Promise<string> {
  if (!mentionedJids?.length) return text;

  log.debug('Starting mention replacement', { mentionCount: mentionedJids.length });

  const jidToName = buildJidNameMap(mentionedContacts);
  const stats: MentionStats = { resolved: 0, replaced: 0, unresolved: 0, skipped: 0 };
  let replacedText = text;

  for (const jid of mentionedJids) {
    replacedText = await applyJidMentionReplacement(services, instanceId, jid, jidToName, replacedText, stats);
  }

  log.debug('Mention replacement complete', {
    original: text,
    replaced: replacedText,
    mentionCount: mentionedJids.length,
    resolvedCount: stats.resolved,
    replacedCount: stats.replaced,
    unresolvedCount: stats.unresolved,
    skippedCount: stats.skipped,
  });
  return replacedText;
}

/**
 * Collect message texts, wait for media processing, and resolve quoted messages.
 * Returns { messageTexts, mediaFiles } ready for the agent runner.
 */
async function prepareAgentContent(
  services: Services,
  instance: Instance,
  messages: BufferedMessage[],
): Promise<{ messageTexts: string[]; mediaFiles: ProviderFile[] }> {
  const chatId = messages[0]?.payload.chatId ?? '';
  const messageEntries: Array<{ text: string; messageKey: string | null }> = [];
  const messageKeyByIndex = new Map<number, string>();
  const mentionDataByMessageKey = new Map<
    string,
    {
      mentionedJids: string[] | undefined;
      mentionedContacts: Array<{ jid: string; name?: string }> | undefined;
    }
  >();

  for (const [index, msg] of messages.entries()) {
    const text = msg.payload.content?.text;
    if (!text) continue;

    const messageKey = msg.payload.externalId || `idx:${index}`;
    messageKeyByIndex.set(index, messageKey);
    messageEntries.push({ text, messageKey });

    const rawPayload = msg.payload.rawPayload as Record<string, unknown> | undefined;
    mentionDataByMessageKey.set(messageKey, {
      mentionedJids: rawPayload?.mentionedJids as string[] | undefined,
      mentionedContacts: rawPayload?.mentionedContacts as Array<{ jid: string; name?: string }> | undefined,
    });
  }

  for (const entry of messageEntries) {
    if (!entry.messageKey) continue;
    const mentionData = mentionDataByMessageKey.get(entry.messageKey);
    if (!mentionData?.mentionedJids || mentionData.mentionedJids.length === 0) continue;

    entry.text = await replaceMentionsWithContactNames(
      services,
      instance.id,
      entry.text,
      mentionData.mentionedJids,
      mentionData.mentionedContacts,
    );
  }

  const processedMediaTexts: string[] = [];
  const mediaFiles = extractMediaFiles(messages, instance.agentSendMediaPath);

  if (instance.agentWaitForMedia) {
    const processed = await collectProcessedMedia(services, instance, messages);
    processedMediaTexts.push(...processed);
    // Keep mediaFiles — agent gets both processed text AND file references
  }

  await prependQuotedContext(services, instance.id, chatId, messages, messageEntries, messageKeyByIndex);

  const finalTexts = messageEntries.map((entry) => entry.text);
  finalTexts.push(...processedMediaTexts);

  return { messageTexts: finalTexts, mediaFiles };
}

/**
 * Resolve person ID by waiting for message-persistence to create the identity.
 * Polls the identity table up to 2s (10 x 200ms) before giving up.
 */
async function resolvePersonId(
  services: Services,
  channel: ChannelType,
  instanceId: string,
  senderId: string,
  metadataPersonId?: string,
): Promise<string | undefined> {
  if (metadataPersonId) return metadataPersonId;
  if (!senderId) return undefined;

  for (let attempt = 0; attempt < 10; attempt++) {
    const identity = await services.persons.getIdentityByPlatformId(channel, instanceId, senderId);
    if (identity?.personId) return identity.personId;
    await sleep(200);
  }

  return undefined;
}

/**
 * Fetch sender identity metadata (avatar URL, username)
 */
async function fetchSenderMetadata(
  services: Services,
  channel: ChannelType,
  instanceId: string,
  senderId: string,
): Promise<{ avatarUrl?: string; platformUsername?: string }> {
  try {
    const identity = await services.persons.getIdentityByPlatformId(channel, instanceId, senderId);
    return {
      avatarUrl: identity?.profilePicUrl ?? undefined,
      platformUsername: identity?.platformUsername ?? undefined,
    };
  } catch (error) {
    log.debug('Failed to fetch sender identity metadata', { error: String(error) });
    return {};
  }
}

/**
 * Fetch chat metadata for groups (name, participant count)
 */
async function fetchChatMetadata(
  services: Services,
  instanceId: string,
  chatId: string,
  chatType: string,
): Promise<{ chatName?: string; participantCount?: number }> {
  if (chatType !== 'group') return {};

  try {
    const chat = await services.chats.findByExternalIdSmart(instanceId, chatId);
    return {
      chatName: chat?.name ?? undefined,
      participantCount: chat?.participantCount ?? undefined,
    };
  } catch (error) {
    log.debug('Failed to fetch chat metadata', { error: String(error) });
    return {};
  }
}

// ─── Per-chatId stream guard ──────────────────────────────
const activeStreams = new Map<string, StreamSender>();

/** Route a single StreamDelta to the appropriate StreamSender method. */
async function routeStreamDelta(sender: StreamSender, delta: StreamDelta): Promise<void> {
  switch (delta.phase) {
    case 'thinking':
      await sender.onThinkingDelta(delta);
      break;
    case 'content':
      await sender.onContentDelta(delta);
      break;
    case 'final':
      await sender.onFinal(delta);
      break;
    case 'error':
      await sender.onError(delta);
      break;
  }
}

interface StreamCapabilities {
  provider: IAgentProvider & { triggerStream: (ctx: AgentTrigger) => AsyncGenerator<StreamDelta> };
  createSender: (
    instanceId: string,
    chatId: string,
    replyToMessageId?: string,
    chatType?: 'dm' | 'group' | 'channel',
    options?: { formatMode?: 'convert' | 'passthrough' },
  ) => StreamSender;
}

/** Check all preconditions for streaming dispatch. Returns null if any guard fails. */
async function resolveStreamingCapabilities(
  services: Services,
  instance: Instance,
  channel: ChannelType,
  chatId: string,
  traceId: string,
  db: Database,
): Promise<StreamCapabilities | null> {
  if (!instance.agentStreamMode) {
    log.debug('Stream guard: agentStreamMode is falsy', {
      instanceId: instance.id,
      agentStreamMode: instance.agentStreamMode,
      chatId,
    });
    return null;
  }

  const provider = await getAgentProvider(services, instance, db);
  if (!provider?.triggerStream) {
    log.debug('Stream guard: provider has no triggerStream', {
      instanceId: instance.id,
      hasProvider: !!provider,
      chatId,
    });
    return null;
  }

  const plugin = await getPlugin(channel);
  if (!plugin?.capabilities?.canStreamResponse || !plugin.createStreamSender) {
    log.debug('Stream guard: channel does not support streaming', {
      channel,
      canStream: plugin?.capabilities?.canStreamResponse,
      chatId,
    });
    return null;
  }

  const streamKey = `${instance.id}:${chatId}`;
  if (activeStreams.has(streamKey)) {
    log.info('Stream guard: parallel stream blocked, falling back to accumulate', {
      instanceId: instance.id,
      chatId,
      traceId,
    });
    return null;
  }

  return {
    provider: provider as StreamCapabilities['provider'],
    createSender: plugin.createStreamSender.bind(plugin),
  };
}

/**
 * Consume a streaming generator, routing each delta to the sender.
 *
 * Returns true if the stream should be treated as "handled" (no fallback needed).
 * Returns false only if an error occurred AND no content was sent yet — meaning the
 * fallback path should run so the user still gets a response.
 *
 * If content was already sent before the error, we return true to prevent a double
 * reply from the fallback path.
 */
async function consumeStream(
  generator: AsyncGenerator<StreamDelta>,
  sender: StreamSender,
  instanceId: string,
  chatId: string,
  traceId: string,
): Promise<boolean> {
  const startTime = Date.now();
  let hadError = false;
  let hadContent = false;

  for await (const delta of generator) {
    if (delta.phase === 'error') hadError = true;
    if (delta.phase === 'content' || delta.phase === 'final') hadContent = true;
    await routeStreamDelta(sender, delta);
  }

  log.info('Streaming response complete', {
    instanceId,
    chatId,
    durationMs: Date.now() - startTime,
    hadError,
    hadContent,
    traceId,
  });

  // If we already sent content to the user, treat as handled even on error.
  // Falling back would cause a double reply.
  return hadContent || !hadError;
}

/** Extract thread ID from the first buffered message rawPayload (for per_thread session strategy) */
function extractThreadId(messages: BufferedMessage[]): string | undefined {
  return ((messages[0]?.payload.rawPayload ?? {}) as Record<string, unknown>).threadId as string | undefined;
}

/** Merge per-thread history context with DB-fetched context messages (extra comes first) */
function mergeContextMessages(extra: string[] | undefined, db: string[]): string[] {
  return extra?.length ? [...extra, ...db] : db;
}

/** Convert media files array to trigger files (undefined when empty) */
function toTriggerFiles(mediaFiles: ProviderFile[]): ProviderFile[] | undefined {
  return mediaFiles.length > 0 ? mediaFiles : undefined;
}

// ============================================================================
// Hook Helpers
// ============================================================================

/**
 * Execute before_agent_start hooks and return the (possibly modified) context.
 * Returns null on fast path (no hooks registered) or if structuredClone fails.
 *
 * NOTE: For v1, mutated model/provider/agentId values are logged but NOT applied
 * back into the dispatch flow. DEC-5 (provider/agentId allowlist validation via
 * DB lookup) is required before we can safely honour redirects.
 * TODO: wire mutated context values back into dispatch once allowlist infra exists.
 */
async function executeBeforeAgentStartHooks(
  instance: Instance & Partial<DispatchFields>,
  chatId: string,
  senderId: string,
  senderName: string | undefined,
  triggerType: AgentTriggerType,
  traceId: string,
  correlationId: string | undefined,
  files: ProviderFile[] | undefined,
): Promise<BeforeAgentStartContext | null> {
  const registry = getHookRegistry();
  const hookCount = registry.getHookCount(instance.id, 'before_agent_start');
  if (hookCount === 0) return null; // fast path — zero overhead when no hooks

  const context: BeforeAgentStartContext = {
    instanceId: instance.id,
    chatId,
    senderId,
    senderName,
    model: instance.agentId ?? undefined,
    provider: instance.agentProviderId ?? undefined,
    agentId: instance.agentId ?? undefined,
    triggerType,
    traceId,
    correlationId,
    files: files as unknown[] | undefined,
  };

  const result = await executeHooks(instance.id, 'before_agent_start', context, {
    timeoutMs: 2000,
    pipelineTimeoutMs: 15_000,
  });

  return result.context;
}

/**
 * Execute before_message_write hooks on response content.
 * Returns the (possibly transformed) content string.
 * Fast path: returns input content unchanged when no hooks are registered.
 */
async function executeBeforeMessageWriteHooks(instanceId: string, chatId: string, content: string): Promise<string> {
  const registry = getHookRegistry();
  const hookCount = registry.getHookCount(instanceId, 'before_message_write');
  if (hookCount === 0) return content; // fast path — zero overhead when no hooks

  const context: BeforeMessageWriteContext = {
    instanceId,
    chatId,
    content,
    direction: 'outbound' as const,
  };

  const result = await executeHooks(instanceId, 'before_message_write', context, {
    timeoutMs: 2000,
    pipelineTimeoutMs: 15_000,
  });

  return result.context.content;
}

/** Build an AgentTrigger for a message dispatch (shared by streaming and non-streaming paths) */
function buildMessageTrigger(
  traceId: string,
  triggerType: AgentTriggerType,
  rawEvent: AgentTrigger['event'],
  channel: ChannelType,
  instance: DispatchInstance,
  chatId: string,
  senderId: string,
  personId: string | undefined,
  senderName: string | undefined,
  messages: BufferedMessage[],
  messageTexts: string[],
  triggerFiles: ProviderFile[] | undefined,
  sessionId: string,
  allContextMessages: string[],
): AgentTrigger {
  const threadId = extractThreadId(messages);
  return {
    traceId,
    type: triggerType,
    event: rawEvent,
    source: {
      channelType: channel,
      instanceId: instance.id,
      chatId,
      messageId: messages[0]?.payload.externalId ?? '',
      threadId,
    },
    sender: {
      platformUserId: senderId,
      personId,
      displayName: senderName,
    },
    content: {
      text: messageTexts.join('\n'),
      files: triggerFiles,
      referencedMessageId: messages[0]?.payload.replyToId || undefined,
    },
    sessionId,
    contextMessages: allContextMessages.length > 0 ? allContextMessages : undefined,
  };
}

/**
 * Try streaming dispatch: provider.triggerStream() → StreamSender.
 * Returns true if handled via streaming, false to fall back to accumulate.
 */
async function dispatchViaStreamingProvider(
  services: Services,
  instance: DispatchInstance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  rawEvent: AgentTrigger['event'],
  db: Database,
  extraContextMessages?: string[],
): Promise<boolean> {
  const resolved = await resolveStreamingCapabilities(services, instance, channel, chatId, traceId, db);
  if (!resolved) return false;

  const { messageTexts, mediaFiles } = await prepareAgentContent(services, instance, messages);
  if (!messageTexts.length && !mediaFiles.length) return false;
  if (!messageTexts.length && mediaFiles.length) messageTexts.push('[Media message]');

  const rawThreadId = extractThreadId(messages);
  const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_chat', senderId, chatId, rawThreadId);
  const rawPl = (messages[0]?.payload.rawPayload ?? {}) as Record<string, unknown>;
  const replyToId = messages[0]?.payload.replyToId ?? messages[0]?.payload.externalId;

  const currentMessageIds = messages.map((msg) => msg.payload.externalId).filter((id): id is string => !!id);
  const dbContextMessages = await buildContextMessages(services, instance, chatId, currentMessageIds);
  const allContextMessages = mergeContextMessages(extraContextMessages, dbContextMessages);
  const triggerFiles = toTriggerFiles(mediaFiles);

  // Fire before_agent_start hooks (observational for v1 — mutations logged but not applied)
  // TODO: wire mutated context values back once DEC-5 allowlist infra (provider/agentId validation) exists
  await executeBeforeAgentStartHooks(
    instance,
    chatId,
    senderId,
    senderName,
    triggerType,
    traceId,
    messages[0]?.metadata.correlationId,
    triggerFiles,
  );

  // TODO: before_message_write for streaming — batch after stream completes
  // (per-segment hooks would add latency; batch transform is the right approach)

  const trigger = buildMessageTrigger(
    traceId,
    triggerType,
    rawEvent,
    channel,
    instance,
    chatId,
    senderId,
    personId,
    senderName,
    messages,
    messageTexts,
    triggerFiles,
    sessionId,
    allContextMessages,
  );

  const chatType = determineChatType(chatId, channel, rawPl);
  const formatMode = (instance.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const sender = resolved.createSender(instance.id, chatId, replyToId, chatType, { formatMode });
  const streamKey = `${instance.id}:${chatId}`;
  activeStreams.set(streamKey, sender);

  const streamDispatchStart = Date.now();
  try {
    const generator = resolved.provider.triggerStream(trigger);

    // Error deltas (timeout, circuit-breaker) are not exceptions — they just
    // clean up the placeholder.  Return false so the caller falls back to the
    // accumulate-then-reply path and the user still gets a response.
    const streamResult = await consumeStream(generator, sender, instance.id, chatId, traceId);

    // Sentry metrics: streaming dispatch count and latency
    if (streamResult && sentryEnabled()) {
      const streamDurationMs = Date.now() - streamDispatchStart;
      Sentry.metrics.count('agent.dispatch', 1, {
        attributes: { provider_type: resolved.provider.schema },
      });
      Sentry.metrics.distribution('agent.dispatch.latency', streamDurationMs, {
        unit: 'millisecond',
        attributes: { provider_type: resolved.provider.schema },
      });
    }

    return streamResult;
  } catch (err) {
    log.error('Streaming dispatch failed, falling back', {
      instanceId: instance.id,
      chatId,
      error: String(err),
      traceId,
    });
    try {
      await sender.abort();
    } catch {
      // Best effort cleanup
    }
    return false;
  } finally {
    activeStreams.delete(streamKey);
  }
}

/**
 * Format media message content with emoji and descriptions/transcriptions
 */
function formatMediaContent(msg: {
  messageType: string;
  hasMedia?: boolean;
  textContent?: string | null;
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;
}): string {
  if (!msg.hasMedia) {
    return msg.textContent || '';
  }

  const mediaEmoji =
    {
      image: '🖼️',
      audio: '🎵',
      ptt: '🎤', // voice message
      video: '🎬',
      document: '📄',
      sticker: '😀',
    }[msg.messageType] || '📎';

  const mediaInfo: string[] = [mediaEmoji];

  // Add transcription for audio/voice
  if (msg.transcription) {
    mediaInfo.push(`"${msg.transcription}"`);
  }
  // Add description for images
  else if (msg.imageDescription) {
    mediaInfo.push(msg.imageDescription);
  }
  // Add description for videos
  else if (msg.videoDescription) {
    mediaInfo.push(msg.videoDescription);
  }
  // Add extraction for documents
  else if (msg.documentExtraction) {
    mediaInfo.push(msg.documentExtraction.substring(0, 200)); // truncate long extractions
  }

  // If there's a caption, add it
  if (msg.textContent) {
    mediaInfo.push(`Caption: ${msg.textContent}`);
  }

  return mediaInfo.join(' ');
}

/**
 * Build context messages from recent chat history for group and DM conversations.
 * Returns messages since the last bot response, formatted as "[Name - time] message"
 */
async function buildContextMessages(
  services: Services,
  instance: Instance,
  chatId: string,
  currentMessageIds: string[],
): Promise<string[]> {
  try {
    // Per-instance configurable limit, capped at 200 (0 = disabled)
    const historyLimit = Math.min(Math.max(instance.groupHistorySize ?? 50, 0), 200);
    if (historyLimit === 0) return [];

    // chatId here is the external JID, not internal UUID
    const chat = await services.chats.findByExternalIdSmart(instance.id, chatId);
    if (!chat) {
      return [];
    }

    // DMs use a smaller context window (cap at 20) to keep context focused
    const effectiveLimit = chat.chatType === 'group' ? historyLimit : Math.min(historyLimit, DM_HISTORY_LIMIT);

    // Query recent messages (configurable limit, ordered by timestamp desc by default)
    // Use the internal chat.id (UUID) for the query
    const messagesResult = await services.messages.list({
      chatId: chat.id,
      limit: effectiveLimit,
    });

    const recentMessages = messagesResult.items;

    if (!recentMessages || recentMessages.length === 0) {
      return [];
    }

    const lastBotMessageIndex = recentMessages.findIndex((msg) => msg.isFromMe === true);
    const currentMessageIdSet = new Set(currentMessageIds.filter(Boolean));
    let contextMsgs: typeof recentMessages;

    if (chat.chatType !== 'group') {
      // DMs: include recent messages from BOTH sides (user + bot)
      // This ensures the agent sees messages sent outside its own session
      // (e.g., via `omni send` from terminal or other agents)
      contextMsgs = recentMessages.filter((msg) => !currentMessageIdSet.has(msg.externalId));
    } else {
      // Groups: only include messages since last bot response (existing behavior)
      if (lastBotMessageIndex === -1 || lastBotMessageIndex === 0) {
        return [];
      }
      contextMsgs = recentMessages
        .slice(0, lastBotMessageIndex)
        .filter((msg) => !currentMessageIdSet.has(msg.externalId));
    }

    if (contextMsgs.length === 0) {
      return [];
    }

    // Format as "[Name - HH:MM] message" (reverse to chronological order)
    return contextMsgs.reverse().map((msg) => {
      const name = msg.senderDisplayName || msg.senderPlatformUserId || 'Unknown';
      const time = msg.platformTimestamp
        ? new Date(msg.platformTimestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : '';

      const text = formatMediaContent(msg) || `[${msg.messageType}]`;

      return `[${name}${time ? ` - ${time}` : ''}] ${text}`;
    });
  } catch (error) {
    log.warn('Failed to build context messages', { error, chatId, instanceId: instance.id });
    return [];
  }
}

/** Record a journey checkpoint when tracking is active for this correlationId. */
function recordJourneyCheckpoint(correlationId: string | undefined, stage: string, stageName: string): void {
  if (!correlationId) return;
  const tracker = getJourneyTracker();
  if (tracker.isTracking(correlationId)) {
    tracker.recordCheckpoint(correlationId, stage, stageName);
  }
}

/**
 * T10: Forward agent response parts to a chained instance via the internal channel plugin.
 * Extracted to keep dispatchViaProvider below the complexity limit.
 */
async function forwardToChainedInstance(
  instance: Instance,
  parts: string[],
  correlationId: string | undefined,
  messages: BufferedMessage[],
): Promise<void> {
  if (instance.chainMode === 'off' || !instance.agentChainToInstanceId) return;
  const internalPlugin = await getPlugin('internal');
  if (!internalPlugin) return;
  // Propagate hop count carried in rawPayload (0 for external triggers)
  const hopCount = (messages[0]?.payload.rawPayload?.hopCount as number | undefined) ?? 0;
  for (const part of parts) {
    await internalPlugin.sendMessage(instance.agentChainToInstanceId, {
      to: instance.agentChainToInstanceId,
      content: { type: 'text', text: part },
      metadata: { sourceInstanceId: instance.id, chainMode: instance.chainMode, hopCount },
    });
  }
  if (correlationId) recordJourneyCheckpoint(correlationId, 'T10', 'internal_chain_forwarded');
}

/**
 * Try IAgentProvider dispatch first, return true if handled.
 * Falls back to legacy agentRunner.run() if provider not resolved.
 */
async function dispatchViaProvider(
  services: Services,
  instance: DispatchInstance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  rawEvent: AgentTrigger['event'],
  db: Database,
  extraContextMessages?: string[],
  senderAgentId?: string,
): Promise<boolean> {
  const provider = await getAgentProvider(services, instance, db);
  if (!provider) return false;

  const { messageTexts, mediaFiles } = await prepareAgentContent(services, instance, messages);

  if (!messageTexts.length && !mediaFiles.length) {
    log.debug('No text or media content for provider trigger, skipping');
    return false;
  }

  // Ensure provider always gets at least a placeholder for media-only messages
  if (!messageTexts.length && mediaFiles.length) {
    messageTexts.push('[Media message]');
  }

  const rawThreadId = extractThreadId(messages);
  const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_chat', senderId, chatId, rawThreadId);

  // Build context messages for group and DM conversations (messages since last bot response)
  const currentMessageIds = messages.map((msg) => msg.payload.externalId).filter((id): id is string => !!id);
  const dbContextMessages = await buildContextMessages(services, instance, chatId, currentMessageIds);
  const allContextMessages = mergeContextMessages(extraContextMessages, dbContextMessages);
  const triggerFiles = toTriggerFiles(mediaFiles);

  // Fire before_agent_start hooks (observational for v1 — mutations logged but not applied)
  // TODO: wire mutated context values back once DEC-5 allowlist infra (provider/agentId validation) exists
  await executeBeforeAgentStartHooks(
    instance,
    chatId,
    senderId,
    senderName,
    triggerType,
    traceId,
    messages[0]?.metadata.correlationId,
    triggerFiles,
  );

  const trigger = buildMessageTrigger(
    traceId,
    triggerType,
    rawEvent,
    channel,
    instance,
    chatId,
    senderId,
    personId,
    senderName,
    messages,
    messageTexts,
    triggerFiles,
    sessionId,
    allContextMessages,
  );

  const correlationId = messages[0]?.metadata.correlationId;
  const dispatchStart = Date.now();
  const result = await provider.trigger(trigger);
  const dispatchDurationMs = Date.now() - dispatchStart;

  // Sentry metrics: agent dispatch count and latency
  if (sentryEnabled()) {
    Sentry.metrics.count('agent.dispatch', 1, { attributes: { provider_type: provider.schema } });
    Sentry.metrics.distribution('agent.dispatch.latency', dispatchDurationMs, {
      unit: 'millisecond',
      attributes: { provider_type: provider.schema },
    });
  }

  if (result && result.parts.length > 0) {
    const selfChat = isSelfChat(chatId, instance.ownerIdentifier);
    const rawParts = selfChat ? result.parts.map((p) => `${BOT_PREFIX}${p}`) : result.parts;
    // Apply before_message_write hooks to each response part before sending
    const parts = await Promise.all(rawParts.map((part) => executeBeforeMessageWriteHooks(instance.id, chatId, part)));
    const _fmtMode = (instance.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
    const replyTo = messages[0]?.payload.replyToId ?? messages[0]?.payload.externalId;

    // T8: Processing send request
    recordJourneyCheckpoint(correlationId, 'T8', JOURNEY_STAGES.T8);

    await sendResponseParts(
      channel,
      instance.id,
      chatId,
      parts,
      getSplitDelayConfig(instance),
      _fmtMode,
      replyTo,
      correlationId,
      senderAgentId,
    );

    // T9: Outbound sent via plugin
    recordJourneyCheckpoint(correlationId, 'T9', JOURNEY_STAGES.T9);

    // T10: Agent chaining — forward response to chained instance if configured
    await forwardToChainedInstance(instance, parts, correlationId, messages);
  }

  log.info('Agent response via IAgentProvider', {
    instanceId: instance.id,
    chatId,
    parts: result?.parts.length ?? 0,
    providerId: result?.metadata.providerId,
    durationMs: result?.metadata.durationMs,
    triggerType,
    traceId,
  });

  return true;
}

/**
 * Legacy fallback: dispatch via agentRunner.run()
 */
async function dispatchViaLegacy(
  services: Services,
  instance: DispatchInstance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  perThreadExtraContext?: string[],
  senderAgentId?: string,
): Promise<void> {
  const { messageTexts, mediaFiles } = await prepareAgentContent(services, instance, messages);

  if (perThreadExtraContext?.length) {
    log.warn('per_thread context available but legacy dispatch path has limited support — prepending as text', {
      instanceId: instance.id,
      contextCount: perThreadExtraContext.length,
    });
    messageTexts.unshift(...perThreadExtraContext);
  }

  if (!messageTexts.length && !mediaFiles.length) {
    log.debug('No text or media content in messages, skipping agent call');
    return;
  }

  if (!messageTexts.length && mediaFiles.length) {
    messageTexts.push('[Media message]');
  }

  // Determine chat type and fetch metadata
  const rawPl = (messages[0]?.payload.rawPayload ?? {}) as Record<string, unknown>;
  const chatType = determineChatType(chatId, instance.channel, rawPl);
  const { avatarUrl: senderAvatarUrl, platformUsername: senderPlatformUsername } = await fetchSenderMetadata(
    services,
    channel,
    instance.id,
    senderId,
  );
  const { chatName, participantCount } = await fetchChatMetadata(services, instance.id, chatId, chatType);

  // Fire before_agent_start hooks (observational for v1 — mutations logged but not applied)
  // TODO: wire mutated context values back once DEC-5 allowlist infra (provider/agentId validation) exists
  await executeBeforeAgentStartHooks(
    instance,
    chatId,
    senderId,
    senderName,
    triggerType,
    traceId,
    messages[0]?.metadata.correlationId,
    mediaFiles.length > 0 ? (mediaFiles as unknown as ProviderFile[]) : undefined,
  );

  const result = await services.agentRunner.run({
    instance,
    chatId,
    personId,
    senderId,
    senderName,
    senderAvatarUrl,
    senderPlatformUsername,
    chatType,
    chatName,
    participantCount,
    messages: messageTexts,
    files: mediaFiles.length > 0 ? mediaFiles : undefined,
  });

  const correlationId = messages[0]?.metadata.correlationId;
  const selfChat = isSelfChat(chatId, instance.ownerIdentifier);
  const rawParts = selfChat ? result.parts.map((p) => `${BOT_PREFIX}${p}`) : result.parts;

  // Apply before_message_write hooks to each response part before sending
  const parts = await Promise.all(rawParts.map((part) => executeBeforeMessageWriteHooks(instance.id, chatId, part)));

  const _fmtMode = (instance.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const replyTo = messages[0]?.payload.replyToId ?? messages[0]?.payload.externalId;

  // T8: Processing send request
  recordJourneyCheckpoint(correlationId, 'T8', JOURNEY_STAGES.T8);

  await sendResponseParts(
    channel,
    instance.id,
    chatId,
    parts,
    getSplitDelayConfig(instance),
    _fmtMode,
    replyTo,
    correlationId,
    senderAgentId,
  );

  // T9: Outbound sent via plugin
  recordJourneyCheckpoint(correlationId, 'T9', JOURNEY_STAGES.T9);

  log.info('Agent response via legacy runner', {
    instanceId: instance.id,
    chatId,
    parts: result.parts.length,
    runId: result.metadata.runId,
    triggerType,
    traceId,
  });
}

// ============================================================================
// Session Activity Store (singleton for session reset tracking)
// ============================================================================

const sessionActivityStore = new InMemorySessionActivityStore();

/** Execute provider-level session reset and publish the session.reset event. */
async function performSessionReset(
  instance: Instance,
  sessionId: string,
  chatId: string,
  services: Services,
  db: Database,
  channel: ChannelType,
  eventBus: EventBus,
  resetStrategy: string,
  resetChatType: 'dm' | 'group' | 'thread',
  traceId: string | undefined,
): Promise<void> {
  let sessionActuallyReset = false;
  try {
    const provider = await getAgentProvider(services, instance, db);
    if (provider?.resetSession) {
      await provider.resetSession(sessionId, chatId, instance.id);
      sessionActuallyReset = true;
    } else if (!provider) {
      // No IAgentProvider configured — legacy agentRunner path; no provider-level
      // session state to clear, so treat the reset as complete.
      sessionActuallyReset = true;
    }
    // provider exists but lacks resetSession → session not actually cleared; do not record.
  } catch (err) {
    log.warn('Failed to reset provider session', { error: String(err), instanceId: instance.id, sessionId });
  }

  if (sessionActuallyReset) {
    sessionActivityStore.recordReset(instance.id, sessionId, Date.now());

    // DEC-6: Mandatory session.reset event — include routing metadata so the SESSION
    // JetStream stream (session.>) captures it and typed subscribers receive it.
    eventBus
      .publish(
        'session.reset',
        { instanceId: instance.id, sessionId, timestamp: Date.now() },
        { instanceId: instance.id, channelType: channel },
      )
      .catch((err) => {
        log.warn('Failed to publish session.reset event', { error: String(err), instanceId: instance.id, sessionId });
      });

    log.info('Session reset triggered', {
      instanceId: instance.id,
      sessionId,
      strategy: resetStrategy,
      chatType: resetChatType,
      traceId,
    });
  }
}

/** Resolve chat type, check session reset policy, and record activity. */
async function handleSessionReset(
  firstMessage: BufferedMessage,
  instance: Instance,
  channel: ChannelType,
  senderId: string,
  chatId: string,
  services: Services,
  db: Database,
  eventBus: EventBus,
  traceId: string | undefined,
): Promise<void> {
  const inst = instance as Record<string, unknown>;
  const msgRawPayload = firstMessage.payload.rawPayload ?? {};

  const resolvedChatType = determineChatType(chatId, channel, msgRawPayload as Record<string, unknown>);

  // Classify as 'thread' when the message is from a thread channel.
  // The SDK top-level threadId field is set by some channels; Discord and others
  // store thread membership in rawPayload.isThread (message is inside a thread
  // channel) or rawPayload.threadId (thread identifier).
  const hasThread = !!(firstMessage.payload.threadId || msgRawPayload.isThread || msgRawPayload.threadId);

  // Map 'channel' → 'group' for session reset purposes (broadcast channels behave
  // like groups).  Thread takes precedence over group/dm classification.
  const resetChatType: 'dm' | 'group' | 'thread' = hasThread
    ? 'thread'
    : resolvedChatType === 'channel'
      ? 'group'
      : resolvedChatType;

  const rawThreadIdForReset = (msgRawPayload as Record<string, unknown>).threadId as string | undefined;
  const sessionId = computeSessionId(
    instance.agentSessionStrategy ?? 'per_chat',
    senderId,
    chatId,
    rawThreadIdForReset,
  );
  const sessionResetConfig = inst.sessionReset as SessionResetConfig | null;
  const activity = sessionActivityStore.getActivity(instance.id, sessionId);
  const resetResult = checkSessionReset(sessionResetConfig, resetChatType, activity);

  if (resetResult.shouldReset) {
    // Await provider session reset before proceeding to dispatch so that the first
    // post-reset turn sees a clean context. A detached promise would race with the
    // provider dispatch and the incoming message could still use stale history.
    //
    // Only advance lastResetAt when the session was actually cleared.  For providers
    // without resetSession (e.g. Agno, Webhook) the conversation context is not
    // cleared, so recording a reset would incorrectly suppress future reset attempts
    // while leaving stale context active.
    await performSessionReset(
      instance,
      sessionId,
      chatId,
      services,
      db,
      channel,
      eventBus,
      resetResult.strategy,
      resetChatType,
      traceId,
    );
  }

  // Record activity for session tracking (sliding window for idle reset)
  sessionActivityStore.recordActivity(instance.id, sessionId, Date.now());
}

// ============================================================================
// Per-Thread Session Tracking
// ============================================================================

/**
 * Check whether a per_thread session has been initialized for this instance/thread.
 * Uses the agentSessions table with a dedicated 'thread_init:' key prefix.
 */
async function checkPerThreadSessionExists(db: Database, instanceId: string, sessionId: string): Promise<boolean> {
  const initKey = `thread_init:${sessionId}`;
  const result = await db
    .select({ instanceId: agentSessions.instanceId })
    .from(agentSessions)
    .where(and(eq(agentSessions.instanceId, instanceId), eq(agentSessions.sessionKey, initKey)))
    .limit(1);
  return result.length > 0;
}

/**
 * Mark a per_thread session as initialized in the DB.
 * Called after the first lazy-init dispatch so subsequent triggers skip history fetch.
 */
async function markPerThreadSessionInitialized(db: Database, instanceId: string, sessionId: string): Promise<void> {
  const initKey = `thread_init:${sessionId}`;
  const now = new Date();
  await db
    .insert(agentSessions)
    .values({
      instanceId,
      sessionKey: initKey,
      providerSessionData: { initialized: true, initializedAt: now.toISOString() },
      lastUsedAt: now,
      expiresAt: null,
    })
    .onConflictDoUpdate({
      target: [agentSessions.instanceId, agentSessions.sessionKey],
      set: { lastUsedAt: now, updatedAt: now },
    });
  log.info('per_thread session initialized', { instanceId, sessionId });
}

// ============================================================================
// Per-Thread Lazy Init: History Fetch + Media Processing
// ============================================================================

/** Emoji icons for media processing start/end reactions */
const PROC_REACT_START: Record<string, string> = { audio: '🎧', image: '👀', video: '👀', document: '👀' };
const PROC_REACT_DONE = '✅';

/**
 * Determine the content-type category from a MIME type string.
 */
function mimeToContentType(mimeType: string): 'audio' | 'image' | 'video' | 'document' {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Download a URL to a temp file and return the local path.
 * Returns null on any error (graceful degradation).
 */
async function downloadToTempFile(url: string, mimeType: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = (mimeType.split('/')[1]?.split(';')[0] ?? 'bin').replace(/[^a-z0-9]/gi, '');
    const tmpPath = join(tmpdir(), `omni-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    await writeFile(tmpPath, buffer);
    return tmpPath;
  } catch {
    return null;
  }
}

/**
 * Download or resolve a media file and run it through the media processing service.
 * Returns the processed text content, or null if unavailable / processing failed.
 */
async function processMediaFile(
  msg: HistorySyncMessage,
  mimeType: string,
  mediaService: ReturnType<typeof createMediaProcessingService> | null,
): Promise<string | null> {
  let localPath = msg.content.localPath ?? null;
  let ownedTempFile = false;

  if (!localPath && msg.content.mediaUrl && mediaService) {
    localPath = await downloadToTempFile(msg.content.mediaUrl, mimeType);
    if (localPath) ownedTempFile = true;
  }

  if (!localPath || !mediaService) return null;

  try {
    const result = await mediaService.process(localPath, mimeType, { caption: msg.content.caption });
    return result.success && result.content ? result.content : null;
  } catch (err) {
    log.debug('Media processing failed for history message', { error: String(err), messageId: msg.externalId });
    return null;
  } finally {
    if (ownedTempFile) {
      unlink(localPath as string).catch(() => {});
    }
  }
}

/** Build the final formatted string for a history media message */
function buildHistoryMediaResult(
  header: string,
  icon: string,
  contentType: string,
  processedContent: string | null,
  caption: string | undefined,
  text: string | undefined,
): string {
  if (!processedContent) {
    return `${header} ${icon}: ${caption ?? text ?? `[${contentType}]`}`;
  }
  const suffix = caption ? ` (${caption})` : '';
  return `${header} ${icon}: ${processedContent}${suffix}`;
}

/**
 * Format a single history message as a context string, processing media when possible.
 */
async function processHistoryMessage(
  msg: HistorySyncMessage,
  mediaService: ReturnType<typeof createMediaProcessingService> | null,
  reactFn: ((msgId: string, emoji: string) => Promise<void>) | null,
  unreactFn: ((msgId: string, emoji: string) => Promise<void>) | null,
): Promise<string> {
  const timeStr = msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const header = `[${msg.from ?? 'Unknown'} - ${timeStr}]`;

  if (!msg.content.mimeType || (!msg.content.localPath && !msg.content.mediaUrl)) {
    return `${header} ${msg.content.text ?? ''}`.trim();
  }

  const mimeType = msg.content.mimeType;
  const contentType = mimeToContentType(mimeType);
  const icon = MEDIA_ICONS[contentType] ?? '📎';
  const startEmoji = PROC_REACT_START[contentType] ?? '👀';

  if (reactFn) reactFn(msg.externalId, startEmoji).catch(() => {});

  const processedContent = await processMediaFile(msg, mimeType, mediaService);

  // Always remove start emoji; add done emoji only on success
  if (unreactFn) unreactFn(msg.externalId, startEmoji).catch(() => {});
  if (processedContent && reactFn) reactFn(msg.externalId, PROC_REACT_DONE).catch(() => {});

  return buildHistoryMediaResult(header, icon, contentType, processedContent, msg.content.caption, msg.content.text);
}

/**
 * Fetch thread history, process media files, and return formatted context messages.
 * Called on the first trigger of a per_thread session (lazy init).
 */
async function fetchAndProcessThreadHistory(
  services: Services,
  instance: Instance,
  channel: ChannelType,
  chatId: string,
  threadId: string,
): Promise<string[]> {
  const plugin = await getPlugin(channel);
  if (!plugin?.fetchHistory) {
    log.debug('Channel plugin does not support fetchHistory', { instanceId: instance.id, channel });
    return [];
  }

  let historyResult: FetchHistoryResult;
  try {
    historyResult = await plugin.fetchHistory(instance.id, {
      channelId: chatId,
      threadId,
      limit: 200,
    });
  } catch (err) {
    log.warn('fetchHistory failed, proceeding without thread context', {
      error: String(err),
      instanceId: instance.id,
      channel,
    });
    return [];
  }

  // Build MediaProcessingService if API keys are configured
  let mediaService: ReturnType<typeof createMediaProcessingService> | null = null;
  try {
    const [groqApiKey, openaiApiKey, geminiApiKey] = await Promise.all([
      services.settings.getSecret('groq.api_key', 'GROQ_API_KEY'),
      services.settings.getSecret('openai.api_key', 'OPENAI_API_KEY'),
      services.settings.getSecret('gemini.api_key', 'GEMINI_API_KEY'),
    ]);
    if (groqApiKey || openaiApiKey || geminiApiKey) {
      mediaService = createMediaProcessingService({ groqApiKey, openaiApiKey, geminiApiKey });
    }
  } catch {
    // Non-fatal: proceed without media processing
  }

  const boundReact = plugin.react?.bind(plugin);
  const boundUnreact = plugin.unreact?.bind(plugin);
  const reactFn = boundReact ? (msgId: string, emoji: string) => boundReact(instance.id, chatId, msgId, emoji) : null;
  const unreactFn = boundUnreact
    ? (msgId: string, emoji: string) => boundUnreact(instance.id, chatId, msgId, emoji)
    : null;

  // Process messages in parallel (with a cap of 5 concurrent media jobs)
  const CONCURRENCY = 5;
  const contextMessages: string[] = [];
  const mediaMessages = historyResult.messages.filter((m) => !m.isFromMe);

  // Process in batches to cap concurrency
  for (let i = 0; i < mediaMessages.length; i += CONCURRENCY) {
    const batch = mediaMessages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((msg) => processHistoryMessage(msg, mediaService, reactFn, unreactFn)));
    contextMessages.push(...results);
  }

  log.info('Thread history fetched', {
    instanceId: instance.id,
    channel,
    chatId,
    threadId,
    totalMessages: historyResult.totalFetched,
    contextMessages: contextMessages.length,
  });

  return contextMessages;
}

/**
 * Handle the first trigger in a per_thread session:
 * fetch history, process media, mark session initialized, return context messages.
 */
async function handlePerThreadLazyInit(
  services: Services,
  instance: Instance,
  channel: ChannelType,
  chatId: string,
  threadId: string,
  sessionId: string,
  db: Database,
): Promise<string[]> {
  log.info('per_thread lazy init', {
    instanceId: instance.id,
    channel,
    chatId,
    threadId,
    sessionId,
  });

  const contextMessages = await fetchAndProcessThreadHistory(services, instance, channel, chatId, threadId);

  // Persist the init marker so subsequent triggers skip history fetch
  try {
    await markPerThreadSessionInitialized(db, instance.id, sessionId);
  } catch (err) {
    log.warn('Failed to mark per_thread session initialized', {
      error: String(err),
      instanceId: instance.id,
      sessionId,
    });
  }

  return contextMessages;
}

/**
 * If the instance uses per_thread strategy and this is the first trigger for the thread,
 * fetch and process thread history and return it as extra context messages.
 * Returns undefined if no lazy init is needed.
 */
async function resolvePerThreadExtraContext(
  db: Database,
  services: Services,
  instance: Instance,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  firstMessage: BufferedMessage,
): Promise<string[] | undefined> {
  const strategy = instance.agentSessionStrategy ?? 'per_chat';
  const rawThreadId = (firstMessage.payload.rawPayload as Record<string, unknown>)?.threadId as string | undefined;
  if (strategy !== 'per_thread' || !rawThreadId) return undefined;
  const sessionId = computeSessionId('per_thread', senderId, chatId, rawThreadId);
  const sessionExists = await checkPerThreadSessionExists(db, instance.id, sessionId);
  if (sessionExists) return undefined;
  return handlePerThreadLazyInit(services, instance, channel, chatId, rawThreadId, sessionId, db);
}

/**
 * omni-930 phase 3: Resolve the agent entity UUID for a dispatched message.
 * instance.agentId is the UUID FK to agents.
 */
async function resolveDispatchSenderAgentId(_db: Database, instance: Instance): Promise<string | undefined> {
  return instance.agentId ?? undefined;
}

function buildAckConfig(instance: DispatchInstance): ReactionAckConfig {
  const inst = instance as unknown as Record<string, unknown>;
  return {
    reactionAck: (inst.reactionAck as 'off' | 'on') ?? 'off',
    reactionAckEmoji: inst.reactionAckEmoji as ReactionAckConfig['reactionAckEmoji'],
    ackTimeoutMs: (inst.ackTimeoutMs as number) ?? 30_000,
  };
}

async function dispatchToAgent(
  services: Services,
  instance: DispatchInstance,
  msgs: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  senderAgentId: string | undefined,
  perThreadExtraContext: string[] | undefined,
  db: Database,
): Promise<void> {
  // TODO(P1): rawEvent is MessageReceivedPayload, not OmniEvent. The double cast hides
  // a type mismatch. BufferedMessage doesn't carry the original NATS event envelope.
  const firstMsg = msgs[0];
  if (!firstMsg) return;
  const rawEvent = firstMsg.payload as unknown as AgentTrigger['event'];
  let handled = false;
  try {
    handled = await dispatchViaStreamingProvider(
      services,
      instance,
      msgs,
      triggerType,
      channel,
      chatId,
      senderId,
      personId,
      senderName,
      traceId,
      rawEvent,
      db,
      perThreadExtraContext,
    );
    if (!handled) {
      handled = await dispatchViaProvider(
        services,
        instance,
        msgs,
        triggerType,
        channel,
        chatId,
        senderId,
        personId,
        senderName,
        traceId,
        rawEvent,
        db,
        perThreadExtraContext,
        senderAgentId,
      );
    }
  } catch (providerError) {
    log.error('Provider dispatch failed, falling back to legacy', {
      instanceId: instance.id,
      chatId,
      error: String(providerError),
      traceId,
    });
  }

  if (handled) return;

  log.debug('No IAgentProvider resolved or provider failed, using legacy agentRunner path', {
    instanceId: instance.id,
  });
  await dispatchViaLegacy(
    services,
    instance,
    msgs,
    triggerType,
    channel,
    chatId,
    senderId,
    personId,
    senderName,
    traceId,
    perThreadExtraContext,
    senderAgentId,
  );
}

async function processAgentResponse(
  services: Services,
  instance: DispatchInstance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  db: Database,
  eventBus: EventBus,
): Promise<void> {
  const firstMessage = messages[0];
  if (!firstMessage) return;

  const chatId = firstMessage.payload.chatId;
  const senderId = firstMessage.payload.from ?? '';
  const channel = (firstMessage.metadata.channelType ?? 'whatsapp') as ChannelType;
  const traceId = firstMessage.metadata.traceId ?? '';

  // ── Reaction Ack (pre-processing, fire-and-forget) ──
  const plugin = (await getPlugin(channel)) ?? null;
  const ackProvider = createPluginAckProvider(plugin);
  const messageId = firstMessage.payload.externalId ?? '';
  const ackHandle: AckHandle = startAck(
    plugin,
    ackProvider,
    instance.id,
    chatId,
    messageId,
    channel,
    buildAckConfig(instance),
  );

  // Resolve person ID (waits for message-persistence to create identity)
  const personId = await resolvePersonId(services, channel, instance.id, senderId, firstMessage.metadata.personId);
  if (!personId) {
    log.warn('Could not resolve person ID, skipping agent', { instanceId: instance.id, chatId, senderId });
    ackHandle.remove();
    return;
  }

  // ── Session Reset Check + Activity Recording (post-personId guard) ──
  await handleSessionReset(firstMessage, instance, channel, senderId, chatId, services, db, eventBus, traceId);

  const rawPayload = firstMessage.payload.rawPayload ?? {};
  const pushName = (rawPayload.pushName as string) ?? (rawPayload.displayName as string);
  const senderName = await services.agentRunner.getSenderName(personId, pushName);
  const senderAgentId = await resolveDispatchSenderAgentId(db, instance);

  log.info('Dispatching to agent', {
    instanceId: instance.id,
    chatId,
    messageCount: messages.length,
    triggerType,
    traceId,
    senderName,
    senderAgentId,
  });

  await sendTypingPresence(channel, instance.id, chatId, 'composing');

  // ── Auto-ack text message (pre-dispatch, fire-and-forget) ──
  const inst = instance as unknown as Record<string, unknown>;
  const agentAckMessage = (inst.agentAckMessage as string) ?? null;
  if (agentAckMessage) {
    sendTextMessage(channel, instance.id, chatId, agentAckMessage).catch((err) => {
      log.warn('Failed to send agent ack message', { instanceId: instance.id, chatId, error: String(err) });
    });
  }

  // ── Per-thread lazy init ──
  const perThreadExtraContext = await resolvePerThreadExtraContext(
    db,
    services,
    instance,
    channel,
    chatId,
    senderId,
    firstMessage,
  );

  try {
    await dispatchToAgent(
      services,
      instance,
      messages,
      triggerType,
      channel,
      chatId,
      senderId,
      personId,
      senderName,
      traceId,
      senderAgentId,
      perThreadExtraContext,
      db,
    );
  } catch (error) {
    log.error('Failed to process agent response', {
      instanceId: instance.id,
      chatId,
      error: String(error),
      traceId,
    });
    sendErrorFeedback(channel, instance.id, chatId, error).catch(() => {});
  } finally {
    ackHandle.remove();
    await sendTypingPresence(channel, instance.id, chatId, 'paused');
  }
}

// ============================================================================
// Provider Resolution
// ============================================================================

/** Cache of IAgentProvider instances by "providerId:instanceId" */
const providerCache = new Map<string, IAgentProvider>();

/** Shared OpenClaw WS clients keyed by provider DB ID (DEC-3: one connection per provider) */
const openclawClientPool = new Map<string, OpenClawClient>();

/** Create an OpenClaw-based agent provider */
function createOpenClawProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider {
  // DEC-3: Reuse shared WS client per provider ID
  let client = openclawClientPool.get(provider.id);
  if (!client) {
    const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
    // FIX-SCOPE: Pass device credentials from schemaConfig if present.
    // Without device credentials, the gateway strips all declared scopes for shared-token
    // connections, causing chat.send to fail with "missing scope: operator.write".
    const deviceConfig =
      schemaConfig.deviceId && schemaConfig.devicePublicKey && schemaConfig.devicePrivateKey && schemaConfig.deviceToken
        ? {
            id: schemaConfig.deviceId as string,
            publicKey: schemaConfig.devicePublicKey as string,
            privateKey: schemaConfig.devicePrivateKey as string,
            token: schemaConfig.deviceToken as string,
          }
        : undefined;

    const clientConfig: OpenClawClientConfig = {
      url: provider.baseUrl,
      token: provider.apiKey ?? '',
      providerId: provider.id,
      origin: (schemaConfig.origin as string) ?? undefined,
      device: deviceConfig,
    };
    client = new OpenClawClient(clientConfig);
    client.start(); // DEC-14: lazy connect — starts WS in background
    openclawClientPool.set(provider.id, client);
  }

  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
  const providerConfig: OpenClawProviderConfig = {
    defaultAgentId: (instance.agentInternalId ?? (schemaConfig.defaultAgentId as string) ?? 'default') as string,
    agentTimeoutMs: ((instance.agentTimeout ?? provider.defaultTimeout ?? 120) as number) * 1000,
    sendAckTimeoutMs: 10_000,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  };

  return new OpenClawAgentProvider(provider.id, provider.name, client, providerConfig);
}

/** Create an Agno-based agent provider */
function createAgnoProvider(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  if (!provider.apiKey) {
    log.warn('Provider has no API key, falling back to legacy path', { providerId: provider.id });
    return null;
  }

  const client = createProviderClient({
    schema: provider.schema,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;

  return new AgnoAgentProvider(provider.id, provider.name, client, {
    agentId: (instance.agentInternalId ?? schemaConfig.agentId ?? 'default') as string,
    agentType: (instance.agentType ?? 'agent') as 'agent' | 'team' | 'workflow',
    timeoutMs: (instance.agentTimeout ?? provider.defaultTimeout ?? 60) * 1000,
    enableAutoSplit: instance.enableAutoSplit ?? true,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  });
}

/** Create a Claude Code agent provider */
function createClaudeCodeProviderInstance(
  provider: AgentProvider,
  instance: DispatchInstance,
  db: Database,
): IAgentProvider {
  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
  const projectPath = schemaConfig.projectPath as string;

  if (!projectPath) {
    log.error('Claude Code provider missing projectPath', { providerId: provider.id });
    throw new Error('Claude Code provider requires schemaConfig.projectPath');
  }

  return new ClaudeCodeAgentProvider(
    provider.id,
    provider.name,
    {
      projectPath,
      apiKey: provider.apiKey ?? undefined,
      allowedTools: schemaConfig.allowedTools as string[] | undefined,
      permissionMode: schemaConfig.permissionMode as string | undefined as
        | 'default'
        | 'acceptEdits'
        | 'bypassPermissions'
        | 'plan'
        | undefined,
      model: schemaConfig.model as string | undefined,
      systemPrompt: schemaConfig.systemPrompt as string | undefined,
      mcpServers: schemaConfig.mcpServers as
        | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
        | undefined,
      maxTurns: schemaConfig.maxTurns as number | undefined,
    },
    createSessionStorage(db, provider.id),
    {
      timeoutMs: ((instance.agentTimeout ?? provider.defaultTimeout ?? 120) as number) * 1000,
      enableAutoSplit: instance.enableAutoSplit ?? true,
      prefixSenderName: instance.agentPrefixSenderName ?? true,
      streamConfig: schemaConfig.streamConfig as
        | {
            showToolCalls?: boolean;
            showThinking?: boolean;
            showToolProgress?: boolean;
            toolCallFormat?: 'compact' | 'verbose';
          }
        | undefined,
    },
  );
}

/** Create a webhook-based agent provider */
function createWebhookProvider(provider: AgentProvider): IAgentProvider {
  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;

  return new WebhookAgentProvider(provider.id, provider.name, {
    webhookUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? undefined,
    mode: (schemaConfig.mode as 'round-trip' | 'fire-and-forget') ?? 'round-trip',
    timeoutMs: (provider.defaultTimeout ?? 30) * 1000,
    retries: (schemaConfig.retries as number) ?? 1,
  });
}

/** Create an AG-UI agent provider */
function createAgUiProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  if (!provider.apiKey) {
    log.warn('AG-UI provider has no API key, falling back to legacy path', { providerId: provider.id });
    return null;
  }

  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
  const client = createProviderClient({
    schema: provider.schema,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  return new AgUiAgentProvider(provider.id, provider.name, client, {
    agentId: (instance.agentInternalId ?? schemaConfig.agentId ?? 'default') as string,
    timeoutMs: (instance.agentTimeout ?? provider.defaultTimeout ?? 60) * 1000,
    enableAutoSplit: instance.enableAutoSplit ?? true,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  });
}

/** Create an A2A agent provider */
function createA2AProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  if (!provider.apiKey) {
    log.warn('A2A provider has no API key, falling back to legacy path', { providerId: provider.id });
    return null;
  }

  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
  const client = createProviderClient({
    schema: provider.schema,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  return new A2AAgentProvider(provider.id, provider.name, client, {
    agentId: (instance.agentInternalId ?? schemaConfig.agentId ?? 'default') as string,
    timeoutMs: (instance.agentTimeout ?? provider.defaultTimeout ?? 60) * 1000,
    enableAutoSplit: instance.enableAutoSplit ?? true,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  });
}

/** Create a NATS Genie provider (publishes to NATS, no filesystem) */
function createNatsGenieProviderInstance(provider: AgentProvider, instance: DispatchInstance): IAgentProvider | null {
  const schemaConfig = (
    typeof provider.schemaConfig === 'object' && provider.schemaConfig !== null ? provider.schemaConfig : {}
  ) as Record<string, unknown>;

  const agentName = typeof schemaConfig.agentName === 'string' ? schemaConfig.agentName : '';
  if (!agentName) {
    log.error('NATS Genie provider missing agentName in schemaConfig', { providerId: provider.id });
    return null;
  }

  const natsUrl = typeof schemaConfig.natsUrl === 'string' ? schemaConfig.natsUrl : 'localhost:4222';
  const channel = instance.channel as ChannelType;

  const natsProvider = new NatsGenieProvider(provider.id, provider.name, {
    agentName,
    natsUrl,
    instanceId: instance.id,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
    onReply: async (chatId, content, metadata) => {
      try {
        await sendTextMessage(channel, instance.id, chatId, content);
      } catch (error) {
        log.error('Failed to deliver agent reply', {
          chatId,
          instanceId: instance.id,
          providerId: provider.id,
          agent: (metadata as Record<string, unknown>)?.agent,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // Fire subscription as a side effect — do not block provider resolution.
  // providerCache below caches by `${provider.id}:${instance.id}`, so this
  // only runs once per (provider, instance) pair.
  // Retries with exponential backoff (2s → 4s → 8s → … → 60s cap, max 10 attempts).
  const startWithRetry = async (attempt = 1): Promise<void> => {
    try {
      await natsProvider.startReplySubscription();
      log.info('NATS reply subscription started', { instanceId: instance.id, attempt });
    } catch (err) {
      const delay = Math.min(2000 * 2 ** (attempt - 1), 60_000);
      if (attempt < 10) {
        log.warn('NATS reply subscription failed, retrying', {
          instanceId: instance.id,
          providerId: provider.id,
          attempt,
          nextRetryMs: delay,
          error: err instanceof Error ? err.message : String(err),
        });
        setTimeout(() => startWithRetry(attempt + 1), delay);
      } else {
        log.error('NATS reply subscription permanently failed', {
          instanceId: instance.id,
          providerId: provider.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  startWithRetry();

  return natsProvider;
}

/**
 * Resolve an IAgentProvider from a DB provider record + instance config.
 * Returns null if the schema is not supported for the new provider abstraction.
 *
 * Exported for use by session-cleaner (provider.resetSession).
 */
export function resolveProvider(
  provider: AgentProvider,
  instance: DispatchInstance,
  db: Database,
): IAgentProvider | null {
  const cacheKey = `${provider.id}:${instance.id}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let agentProvider: IAgentProvider | null = null;

  switch (provider.schema) {
    case 'agno':
      agentProvider = createAgnoProvider(provider, instance);
      break;
    case 'webhook':
      agentProvider = createWebhookProvider(provider);
      break;
    case 'openclaw':
      agentProvider = createOpenClawProviderInstance(provider, instance);
      break;
    case 'claude-code':
      agentProvider = createClaudeCodeProviderInstance(provider, instance, db);
      break;
    case 'ag-ui':
      agentProvider = createAgUiProviderInstance(provider, instance);
      break;
    case 'a2a':
      agentProvider = createA2AProviderInstance(provider, instance);
      break;
    case 'nats-genie':
      agentProvider = createNatsGenieProviderInstance(provider, instance);
      break;
    default:
      log.debug('Provider schema not supported for IAgentProvider dispatch', {
        schema: provider.schema,
        providerId: provider.id,
      });
      return null;
  }

  if (!agentProvider) return null;

  providerCache.set(cacheKey, agentProvider);
  return agentProvider;
}

/**
 * Look up provider from DB and resolve to IAgentProvider.
 * Accepts DispatchInstance which carries the transient agentProviderId stamped by applyAgentFkOverrides.
 */
async function getAgentProvider(
  services: Services,
  instance: DispatchInstance,
  db: Database,
): Promise<IAgentProvider | null> {
  if (!instance.agentProviderId) return null;

  try {
    const provider = await services.providers.getById(instance.agentProviderId);

    if (!provider?.isActive) return null;

    return resolveProvider(provider, instance, db);
  } catch (error) {
    log.warn('Failed to resolve agent provider, falling back to legacy', {
      instanceId: instance.id,
      providerId: instance.agentProviderId,
      error: String(error),
    });
    return null;
  }
}

/**
 * omni-p7r: Apply agent entity overrides from the agentId FK on the instance/route.
 * Mutates effectiveInstance in-place with values from the Agent entity row.
 * Stamps transient dispatch fields (agentProviderId, agentType, agentInternalId) onto the copy.
 */
async function applyAgentFkOverrides(
  db: Database,
  agentFkId: string,
  effectiveInstance: DispatchInstance,
): Promise<void> {
  const [agentRow] = await db
    .select({
      id: agents.id,
      agentProviderId: agents.agentProviderId,
      agentType: agents.agentType,
      metadata: agents.metadata,
      configPath: agents.configPath,
    })
    .from(agents)
    .where(eq(agents.id, agentFkId))
    .limit(1);

  if (!agentRow) return;

  // Stamp transient dispatch fields from the Agent entity
  effectiveInstance.agentProviderId = agentRow.agentProviderId ?? effectiveInstance.agentProviderId;
  // Map agentType: AgentEntityType → AgentType
  // 'assistant'|'tool' → 'agent', 'workflow' → 'workflow', 'team' → 'team'
  const typeMap: Record<string, string> = { assistant: 'agent', tool: 'agent', workflow: 'workflow', team: 'team' };
  effectiveInstance.agentType = (typeMap[agentRow.agentType] ??
    effectiveInstance.agentType) as DispatchFields['agentType'];
  // Provider-internal agent name from metadata or configPath
  const providerAgentId = (agentRow.metadata as Record<string, unknown>)?.providerAgentId ?? agentRow.configPath;
  if (providerAgentId) effectiveInstance.agentInternalId = providerAgentId as string;
}

/**
 * Merge route overrides onto instance defaults. Null route fields inherit from instance.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat field-by-field merge, no branching logic
function mergeRouteOverrides(instance: Instance, route: ResolvedRoute): DispatchInstance {
  return {
    ...instance,
    agentTimeout: route.agentTimeout ?? instance.agentTimeout,
    agentStreamMode: route.agentStreamMode ?? instance.agentStreamMode,
    agentReplyFilter: (route.agentReplyFilter as Instance['agentReplyFilter']) ?? instance.agentReplyFilter,
    agentSessionStrategy:
      (route.agentSessionStrategy as Instance['agentSessionStrategy']) ?? instance.agentSessionStrategy,
    agentPrefixSenderName: route.agentPrefixSenderName ?? instance.agentPrefixSenderName,
    agentWaitForMedia: route.agentWaitForMedia ?? instance.agentWaitForMedia,
    agentSendMediaPath: route.agentSendMediaPath ?? instance.agentSendMediaPath,
    agentGateEnabled: route.agentGateEnabled ?? instance.agentGateEnabled,
    agentGateModel: route.agentGateModel ?? instance.agentGateModel,
    agentGatePrompt: route.agentGatePrompt ?? instance.agentGatePrompt,
    messageDebounceMode: (route.messageDebounceMode as Instance['messageDebounceMode']) ?? instance.messageDebounceMode,
    messageDebounceMinMs: route.messageDebounceMinMs ?? instance.messageDebounceMinMs,
    messageDebounceMaxMs: route.messageDebounceMaxMs ?? instance.messageDebounceMaxMs,
    messageDebounceGroupMs: route.messageDebounceGroupMs ?? instance.messageDebounceGroupMs,
    messageDebounceRestartOnTyping: route.messageDebounceRestartOnTyping ?? instance.messageDebounceRestartOnTyping,
    messageSplitDelayMode:
      (route.messageSplitDelayMode as Instance['messageSplitDelayMode']) ?? instance.messageSplitDelayMode,
    messageSplitDelayFixedMs: route.messageSplitDelayFixedMs ?? instance.messageSplitDelayFixedMs,
    messageSplitDelayMinMs: route.messageSplitDelayMinMs ?? instance.messageSplitDelayMinMs,
    messageSplitDelayMaxMs: route.messageSplitDelayMaxMs ?? instance.messageSplitDelayMaxMs,
    enableAutoSplit: route.enableAutoSplit ?? instance.enableAutoSplit,
    reactionAck: (route.reactionAck as Instance['reactionAck']) ?? instance.reactionAck,
    reactionAckEmoji: (route.reactionAckEmoji as Instance['reactionAckEmoji']) ?? instance.reactionAckEmoji,
    ackTimeoutMs: route.ackTimeoutMs ?? instance.ackTimeoutMs,
    agentAckMessage: route.agentAckMessage ?? instance.agentAckMessage,
  };
}

/**
 * omni-930 phase 3: Apply instance-level agentId (UUID FK) overrides and return the result.
 * Used as the no-route early-return path in resolveEffectiveInstance.
 */
async function applyInstanceFkAndReturn(
  db: Database,
  instance: Instance,
): Promise<{ instance: DispatchInstance; routeId: null }> {
  if (!instance.agentId) return { instance, routeId: null };
  const effectiveInstance: DispatchInstance = { ...instance };
  await applyAgentFkOverrides(db, instance.agentId, effectiveInstance);
  return { instance: effectiveInstance, routeId: null };
}

/**
 * Resolve effective instance by applying route overrides.
 * Resolution priority: chat route > user route > instance default
 *
 * @see agent-routing wish
 */
async function resolveEffectiveInstance(
  services: Services,
  db: Database,
  instance: Instance,
  chatId: string | undefined,
  personId?: string,
): Promise<{ instance: DispatchInstance; routeId: string | null }> {
  // If chatId is undefined (chat not found in DB), skip chat-scoped route resolution
  // and return instance defaults. This is the safe path for LID-only chats.
  if (!chatId) {
    log.debug('No internal chatId — using instance default agent', { instanceId: instance.id, personId });
    return applyInstanceFkAndReturn(db, instance);
  }
  // Resolve route (chat > user > null)
  const route = await services.routeResolver.resolve(instance.id, chatId, personId);

  if (!route) {
    // No route matched - use instance defaults.
    // omni-930 phase 3 / omni-p7r: Apply instance-level agentId entity overrides if set.
    return applyInstanceFkAndReturn(db, instance);
  }

  // Merge route overrides with instance defaults
  const effectiveInstance: DispatchInstance = mergeRouteOverrides(instance, route);

  // omni-p7r phase 2: Resolve agent entity overrides.
  // Route-level agentId takes priority; fall back to instance-level agentId.
  const effectiveAgentFkId = route.agentId ?? instance.agentId;
  if (effectiveAgentFkId) {
    await applyAgentFkOverrides(db, effectiveAgentFkId, effectiveInstance);
  }

  log.debug('Route resolved and merged', {
    instanceId: instance.id,
    chatId,
    personId,
    routeId: route.id,
    routeScope: route.scope,
    routeAgentId: route.agentId,
    agentStreamMode: effectiveInstance.agentStreamMode,
    routeAgentStreamMode: route.agentStreamMode,
    instanceAgentStreamMode: instance.agentStreamMode,
    instanceAgentId: instance.agentId,
  });

  return { instance: effectiveInstance, routeId: route.id };
}

// ============================================================================
// Reaction Trigger Handler
// ============================================================================

async function processReactionTrigger(
  services: Services,
  baseInstance: Instance,
  payload: ReactionReceivedPayload,
  metadata: DispatchMetadata,
  rawEvent: AgentTrigger['event'],
  db: Database,
): Promise<void> {
  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const externalChatId = payload.chatId;

  // Look up internal chat UUID for route resolution
  const chat = await services.chats.findByExternalIdSmart(baseInstance.id, externalChatId);
  const internalChatId = chat?.id; // undefined when chat not in DB (e.g. LID-only chats)

  // Resolve agent route and merge with instance defaults
  const { instance, routeId: _routeId } = await resolveEffectiveInstance(
    services,
    db,
    baseInstance,
    internalChatId,
    metadata.personId,
  );

  log.info('Dispatching reaction trigger', {
    instanceId: instance.id,
    chatId: externalChatId,
    routeChatId: internalChatId ?? 'none',
    emoji: payload.emoji,
    messageId: payload.messageId,
    traceId: metadata.traceId,
  });

  await sendTypingPresence(channel, instance.id, externalChatId, 'composing');

  try {
    // Try new IAgentProvider path first
    const provider = await getAgentProvider(services, instance, db);

    if (provider) {
      // Build AgentTrigger for the provider
      const senderName = await services.agentRunner.getSenderName(metadata.personId, undefined);
      const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_chat', payload.from, externalChatId);

      const trigger: AgentTrigger = {
        traceId: metadata.traceId,
        type: 'reaction',
        event: rawEvent,
        source: {
          channelType: channel,
          instanceId: instance.id,
          chatId: externalChatId,
          messageId: payload.messageId,
        },
        sender: {
          platformUserId: payload.from,
          personId: metadata.personId,
          displayName: senderName,
        },
        content: {
          emoji: payload.emoji,
          referencedMessageId: payload.messageId,
        },
        sessionId,
      };

      const result = await provider.trigger(trigger);

      if (result && result.parts.length > 0) {
        const _fmtMode = (instance.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
        await sendResponseParts(
          channel,
          instance.id,
          externalChatId,
          result.parts,
          getSplitDelayConfig(instance),
          _fmtMode,
          payload.messageId,
        );
      }

      log.info('Reaction trigger response via provider', {
        instanceId: instance.id,
        chatId: externalChatId,
        routeChatId: internalChatId,
        emoji: payload.emoji,
        parts: result?.parts.length ?? 0,
        providerId: result?.metadata.providerId,
        durationMs: result?.metadata.durationMs,
        traceId: metadata.traceId,
      });

      return;
    }

    // Fallback: legacy agentRunner.run() path
    log.debug('No IAgentProvider resolved, using legacy agentRunner path', {
      instanceId: instance.id,
    });

    const personId = await resolvePersonId(services, channel, instance.id, payload.from, metadata.personId);

    const reactionMessage = `[Reacted with ${payload.emoji} to a message]`;
    const senderName = await services.agentRunner.getSenderName(personId, undefined);

    // Determine chat type and fetch metadata
    const chatType = determineChatType(externalChatId, instance.channel, payload.rawPayload as Record<string, unknown>);
    const { avatarUrl: senderAvatarUrl, platformUsername: senderPlatformUsername } = await fetchSenderMetadata(
      services,
      channel,
      instance.id,
      payload.from,
    );
    const { chatName, participantCount } = await fetchChatMetadata(services, instance.id, externalChatId, chatType);

    const result = await services.agentRunner.run({
      instance,
      chatId: externalChatId,
      personId,
      senderId: payload.from,
      senderName,
      senderAvatarUrl,
      senderPlatformUsername,
      chatType,
      chatName,
      participantCount,
      messages: [reactionMessage],
    });

    if (result.parts.length > 0) {
      const _fmtMode = (instance.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
      await sendResponseParts(
        channel,
        instance.id,
        externalChatId,
        result.parts,
        getSplitDelayConfig(instance),
        _fmtMode,
        payload.messageId,
      );
    }

    log.info('Reaction trigger response via legacy runner', {
      instanceId: instance.id,
      chatId: externalChatId,
      routeChatId: internalChatId,
      emoji: payload.emoji,
      parts: result.parts.length,
      traceId: metadata.traceId,
    });
  } catch (error) {
    log.error('Failed to process reaction trigger', {
      instanceId: instance.id,
      chatId: externalChatId,
      routeChatId: internalChatId,
      error: String(error),
      traceId: metadata.traceId,
    });
  } finally {
    await sendTypingPresence(channel, instance.id, externalChatId, 'paused');
  }
}

// ============================================================================
// Setup
// ============================================================================

/**
 * Check if an instance is configured to trigger on a given event type
 */
function instanceTriggersOnEvent(instance: Instance, eventType: string): boolean {
  const triggerEvents = (instance as Record<string, unknown>).triggerEvents as string[] | undefined;
  if (!triggerEvents || triggerEvents.length === 0) {
    // Default: only trigger on message.received
    return eventType === 'message.received';
  }
  return triggerEvents.includes(eventType);
}

/**
 * Check if a reaction emoji matches the instance's trigger reactions config
 */
function isReactionTrigger(instance: Instance, emoji: string): boolean {
  const triggerReactions = (instance as Record<string, unknown>).triggerReactions as string[] | undefined;
  // null/undefined = all emojis trigger
  if (!triggerReactions) return true;
  // Empty array = no reactions trigger
  if (triggerReactions.length === 0) return false;
  return triggerReactions.includes(emoji);
}

/**
 * Guard checks for incoming messages — returns the instance if message should be processed, null otherwise.
 */
/**
 * Check if message contains only trash emoji (session clear command)
 */
function isTrashEmojiOnly(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  const trashEmojiPattern = /^[\uFE0F\u200D]*(?:🗑️|🗑)[\uFE0F\u200D]*$/u;
  return trashEmojiPattern.test(trimmed);
}

/**
 * Check if a single LID JID matches the instance owner via direct comparison or DB resolution.
 * Returns true if the LID maps to the owner.
 */
async function isLidMatchingOwner(
  chatsService: Services['chats'],
  instanceId: string,
  ownerIdentifier: string,
  ownerPhone: string,
  ownerIsLid: boolean,
  lidJid: string,
): Promise<boolean> {
  // Direct LID match: when ownerIdentifier is itself a LID, compare directly
  if (ownerIsLid && extractPhoneFromJid(lidJid) === ownerPhone) {
    log.debug('LID mention matches owner LID directly', { lidJid, ownerIdentifier });
    return true;
  }

  // DB resolution: resolve LID -> phone JID, then compare with owner phone
  try {
    const mapping = await chatsService.findLidMapping(instanceId, lidJid);
    if (!mapping) return false;

    const resolvedPhone = extractPhoneFromJid(mapping);
    if (resolvedPhone === ownerPhone) {
      log.debug('LID resolved to instance owner via DB', { lidJid, resolvedPhone, ownerPhone });
      return true;
    }

    // Reverse check: when owner is LID, also look up the owner's phone mapping
    if (ownerIsLid) {
      const ownerMapping = await chatsService.findLidMapping(instanceId, ownerIdentifier);
      if (ownerMapping && extractPhoneFromJid(ownerMapping) === resolvedPhone) {
        log.debug('LID resolved to owner via reverse mapping', { lidJid, resolvedPhone, ownerIdentifier });
        return true;
      }
    }
  } catch {
    // Non-critical: skip DB lookup failures
  }
  return false;
}

/**
 * Resolve LID-addressed mentions via DB mapping to determine if a @lid mention
 * targets the instance owner. Mutates messageContext.mentionsBot if resolved.
 *
 * LID resolution fallback: if plugin didn't resolve isMentioningInstance (cache cold),
 * check DB for LID→phone mappings to detect if any @lid mention maps to the owner.
 */
async function resolveLidMentionBot(
  chatsService: Services['chats'],
  instanceId: string,
  ownerIdentifier: string,
  mentionedJids: string[],
  messageContext: MessageContext,
): Promise<void> {
  const lidMentions = mentionedJids.filter((jid) => jid.endsWith('@lid'));
  if (lidMentions.length === 0) return;

  const ownerIsLid = ownerIdentifier.endsWith('@lid');
  const ownerPhone = extractPhoneFromJid(ownerIdentifier);

  for (const lidJid of lidMentions) {
    if (await isLidMatchingOwner(chatsService, instanceId, ownerIdentifier, ownerPhone, ownerIsLid, lidJid)) {
      messageContext.mentionsBot = true;
      break;
    }
  }
}

async function resolveEffectiveReplyFilter(
  chatsService: Services['chats'],
  routeResolver: Services['routeResolver'],
  instanceId: string,
  chatId: string,
  defaultFilter: Instance['agentReplyFilter'],
): Promise<Instance['agentReplyFilter']> {
  const chat = await chatsService.findByExternalIdSmart(instanceId, chatId);
  if (!chat?.id) return defaultFilter;
  const route = await routeResolver.resolve(instanceId, chat.id);
  return (route?.agentReplyFilter as Instance['agentReplyFilter']) ?? defaultFilter;
}

/** Slack: resolve isReplyToBot by checking if the bot has sent a message in this thread */
async function resolveSlackThreadReply(
  chatsService: Services['chats'],
  messagesService: Services['messages'],
  instance: Instance,
  payload: MessageReceivedPayload,
  context: MessageContext,
): Promise<void> {
  if (instance.channel !== 'slack') return;
  const raw = payload.rawPayload ?? {};
  if (raw.isThreadReply !== true || !raw.threadTs) return;
  const chat = await chatsService.findByExternalIdSmart(instance.id, payload.chatId);
  if (!chat) return;
  context.isReplyToBot = await messagesService.hasBotRepliedInThread(chat.id, raw.threadTs as string);
}

/** True if the chat is a newsletter or broadcast channel (agent never processes these). */
function isBroadcastOrNewsletter(chatId: string): boolean {
  return chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
}

/** True if we need to resolve whether the bot was mentioned via a LID JID. */
function needsLidMentionCheck(messageContext: MessageContext, instance: Instance): boolean {
  return !messageContext.mentionsBot && !messageContext.isDirectMessage && !!instance.ownerIdentifier;
}

async function shouldProcessMessage(
  agentRunner: Services['agentRunner'],
  accessService: Services['access'],
  chatsService: Services['chats'],
  messagesService: Services['messages'],
  routeResolver: Services['routeResolver'],
  rateLimiter: RateLimiter,
  payload: MessageReceivedPayload,
  metadata: { instanceId?: string; channelType?: string; platformIdentityId?: string },
): Promise<Instance | null> {
  if (!metadata.instanceId) {
    log.debug('No instanceId in metadata', { from: payload.from, chatId: payload.chatId });
    return null;
  }
  if (payload.from === metadata.platformIdentityId) {
    log.debug('Message from self, skipping', { instanceId: metadata.instanceId, from: payload.from });
    return null;
  }

  // Skip trash emoji messages - handled by session-cleaner plugin
  if (isTrashEmojiOnly(payload.content?.text)) {
    log.debug('Skipping trash emoji message (session-cleaner handles this)', {
      instanceId: metadata.instanceId,
      chatId: payload.chatId,
    });
    return null;
  }

  // Never trigger the agent for newsletter/broadcast chats regardless of reply filter mode
  const chatId = payload.chatId ?? '';
  if (isBroadcastOrNewsletter(chatId)) {
    log.debug('Skipping newsletter/broadcast message', { instanceId: metadata.instanceId, chatId });
    return null;
  }

  const instance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
  if (!instance?.agentId) {
    log.debug('Instance has no agentId', { instanceId: metadata.instanceId });
    return null;
  }

  if (!instanceTriggersOnEvent(instance, 'message.received')) {
    log.debug('Instance does not trigger on message.received', { instanceId: instance.id });
    return null;
  }

  // Layer 3 JID self-filter removed (#344). It was intended to block bot reaction
  // echoes (#336) but was dead code for that purpose: reaction dual-emits with
  // isFromMe=true are already blocked at the plugin level (layer 1: !isFromMe check
  // in handleReactionReceived) and by the sentMessageIds cache (layer 2). The filter
  // only caught legitimate owner phone messages (multi-device sync), dropping them
  // silently. See https://github.com/automagik-dev/omni/issues/344.

  const messageContext = buildMessageContext(payload, instance);
  const rawPayloadWithMentions = payload.rawPayload as Record<string, unknown> | undefined;

  if (needsLidMentionCheck(messageContext, instance)) {
    const mentionedJids = (rawPayloadWithMentions?.mentionedJids as string[]) ?? [];
    await resolveLidMentionBot(
      chatsService,
      metadata.instanceId,
      instance.ownerIdentifier as string,
      mentionedJids,
      messageContext,
    );
  }

  await resolveSlackThreadReply(chatsService, messagesService, instance, payload, messageContext);

  log.debug('Message context built', {
    instanceId: instance.id,
    chatId: payload.chatId,
    isDirectMessage: messageContext.isDirectMessage,
    mentionsBot: messageContext.mentionsBot,
    isReplyToBot: messageContext.isReplyToBot,
    mentionedJids: rawPayloadWithMentions?.mentionedJids,
  });

  // Resolve per-chat route filter override before applying the instance-level filter.
  // This allows individual chats to have a different reply filter (e.g. mode:'all') while
  // the instance default remains filtered. Route lookup is a cheap indexed query.
  const effectiveReplyFilter = await resolveEffectiveReplyFilter(
    chatsService,
    routeResolver,
    instance.id,
    payload.chatId,
    instance.agentReplyFilter,
  );

  if (!shouldAgentReply(effectiveReplyFilter, messageContext)) {
    log.debug('Message did not pass reply filter', {
      instanceId: instance.id,
      chatId: payload.chatId,
      messageContext,
      filter: effectiveReplyFilter,
    });
    return null;
  }

  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const rateLimit = (instance as Record<string, unknown>).triggerRateLimit as number | undefined;
  if (!rateLimiter.isAllowed(payload.from, channel, instance.id, rateLimit ?? DEFAULT_RATE_LIMIT)) {
    log.info('Rate limited', { instanceId: instance.id, from: payload.from, channel });
    return null;
  }

  const accessDenied = await checkAccessWithFallback(accessService, instance, payload, channel);
  if (accessDenied) return null;

  return instance;
}

/**
 * Check access using primary sender ID, falling back to participantAlt for Baileys LID addressing.
 * Also tries resolvedSenderPhone annotated by the WhatsApp channel when the sender is a LID.
 * Returns true if access is denied (caller should return null).
 */
async function checkAccessWithFallback(
  accessService: Services['access'],
  instance: Instance,
  payload: { from: string; chatId: string; rawPayload?: unknown },
  channel: ChannelType,
): Promise<boolean> {
  const rawPayload = payload.rawPayload as Record<string, unknown> | undefined;
  const rawKey = rawPayload?.key as Record<string, unknown> | undefined;
  const rawParticipantAlt = (rawKey?.participantAlt as string)?.replace(/@.*$/, '');
  // Validate participantAlt looks like a real phone number (Baileys LID fallback)
  const participantAlt = rawParticipantAlt && /^\d{7,15}$/.test(rawParticipantAlt) ? rawParticipantAlt : undefined;
  // resolvedSenderPhone is annotated by channel-whatsapp when it resolves a LID sender to phone
  // via participantAlt, remoteJidAlt, or the in-memory LID mapping cache.
  const rawResolvedPhone = rawPayload?.resolvedSenderPhone as string | undefined;
  const resolvedSenderPhone = rawResolvedPhone && /^\d{7,15}$/.test(rawResolvedPhone) ? rawResolvedPhone : undefined;
  const primaryId = payload.from ?? '';

  let accessResult = await accessService.checkAccess(instance, primaryId, channel);
  if (!accessResult.allowed && participantAlt && participantAlt !== primaryId) {
    log.warn('Access fallback to participantAlt', {
      instanceId: instance.id,
      primaryId,
      participantAlt,
      chatId: payload.chatId,
    });
    accessResult = await accessService.checkAccess(instance, participantAlt, channel);
  }
  if (
    !accessResult.allowed &&
    resolvedSenderPhone &&
    resolvedSenderPhone !== primaryId &&
    resolvedSenderPhone !== participantAlt
  ) {
    log.debug('Access fallback to resolvedSenderPhone (LID→phone)', {
      instanceId: instance.id,
      primaryId,
      resolvedSenderPhone,
      chatId: payload.chatId,
    });
    accessResult = await accessService.checkAccess(instance, resolvedSenderPhone, channel);
  }
  if (accessResult.allowed) return false;

  log.info('Access denied', {
    instanceId: instance.id,
    chatId: payload.chatId,
    from: payload.from,
    participantAlt,
    reason: accessResult.reason,
  });

  // Trigger pairing flow for unknown senders in allowlist mode (no explicit rule matched).
  // Fire-and-forget: pairing request creation must not block message processing.
  // Guard against empty primaryId: a missing payload.from would otherwise create a
  // degenerate pairing entry shared by all anonymous senders.
  if (accessResult.mode === 'allowlist' && !accessResult.rule && primaryId) {
    accessService.requestPairing(instance.id, primaryId, { channelType: instance.channel }).catch((err) => {
      log.warn('Failed to create pairing request', { instanceId: instance.id, from: primaryId, error: String(err) });
    });
  }

  if (accessResult.rule?.action !== 'silent_block' && accessResult.rule?.blockMessage) {
    sendTextMessage(channel, instance.id, payload.chatId, accessResult.rule.blockMessage).catch(() => {});
  }
  return true;
}

/**
 * Guard checks for incoming reactions — returns the instance if reaction should be processed, null otherwise.
 */
async function shouldProcessReaction(
  agentRunner: Services['agentRunner'],
  accessService: Services['access'],
  rateLimiter: RateLimiter,
  reactionDedup: ReactionDedup,
  payload: ReactionReceivedPayload,
  metadata: { instanceId?: string; channelType?: string },
  eventType: 'reaction.received' | 'reaction.removed' = 'reaction.received',
): Promise<Instance | null> {
  if (!metadata.instanceId) return null;

  const instance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
  if (!instance?.agentId) return null;

  if (!instanceTriggersOnEvent(instance, eventType)) return null;

  if (!isReactionTrigger(instance, payload.emoji)) {
    log.debug('Reaction emoji not in trigger list', { instanceId: instance.id, emoji: payload.emoji });
    return null;
  }

  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const rateLimit = (instance as Record<string, unknown>).triggerRateLimit as number | undefined;
  if (!rateLimiter.isAllowed(payload.from, channel, instance.id, rateLimit ?? DEFAULT_RATE_LIMIT)) {
    log.info('Rate limited reaction trigger', { instanceId: instance.id, from: payload.from });
    return null;
  }

  // Access check for reactions (reuses LID fallback logic)
  const accessDenied = await checkAccessWithFallback(accessService, instance, payload, channel);
  if (accessDenied) return null;

  if (reactionDedup.isDuplicate(payload.messageId, payload.emoji, payload.from)) {
    log.debug('Duplicate reaction, skipping', {
      instanceId: instance.id,
      messageId: payload.messageId,
      emoji: payload.emoji,
    });
    return null;
  }

  return instance;
}

/**
 * Cleanup function returned by setupAgentDispatcher for graceful shutdown.
 * Async to support OpenClaw WS client pool teardown.
 */
export type DispatcherCleanup = () => Promise<void>;

// ============================================================================
// Smart Response Gate (LLM pre-filter)
// ============================================================================

import { RESPONSE_GATE_PROMPT } from '@omni/media-processing';

const DEFAULT_GATE_MODEL = 'gemini-3-flash-preview';
const GATE_TIMEOUT_MS = 3_000;

type SettingsReader = {
  getSecret: (key: string, envKey?: string) => Promise<string | undefined>;
  getString: (key: string, envFallback?: string, defaultValue?: string) => Promise<string | undefined>;
};

/**
 * Resolve gate prompt: instance override → globalSettings override → code default
 */
async function resolveGatePrompt(instancePrompt: string | null, settings: SettingsReader): Promise<string> {
  if (instancePrompt) return instancePrompt;
  const globalOverride = await settings.getString('prompt.response_gate');
  return globalOverride ?? RESPONSE_GATE_PROMPT;
}

/**
 * Call a fast LLM to decide whether the agent should respond to buffered messages.
 * Returns true if the agent should respond, false to skip.
 * Fail-open: returns true on any error or timeout.
 */
async function shouldRespondViaGate(
  instance: Instance,
  messages: BufferedMessage[],
  chatType: 'dm' | 'group' | 'channel',
  settings: SettingsReader,
): Promise<boolean> {
  const inst = instance as Record<string, unknown>;
  if (!inst.agentGateEnabled) return true;

  const agentName = instance.name ?? 'assistant';
  const model = (inst.agentGateModel as string | null) ?? DEFAULT_GATE_MODEL;
  const basePrompt = await resolveGatePrompt(inst.agentGatePrompt as string | null, settings);

  const messagesText = messages
    .map((m) => {
      const name = (m.payload.rawPayload as Record<string, unknown>)?.pushName ?? m.payload.from ?? 'Unknown';
      return `[${name}]: ${m.payload.content?.text ?? '[media]'}`;
    })
    .join('\n');

  const prompt = basePrompt
    .replace(/{agentName}/g, agentName)
    .replace(/{chatType}/g, chatType)
    .replace(/{messages}/g, messagesText);

  const traceId = messages[0]?.metadata.traceId ?? 'unknown';
  const startMs = Date.now();

  try {
    const apiKey = await settings.getSecret('gemini.api_key', 'GEMINI_API_KEY');
    if (!apiKey) {
      log.warn('Gate: no Gemini API key, fail-open', { traceId });
      return true;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 10, temperature: 0 },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        log.warn('Gate: API error, fail-open', { traceId, status: res.status, durationMs: Date.now() - startMs });
        return true;
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() ?? '';
      const shouldRespond = !answer.startsWith('skip');

      log.info('Gate decision', {
        traceId,
        decision: shouldRespond ? 'respond' : 'skip',
        rawAnswer: answer,
        model,
        chatType,
        messageCount: messages.length,
        durationMs: Date.now() - startMs,
      });

      return shouldRespond;
    } catch (fetchError) {
      clearTimeout(timeout);
      const errName = (fetchError as Error).name;
      if (errName === 'AbortError') {
        log.warn('Gate: timeout, fail-open', { traceId, durationMs: Date.now() - startMs });
      } else {
        log.warn('Gate: fetch error, fail-open', { traceId, error: String(fetchError) });
      }
      return true;
    }
  } catch (error) {
    log.warn('Gate: unexpected error, fail-open', { traceId, error: String(error) });
    return true;
  }
}

/** Evaluate gate for non-mention/reply triggers; returns true if response should be skipped */
async function shouldSkipViaGate(
  triggerType: AgentTriggerType,
  firstMsg: BufferedMessage,
  instance: Instance,
  messages: BufferedMessage[],
  services: Services,
): Promise<boolean> {
  if (triggerType === 'mention' || triggerType === 'reply') return false;
  const chatType = determineChatType(
    firstMsg.payload.chatId,
    firstMsg.metadata.channelType ?? 'whatsapp',
    (firstMsg.payload.rawPayload ?? {}) as Record<string, unknown>,
  );
  const shouldRespond = await shouldRespondViaGate(instance, messages, chatType, services.settings);
  if (!shouldRespond) {
    log.info('Gate skipped response', {
      instanceId: instance.id,
      chatId: firstMsg.payload.chatId,
      triggerType,
      traceId: firstMsg.metadata.traceId,
      messageCount: messages.length,
    });
  }
  return !shouldRespond;
}

/**
 * Set up agent dispatcher - subscribes to message AND reaction events
 * Returns a cleanup function that should be called on shutdown.
 */
export async function setupAgentDispatcher(
  eventBus: EventBus,
  services: Services,
  db: Database,
): Promise<DispatcherCleanup> {
  const agentRunner = services.agentRunner;
  const accessService = services.access;
  const rateLimiter = new RateLimiter();
  const reactionDedup = new ReactionDedup();

  // Periodic cleanup of rate limiter counters
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);

  // Periodic cleanup of leaked media promises (10min circuit breaker)
  const mediaCleanupInterval = setInterval(() => {
    const now = Date.now();
    const leakThreshold = 10 * 60_000; // 10 minutes
    for (const [mediaId, pending] of mediaCompletions.entries()) {
      if (now - pending.createdAt > leakThreshold) {
        log.warn('media_promise_leaked', { mediaId, ageMs: now - pending.createdAt });
        pending.reject(new Error('media processing promise leaked (10min circuit breaker)'));
        mediaCompletions.delete(mediaId);
      }
    }
  }, 60_000);

  // Create debouncer for message events
  const debouncer = new MessageDebouncer(async (_chatKey, messages) => {
    const firstMsg = messages[0];
    if (!firstMsg) return;

    const instanceId = firstMsg.metadata.instanceId;

    // Use the pre-resolved instance from early route resolution (done in message.received handler).
    // This avoids a redundant resolveEffectiveInstance() call — the route was already resolved
    // before the debounce timer, so per-user debounce overrides are already applied.
    let instance: DispatchInstance;
    if (firstMsg.metadata.resolvedInstance) {
      instance = firstMsg.metadata.resolvedInstance as DispatchInstance;
    } else {
      // Fallback: resolve now if metadata doesn't carry it (shouldn't happen in normal flow)
      const baseInstance = await agentRunner.getInstanceWithProvider(instanceId);
      if (!baseInstance) {
        log.warn('Instance not found for debounced messages', { instanceId });
        return;
      }
      const externalChatId = firstMsg.payload.chatId;
      const chat = await services.chats.findByExternalIdSmart(instanceId, externalChatId);
      const resolved = await resolveEffectiveInstance(services, db, baseInstance, chat?.id, firstMsg.metadata.personId);
      instance = resolved.instance;
    }

    const msgContext = buildMessageContext(firstMsg.payload, instance);
    const triggerType = classifyMessageTrigger(msgContext);

    if (await shouldSkipViaGate(triggerType, firstMsg, instance, messages, services)) return;

    // T5: Agent notified — record journey checkpoint
    if (firstMsg.metadata.journeyTracked && firstMsg.metadata.correlationId) {
      const tracker = getJourneyTracker();
      tracker.recordCheckpoint(firstMsg.metadata.correlationId, 'T5', JOURNEY_STAGES.T5);
    }

    await processAgentResponse(services, instance, messages, triggerType, db, eventBus);
  });

  try {
    // ========================================
    // Subscribe to message.received
    // ========================================
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        try {
          const instance = await shouldProcessMessage(
            agentRunner,
            accessService,
            services.chats,
            services.messages,
            services.routeResolver,
            rateLimiter,
            payload,
            metadata,
          );
          if (!instance) return;

          const traceId = metadata.traceId ?? generateCorrelationId('trc');

          // Early route resolution: resolve route BEFORE debounce so per-user
          // debounce overrides (e.g. messageDebounceMode: 'disabled') take effect.
          const chat = await services.chats.findByExternalIdSmart(instance.id, payload.chatId);
          const { instance: resolved, routeId } = await resolveEffectiveInstance(
            services,
            db,
            instance,
            chat?.id,
            metadata.personId,
          );

          const debounceConfig = getDebounceConfig(resolved);

          // Group chats (WhatsApp: @g.us) can use a different debounce window.
          // If configured, use groupMs instead of minMs for the timer delay.
          const isGroupChat = payload.chatId.includes('@g.us');
          const effectiveDebounceConfig: DebounceConfig =
            isGroupChat && debounceConfig.groupMs != null
              ? {
                  ...debounceConfig,
                  minMs: debounceConfig.groupMs,
                  // Safety: keep randomized ranges non-negative if maxMs < groupMs
                  maxMs: Math.max(debounceConfig.maxMs, debounceConfig.groupMs),
                }
              : debounceConfig;

          debouncer.buffer(
            instance.id,
            payload.chatId,
            {
              payload,
              metadata: {
                instanceId: instance.id,
                channelType: metadata.channelType,
                personId: metadata.personId,
                platformIdentityId: metadata.platformIdentityId,
                traceId,
                correlationId: metadata.correlationId,
                journeyTracked: metadata.timings != null,
                resolvedInstance: resolved,
                routeId,
              },
              timestamp: event.timestamp,
            },
            effectiveDebounceConfig,
          );
        } catch (error) {
          log.error('Error processing message for dispatch', {
            instanceId: metadata.instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'agent-dispatcher-msg',
        queue: 'agent-dispatcher',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 5,
      },
    );

    // ========================================
    // Subscribe to reaction.received
    // ========================================
    await eventBus.subscribe(
      'reaction.received',
      async (event) => {
        const payload = event.payload as ReactionReceivedPayload;
        const metadata = event.metadata;

        try {
          const instance = await shouldProcessReaction(
            agentRunner,
            accessService,
            rateLimiter,
            reactionDedup,
            payload,
            metadata,
          );
          if (!instance) return;

          const traceId = metadata.traceId ?? generateCorrelationId('trc');

          await processReactionTrigger(
            services,
            instance,
            payload,
            {
              instanceId: instance.id,
              channelType: metadata.channelType,
              personId: metadata.personId,
              platformIdentityId: metadata.platformIdentityId,
              traceId,
            },
            event,
            db,
          );
        } catch (error) {
          log.error('Error processing reaction for dispatch', {
            instanceId: metadata.instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'agent-dispatcher-reaction',
        queue: 'agent-dispatcher',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 5,
      },
    );

    // ========================================
    // Subscribe to reaction.removed
    // ========================================
    await eventBus.subscribe(
      'reaction.removed',
      async (event) => {
        const payload = event.payload as ReactionReceivedPayload;
        const metadata = event.metadata;

        try {
          const instance = await shouldProcessReaction(
            agentRunner,
            accessService,
            rateLimiter,
            reactionDedup,
            payload,
            metadata,
            'reaction.removed',
          );
          if (!instance) return;

          const traceId = metadata.traceId ?? generateCorrelationId('trc');

          await processReactionTrigger(
            services,
            instance,
            payload,
            {
              instanceId: instance.id,
              channelType: metadata.channelType,
              personId: metadata.personId,
              platformIdentityId: metadata.platformIdentityId,
              traceId,
            },
            event,
            db,
          );
        } catch (error) {
          log.error('Error processing reaction removal for dispatch', {
            instanceId: metadata.instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'agent-dispatcher-reaction-removed',
        queue: 'agent-dispatcher',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 5,
      },
    );

    // ========================================
    // Subscribe to presence.typing (for debounce)
    // ========================================
    await eventBus.subscribe(
      'presence.typing',
      async (event) => {
        const payload = event.payload as { chatId: string; from: string };
        const metadata = event.metadata;

        if (!metadata.instanceId) return;

        try {
          const baseInstance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
          if (!baseInstance?.agentId) return;

          // Resolve route so per-user debounce overrides (e.g. restartOnTyping) take effect.
          const chat = await services.chats.findByExternalIdSmart(metadata.instanceId, payload.chatId);
          const { instance: resolved } = await resolveEffectiveInstance(
            services,
            db,
            baseInstance,
            chat?.id,
            metadata.personId,
          );

          const debounceConfig = getDebounceConfig(resolved);
          if (debounceConfig.restartOnTyping) {
            debouncer.onUserTyping(metadata.instanceId, payload.chatId, debounceConfig);
          }
        } catch (error) {
          log.debug('Error handling typing event', { error: String(error) });
        }
      },
      {
        durable: 'agent-dispatcher-typing',
        queue: 'agent-dispatcher',
        maxRetries: 1,
        startFrom: 'last',
        concurrency: 10,
      },
    );

    // ========================================
    // Subscribe to media.processed (event-driven media wait)
    // ========================================
    await eventBus.subscribe(
      'media.processed',
      async (event) => {
        const payload = event.payload as MediaProcessedPayload;
        const { mediaId, content, error } = payload;

        // If dispatcher is already waiting → resolve the promise
        const pending = mediaCompletions.get(mediaId);
        if (pending) {
          pending.resolve({ content, error });
          mediaCompletions.delete(mediaId);
          return;
        }

        // If dispatcher hasn't asked yet → cache the result (TTL 5min)
        mediaResultCache.set(mediaId, { content, error });
        setTimeout(() => mediaResultCache.delete(mediaId), 300_000);
      },
      {
        durable: 'agent-dispatcher-media',
        queue: 'agent-dispatcher-media',
        startFrom: 'new',
      },
    );

    log.info('Agent dispatcher initialized (message + reaction + reaction-removed + media triggers)');
  } catch (error) {
    log.error('Failed to set up agent dispatcher', { error: String(error) });
    clearInterval(cleanupInterval);
    clearInterval(mediaCleanupInterval);
    debouncer.clear();
    throw error;
  }

  // Return cleanup function for graceful shutdown
  return async () => {
    log.info('Shutting down agent dispatcher');
    clearInterval(cleanupInterval);
    clearInterval(mediaCleanupInterval);
    debouncer.clear();

    // Reject any pending media promises on shutdown
    for (const [mediaId, pending] of mediaCompletions.entries()) {
      pending.reject(new Error('dispatcher shutting down'));
      mediaCompletions.delete(mediaId);
    }
    mediaResultCache.clear();

    // Dispose all providers that support it (e.g., OpenClaw WS clients)
    const disposePromises: Promise<void>[] = [];
    for (const [key, provider] of providerCache.entries()) {
      if (provider.dispose) {
        disposePromises.push(
          provider.dispose().catch((err) => {
            log.warn('Error disposing provider', { key, error: String(err) });
          }),
        );
      }
    }

    // Stop all shared OpenClaw WS clients
    const clientStopPromises: Promise<void>[] = [];
    for (const [id, client] of openclawClientPool.entries()) {
      clientStopPromises.push(
        Promise.resolve().then(() => {
          try {
            client.stop();
          } catch (err) {
            log.warn('Error stopping OpenClaw client', { providerId: id, error: String(err) });
          }
        }),
      );
    }

    // Use allSettled + 5s top-level timeout so one stuck provider can't block shutdown
    const allCleanup = Promise.allSettled([...disposePromises, ...clientStopPromises]);

    // Create timeout guard with explicit timeout ID tracking
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutGuard = new Promise<PromiseSettledResult<void>[]>((resolve) => {
      timeoutId = setTimeout(() => {
        log.warn('Dispatcher shutdown timed out after 5s, proceeding');
        resolve([]);
      }, 5_000);
    });

    try {
      await Promise.race([allCleanup, timeoutGuard]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    providerCache.clear();
    openclawClientPool.clear();

    log.info('Agent dispatcher shutdown complete');
  };
}

/**
 * @deprecated Use setupAgentDispatcher instead
 */
export const setupAgentResponder = setupAgentDispatcher;

/** @internal Exported for unit testing only — do not use in production code. */
export const __test__ = {
  buildContextMessages,
  awaitMediaProcessing,
  mediaCompletions,
  mediaResultCache,
  checkProcessedColumn,
  getProcessedColumn,
  MEDIA_WAIT_NULL,
  mergeRouteOverrides,
  getDebounceConfig,
  createNatsGenieProviderInstance,
};
