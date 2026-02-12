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

import { join, resolve } from 'node:path';
import type { StreamSender } from '@omni/channel-sdk';
import {
  type AgentTrigger,
  type AgentTriggerType,
  AgnoAgentProvider,
  ClaudeCodeAgentProvider,
  type EventBus,
  type IAgentProvider,
  JOURNEY_STAGES,
  type MessageReceivedPayload,
  OpenClawAgentProvider,
  OpenClawClient,
  type OpenClawClientConfig,
  type OpenClawProviderConfig,
  type ProviderFile,
  type ReactionReceivedPayload,
  type StreamDelta,
  WebhookAgentProvider,
  createLogger,
  createProviderClient,
  generateCorrelationId,
  getJourneyTracker,
} from '@omni/core';
import type { AgentProvider } from '@omni/db';
import type { ChannelType, Instance } from '@omni/db';
import type { Services } from '../services';
import {
  type MessageContext,
  type SplitDelayConfig,
  calculateSplitDelay,
  computeSessionId,
  getSplitDelayConfig,
  shouldAgentReply,
} from '../services/agent-runner';
import { getPlugin } from './loader';

const log = createLogger('agent-dispatcher');

// ============================================================================
// Types
// ============================================================================

interface BufferedMessage {
  payload: MessageReceivedPayload;
  metadata: DispatchMetadata;
  timestamp: number;
}

interface DispatchMetadata {
  instanceId: string;
  channelType?: string;
  personId?: string;
  platformIdentityId?: string;
  traceId: string;
  /** Original NATS event correlationId for journey tracking */
  correlationId?: string;
  /** Whether this message is being journey-tracked (has timings) */
  journeyTracked?: boolean;
}

interface DebounceConfig {
  mode: 'disabled' | 'fixed' | 'randomized';
  minMs: number;
  maxMs: number;
  restartOnTyping: boolean;
  groupMs: number | null;
}

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
// Message Debouncer (preserved from agent-responder)
// ============================================================================

class MessageDebouncer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>;

  constructor(onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>) {
    this.onFlush = onFlush;
  }

  private getChatKey(instanceId: string, chatId: string): string {
    return `${instanceId}:${chatId}`;
  }

  buffer(instanceId: string, chatId: string, message: BufferedMessage, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    const buffer = this.buffers.get(chatKey) ?? [];
    buffer.push(message);
    this.buffers.set(chatKey, buffer);
    this.restartTimer(chatKey, config);
  }

  onUserTyping(instanceId: string, chatId: string, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);
    if (config.restartOnTyping && this.buffers.has(chatKey)) {
      log.debug('Restarting debounce timer on user typing', { chatKey });
      this.restartTimer(chatKey, config);
    }
  }

  private restartTimer(chatKey: string, config: DebounceConfig): void {
    const existing = this.timers.get(chatKey);

    // In 'fixed' mode, the timer is a fixed collection window from the first
    // message — do NOT restart it when subsequent messages arrive.
    if (config.mode === 'fixed' && existing) return;

    if (existing) clearTimeout(existing);

    let delay: number;
    switch (config.mode) {
      case 'disabled':
        delay = 0;
        break;
      case 'fixed':
        delay = config.minMs;
        break;
      case 'randomized':
        delay = config.minMs + Math.random() * (config.maxMs - config.minMs);
        break;
      default:
        delay = 0;
    }

    const timer = setTimeout(() => this.flush(chatKey), delay);
    this.timers.set(chatKey, timer);
  }

  private async flush(chatKey: string): Promise<void> {
    const messages = this.buffers.get(chatKey);
    this.buffers.delete(chatKey);
    this.timers.delete(chatKey);

    if (messages?.length) {
      try {
        await this.onFlush(chatKey, messages);
      } catch (error) {
        log.error('Error flushing debounced messages', { chatKey, error: String(error) });
      }
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.buffers.clear();
    this.timers.clear();
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

function buildMessageContext(payload: MessageReceivedPayload, instance: Instance): MessageContext {
  const rawPayload = payload.rawPayload ?? {};
  const chatId = payload.chatId ?? '';

  const isDirectMessage =
    !chatId.includes('@g.us') &&
    !chatId.includes('@broadcast') &&
    !chatId.includes('@newsletter') &&
    !(rawPayload.isGroup as boolean);

  const mentionedJids = (rawPayload.mentionedJids as string[]) ?? [];
  const ownerJid = instance.ownerIdentifier ?? '';

  // Baileys LID addressing: mentionedJids may use @lid format while ownerIdentifier
  // is phone-jid format (e.g. 5511...@s.whatsapp.net), causing direct JID match to fail.
  // Fallback: in group chats, if mentionedJids is non-empty, treat as mention — WhatsApp UI
  // only populates mentionedJids when user explicitly @-tags someone from the picker.
  const jidMatchesOwner = mentionedJids.some((jid) => jid === ownerJid || jid.includes(ownerJid));
  const isGroupMention = mentionedJids.length > 0 && chatId.includes('@g.us');
  const mentionsBot = jidMatchesOwner || rawPayload.isMention === true || isGroupMention;

  const quotedParticipant = (rawPayload.quotedMessage as Record<string, unknown>)?.participant as string | undefined;
  const isReplyToBot = quotedParticipant === ownerJid;

  return {
    isDirectMessage,
    mentionsBot,
    isReplyToBot,
    text: payload.content?.text ?? '',
  };
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

/**
 * Determine chat type from platform-specific chat ID
 */
function determineChatType(chatId: string, channel: string): 'dm' | 'group' | 'channel' {
  if (channel === 'whatsapp' || channel === 'whatsapp-baileys' || channel === 'whatsapp-cloud') {
    if (chatId.includes('@s.whatsapp.net')) return 'dm';
    if (chatId.includes('@g.us')) return 'group';
    if (chatId.includes('@newsletter')) return 'channel';
    return 'dm'; // fallback
  }

  if (channel === 'discord') {
    // Discord group detection logic (based on chatId format or instance metadata)
    // For now, assume DM unless proven otherwise
    return 'dm';
  }

  return 'dm'; // default fallback
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

async function sendTextMessage(channel: ChannelType, instanceId: string, chatId: string, text: string): Promise<void> {
  const plugin = await getPlugin(channel);
  if (!plugin) throw new Error(`Channel plugin not found: ${channel}`);

  await plugin.sendMessage(instanceId, {
    to: chatId,
    content: { type: 'text', text },
  });
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
 */
function resolveMediaPath(mediaUrl: string): string {
  const relativePath = mediaUrl.replace(/^\/api\/v2\/media\//, '');
  return join(MEDIA_BASE_PATH, relativePath);
}

/**
 * Extract ProviderFile entries from buffered messages that have media attachments.
 */
function extractMediaFiles(messages: BufferedMessage[]): ProviderFile[] {
  const files: ProviderFile[] = [];
  for (const m of messages) {
    const content = m.payload.content;
    if (content?.mediaUrl && content.mimeType) {
      files.push({
        path: resolveMediaPath(content.mediaUrl),
        mimeType: content.mimeType,
      });
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

/**
 * Check a single poll result: returns result if ready, 'pending' if still waiting, or null on error.
 */
function checkProcessedColumn(
  msg: { mediaUrl?: string | null; [key: string]: unknown } | null,
  column: string,
): { content: string; localPath: string | null } | 'error' | 'pending' {
  if (!msg) return 'pending';
  const processed = msg[column];
  if (processed == null) return 'pending';
  if (typeof processed === 'string' && processed.startsWith('[error')) return 'error';
  if (processed) {
    return {
      content: processed as string,
      localPath: msg.mediaUrl ? resolve(resolveMediaPath(msg.mediaUrl as string)) : null,
    };
  }
  return 'pending';
}

/**
 * Poll the messages table until the media processing column is populated or timeout.
 * Detects error markers written by media-processor on failure to fail fast.
 */
async function waitForMediaProcessing(
  services: Services,
  instanceId: string,
  chatId: string,
  externalId: string,
  contentType: string,
  pollMs = 500,
): Promise<{ content: string | null; localPath: string | null }> {
  const column = getProcessedColumn(contentType);
  if (!column) return MEDIA_WAIT_NULL;

  const chat = await services.chats.getByExternalId(instanceId, chatId);
  if (!chat) {
    log.warn('Chat not found for media wait', { instanceId, chatId });
    return MEDIA_WAIT_NULL;
  }

  // 60s timeout — processing typically completes in <15s
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const msg = await services.messages.getByExternalId(chat.id, externalId);
    const result = checkProcessedColumn(msg, column);
    if (result === 'error') {
      log.warn('Media processing failed', { instanceId, chatId, externalId, error: msg?.[column] });
      return MEDIA_WAIT_NULL;
    }
    if (result !== 'pending') return result;
    await sleep(pollMs);
  }

  log.warn('Media processing wait timed out', { instanceId, chatId, externalId, contentType });
  return MEDIA_WAIT_NULL;
}

/**
 * Format processed media content for the agent.
 */
function formatProcessedMedia(
  contentType: string,
  fullPath: string | null,
  processedText: string,
  includePath: boolean,
): string {
  const icon = MEDIA_ICONS[contentType] ?? '\u{1F4CE}';
  if (includePath && fullPath) {
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
async function resolveQuotedMessage(
  services: Services,
  instanceId: string,
  chatId: string,
  replyToId: string,
): Promise<string | null> {
  try {
    const chat = await services.chats.getByExternalId(instanceId, chatId);
    if (!chat) return null;

    const quoted = await services.messages.getByExternalId(chat.id, replyToId);
    if (!quoted) return null;

    const sender = quoted.senderDisplayName ?? quoted.senderPlatformUserId ?? 'unknown';
    const time = quoted.platformTimestamp
      ? new Date(quoted.platformTimestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : '';

    const content = getMessageContentText(quoted);
    if (!content) return null;

    // Truncate long quoted content to keep context manageable
    const maxLen = 500;
    const truncated = content.length > maxLen ? `${content.slice(0, maxLen)}...` : content;

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
  const normalize = (jid: string) => jid.replace(/:.*/, '').replace(/@.*/, '');
  return normalize(chatId) === normalize(ownerIdentifier);
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
): Promise<void> {
  const messageLimit = getMessageLimit(channel);
  const allChunks: string[] = [];
  for (const part of parts) {
    allChunks.push(...chunkText(part, messageLimit));
  }

  for (const [index, chunk] of allChunks.entries()) {
    await sendTextMessage(channel, instanceId, chatId, chunk);
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

    const result = await waitForMediaProcessing(
      services,
      instance.id,
      m.payload.chatId,
      m.payload.externalId,
      contentType,
    );

    if (result.content) {
      results.push(formatProcessedMedia(contentType, result.localPath, result.content, instance.agentSendMediaPath));
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
  messageTexts: string[],
): Promise<void> {
  for (const m of messages) {
    const replyToId = m.payload.replyToId;
    if (!replyToId) continue;

    const quotedText = await resolveQuotedMessage(services, instanceId, chatId, replyToId);
    if (!quotedText) continue;

    const replyText = m.payload.content?.text;
    const idx = replyText ? messageTexts.indexOf(replyText) : -1;
    if (idx >= 0) {
      messageTexts[idx] = `${quotedText}\n${messageTexts[idx]}`;
    } else {
      messageTexts.unshift(quotedText);
    }
  }
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
  const messageTexts = messages.map((m) => m.payload.content?.text).filter((t): t is string => !!t);
  let mediaFiles = extractMediaFiles(messages);

  if (instance.agentWaitForMedia) {
    const processed = await collectProcessedMedia(services, instance, messages);
    messageTexts.push(...processed);
    if (processed.length > 0) mediaFiles = [];
  }

  await prependQuotedContext(services, instance.id, chatId, messages, messageTexts);

  return { messageTexts, mediaFiles };
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
    const chat = await services.chats.getByExternalId(instanceId, chatId);
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
  createSender: (instanceId: string, chatId: string, replyToMessageId?: string) => StreamSender;
}

/** Check all preconditions for streaming dispatch. Returns null if any guard fails. */
async function resolveStreamingCapabilities(
  services: Services,
  instance: Instance,
  channel: ChannelType,
  chatId: string,
  traceId: string,
): Promise<StreamCapabilities | null> {
  if (!instance.agentStreamMode) return null;

  const provider = await getAgentProvider(services, instance);
  if (!provider?.triggerStream) return null;

  const plugin = await getPlugin(channel);
  if (!plugin?.capabilities?.canStreamResponse || !plugin.createStreamSender) return null;

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
 * Try streaming dispatch: provider.triggerStream() → StreamSender.
 * Returns true if handled via streaming, false to fall back to accumulate.
 */
async function dispatchViaStreamingProvider(
  services: Services,
  instance: Instance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  rawEvent: AgentTrigger['event'],
): Promise<boolean> {
  const resolved = await resolveStreamingCapabilities(services, instance, channel, chatId, traceId);
  if (!resolved) return false;

  const { messageTexts, mediaFiles } = await prepareAgentContent(services, instance, messages);
  if (!messageTexts.length && !mediaFiles.length) return false;
  if (!messageTexts.length && mediaFiles.length) messageTexts.push('[Media message]');

  const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_user_per_chat', senderId, chatId);
  const replyToId = messages[0]?.payload.externalId;

  const trigger: AgentTrigger = {
    traceId,
    type: triggerType,
    event: rawEvent,
    source: {
      channelType: channel,
      instanceId: instance.id,
      chatId,
      messageId: messages[0]?.payload.externalId ?? '',
    },
    sender: {
      platformUserId: senderId,
      personId,
      displayName: senderName,
    },
    content: {
      text: messageTexts.join('\n'),
    },
    sessionId,
  };

  const sender = resolved.createSender(instance.id, chatId, replyToId);
  const streamKey = `${instance.id}:${chatId}`;
  activeStreams.set(streamKey, sender);

  const startTime = Date.now();
  let generator: AsyncGenerator<StreamDelta> | null = null;

  try {
    generator = resolved.provider.triggerStream(trigger);

    for await (const delta of generator) {
      await routeStreamDelta(sender, delta);
    }

    log.info('Streaming response complete', {
      instanceId: instance.id,
      chatId,
      durationMs: Date.now() - startTime,
      traceId,
    });

    return true;
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
    if (generator) {
      try {
        await generator.return(undefined as never);
      } catch {
        // Generator may already be closed
      }
    }
  }
}

/**
 * Try IAgentProvider dispatch first, return true if handled.
 * Falls back to legacy agentRunner.run() if provider not resolved.
 */
async function dispatchViaProvider(
  services: Services,
  instance: Instance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
  rawEvent: AgentTrigger['event'],
): Promise<boolean> {
  const provider = await getAgentProvider(services, instance);
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

  const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_user_per_chat', senderId, chatId);

  const trigger: AgentTrigger = {
    traceId,
    type: triggerType,
    event: rawEvent,
    source: {
      channelType: channel,
      instanceId: instance.id,
      chatId,
      messageId: messages[0]?.payload.externalId ?? '',
    },
    sender: {
      platformUserId: senderId,
      personId,
      displayName: senderName,
    },
    content: {
      text: messageTexts.join('\n'),
    },
    sessionId,
  };

  const result = await provider.trigger(trigger);

  if (result && result.parts.length > 0) {
    const selfChat = isSelfChat(chatId, instance.ownerIdentifier);
    const parts = selfChat ? result.parts.map((p) => `${BOT_PREFIX}${p}`) : result.parts;
    await sendResponseParts(channel, instance.id, chatId, parts, getSplitDelayConfig(instance));
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
  instance: Instance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
  channel: ChannelType,
  chatId: string,
  senderId: string,
  personId: string,
  senderName: string | undefined,
  traceId: string,
): Promise<void> {
  const { messageTexts, mediaFiles } = await prepareAgentContent(services, instance, messages);

  if (!messageTexts.length && !mediaFiles.length) {
    log.debug('No text or media content in messages, skipping agent call');
    return;
  }

  if (!messageTexts.length && mediaFiles.length) {
    messageTexts.push('[Media message]');
  }

  // Determine chat type and fetch metadata
  const chatType = determineChatType(chatId, instance.channel);
  const { avatarUrl: senderAvatarUrl, platformUsername: senderPlatformUsername } = await fetchSenderMetadata(
    services,
    channel,
    instance.id,
    senderId,
  );
  const { chatName, participantCount } = await fetchChatMetadata(services, instance.id, chatId, chatType);

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

  const selfChat = isSelfChat(chatId, instance.ownerIdentifier);
  const parts = selfChat ? result.parts.map((p) => `${BOT_PREFIX}${p}`) : result.parts;

  await sendResponseParts(channel, instance.id, chatId, parts, getSplitDelayConfig(instance));

  log.info('Agent response via legacy runner', {
    instanceId: instance.id,
    chatId,
    parts: result.parts.length,
    runId: result.metadata.runId,
    triggerType,
    traceId,
  });
}

async function processAgentResponse(
  services: Services,
  instance: Instance,
  messages: BufferedMessage[],
  triggerType: AgentTriggerType,
): Promise<void> {
  const firstMessage = messages[0];
  if (!firstMessage) return;

  const chatId = firstMessage.payload.chatId;
  const senderId = firstMessage.payload.from ?? '';
  const channel = (firstMessage.metadata.channelType ?? 'whatsapp') as ChannelType;
  const traceId = firstMessage.metadata.traceId;

  // Resolve person ID (waits for message-persistence to create identity)
  const personId = await resolvePersonId(services, channel, instance.id, senderId, firstMessage.metadata.personId);
  if (!personId) {
    log.warn('Could not resolve person ID, skipping agent', {
      instanceId: instance.id,
      chatId,
      senderId,
    });
    return;
  }

  const rawPayload = firstMessage.payload.rawPayload ?? {};
  const pushName = (rawPayload.pushName as string) ?? (rawPayload.displayName as string);
  const senderName = await services.agentRunner.getSenderName(personId, pushName);

  log.info('Dispatching to agent', {
    instanceId: instance.id,
    chatId,
    messageCount: messages.length,
    triggerType,
    traceId,
    senderName,
  });

  await sendTypingPresence(channel, instance.id, chatId, 'composing');

  try {
    // B-1: Try IAgentProvider path first (Agno, Webhook, OpenClaw)
    // TODO(P1): rawEvent is MessageReceivedPayload, not OmniEvent. The double cast hides
    // a type mismatch. BufferedMessage doesn't carry the original NATS event envelope.
    // Providers reading context.event fields (id, type, timestamp) will get undefined.
    // Fix: either store the full OmniEvent in BufferedMessage, or make AgentTrigger.event optional.
    const rawEvent = firstMessage.payload as unknown as AgentTrigger['event'];
    let handled = false;
    try {
      // B-1a: Try streaming dispatch first (if instance + provider + channel support it)
      handled = await dispatchViaStreamingProvider(
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
        rawEvent,
      );

      // B-1b: Fall back to accumulate-then-reply
      if (!handled) {
        handled = await dispatchViaProvider(
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
          rawEvent,
        );
      }
    } catch (providerError) {
      log.error('Provider dispatch failed, falling back to legacy', {
        instanceId: instance.id,
        chatId,
        error: String(providerError),
        traceId,
      });
      // Fall through to legacy path
    }

    if (handled) return;

    // Fallback: legacy agentRunner.run() path
    log.debug('No IAgentProvider resolved or provider failed, using legacy agentRunner path', {
      instanceId: instance.id,
    });

    await dispatchViaLegacy(
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
    );
  } catch (error) {
    log.error('Failed to process agent response', {
      instanceId: instance.id,
      chatId,
      error: String(error),
      traceId,
    });
  } finally {
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
function createOpenClawProviderInstance(provider: AgentProvider, instance: Instance): IAgentProvider {
  // DEC-3: Reuse shared WS client per provider ID
  let client = openclawClientPool.get(provider.id);
  if (!client) {
    const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
    const clientConfig: OpenClawClientConfig = {
      url: provider.baseUrl,
      token: provider.apiKey ?? '',
      providerId: provider.id,
      origin: (schemaConfig.origin as string) ?? undefined,
    };
    client = new OpenClawClient(clientConfig);
    client.start(); // DEC-14: lazy connect — starts WS in background
    openclawClientPool.set(provider.id, client);
  }

  const schemaConfig = (provider.schemaConfig ?? {}) as Record<string, unknown>;
  const providerConfig: OpenClawProviderConfig = {
    defaultAgentId: (instance.agentId ?? (schemaConfig.defaultAgentId as string) ?? 'default') as string,
    agentTimeoutMs: ((instance.agentTimeout ?? provider.defaultTimeout ?? 120) as number) * 1000,
    sendAckTimeoutMs: 10_000,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  };

  return new OpenClawAgentProvider(provider.id, provider.name, client, providerConfig);
}

/** Create an Agno-based agent provider */
function createAgnoProvider(provider: AgentProvider, instance: Instance): IAgentProvider | null {
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
    agentId: (instance.agentId ?? schemaConfig.agentId ?? 'default') as string,
    agentType: (instance.agentType ?? 'agent') as 'agent' | 'team' | 'workflow',
    timeoutMs: (instance.agentTimeout ?? provider.defaultTimeout ?? 60) * 1000,
    enableAutoSplit: instance.enableAutoSplit ?? true,
    prefixSenderName: instance.agentPrefixSenderName ?? true,
  });
}

/** Create a Claude Code agent provider */
function createClaudeCodeProviderInstance(provider: AgentProvider, instance: Instance): IAgentProvider {
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
    {
      timeoutMs: ((instance.agentTimeout ?? provider.defaultTimeout ?? 120) as number) * 1000,
      enableAutoSplit: instance.enableAutoSplit ?? true,
      prefixSenderName: instance.agentPrefixSenderName ?? true,
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

/**
 * Resolve an IAgentProvider from a DB provider record + instance config.
 * Returns null if the schema is not supported for the new provider abstraction.
 *
 * Exported for use by session-cleaner (provider.resetSession).
 */
export function resolveProvider(provider: AgentProvider, instance: Instance): IAgentProvider | null {
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
      agentProvider = createClaudeCodeProviderInstance(provider, instance);
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
 * Look up provider from DB and resolve to IAgentProvider
 */
async function getAgentProvider(services: Services, instance: Instance): Promise<IAgentProvider | null> {
  if (!instance.agentProviderId) return null;

  try {
    const provider = await services.providers.getById(instance.agentProviderId);

    if (!provider?.isActive) return null;

    return resolveProvider(provider, instance);
  } catch (error) {
    log.warn('Failed to resolve agent provider, falling back to legacy', {
      instanceId: instance.id,
      providerId: instance.agentProviderId,
      error: String(error),
    });
    return null;
  }
}

// ============================================================================
// Reaction Trigger Handler
// ============================================================================

async function processReactionTrigger(
  services: Services,
  instance: Instance,
  payload: ReactionReceivedPayload,
  metadata: DispatchMetadata,
  rawEvent: AgentTrigger['event'],
): Promise<void> {
  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const chatId = payload.chatId;

  log.info('Dispatching reaction trigger', {
    instanceId: instance.id,
    chatId,
    emoji: payload.emoji,
    messageId: payload.messageId,
    traceId: metadata.traceId,
  });

  await sendTypingPresence(channel, instance.id, chatId, 'composing');

  try {
    // Try new IAgentProvider path first
    const provider = await getAgentProvider(services, instance);

    if (provider) {
      // Build AgentTrigger for the provider
      const senderName = await services.agentRunner.getSenderName(metadata.personId, undefined);
      const sessionId = computeSessionId(instance.agentSessionStrategy ?? 'per_user_per_chat', payload.from, chatId);

      const trigger: AgentTrigger = {
        traceId: metadata.traceId,
        type: 'reaction',
        event: rawEvent,
        source: {
          channelType: channel,
          instanceId: instance.id,
          chatId,
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
        await sendResponseParts(channel, instance.id, chatId, result.parts, getSplitDelayConfig(instance));
      }

      log.info('Reaction trigger response via provider', {
        instanceId: instance.id,
        chatId,
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
    const chatType = determineChatType(chatId, instance.channel);
    const { avatarUrl: senderAvatarUrl, platformUsername: senderPlatformUsername } = await fetchSenderMetadata(
      services,
      channel,
      instance.id,
      payload.from,
    );
    const { chatName, participantCount } = await fetchChatMetadata(services, instance.id, chatId, chatType);

    const result = await services.agentRunner.run({
      instance,
      chatId,
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
      await sendResponseParts(channel, instance.id, chatId, result.parts, getSplitDelayConfig(instance));
    }

    log.info('Reaction trigger response via legacy runner', {
      instanceId: instance.id,
      chatId,
      emoji: payload.emoji,
      parts: result.parts.length,
      traceId: metadata.traceId,
    });
  } catch (error) {
    log.error('Failed to process reaction trigger', {
      instanceId: instance.id,
      chatId,
      error: String(error),
      traceId: metadata.traceId,
    });
  } finally {
    await sendTypingPresence(channel, instance.id, chatId, 'paused');
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

async function shouldProcessMessage(
  agentRunner: Services['agentRunner'],
  accessService: Services['access'],
  rateLimiter: RateLimiter,
  payload: MessageReceivedPayload,
  metadata: { instanceId?: string; channelType?: string; platformIdentityId?: string },
): Promise<Instance | null> {
  if (!metadata.instanceId) return null;
  if (payload.from === metadata.platformIdentityId) return null;

  // Skip trash emoji messages - handled by session-cleaner plugin
  if (isTrashEmojiOnly(payload.content?.text)) {
    log.debug('Skipping trash emoji message (session-cleaner handles this)', {
      instanceId: metadata.instanceId,
      chatId: payload.chatId,
    });
    return null;
  }

  const instance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
  if (!instance?.agentProviderId) return null;

  if (!instanceTriggersOnEvent(instance, 'message.received')) return null;

  const messageContext = buildMessageContext(payload, instance);
  if (!shouldAgentReply(instance.agentReplyFilter, messageContext)) {
    log.debug('Message did not pass reply filter', { instanceId: instance.id, chatId: payload.chatId });
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
 * Returns true if access is denied (caller should return null).
 */
async function checkAccessWithFallback(
  accessService: Services['access'],
  instance: Instance,
  payload: { from: string; chatId: string; rawPayload?: unknown },
  channel: ChannelType,
): Promise<boolean> {
  const rawKey = (payload.rawPayload as Record<string, unknown>)?.key as Record<string, unknown> | undefined;
  const rawParticipantAlt = (rawKey?.participantAlt as string)?.replace(/@.*$/, '');
  // Validate participantAlt looks like a real phone number (Baileys LID fallback)
  const participantAlt = rawParticipantAlt && /^\d{7,15}$/.test(rawParticipantAlt) ? rawParticipantAlt : undefined;
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
  if (accessResult.allowed) return false;

  log.info('Access denied', {
    instanceId: instance.id,
    chatId: payload.chatId,
    from: payload.from,
    participantAlt,
    reason: accessResult.reason,
  });
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
  if (!instance?.agentProviderId) return null;

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

  const agentName = instance.agentId ?? instance.name ?? 'assistant';
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

/**
 * Set up agent dispatcher - subscribes to message AND reaction events
 * Returns a cleanup function that should be called on shutdown.
 */
export async function setupAgentDispatcher(eventBus: EventBus, services: Services): Promise<DispatcherCleanup> {
  const agentRunner = services.agentRunner;
  const accessService = services.access;
  const rateLimiter = new RateLimiter();
  const reactionDedup = new ReactionDedup();

  // Periodic cleanup of rate limiter counters
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);

  // Create debouncer for message events
  const debouncer = new MessageDebouncer(async (_chatKey, messages) => {
    const firstMsg = messages[0];
    if (!firstMsg) return;

    const instanceId = firstMsg.metadata.instanceId;
    const instance = await agentRunner.getInstanceWithProvider(instanceId);
    if (!instance) {
      log.warn('Instance not found for debounced messages', { instanceId });
      return;
    }

    const msgContext = buildMessageContext(firstMsg.payload, instance);
    const triggerType = classifyMessageTrigger(msgContext);

    // Bypass gate for direct mention/reply. For dm/name_match, evaluate via gate.
    if (triggerType !== 'mention' && triggerType !== 'reply') {
      const chatType = determineChatType(firstMsg.payload.chatId, firstMsg.metadata.channelType ?? 'whatsapp');
      const shouldRespond = await shouldRespondViaGate(instance, messages, chatType, services.settings);
      if (!shouldRespond) {
        log.info('Gate skipped response', {
          instanceId: instance.id,
          chatId: firstMsg.payload.chatId,
          triggerType,
          traceId: firstMsg.metadata.traceId,
          messageCount: messages.length,
        });
        return;
      }
    }

    // T5: Agent notified — record journey checkpoint
    if (firstMsg.metadata.journeyTracked && firstMsg.metadata.correlationId) {
      const tracker = getJourneyTracker();
      tracker.recordCheckpoint(firstMsg.metadata.correlationId, 'T5', JOURNEY_STAGES.T5);
    }

    await processAgentResponse(services, instance, messages, triggerType);
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
          const instance = await shouldProcessMessage(agentRunner, accessService, rateLimiter, payload, metadata);
          if (!instance) return;

          const traceId = metadata.traceId ?? generateCorrelationId('trc');
          const debounceConfig = getDebounceConfig(instance);

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
          const instance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
          if (!instance?.agentProviderId) return;

          const debounceConfig = getDebounceConfig(instance);
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

    log.info('Agent dispatcher initialized (message + reaction + reaction-removed triggers)');
  } catch (error) {
    log.error('Failed to set up agent dispatcher', { error: String(error) });
    clearInterval(cleanupInterval);
    debouncer.clear();
    throw error;
  }

  // Return cleanup function for graceful shutdown
  return async () => {
    log.info('Shutting down agent dispatcher');
    clearInterval(cleanupInterval);
    debouncer.clear();

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
    const timeoutGuard = new Promise<PromiseSettledResult<void>[]>((resolve) =>
      setTimeout(() => {
        log.warn('Dispatcher shutdown timed out after 5s, proceeding');
        resolve([]);
      }, 5_000),
    );
    await Promise.race([allCleanup, timeoutGuard]);

    providerCache.clear();
    openclawClientPool.clear();

    log.info('Agent dispatcher shutdown complete');
  };
}

/**
 * @deprecated Use setupAgentDispatcher instead
 */
export const setupAgentResponder = setupAgentDispatcher;
