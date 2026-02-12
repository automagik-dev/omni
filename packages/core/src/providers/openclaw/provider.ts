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
import type { AgentTrigger, AgentTriggerResult, IAgentProvider, StreamDelta } from '../types';
import { OpenClawClient } from './client';
import type { AgentEventPayload, ChatEvent, OpenClawClientConfig, OpenClawProviderConfig } from './types';

const log = createLogger('openclaw:provider');

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strip C0 control chars from untrusted input
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;

/** Strip C0 control characters from a string */
function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHAR_RE, '');
}

interface AccumulationState {
  runId: string;
  traceId: string;
  sendTimestamp: number;
  accumulated: string;
  accumulatedBytes: number;
  deltasReceived: number;
  lastDeltaReceivedAt: number | null;
  firstDeltaAt: number | null;
}

const MAX_MESSAGE_BYTES = 100 * 1024; // 100KB
const MAX_ACCUMULATION_BYTES = 1 * 1024 * 1024; // 1MB
const AGENT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Mutable state container for a single triggerStream() invocation. */
class StreamContext {
  runId = '';
  readonly queue: StreamDelta[] = [];
  resolve: (() => void) | null = null;
  done = false;
  timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  deltasReceived = 0;
  thinkingText = '';
  thinkingStartMs = 0;
  thinkingDurationMs: number | undefined;
  contentText = '';
  sawThinkingStarted = false;
  sawContentStarted = false;

  constructor(private readonly maxQueueSize: number) {}

  push(delta: StreamDelta): void {
    if (this.queue.length >= this.maxQueueSize) {
      // Deltas are cumulative snapshots — oldest entries are safe to discard under pressure
      this.queue.shift();
    }
    this.queue.push(delta);
    this.wake();
  }

  finish(): void {
    this.done = true;
    this.wake();
  }

  private wake(): void {
    this.resolve?.();
    this.resolve = null;
  }
}

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

  /** Build the outbound message string from trigger content, or null if empty / too large. */
  private buildMessage(context: AgentTrigger): { message: string } | { error: string } | null {
    let message = '';
    if (context.content.text) {
      message = context.content.text;
    } else if (context.content.emoji) {
      message = `[Reaction: ${context.content.emoji} on message ${context.content.referencedMessageId ?? context.source.messageId}]`;
    }
    if (!message) return null;

    if (this.config.prefixSenderName !== false && context.sender.displayName) {
      message = `[${context.sender.displayName}]: ${message}`;
    }

    const messageBytes = new TextEncoder().encode(message).length;
    if (messageBytes > MAX_MESSAGE_BYTES) {
      return { error: 'Your message is too long. Please shorten it and try again.' };
    }

    return { message };
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
    const built = this.buildMessage(context);
    if (!built) {
      log.debug('No content to send to agent', { traceId: context.traceId });
      return {
        parts: [],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }
    if ('error' in built) {
      log.error('Message exceeds 100KB limit', { traceId: context.traceId, providerId: this.id });
      return {
        parts: [built.error],
        metadata: { runId: '', providerId: this.id, durationMs: Date.now() - startTime },
      };
    }
    const { message } = built;

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

  async *triggerStream(context: AgentTrigger): AsyncGenerator<StreamDelta> {
    const startTime = Date.now();
    const agentId = this.config.defaultAgentId;
    const sessionKey = this.buildSessionKey(agentId, context.sessionId || context.source.chatId);
    const agentTimeoutMs = this.config.agentTimeoutMs ?? 120_000;
    const sendAckTimeoutMs = this.config.sendAckTimeoutMs ?? 10_000;
    const MAX_QUEUE_SIZE = 100;

    if (this.isCircuitOpen()) {
      yield { phase: 'error', error: 'The assistant is temporarily unavailable. Please try again in a moment.' };
      return;
    }

    const built = this.buildMessage(context);
    if (!built) return;
    if ('error' in built) {
      yield { phase: 'error', error: built.error };
      return;
    }
    const { message } = built;

    const ctx = new StreamContext(MAX_QUEUE_SIZE);

    try {
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

      ctx.runId = sendResult.runId;

      log.debug('triggerStream: started', {
        traceId: context.traceId,
        runId: ctx.runId,
        sessionKey,
        providerId: this.id,
      });

      ctx.timeoutHandle = setTimeout(() => {
        if (ctx.done) return;
        log.warn('triggerStream: timeout', {
          traceId: context.traceId,
          runId: ctx.runId,
          timeoutMs: agentTimeoutMs,
          deltasReceived: ctx.deltasReceived,
          providerId: this.id,
        });
        this.registerStreamFailure('timeout');
        ctx.push({
          phase: 'error',
          error: 'The assistant is taking longer than expected. Please try again in a moment.',
        });
        ctx.finish();
      }, agentTimeoutMs);

      this.client.registerAgentAccumulation(ctx.runId, (event: AgentEventPayload) => {
        this.handleStreamEvent(event, ctx, context, startTime);
      });

      while (!ctx.done) {
        const next = ctx.queue.shift();
        if (next) {
          yield next;
        } else {
          await new Promise<void>((r) => {
            ctx.resolve = r;
          });
        }
      }

      for (let item = ctx.queue.shift(); item; item = ctx.queue.shift()) {
        yield item;
      }
    } catch (err) {
      const error = String(err);
      this.registerStreamFailure(error);
      log.error('triggerStream: error', {
        traceId: context.traceId,
        runId: ctx.runId,
        sessionKey,
        providerId: this.id,
        error,
        consecutiveFailures: this.consecutiveFailures,
      });
      yield { phase: 'error', error: 'The assistant is taking longer than expected. Please try again in a moment.' };
    } finally {
      if (ctx.timeoutHandle) clearTimeout(ctx.timeoutHandle);
      if (ctx.runId) this.client.unregisterAgentAccumulation(ctx.runId);
    }
  }

  /** Register a stream failure for circuit breaker tracking. */
  private registerStreamFailure(error: string): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= OpenClawAgentProvider.CIRCUIT_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + OpenClawAgentProvider.CIRCUIT_COOLDOWN_MS;
      log.warn('Circuit breaker OPENED', {
        providerId: this.id,
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: OpenClawAgentProvider.CIRCUIT_COOLDOWN_MS,
        error,
      });
    }
  }

  /** Handle a single agent event within a stream context. */
  private handleStreamEvent(
    event: AgentEventPayload,
    ctx: StreamContext,
    trigger: AgentTrigger,
    startTime: number,
  ): void {
    if (ctx.done) return;
    ctx.deltasReceived++;
    const data = event.data ?? {};

    switch (event.stream) {
      case 'thinking':
        this.handleThinkingEvent(data, ctx, trigger);
        break;
      case 'assistant':
        this.handleAssistantEvent(data, ctx, trigger);
        break;
      case 'tool':
        log.debug('triggerStream: tool_event', {
          traceId: trigger.traceId,
          runId: ctx.runId,
          seq: event.seq,
          providerId: this.id,
        });
        break;
      case 'lifecycle':
        this.handleLifecycleEvent(data, ctx, trigger, startTime);
        break;
      case 'error':
        this.handleErrorEvent(data, ctx, trigger);
        break;
    }
  }

  private handleThinkingEvent(data: Record<string, unknown>, ctx: StreamContext, trigger: AgentTrigger): void {
    const text = typeof data.text === 'string' ? data.text : '';
    if (!ctx.thinkingStartMs) {
      ctx.thinkingStartMs = Date.now();
      if (!ctx.sawThinkingStarted) {
        ctx.sawThinkingStarted = true;
        log.debug('triggerStream: thinking_started', {
          traceId: trigger.traceId,
          runId: ctx.runId,
          providerId: this.id,
        });
      }
    }
    ctx.thinkingText = text;
    ctx.push({ phase: 'thinking', thinking: text, thinkingElapsedMs: Date.now() - ctx.thinkingStartMs });
  }

  private handleAssistantEvent(data: Record<string, unknown>, ctx: StreamContext, trigger: AgentTrigger): void {
    const text = typeof data.text === 'string' ? data.text : '';
    ctx.contentText = text;
    if (!ctx.sawContentStarted) {
      ctx.sawContentStarted = true;
      log.debug('triggerStream: content_started', { traceId: trigger.traceId, runId: ctx.runId, providerId: this.id });
    }
    if (ctx.thinkingStartMs && ctx.thinkingDurationMs === undefined) {
      ctx.thinkingDurationMs = Date.now() - ctx.thinkingStartMs;
    }
    ctx.push({
      phase: 'content',
      content: text,
      thinking: ctx.thinkingText || undefined,
      thinkingDurationMs: ctx.thinkingDurationMs || undefined,
    });
  }

  private handleLifecycleEvent(
    data: Record<string, unknown>,
    ctx: StreamContext,
    trigger: AgentTrigger,
    startTime: number,
  ): void {
    const phase = data.phase;
    if (phase === 'end') {
      if (ctx.thinkingStartMs && ctx.thinkingDurationMs === undefined) {
        ctx.thinkingDurationMs = Date.now() - ctx.thinkingStartMs;
      }
      this.consecutiveFailures = 0;
      log.info('triggerStream: completed', {
        traceId: trigger.traceId,
        runId: ctx.runId,
        providerId: this.id,
        durationMs: Date.now() - startTime,
      });
      ctx.push({
        phase: 'final',
        content: ctx.contentText,
        thinking: ctx.thinkingText || undefined,
        thinkingDurationMs: ctx.thinkingDurationMs,
      });
      ctx.finish();
      return;
    }
    if (phase === 'error') {
      const error = typeof data.error === 'string' && data.error ? data.error : 'Agent error';
      log.error('triggerStream: lifecycle_error', {
        traceId: trigger.traceId,
        runId: ctx.runId,
        providerId: this.id,
        error,
      });
      this.registerStreamFailure(error);
      ctx.push({ phase: 'error', error });
      ctx.finish();
    }
  }

  private handleErrorEvent(data: Record<string, unknown>, ctx: StreamContext, trigger: AgentTrigger): void {
    const error =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      'Unknown error';
    log.error('triggerStream: error_stream', {
      traceId: trigger.traceId,
      runId: ctx.runId,
      providerId: this.id,
      error,
    });
    this.registerStreamFailure(error);
    ctx.push({ phase: 'error', error });
    ctx.finish();
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

  /** Process a single accumulation event. Returns the outcome for the caller. */
  private processAccumulationEvent(
    event: ChatEvent,
    state: AccumulationState,
  ): 'continue' | 'final' | 'cap_exceeded' | 'error' {
    if (event.state === 'error' || event.state === 'aborted') return 'error';
    if (event.state !== 'delta' && event.state !== 'final') return 'continue';

    const now = Date.now();
    state.deltasReceived++;
    state.lastDeltaReceivedAt = now;
    if (!state.firstDeltaAt) {
      state.firstDeltaAt = now;
      const ttfdMs = now - state.sendTimestamp;
      log.debug('Time-to-first-delta', { traceId: state.traceId, runId: state.runId, ttfdMs, providerId: this.id });
    }

    // Gateway sends CUMULATIVE snapshots: replace, don't append
    const text = this.extractText(event);
    if (text) {
      const bytes = new TextEncoder().encode(text).length;
      if (bytes > MAX_ACCUMULATION_BYTES) return 'cap_exceeded';
      state.accumulated = text;
      state.accumulatedBytes = bytes;
    }

    return event.state === 'final' ? 'final' : 'continue';
  }

  private accumulateResponse(
    runId: string,
    timeoutMs: number,
    traceId: string,
    sendTimestamp: number,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const state: AccumulationState = {
        runId,
        traceId,
        sendTimestamp,
        accumulated: '',
        accumulatedBytes: 0,
        deltasReceived: 0,
        lastDeltaReceivedAt: null,
        firstDeltaAt: null,
      };
      let resolved = false;

      const finish = (cb: () => void) => {
        resolved = true;
        clearTimeout(timer);
        this.client.unregisterAccumulation(runId);
        cb();
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        finish(() => {
          const kind = state.deltasReceived === 0 ? 'Dead-response' : 'Accumulation timeout (stalled mid-stream)';
          log.warn(kind, { traceId, runId, providerId: this.id, deltasReceived: state.deltasReceived, timeoutMs });
          reject(new Error(`Accumulation timeout after ${timeoutMs}ms (deltas: ${state.deltasReceived})`));
        });
      }, timeoutMs);

      this.client.registerAccumulation(runId, (event: ChatEvent) => {
        if (resolved) return;
        const outcome = this.processAccumulationEvent(event, state);
        if (outcome === 'continue') return;
        if (outcome === 'final') {
          finish(() => resolve(state.accumulated));
        } else if (outcome === 'cap_exceeded') {
          finish(() => {
            log.error('Accumulation cap (1MB) exceeded', { traceId, runId, providerId: this.id });
            reject(new Error('Response too large (1MB cap)'));
          });
        } else {
          finish(() => reject(new Error(event.errorMessage ?? `Agent ${event.state}`)));
        }
      });
    });
  }

  private extractText(event: ChatEvent): string {
    if (!event.message) return '';
    const content = event.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is typeof b & { text: string } => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
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
