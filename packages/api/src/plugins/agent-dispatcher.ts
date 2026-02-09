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

import {
  type AgentTrigger,
  type AgentTriggerType,
  AgnoAgentProvider,
  type EventBus,
  type IAgentProvider,
  type MessageReceivedPayload,
  type ReactionReceivedPayload,
  WebhookAgentProvider,
  createLogger,
  createProviderClient,
  generateCorrelationId,
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
}

interface DebounceConfig {
  mode: 'disabled' | 'fixed' | 'randomized';
  minMs: number;
  maxMs: number;
  restartOnTyping: boolean;
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
  };
}

function buildMessageContext(payload: MessageReceivedPayload, instance: Instance): MessageContext {
  const rawPayload = payload.rawPayload ?? {};
  const chatId = payload.chatId ?? '';

  const isDirectMessage =
    !chatId.includes('@g.us') && !chatId.includes('@broadcast') && !(rawPayload.isGroup as boolean);

  const mentionedJids = (rawPayload.mentionedJids as string[]) ?? [];
  const ownerJid = instance.ownerIdentifier ?? '';
  const mentionsBot =
    mentionedJids.some((jid) => jid === ownerJid || jid.includes(ownerJid)) || rawPayload.isMention === true;

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

  const rawPayload = firstMessage.payload.rawPayload ?? {};
  const pushName = (rawPayload.pushName as string) ?? (rawPayload.displayName as string);
  const senderName = await services.agentRunner.getSenderName(firstMessage.metadata.personId, pushName);

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
    const messageTexts = messages.map((m) => m.payload.content?.text).filter((t): t is string => !!t);
    if (!messageTexts.length) {
      log.debug('No text content in messages, skipping agent call');
      await sendTypingPresence(channel, instance.id, chatId, 'paused');
      return;
    }

    const result = await services.agentRunner.run({
      instance,
      chatId,
      senderId,
      senderName,
      messages: messageTexts,
    });

    await sendResponseParts(channel, instance.id, chatId, result.parts, getSplitDelayConfig(instance));

    log.info('Agent response sent', {
      instanceId: instance.id,
      chatId,
      parts: result.parts.length,
      runId: result.metadata.runId,
      triggerType,
      traceId,
    });
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

/** Cache of IAgentProvider instances by provider DB ID */
const providerCache = new Map<string, IAgentProvider>();

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
 */
function resolveProvider(provider: AgentProvider, instance: Instance): IAgentProvider | null {
  const cacheKey = `${provider.id}:${instance.id}`;
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let agentProvider: IAgentProvider | null = null;

  switch (provider.schema) {
    case 'agnoos':
    case 'agno':
      agentProvider = createAgnoProvider(provider, instance);
      break;
    case 'webhook':
      agentProvider = createWebhookProvider(provider);
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

    const reactionMessage = `[Reacted with ${payload.emoji} to a message]`;
    const senderName = await services.agentRunner.getSenderName(metadata.personId, undefined);

    const result = await services.agentRunner.run({
      instance,
      chatId,
      senderId: payload.from,
      senderName,
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
async function shouldProcessMessage(
  agentRunner: Services['agentRunner'],
  accessService: Services['access'],
  rateLimiter: RateLimiter,
  payload: MessageReceivedPayload,
  metadata: { instanceId?: string; channelType?: string; platformIdentityId?: string },
): Promise<Instance | null> {
  if (!metadata.instanceId) return null;
  if (payload.from === metadata.platformIdentityId) return null;

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

  const accessResult = await accessService.checkAccess(instance.id, payload.from ?? '', channel);
  if (!accessResult.allowed) {
    log.info('Access denied', {
      instanceId: instance.id,
      chatId: payload.chatId,
      from: payload.from,
      reason: accessResult.reason,
    });
    return null;
  }

  return instance;
}

/**
 * Guard checks for incoming reactions — returns the instance if reaction should be processed, null otherwise.
 */
async function shouldProcessReaction(
  agentRunner: Services['agentRunner'],
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
 * Cleanup function returned by setupAgentDispatcher for graceful shutdown
 */
export type DispatcherCleanup = () => void;

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
              },
              timestamp: event.timestamp,
            },
            debounceConfig,
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
          const instance = await shouldProcessReaction(agentRunner, rateLimiter, reactionDedup, payload, metadata);
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
  return () => {
    log.info('Shutting down agent dispatcher');
    clearInterval(cleanupInterval);
    debouncer.clear();
  };
}

/**
 * @deprecated Use setupAgentDispatcher instead
 */
export const setupAgentResponder = setupAgentDispatcher;
