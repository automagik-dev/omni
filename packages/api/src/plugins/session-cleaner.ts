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
import type { ChannelType } from '@omni/db';
import type { Services } from '../services';
import { computeSessionId } from '../services/agent-runner';
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
 * Clear AgnoOS session for the given user and chat
 */
async function clearAgnoOSSession(
  services: Services,
  instanceId: string,
  from: string,
  chatId: string,
): Promise<{ sessionId: string; sessionStrategy: string }> {
  // Get instance with provider
  const instance = await services.agentRunner.getInstanceWithProvider(instanceId);

  if (!instance?.agentProviderId) {
    throw new Error('No agent provider configured for instance');
  }

  // Get provider
  const provider = await services.providers.getById(instance.agentProviderId);

  if (provider.schema !== 'agnoos') {
    throw new Error('Session clearing only supported for AgnoOS providers');
  }

  // Compute session ID using the same strategy as agent-runner
  const sessionStrategy = instance.agentSessionStrategy ?? 'per_user_per_chat';
  const sessionId = computeSessionId(sessionStrategy, from, chatId);

  // Create client and clear the session
  const client = createAgnoClient({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
  });

  await client.deleteSession(sessionId);

  return { sessionId, sessionStrategy };
}

/**
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
/**
 * Handle trash emoji message event
 */
async function handleTrashEmojiMessage(services: Services, event: TypedOmniEvent<'message.received'>): Promise<void> {
  const { content, chatId, from } = event.payload;
  const { instanceId } = event.metadata;

  if (!instanceId || !content?.text) return;
  if (!isTrashEmojiOnly(content.text)) return;

  log.info('Trash emoji detected, clearing session', { instanceId, chatId, from });

  try {
    const { sessionId, sessionStrategy } = await clearAgnoOSSession(services, instanceId, from, chatId);

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
    if (errorMessage.includes('No agent provider') || errorMessage.includes('only supported for AgnoOS')) {
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
export async function setupSessionCleaner(eventBus: EventBus, services: Services): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => handleTrashEmojiMessage(services, event), {
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
