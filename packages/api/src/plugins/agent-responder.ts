/**
 * Agent Responder Plugin
 *
 * Subscribes to message.received events and triggers agent responses when:
 * 1. Instance has an agent provider configured
 * 2. Message passes the reply filter
 * 3. Debounce period has elapsed
 *
 * Flow:
 * - message.received → check reply filter → buffer (debounce) → call agent → split → send with delays
 *
 * Features:
 * - Reply filtering (DM, mention, reply, name match)
 * - Message debouncing with typing-aware restart
 * - Response splitting on \n\n
 * - Typing presence during agent processing
 * - Configurable delays between split messages
 */

import type { EventBus, MessageReceivedPayload } from '@omni/core';
import { ProviderError, createLogger } from '@omni/core';
import type { ChannelType, Instance } from '@omni/db';
import type { AgentRunnerService, Services } from '../services';
import {
  type MessageContext,
  type SplitDelayConfig,
  calculateSplitDelay,
  getSplitDelayConfig,
  shouldAgentReply,
} from '../services/agent-runner';
import { getPlugin } from './loader';

const log = createLogger('agent-responder');

// ============================================================================
// Types
// ============================================================================

interface BufferedMessage {
  payload: MessageReceivedPayload;
  metadata: MessageMetadata;
  timestamp: number;
}

interface MessageMetadata {
  instanceId: string;
  channelType?: string;
  personId?: string;
  platformIdentityId?: string;
}

interface DebounceConfig {
  mode: 'disabled' | 'fixed' | 'randomized';
  minMs: number;
  maxMs: number;
  restartOnTyping: boolean;
}

// ============================================================================
// Message Debouncer
// ============================================================================

class MessageDebouncer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>;

  constructor(onFlush: (chatKey: string, messages: BufferedMessage[]) => Promise<void>) {
    this.onFlush = onFlush;
  }

  /**
   * Generate a unique key for the chat (instance + chat)
   */
  private getChatKey(instanceId: string, chatId: string): string {
    return `${instanceId}:${chatId}`;
  }

  /**
   * Buffer a message and start/restart the debounce timer
   */
  buffer(instanceId: string, chatId: string, message: BufferedMessage, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);

    // Add to buffer
    const buffer = this.buffers.get(chatKey) ?? [];
    buffer.push(message);
    this.buffers.set(chatKey, buffer);

    // Restart timer
    this.restartTimer(chatKey, config);
  }

  /**
   * Handle user typing event - restart timer if config allows
   */
  onUserTyping(instanceId: string, chatId: string, config: DebounceConfig): void {
    const chatKey = this.getChatKey(instanceId, chatId);

    if (config.restartOnTyping && this.buffers.has(chatKey)) {
      log.debug('Restarting debounce timer on user typing', { chatKey });
      this.restartTimer(chatKey, config);
    }
  }

  /**
   * Check if there's a pending buffer for a chat
   */
  hasPending(instanceId: string, chatId: string): boolean {
    return this.buffers.has(this.getChatKey(instanceId, chatId));
  }

  private restartTimer(chatKey: string, config: DebounceConfig): void {
    // Cancel existing timer
    const existing = this.timers.get(chatKey);
    if (existing) {
      clearTimeout(existing);
    }

    // Calculate delay
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

    // Set new timer
    const timer = setTimeout(() => {
      this.flush(chatKey);
    }, delay);

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

  /**
   * Clear all pending buffers and timers
   */
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.buffers.clear();
    this.timers.clear();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get debounce config from instance
 */
function getDebounceConfig(instance: Instance): DebounceConfig {
  return {
    mode: instance.messageDebounceMode ?? 'disabled',
    minMs: instance.messageDebounceMinMs ?? 0,
    maxMs: instance.messageDebounceMaxMs ?? 0,
    restartOnTyping: instance.messageDebounceRestartOnTyping ?? false,
  };
}

/**
 * Build message context for reply filter evaluation
 */
function buildMessageContext(payload: MessageReceivedPayload, instance: Instance): MessageContext {
  const rawPayload = payload.rawPayload ?? {};
  const chatId = payload.chatId ?? '';

  // Determine if DM (not a group chat)
  // WhatsApp: groups have @g.us, DMs have @s.whatsapp.net
  // Discord: need to check channel type
  const isDirectMessage =
    !chatId.includes('@g.us') && !chatId.includes('@broadcast') && !(rawPayload.isGroup as boolean);

  // Check for bot mention
  // WhatsApp: check if message mentions our JID
  // Discord: check if message has @mention of our user
  const mentionedJids = (rawPayload.mentionedJids as string[]) ?? [];
  const ownerJid = instance.ownerIdentifier ?? '';
  const mentionsBot = mentionedJids.some((jid) => jid === ownerJid || jid.includes(ownerJid));

  // Check if reply to bot message
  // Look at quoted message sender
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
 * Send typing presence to channel
 */
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
    // Non-critical - log and continue
    log.debug('Failed to send typing presence', { error: String(error) });
  }
}

/**
 * Send a text message via channel plugin
 */
async function sendTextMessage(channel: ChannelType, instanceId: string, chatId: string, text: string): Promise<void> {
  const plugin = await getPlugin(channel);
  if (!plugin) {
    throw new Error(`Channel plugin not found: ${channel}`);
  }

  await plugin.sendMessage(instanceId, {
    to: chatId,
    content: {
      type: 'text',
      text,
    },
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Channel-specific message length limits
 * Discord: 2000 characters
 * WhatsApp: 65536 characters (practical limit)
 * Others: default to a safe 4000 characters
 */
const CHANNEL_MESSAGE_LIMITS: Record<string, number> = {
  discord: 2000,
  'whatsapp-baileys': 65536,
  'whatsapp-cloud': 65536,
  slack: 40000,
  telegram: 4096,
};

const DEFAULT_MESSAGE_LIMIT = 4000;

/**
 * Get the message character limit for a channel
 */
function getMessageLimit(channel: ChannelType): number {
  return CHANNEL_MESSAGE_LIMITS[channel] ?? DEFAULT_MESSAGE_LIMIT;
}

/**
 * Chunk text into parts that fit within the character limit
 * Tries to split at natural boundaries (newlines, sentences, words)
 */
function chunkText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point within the limit
    let splitIndex = maxLength;

    // Try to split at a double newline (paragraph boundary)
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitIndex = paragraphBreak + 2; // Include the newlines
    } else {
      // Try to split at a single newline
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.5) {
        splitIndex = lineBreak + 1;
      } else {
        // Try to split at a sentence boundary (. ! ?)
        const sentenceEnd = Math.max(
          remaining.lastIndexOf('. ', maxLength),
          remaining.lastIndexOf('! ', maxLength),
          remaining.lastIndexOf('? ', maxLength),
        );
        if (sentenceEnd > maxLength * 0.5) {
          splitIndex = sentenceEnd + 2;
        } else {
          // Try to split at a word boundary (space)
          const wordBreak = remaining.lastIndexOf(' ', maxLength);
          if (wordBreak > maxLength * 0.5) {
            splitIndex = wordBreak + 1;
          }
          // Otherwise just split at maxLength (hard cut)
        }
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.filter(Boolean);
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Send response parts with configured delays between them
 * Automatically chunks messages that exceed channel limits
 */
async function sendResponseParts(
  channel: ChannelType,
  instanceId: string,
  chatId: string,
  parts: string[],
  splitConfig: SplitDelayConfig,
): Promise<void> {
  const messageLimit = getMessageLimit(channel);

  // Flatten parts that exceed the message limit into smaller chunks
  const allChunks: string[] = [];
  for (const part of parts) {
    allChunks.push(...chunkText(part, messageLimit));
  }

  for (const [index, chunk] of allChunks.entries()) {
    await sendTextMessage(channel, instanceId, chatId, chunk);

    // Delay between chunks (except last)
    const isLastChunk = index === allChunks.length - 1;
    if (!isLastChunk) {
      const delay = calculateSplitDelay(splitConfig);
      if (delay > 0) {
        await sendTypingPresence(channel, instanceId, chatId, 'composing');
        await sleep(delay);
      }
    }
  }

  // Stop typing after all parts sent
  await sendTypingPresence(channel, instanceId, chatId, 'paused');
}

/**
 * Handle agent response error - send user-friendly message if appropriate
 */
async function handleAgentError(
  error: unknown,
  channel: ChannelType,
  instanceId: string,
  chatId: string,
): Promise<void> {
  log.error('Failed to process agent response', { instanceId, chatId, error: String(error) });

  // Only send error message for non-internal errors
  if (error instanceof ProviderError) {
    const isInternalError = error.code === 'AUTHENTICATION_FAILED' || error.code === 'SERVER_ERROR';
    if (!isInternalError) {
      try {
        await sendTextMessage(
          channel,
          instanceId,
          chatId,
          'Sorry, I encountered an error processing your message. Please try again.',
        );
      } catch {
        // Ignore send error
      }
    }
  }
}

/**
 * Process buffered messages and generate agent response
 */
async function processAgentResponse(
  agentRunner: AgentRunnerService,
  instance: Instance,
  messages: BufferedMessage[],
): Promise<void> {
  const firstMessage = messages[0];
  if (!firstMessage) return;

  const chatId = firstMessage.payload.chatId;
  const senderId = firstMessage.payload.from ?? '';
  const channel = (firstMessage.metadata.channelType ?? 'whatsapp') as ChannelType;

  // Get sender name from DB or fallback to pushName from payload
  const rawPayload = firstMessage.payload.rawPayload ?? {};
  const pushName = (rawPayload.pushName as string) ?? (rawPayload.displayName as string);
  const senderName = await agentRunner.getSenderName(firstMessage.metadata.personId, pushName);

  log.info('Processing agent response', {
    instanceId: instance.id,
    chatId,
    messageCount: messages.length,
    senderName,
  });

  // Start typing immediately
  await sendTypingPresence(channel, instance.id, chatId, 'composing');

  try {
    // Aggregate message texts
    const messageTexts = messages.map((m) => m.payload.content?.text).filter((t): t is string => !!t);

    if (!messageTexts.length) {
      log.debug('No text content in messages, skipping agent call');
      await sendTypingPresence(channel, instance.id, chatId, 'paused');
      return;
    }

    // Call agent
    const result = await agentRunner.run({
      instance,
      chatId,
      senderId,
      senderName,
      messages: messageTexts,
    });

    // Send response parts with delays
    await sendResponseParts(channel, instance.id, chatId, result.parts, getSplitDelayConfig(instance));

    log.info('Agent response sent', {
      instanceId: instance.id,
      chatId,
      parts: result.parts.length,
      runId: result.metadata.runId,
    });
  } catch (error) {
    await handleAgentError(error, channel, instance.id, chatId);
  } finally {
    // Clear typing
    await sendTypingPresence(channel, instance.id, chatId, 'paused');
  }
}

// ============================================================================
// Setup
// ============================================================================

/**
 * Set up agent responder - subscribes to message events and triggers agent responses
 */
export async function setupAgentResponder(eventBus: EventBus, services: Services): Promise<void> {
  const agentRunner = services.agentRunner;

  // Create debouncer
  const debouncer = new MessageDebouncer(async (_chatKey, messages) => {
    // Get instance from first message
    const firstMsg = messages[0];
    if (!firstMsg) return;

    const instanceId = firstMsg.metadata.instanceId;
    const instance = await agentRunner.getInstanceWithProvider(instanceId);

    if (!instance) {
      log.warn('Instance not found for debounced messages', { instanceId });
      return;
    }

    await processAgentResponse(agentRunner, instance, messages);
  });

  try {
    // Subscribe to message.received
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        // Skip if no instance ID
        if (!metadata.instanceId) {
          return;
        }

        // Skip messages from ourselves
        if (payload.from === metadata.platformIdentityId) {
          return;
        }

        try {
          // Get instance config
          const instance = await agentRunner.getInstanceWithProvider(metadata.instanceId);
          if (!instance) {
            return;
          }

          // Skip if no agent provider configured
          if (!instance.agentProviderId) {
            return;
          }

          // Build message context and check reply filter
          const messageContext = buildMessageContext(payload, instance);
          if (!shouldAgentReply(instance.agentReplyFilter, messageContext)) {
            log.debug('Message did not pass reply filter', {
              instanceId: instance.id,
              chatId: payload.chatId,
            });
            return;
          }

          // Get debounce config
          const debounceConfig = getDebounceConfig(instance);

          // Buffer message
          debouncer.buffer(
            metadata.instanceId,
            payload.chatId,
            {
              payload,
              metadata: {
                instanceId: metadata.instanceId,
                channelType: metadata.channelType,
                personId: metadata.personId,
                platformIdentityId: metadata.platformIdentityId,
              },
              timestamp: event.timestamp,
            },
            debounceConfig,
          );

          log.debug('Buffered message for agent response', {
            instanceId: metadata.instanceId,
            chatId: payload.chatId,
            debounceMode: debounceConfig.mode,
          });
        } catch (error) {
          log.error('Error processing message for agent response', {
            instanceId: metadata.instanceId,
            error: String(error),
          });
          // Don't rethrow - this is non-critical and shouldn't fail message persistence
        }
      },
      {
        durable: 'agent-responder',
        queue: 'agent-responder',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'last',
        concurrency: 5,
      },
    );

    // Subscribe to presence.typing for typing-aware debounce
    // Note: This event is emitted when we receive typing indicators from users
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
          // Non-critical
          log.debug('Error handling typing event', { error: String(error) });
        }
      },
      {
        durable: 'agent-responder-typing',
        queue: 'agent-responder',
        maxRetries: 1,
        startFrom: 'last',
        concurrency: 10,
      },
    );

    log.info('Agent responder initialized');
  } catch (error) {
    log.error('Failed to set up agent responder', { error: String(error) });
    throw error;
  }
}
