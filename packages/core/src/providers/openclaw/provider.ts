/**
 * OpenClawAgentProvider — implements IAgentProvider for OpenClaw Gateway dispatch
 *
 * Key features:
 * - Accumulate-then-reply: collect streamed deltas by runId, return complete response
 * - Two-phase timeout: send-ack (~10s) + response-accumulation (configurable, default 120s)
 * - Circuit breaker: 3 consecutive trigger failures → 30s cooldown (DEC-11)
 * - Session key mapping: agent:<agentId>:omni-<chatId> (DEC-4)
 * - 1MB accumulation cap, 100KB message length cap (DEC-5)
 * - Sender name prefix support
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../logger';
import type { AgentTrigger, AgentTriggerResult, IAgentProvider } from '../types';
import { OpenClawClient } from './client';
import type { ChatEvent, OpenClawClientConfig, OpenClawProviderConfig } from './types';

const log = createLogger('openclaw:provider');

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip C0 control chars from untrusted input
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;

/** Strip C0 control characters from a string */
function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHAR_RE, '');
}

const MAX_MESSAGE_BYTES = 100 * 1024; // 100KB
const MAX_ACCUMULATION_BYTES = 1 * 1024 * 1024; // 1MB
const AGENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export class OpenClawAgentProvider implements IAgentProvider {
  readonly schema = 'openclaw' as const;
  readonly mode = 'round-trip' as const;

  // Circuit breaker state (DEC-11)
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private static readonly CIRCUIT_THRESHOLD = 3;
  private static readonly CIRCUIT_COOLDOWN_MS = 30_000;

  constructor(
    readonly id: string,
    readonly name: string,
    private client: OpenClawClient,
    private config: OpenClawProviderConfig,
  ) {
    // Validate agentId
    if (!AGENT_ID_REGEX.test(config.defaultAgentId)) {
      throw new Error(`Invalid agentId "${config.defaultAgentId}" — must match /^[a-zA-Z0-9_-]+$/`);
    }
  }

  canHandle(_trigger: AgentTrigger): boolean {
    return true;
  }

  async trigger(context: AgentTrigger): Promise<AgentTriggerResult> {
    const startTime = Date.now();
    const agentId = this.config.defaultAgentId;
    // Use context.sessionId (computed from instance's agentSessionStrategy) to preserve
    // per_user / per_user_per_chat / per_chat isolation. Falls back to chatId if missing.
    const sessionKey = this.buildSessionKey(agentId, context.sessionId || context.source.chatId);
    const agentTimeoutMs = this.config.agentTimeoutMs ?? 120_000;
    const sendAckTimeoutMs = this.config.sendAckTimeoutMs ?? 10_000;

    // Correlation Rosetta Stone log
    log.info('Triggering OpenClaw agent', {
      traceId: context.traceId,
      agentId,
      sessionKey,
      instanceId: context.source.instanceId,
      triggerType: context.type,
      providerId: this.id,
    });

    // Circuit breaker check (DEC-11)
    if (this.isCircuitOpen()) {
      const msg = 'The assistant is temporarily unavailable. Please try again in a moment.';
      log.warn('Circuit breaker open, rejecting trigger', {
        traceId: context.traceId,
        providerId: this.id,
        agentId,
        cooldownRemainingMs: this.circuitOpenUntil - Date.now(),
      });
      return {
        parts: [msg],
        metadata: {
          runId: '',
          providerId: this.id,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // Build message from trigger content
    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }

    if (!message) {
      log.debug('No content to send to agent', { traceId: context.traceId });
      return {
        parts: [],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }

    // Prefix sender name if configured
    if (this.config.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    // 100KB message length cap
    const messageBytes = new TextEncoder().encode(message).length;
    if (messageBytes > MAX_MESSAGE_BYTES) {
      log.error('Message exceeds 100KB limit', {
        traceId: context.traceId,
        providerId: this.id,
        messageBytes,
      });
      return {
        parts: ['Your message is too long. Please shorten it and try again.'],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }

    try {
      // Phase 1: Wait for connection + send chat.send
      await this.client.waitForReady(sendAckTimeoutMs);

      const sendResult = await this.client.chatSend(
        {
          sessionKey,
          message,
          deliver: true,
          idempotencyKey: randomUUID(),
        },
        sendAckTimeoutMs,
      );

      const runId = sendResult.runId;

      log.debug('chat.send acknowledged', {
        traceId: context.traceId,
        runId,
        wsRequestId: sendResult.runId,
        sessionKey,
        agentId,
        providerId: this.id,
      });

      // Phase 2: Accumulate response by runId
      const sendTimestamp = Date.now();
      const accumulated = await this.accumulateResponse(runId, agentTimeoutMs, context.traceId, sendTimestamp);

      // Success — reset circuit breaker
      this.consecutiveFailures = 0;

      const durationMs = Date.now() - startTime;

      log.info('OpenClaw agent responded', {
        traceId: context.traceId,
        runId,
        sessionKey,
        agentId,
        providerId: this.id,
        durationMs,
        responseBytes: accumulated.length,
      });

      // Return a single message part to avoid multi-message burst/loop perception in chat channels
      const normalized = accumulated.trim();
      const parts = normalized ? [normalized] : [];

      return {
        parts,
        metadata: {
          runId,
          providerId: this.id,
          durationMs,
        },
      };
    } catch (err) {
      this.consecutiveFailures++;
      const durationMs = Date.now() - startTime;

      log.error('OpenClaw trigger failed', {
        traceId: context.traceId,
        agentId,
        sessionKey,
        providerId: this.id,
        error: String(err),
        consecutiveFailures: this.consecutiveFailures,
        durationMs,
      });

      // Check if we should open circuit breaker
      if (this.consecutiveFailures >= OpenClawAgentProvider.CIRCUIT_THRESHOLD) {
        this.circuitOpenUntil = Date.now() + OpenClawAgentProvider.CIRCUIT_COOLDOWN_MS;
        log.warn('Circuit breaker OPENED', {
          providerId: this.id,
          agentId,
          consecutiveFailures: this.consecutiveFailures,
          cooldownMs: OpenClawAgentProvider.CIRCUIT_COOLDOWN_MS,
        });
      }

      return {
        parts: ['The assistant is taking longer than expected. Please try again in a moment.'],
        metadata: { runId: '', providerId: this.id, durationMs },
      };
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    const healthy = this.client.connected;
    return {
      healthy,
      latencyMs: Date.now() - start,
      error: healthy ? undefined : `WebSocket state: ${this.client.state}`,
    };
  }

  /** Graceful shutdown — dispose WS resources (DEC-13: 3s internal timeout) */
  async dispose(): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    const cleanup = new Promise<void>((resolve) => {
      this.client.stop();
      resolve();
    });
    await Promise.race([cleanup, timeout]);
    log.info('Provider disposed', {
      providerId: this.id,
    });
  }

  /** Clear an OpenClaw session (trash emoji reset).
   *  sessionKey is the strategy-computed sessionId (from computeSessionId).
   *  We rebuild the OpenClaw key in our format: `agent:<agentId>:omni-<sessionId>`.
   *  chatId param kept for backwards compatibility but sessionKey is now preferred
   *  since it encodes the correct session strategy. */
  async resetSession(sessionKey: string, chatId?: string): Promise<void> {
    // Use sessionKey (strategy-computed) to match what trigger() now uses
    const effectiveKey = this.buildSessionKey(this.config.defaultAgentId, sessionKey);
    try {
      await this.client.waitForReady(5_000);
      await this.client.deleteSession(effectiveKey);
      log.info('Session reset', { providerId: this.id, sessionKey: effectiveKey, originalKey: sessionKey, chatId });
    } catch (err) {
      log.error('Session reset failed', {
        providerId: this.id,
        sessionKey: effectiveKey,
        error: String(err),
      });
      throw err;
    }
  }

  // === Private ===

  private buildSessionKey(agentId: string, chatId: string): string {
    // Sanitize chatId — strip C0 control chars, dangerous path chars, and cap length
    const safeChatId = stripControlChars(chatId)
      .replace(/[:/\\]/g, '-')
      .slice(0, 256);
    return `agent:${agentId}:omni-${safeChatId}`;
  }

  private isCircuitOpen(): boolean {
    if (this.circuitOpenUntil === 0) return false;
    if (Date.now() >= this.circuitOpenUntil) {
      // Circuit breaker cooldown expired — close it
      log.info('Circuit breaker CLOSED', { providerId: this.id });
      this.circuitOpenUntil = 0;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private accumulateResponse(
    runId: string,
    timeoutMs: number,
    traceId: string,
    sendTimestamp: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let accumulated = '';
      let accumulatedBytes = 0;
      let deltasReceived = 0;
      let lastDeltaReceivedAt: number | null = null;
      let firstDeltaAt: number | null = null;
      let resolved = false;

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        this.client.unregisterAccumulation(runId);

        // Distinguish "never responded" from "stalled mid-stream"
        if (deltasReceived === 0) {
          log.warn('Dead-response: chat.send acknowledged but no events received', {
            traceId,
            runId,
            providerId: this.id,
            timeoutMs,
          });
        } else {
          log.warn('Accumulation timeout (stalled mid-stream)', {
            traceId,
            runId,
            providerId: this.id,
            deltasReceived,
            lastDeltaReceivedAt,
            accumulatedBytes,
            timeoutMs,
          });
        }

        reject(new Error(`Accumulation timeout after ${timeoutMs}ms (deltas: ${deltasReceived})`));
      }, timeoutMs);

      const callback = (event: ChatEvent) => {
        if (resolved) return;

        if (event.state === 'delta' || event.state === 'final') {
          const now = Date.now();
          deltasReceived++;
          lastDeltaReceivedAt = now;
          if (!firstDeltaAt) {
            firstDeltaAt = now;
            const ttfdMs = now - sendTimestamp;
            log.debug('Time-to-first-delta', { traceId, runId, ttfdMs, providerId: this.id });
          }

          // Extract text content from message
          const text = this.extractText(event);
          if (text) {
            const textBytes = new TextEncoder().encode(text).length;
            if (accumulatedBytes + textBytes > MAX_ACCUMULATION_BYTES) {
              resolved = true;
              clearTimeout(timer);
              this.client.unregisterAccumulation(runId);
              log.error('Accumulation cap (1MB) exceeded', {
                traceId,
                runId,
                providerId: this.id,
                accumulatedBytes: accumulatedBytes + textBytes,
              });
              reject(new Error('Response too large (1MB cap)'));
              return;
            }
            accumulated += text;
            accumulatedBytes += textBytes;
          }
        }

        if (event.state === 'final') {
          resolved = true;
          clearTimeout(timer);
          this.client.unregisterAccumulation(runId);
          resolve(accumulated);
          return;
        }

        if (event.state === 'error' || event.state === 'aborted') {
          resolved = true;
          clearTimeout(timer);
          this.client.unregisterAccumulation(runId);
          reject(new Error(event.errorMessage ?? `Agent ${event.state}`));
        }
      };

      this.client.registerAccumulation(runId, callback);
    });
  }

  private extractText(event: ChatEvent): string {
    if (!event.message) return '';
    const content = event.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
        .join('');
    }
    return '';
  }
}

/** Helper to create an OpenClawAgentProvider with its own client */
export function createOpenClawProvider(
  id: string,
  name: string,
  clientConfig: OpenClawClientConfig,
  providerConfig: OpenClawProviderConfig,
): OpenClawAgentProvider {
  const client = new OpenClawClient(clientConfig);
  client.start();
  return new OpenClawAgentProvider(id, name, client, providerConfig);
}
