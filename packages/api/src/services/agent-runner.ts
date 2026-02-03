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
  type IAgnoClient,
  ProviderError,
  type ProviderResponse,
  type StreamChunk,
  createProviderClient,
  isProviderSchemaSupported,
} from '@omni/core';
import { createLogger } from '@omni/core';
import type { AgentReplyFilter, Instance } from '@omni/db';
import type { Database } from '@omni/db';
import { agentProviders, instances } from '@omni/db';
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
  /** Sender ID for user identification */
  senderId: string;
  /** The message(s) to send to the agent */
  messages: string[];
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
// Agent Runner Service
// ============================================================================

export class AgentRunnerService {
  private clientCache: Map<string, IAgnoClient> = new Map();

  constructor(private db: Database) {}

  /**
   * Get or create an Agno client for a provider
   */
  private async getClient(providerId: string): Promise<IAgnoClient> {
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
   * Run an agent call (sync mode)
   */
  async run(context: AgentRunContext): Promise<AgentRunResult> {
    const { instance, chatId, senderId, messages } = context;

    if (!instance.agentProviderId) {
      throw new ProviderError('No agent provider configured for instance', 'NOT_FOUND', 400);
    }

    if (!instance.agentId) {
      throw new ProviderError('No agent ID configured for instance', 'NOT_FOUND', 400);
    }

    const client = await this.getClient(instance.agentProviderId);

    // Aggregate messages with separator if multiple
    const combinedMessage = messages.join('\n---\n');

    log.info('Running agent', {
      instanceId: instance.id,
      agentId: instance.agentId,
      agentType: instance.agentType,
      messageCount: messages.length,
    });

    // Call appropriate endpoint based on agent type
    let response: ProviderResponse;
    const request = {
      message: combinedMessage,
      stream: false,
      sessionId: chatId, // Use chat ID for session continuity
      userId: senderId, // User identifier
      timeoutMs: (instance.agentTimeout ?? 60) * 1000,
    };

    const agentType = instance.agentType ?? 'agent';

    switch (agentType) {
      case 'agent':
        response = await client.runAgent(instance.agentId, request);
        break;
      case 'team':
        response = await client.runTeam(instance.agentId, request);
        break;
      default:
        throw new ProviderError(`Unknown agent type: ${agentType}`, 'NOT_FOUND', 400);
    }

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
    const { instance, chatId, senderId, messages } = context;

    if (!instance.agentProviderId) {
      throw new ProviderError('No agent provider configured for instance', 'NOT_FOUND', 400);
    }

    if (!instance.agentId) {
      throw new ProviderError('No agent ID configured for instance', 'NOT_FOUND', 400);
    }

    const client = await this.getClient(instance.agentProviderId);
    const combinedMessage = messages.join('\n---\n');
    const enableSplit = instance.enableAutoSplit ?? true;

    const request = {
      message: combinedMessage,
      stream: true,
      sessionId: chatId,
      userId: senderId,
      timeoutMs: (instance.agentTimeout ?? 60) * 1000,
    };

    const agentType = instance.agentType ?? 'agent';

    let streamGenerator: AsyncGenerator<StreamChunk>;

    switch (agentType) {
      case 'agent':
        streamGenerator = client.streamAgent(instance.agentId, request);
        break;
      case 'team':
        streamGenerator = client.streamTeam(instance.agentId, request);
        break;
      default:
        throw new ProviderError(`Unknown agent type: ${agentType}`, 'NOT_FOUND', 400);
    }

    // Accumulate content and yield split parts as they complete
    let buffer = '';

    for await (const chunk of streamGenerator) {
      if (chunk.content) {
        buffer += chunk.content;

        if (enableSplit) {
          // Check for complete segments
          while (buffer.includes('\n\n')) {
            const splitIndex = buffer.indexOf('\n\n');
            const segment = buffer.slice(0, splitIndex).trim();
            buffer = buffer.slice(splitIndex + 2);

            if (segment) {
              yield segment;
            }
          }
        }
      }

      // On completion, yield any remaining buffer
      if (chunk.isComplete && buffer.trim()) {
        yield buffer.trim();
      }
    }
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
