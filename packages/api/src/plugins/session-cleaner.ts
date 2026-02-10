/**
 * Session Cleaner Plugin
 *
 * Listens for trash emoji messages and clears the agent session.
 * When a user sends only a trash emoji (🗑️ or 🗑), their conversation
 * history with the agent is cleared via DELETE /sessions/{identity}.
 * Sends a confirmation message and blocks agent response.
 */

import type { EventBus } from '@omni/core';
import { createAgnoClient, createLogger } from '@omni/core';
import type { ChannelType } from '@omni/db';
import type { Services } from '../services';
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
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
export async function setupSessionCleaner(eventBus: EventBus, services: Services): Promise<void> {
  try {
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const { content, chatId, from } = event.payload;
        const { instanceId } = event.metadata;

        if (!instanceId || !content?.text) return;

        // Check if message is only trash emoji
        if (!isTrashEmojiOnly(content.text)) return;

        log.info('Trash emoji detected, clearing session', {
          instanceId,
          chatId,
          from,
        });

        try {
          // Get instance with provider
          const instance = await services.agentRunner.getInstanceWithProvider(instanceId);

          if (!instance?.agentProviderId) {
            log.debug('No agent provider configured for instance', { instanceId });
            return;
          }

          // Get provider
          const provider = await services.providers.getById(instance.agentProviderId);

          if (provider.schema !== 'agnoos') {
            log.debug('Session clearing only supported for AgnoOS providers', {
              instanceId,
              providerId: provider.id,
              schema: provider.schema,
            });
            return;
          }

          // Use chatId as sessionId (this is the sender's identity)
          const sessionId = chatId;

          // Create client and clear the session
          const client = createAgnoClient({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey ?? '',
            defaultTimeoutMs: (provider.defaultTimeout ?? 60) * 1000,
          });

          await client.deleteSession(sessionId);
          log.info('Session cleared successfully', {
            instanceId,
            sessionId,
          });

          // Send confirmation message
          try {
            const channel = instance.channel as ChannelType;
            const plugin = await getPlugin(channel);
            if (plugin) {
              await plugin.sendMessage(instanceId, {
                to: chatId,
                content: {
                  type: 'text',
                  text: '✅ Conversa limpa! Sua sessão com o assistente foi resetada.',
                },
              });
              log.info('Sent session cleared confirmation', { instanceId, chatId });
            }
          } catch (sendError) {
            log.error('Failed to send confirmation message', {
              instanceId,
              chatId,
              error: String(sendError),
            });
          }
        } catch (error) {
          log.error('Failed to clear session', {
            instanceId,
            chatId,
            error: String(error),
          });

          // Send error message
          try {
            const instance = await services.instances.getById(instanceId);
            const channel = instance.channel as ChannelType;
            const plugin = await getPlugin(channel);
            if (plugin) {
              await plugin.sendMessage(instanceId, {
                to: chatId,
                content: {
                  type: 'text',
                  text: '❌ Erro ao limpar sessão. Tente novamente.',
                },
              });
            }
          } catch (sendError) {
            log.error('Failed to send error message', { instanceId, chatId, error: String(sendError) });
          }
        }
      },
      {
        durable: 'session-cleaner',
        queue: 'session-cleaner',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 5,
      },
    );

    log.info('Session cleaner initialized');
  } catch (error) {
    log.error('Failed to set up session cleaner', { error: String(error) });
    throw error;
  }
}
