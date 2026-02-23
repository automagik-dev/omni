/**
 * Session Cleaner Plugin
 *
 * Listens for trash emoji messages and clears the agent session.
 * When a user sends only a trash emoji (🗑️ or 🗑), their conversation
 * history with the agent is cleared via DELETE /sessions/{identity}.
 * Sends a confirmation message and blocks agent response.
 */

import type { EventBus, TypedOmniEvent } from '@omni/core';
import { createAgnoClient, createLogger } from '@omni/core';
import type { ChannelType, Database } from '@omni/db';
import { agents } from '@omni/db';
import { eq } from 'drizzle-orm';
import type { Services } from '../services';
import { computeSessionId } from '../services/agent-runner';
import { resolveProvider } from './agent-dispatcher';
import { getPlugin } from './loader';

const log = createLogger('session-cleaner');

/**
 * Check if message contains only trash emoji
 */
function isTrashEmojiOnly(text: string | undefined): boolean {
  if (!text) return false;

  // Remove whitespace and check if only trash emoji
  const trimmed = text.trim();

  // Match trash can emoji variations
  const trashEmojiPattern = /^[\uFE0F\u200D]*(?:🗑️|🗑)[\uFE0F\u200D]*$/u;

  return trashEmojiPattern.test(trimmed);
}

/**
 * Send a message via channel plugin
 */
async function sendMessage(services: Services, instanceId: string, chatId: string, text: string): Promise<void> {
  const instance = await services.instances.getById(instanceId);
  const channel = instance.channel as ChannelType;
  const plugin = await getPlugin(channel);
  if (plugin) {
    await plugin.sendMessage(instanceId, {
      to: chatId,
      content: { type: 'text', text },
    });
  }
}

/**
 * Clear agent session for the given user and chat.
 * Tries IAgentProvider.resetSession() first (supports OpenClaw, Webhook, etc.),
 * falls back to direct AgnoOS client for legacy.
 */
async function clearAgentSession(
  services: Services,
  db: Database,
  instanceId: string,
  from: string,
  chatId: string,
): Promise<{ sessionId: string; sessionStrategy: string }> {
  // Get instance with provider
  const instance = await services.agentRunner.getInstanceWithProvider(instanceId);

  if (!instance?.agentId) {
    throw new Error('No agent configured for instance');
  }

  // Resolve agent provider from the agent FK
  const [agentRow] = await db
    .select({ agentProviderId: agents.agentProviderId })
    .from(agents)
    .where(eq(agents.id, instance.agentId))
    .limit(1);

  if (!agentRow?.agentProviderId) {
    throw new Error('Agent has no provider configured');
  }

  // Get provider record from DB
  const providerRecord = await services.providers.getById(agentRow.agentProviderId);

  // Compute session ID using the same strategy as agent-runner
  const sessionStrategy = instance.agentSessionStrategy ?? 'per_chat';
  const sessionId = computeSessionId(sessionStrategy, from, chatId);

  // Try IAgentProvider.resetSession() first (covers OpenClaw, Agno, Claude, etc.)
  // Pass chatId so providers that build their own key format (e.g. OpenClaw)
  // can reconstruct the correct session key instead of using the generic sessionId.
  // Pass instanceId for providers that persist session state scoped by instance.
  // Extend instance with transient dispatch fields required by resolveProvider.
  const dispatchInstance = { ...instance, agentProviderId: agentRow.agentProviderId };
  const agentProvider = resolveProvider(providerRecord, dispatchInstance, db);
  if (agentProvider?.resetSession) {
    await agentProvider.resetSession(sessionId, chatId, instanceId);
    return { sessionId, sessionStrategy };
  }

  // Fallback: direct AgnoOS client
  if (providerRecord.schema !== 'agno') {
    throw new Error(`Session clearing not supported for ${providerRecord.schema} providers`);
  }

  const client = createAgnoClient({
    baseUrl: providerRecord.baseUrl,
    apiKey: providerRecord.apiKey ?? '',
    defaultTimeoutMs: (providerRecord.defaultTimeout ?? 60) * 1000,
  });

  await client.deleteSession?.(sessionId);

  return { sessionId, sessionStrategy };
}

/**
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
/**
 * Handle trash emoji message event
 */
async function handleTrashEmojiMessage(
  services: Services,
  db: Database,
  event: TypedOmniEvent<'message.received'>,
): Promise<void> {
  const { content, chatId, from } = event.payload;
  const { instanceId } = event.metadata;

  if (!instanceId || !content?.text) return;
  if (!isTrashEmojiOnly(content.text)) return;

  log.info('Trash emoji detected, clearing session', { instanceId, chatId, from });

  try {
    const { sessionId, sessionStrategy } = await clearAgentSession(services, db, instanceId, from, chatId);

    log.info('Session cleared successfully', { instanceId, sessionId, sessionStrategy });

    // Send confirmation message
    try {
      await sendMessage(services, instanceId, chatId, '✅ Conversa limpa! Sua sessão com o assistente foi resetada.');
      log.info('Sent session cleared confirmation', { instanceId, chatId });
    } catch (sendError) {
      log.error('Failed to send confirmation message', { instanceId, chatId, error: String(sendError) });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Skip logging if it's a known skippable case
    if (errorMessage.includes('No agent provider') || errorMessage.includes('not supported for')) {
      log.debug('Session clearing skipped', { instanceId, reason: errorMessage });
      return;
    }

    log.error('Failed to clear session', { instanceId, chatId, error: errorMessage });

    // Send error message
    try {
      await sendMessage(services, instanceId, chatId, '❌ Erro ao limpar sessão. Tente novamente.');
    } catch (sendError) {
      log.error('Failed to send error message', { instanceId, chatId, error: String(sendError) });
    }
  }
}

/**
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
export async function setupSessionCleaner(eventBus: EventBus, services: Services, db: Database): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => handleTrashEmojiMessage(services, db, event), {
      durable: 'session-cleaner',
      queue: 'session-cleaner',
      maxRetries: 2,
      retryDelayMs: 1000,
      startFrom: 'last',
      concurrency: 5,
    });

    log.info('Session cleaner initialized');
  } catch (error) {
    log.error('Failed to set up session cleaner', { error: String(error) });
    throw error;
  }
}
