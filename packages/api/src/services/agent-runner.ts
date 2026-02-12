/**
 * Agent Runner Service
 *
 * Orchestrates agent calls with support for:
 * - Multiple agent types (Agno agents, teams, workflows)
 * - Sync and streaming responses
 * - Response splitting on \n\n with configurable delays
 * - Message debouncing with typing-aware restart
 */

import {
  type IAgentClient,
  ProviderError,
  type ProviderFile,
  type ProviderResponse,
  type StreamChunk,
  createProviderClient,
  isProviderSchemaSupported,
} from '@omni/core';
import { createLogger } from '@omni/core';
import type { AgentReplyFilter, AgentSessionStrategy, ChannelType, Instance } from '@omni/db';
import type { Database } from '@omni/db';
import { agentProviders, instances, persons } from '@omni/db';
import { eq } from 'drizzle-orm';

const log = createLogger('agent-runner');

// ============================================================================
// Types
// ============================================================================

export interface AgentRunContext {
  /** The instance making the agent call */
  instance: Instance;
  /** Chat ID for session continuity */
  chatId: string;

  /** Person UUID (internal identity) — falls back to senderId if unresolved */
  personId?: string;

  /** Platform-specific sender ID (KEEP for backward compat) */
  senderId: string;

  /** Sender's display name (from DB or payload) */
  senderName?: string;

  /** Additional sender metadata */
  senderAvatarUrl?: string;
  senderPlatformUsername?: string;

  /** Chat metadata */
  chatType: 'dm' | 'group' | 'channel';
  chatName?: string;
  participantCount?: number;

  /** The message(s) to send to the agent */
  messages: string[];
  /** Optional file attachments (images, audio, documents) */
  files?: ProviderFile[];
}

export interface AgentRunResult {
  /** Response content (may be split into parts) */
  parts: string[];
  /** Run metadata */
  metadata: {
    runId: string;
    sessionId: string;
    status: 'completed' | 'failed';
    metrics?: {
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
    };
  };
}

export interface SplitDelayConfig {
  mode: 'disabled' | 'fixed' | 'randomized';
  fixedMs: number;
  minMs: number;
  maxMs: number;
}

export interface MessageContext {
  /** Is this a direct message (not group/channel)? */
  isDirectMessage: boolean;
  /** Does this message mention the bot? */
  mentionsBot: boolean;
  /** Is this a reply to a bot message? */
  isReplyToBot: boolean;
  /** The message text content */
  text: string;
}

// ============================================================================
// Reply Filter Logic
// ============================================================================

/**
 * Check if bot name matches text using patterns
 */
function matchesNamePattern(text: string, patterns?: string[]): boolean {
  if (!patterns?.length) return false;

  const lowerText = text.toLowerCase();
  return patterns.some((pattern) => {
    // Simple case-insensitive contains check
    // Future: could support regex patterns
    return lowerText.includes(pattern.toLowerCase());
  });
}

/**
 * Determine if the agent should reply based on filter configuration
 */
export function shouldAgentReply(filter: AgentReplyFilter | null | undefined, context: MessageContext): boolean {
  // No filter configured = no agent response
  if (!filter) return false;

  // 'all' mode = always reply
  if (filter.mode === 'all') return true;

  // 'filtered' mode = check conditions (OR logic - any match triggers reply)
  const { conditions } = filter;

  if (conditions.onDm && context.isDirectMessage) {
    log.debug('Agent reply triggered: onDm');
    return true;
  }

  if (conditions.onMention && context.mentionsBot) {
    log.debug('Agent reply triggered: onMention');
    return true;
  }

  if (conditions.onReply && context.isReplyToBot) {
    log.debug('Agent reply triggered: onReply');
    return true;
  }

  if (conditions.onNameMatch && matchesNamePattern(context.text, conditions.namePatterns)) {
    log.debug('Agent reply triggered: onNameMatch');
    return true;
  }

  return false;
}

// ============================================================================
// Response Splitting
// ============================================================================

/**
 * Split response on double newlines (\n\n)
 * Trims each part and filters empty ones
 */
export function splitResponse(content: string, enableSplit: boolean): string[] {
  if (!enableSplit) {
    return [content.trim()].filter(Boolean);
  }

  return content
    .split('\n\n')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Calculate delay between split messages
 */
export function calculateSplitDelay(config: SplitDelayConfig): number {
  switch (config.mode) {
    case 'disabled':
      return 0;
    case 'fixed':
      return config.fixedMs;
    case 'randomized':
      return config.minMs + Math.random() * (config.maxMs - config.minMs);
    default:
      return 0;
  }
}

/**
 * Get split delay config from instance
 */
export function getSplitDelayConfig(instance: Instance): SplitDelayConfig {
  return {
    mode: instance.messageSplitDelayMode ?? 'randomized',
    fixedMs: instance.messageSplitDelayFixedMs ?? 0,
    minMs: instance.messageSplitDelayMinMs ?? 300,
    maxMs: instance.messageSplitDelayMaxMs ?? 1000,
  };
}

// ============================================================================
// Session ID Computation
// ============================================================================

/**
 * Compute session ID based on the configured strategy
 *
 * @param strategy - Session strategy (per_user, per_chat, per_user_per_chat)
 * @param userId - The user's identifier
 * @param chatId - The chat/conversation identifier
 * @returns Computed session ID for the agent
 */
export function computeSessionId(strategy: AgentSessionStrategy, userId: string, chatId: string): string {
  switch (strategy) {
    case 'per_user':
      // Same session across all chats for this user
      return userId;
    case 'per_chat':
      // All users in a chat share the session (group memory)
      return chatId;
    default:
      // per_user_per_chat: Each user has own session per chat (most isolated)
      return `${userId}:${chatId}`;
  }
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format a message with optional sender name prefix
 *
 * @param message - The message content
 * @param senderName - The sender's display name (optional)
 * @param prefixEnabled - Whether to prefix with sender name
 * @returns Formatted message: "[Name]: message" or just "message"
 */
export function formatMessageWithSender(
  message: string,
  senderName: string | undefined,
  prefixEnabled: boolean,
): string {
  if (!prefixEnabled || !senderName) {
    return message;
  }
  return `[${senderName}]: ${message}`;
}

/**
 * Format multiple messages with optional sender name prefix
 */
export function formatMessagesWithSender(
  messages: string[],
  senderName: string | undefined,
  prefixEnabled: boolean,
): string[] {
  if (!prefixEnabled || !senderName) {
    return messages;
  }
  return messages.map((msg) => `[${senderName}]: ${msg}`);
}

// ============================================================================
// Stream Processing
// ============================================================================

/**
 * Extract complete segments from buffer (split on \n\n)
 * Returns [segments to yield, remaining buffer]
 */
function extractSegments(buffer: string): [string[], string] {
  const segments: string[] = [];
  let remaining = buffer;

  while (remaining.includes('\n\n')) {
    const splitIndex = remaining.indexOf('\n\n');
    const segment = remaining.slice(0, splitIndex).trim();
    remaining = remaining.slice(splitIndex + 2);
    if (segment) segments.push(segment);
  }

  return [segments, remaining];
}

/**
 * Process stream chunks and yield split segments
 */
async function* processStreamChunks(
  streamGenerator: AsyncGenerator<StreamChunk>,
  enableSplit: boolean,
): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of streamGenerator) {
    if (chunk.content) {
      buffer += chunk.content;
    }

    if (enableSplit && buffer.includes('\n\n')) {
      const [segments, remaining] = extractSegments(buffer);
      buffer = remaining;
      for (const segment of segments) {
        yield segment;
      }
    }

    if (chunk.isComplete && buffer.trim()) {
      yield buffer.trim();
    }
  }
}

// ============================================================================
// Agent Runner Service
// ============================================================================

export class AgentRunnerService {
  private clientCache: Map<string, IAgentClient> = new Map();

  constructor(private db: Database) {}

  /**
   * Get or create an Agno client for a provider
   */
  private async getClient(providerId: string): Promise<IAgentClient> {
    // Check cache
    const cached = this.clientCache.get(providerId);
    if (cached) return cached;

    // Fetch provider config from DB
    const [provider] = await this.db.select().from(agentProviders).where(eq(agentProviders.id, providerId)).limit(1);

    if (!provider) {
      throw new ProviderError(`Provider not found: ${providerId}`, 'NOT_FOUND', 404);
    }

    if (!isProviderSchemaSupported(provider.schema)) {
      throw new ProviderError(`Provider schema not supported: ${provider.schema}`, 'NOT_FOUND', 501, {
        schema: provider.schema,
      });
    }

    if (!provider.apiKey) {
      throw new ProviderError(`Provider ${providerId} has no API key configured`, 'AUTHENTICATION_FAILED', 401);
    }

    // Create client
    const client = createProviderClient({
      schema: provider.schema,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
    });

    // Cache it
    this.clientCache.set(providerId, client);
    return client;
  }

  /**
   * Get full instance config with provider details
   */
  async getInstanceWithProvider(instanceId: string): Promise<Instance | null> {
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);

    return instance ?? null;
  }

  /**
   * Get sender name from database (by personId) or fallback to pushName from payload
   *
   * @param personId - Optional person ID from metadata
   * @param fallbackName - Fallback name from payload (e.g., pushName)
   * @returns Sender display name or undefined
   */
  async getSenderName(personId?: string, fallbackName?: string): Promise<string | undefined> {
    // Try to get name from database first
    if (personId) {
      const [person] = await this.db
        .select({ displayName: persons.displayName })
        .from(persons)
        .where(eq(persons.id, personId))
        .limit(1);

      if (person?.displayName) {
        return person.displayName;
      }
    }

    // Fallback to payload name (pushName, displayName, etc.)
    return fallbackName || undefined;
  }

  /**
   * Run an agent call (sync mode)
   */
  async run(context: AgentRunContext): Promise<AgentRunResult> {
    const {
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
      messages,
      files,
    } = context;

    if (!instance.agentProviderId) {
      throw new ProviderError('No agent provider configured for instance', 'NOT_FOUND', 400);
    }

    if (!instance.agentId) {
      throw new ProviderError('No agent ID configured for instance', 'NOT_FOUND', 400);
    }

    const client = await this.getClient(instance.agentProviderId);

    // Format messages with sender name prefix if enabled
    const prefixEnabled = instance.agentPrefixSenderName ?? true;
    const formattedMessages = formatMessagesWithSender(messages, senderName, prefixEnabled);

    // Aggregate messages with separator if multiple
    const combinedMessage = formattedMessages.join('\n---\n');

    // Compute session ID based on configured strategy
    const sessionStrategy = instance.agentSessionStrategy ?? 'per_user_per_chat';
    const sessionId = computeSessionId(sessionStrategy, senderId, chatId);

    log.info('Running agent', {
      instanceId: instance.id,
      agentId: instance.agentId,
      agentType: instance.agentType,
      messageCount: messages.length,
      sessionStrategy,
      sessionId,
      senderName: prefixEnabled ? senderName : undefined,
    });

    // Build request — client routes by agentType internally
    const request = {
      message: combinedMessage,
      agentId: instance.agentId,
      agentType: (instance.agentType ?? 'agent') as 'agent' | 'team' | 'workflow',
      stream: false,
      sessionId, // Computed based on session strategy
      userId: personId || senderId, // ← Person UUID (internal identity)
      platform: {
        id: senderId,
        channel: instance.channel as ChannelType,
        instanceId: instance.id,
        instanceName: instance.name ?? undefined,
      },
      sender: {
        displayName: senderName,
        avatarUrl: senderAvatarUrl,
        platformUsername: senderPlatformUsername,
      },
      chat: {
        type: chatType,
        id: chatId,
        name: chatName,
        participantCount,
      },
      timeoutMs: (instance.agentTimeout ?? 60) * 1000,
      files,
    };

    const response = await client.run(request);

    // Split response if enabled
    const parts = splitResponse(response.content, instance.enableAutoSplit ?? true);

    log.info('Agent run complete', {
      instanceId: instance.id,
      runId: response.runId,
      status: response.status,
      parts: parts.length,
    });

    return {
      parts,
      metadata: {
        runId: response.runId,
        sessionId: response.sessionId,
        status: response.status,
        metrics: response.metrics,
      },
    };
  }

  /**
   * Stream an agent call
   * Yields split parts as they become available
   */
  async *stream(context: AgentRunContext): AsyncGenerator<string> {
    const {
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
      messages,
    } = context;

    if (!instance.agentProviderId) {
      throw new ProviderError('No agent provider configured for instance', 'NOT_FOUND', 400);
    }

    if (!instance.agentId) {
      throw new ProviderError('No agent ID configured for instance', 'NOT_FOUND', 400);
    }

    const client = await this.getClient(instance.agentProviderId);

    // Format messages with sender name prefix if enabled
    const prefixEnabled = instance.agentPrefixSenderName ?? true;
    const formattedMessages = formatMessagesWithSender(messages, senderName, prefixEnabled);

    const combinedMessage = formattedMessages.join('\n---\n');
    const enableSplit = instance.enableAutoSplit ?? true;

    // Compute session ID based on configured strategy
    const sessionStrategy = instance.agentSessionStrategy ?? 'per_user_per_chat';
    const sessionId = computeSessionId(sessionStrategy, senderId, chatId);

    const request = {
      message: combinedMessage,
      agentId: instance.agentId,
      agentType: (instance.agentType ?? 'agent') as 'agent' | 'team' | 'workflow',
      stream: true,
      sessionId, // Computed based on session strategy
      userId: personId || senderId, // ← Person UUID (internal identity)
      platform: {
        id: senderId,
        channel: instance.channel as ChannelType,
        instanceId: instance.id,
        instanceName: instance.name ?? undefined,
      },
      sender: {
        displayName: senderName,
        avatarUrl: senderAvatarUrl,
        platformUsername: senderPlatformUsername,
      },
      chat: {
        type: chatType,
        id: chatId,
        name: chatName,
        participantCount,
      },
      timeoutMs: (instance.agentTimeout ?? 60) * 1000,
    };

    // Client routes by agentType internally
    yield* processStreamChunks(client.stream(request), enableSplit);
  }

  /**
   * Clear cached clients (useful for config updates)
   */
  clearCache(providerId?: string): void {
    if (providerId) {
      this.clientCache.delete(providerId);
    } else {
      this.clientCache.clear();
    }
  }
}
