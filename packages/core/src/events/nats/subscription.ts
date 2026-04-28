/**
 * NATS subscription management
 *
 * Handles event consumption with:
 * - Automatic ack/nak handling
 * - Retry with exponential backoff
 * - Error handling and dead letter routing
 */

import { ROOT_CONTEXT, type SpanContext, TraceFlags, context as otelContext, trace } from '@opentelemetry/api';
import type { ConsumerMessages, JsMsg } from 'nats';
import type { ZodSchema, z } from 'zod';
import { createLogger } from '../../logger';
import type { GenericEventHandler, SubscribeOptions, Subscription } from '../bus';
import type { EventType, GenericEventPayload, OmniEvent } from '../types';
import { DEFAULT_CONSUMER_CONFIG, calculateBackoffDelay } from './consumer';
import { eventRegistry } from './registry';

const log = createLogger('nats:subscription');

/**
 * Extract a span context from inbound NATS message headers.
 *
 * Honors W3C `traceparent` first, falls back to khal-os custom headers
 * (`x-trace-id`, `x-span-id`) when present. Returns `null` when neither is
 * available — the handler will then run in whatever context is current.
 *
 * Backend-neutral: only depends on `@opentelemetry/api`.
 */
function extractSpanContextFromMessage(msg: JsMsg): SpanContext | null {
  try {
    const h = msg.headers;
    if (!h) return null;

    // W3C `traceparent` — format: "00-<32hex traceId>-<16hex spanId>-<2hex flags>"
    const tp = h.get('traceparent');
    if (tp) {
      const [version, traceId, spanId, flags] = tp.split('-');
      if (version === '00' && traceId?.length === 32 && spanId?.length === 16) {
        return {
          traceId,
          spanId,
          traceFlags: Number.parseInt(flags ?? '01', 16) as TraceFlags,
          isRemote: true,
        };
      }
    }

    // khal-os custom shape (forward-compat with khal-os o11y)
    const xTrace = h.get('x-trace-id');
    const xSpan = h.get('x-span-id');
    if (xTrace && xSpan && xTrace.length === 32 && xSpan.length === 16) {
      return {
        traceId: xTrace,
        spanId: xSpan,
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Options for creating a subscription wrapper
 */
export interface SubscriptionWrapperOptions extends SubscribeOptions {
  /** The subject pattern being subscribed to */
  pattern: string;
  /** The consumer messages iterator */
  consumer: ConsumerMessages;
  /** Handler function for events */
  handler: GenericEventHandler;
  /** Optional callback when event processing fails permanently */
  onDeadLetter?: (event: OmniEvent, error: Error, retryCount: number) => Promise<void>;
}

/**
 * Create a subscription wrapper that handles message processing
 */
export function createSubscription(options: SubscriptionWrapperOptions): Subscription {
  const {
    pattern,
    consumer,
    handler,
    maxRetries = DEFAULT_CONSUMER_CONFIG.maxRetries,
    retryDelayMs = DEFAULT_CONSUMER_CONFIG.retryDelayMs,
    concurrency = 1,
    onDeadLetter,
  } = options;

  const subscriptionId = crypto.randomUUID();
  const abortController = new AbortController();
  let isActive = true;
  let activeCount = 0;
  const pendingMessages: Array<() => void> = [];

  // Start message processing loop
  processMessages();

  async function processMessages(): Promise<void> {
    try {
      for await (const msg of consumer) {
        if (!isActive) break;

        // Wait if at concurrency limit
        if (activeCount >= concurrency) {
          await new Promise<void>((resolve) => pendingMessages.push(resolve));
        }

        activeCount++;

        // Process message without awaiting (fire and forget with semaphore)
        processMessage(msg)
          .catch((error) => {
            log.error('Error processing message', { subscriptionId, error: String(error) });
          })
          .finally(() => {
            activeCount--;
            // Wake up next waiting message
            const next = pendingMessages.shift();
            if (next) next();
          });
      }

      // Wait for all active messages to complete before exiting
      while (activeCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // If the iterator exited while we still considered the subscription
      // active, the server-side consumer was deleted (inactive_threshold GC,
      // stream deleted, client disconnect). Previously this returned silently
      // and the caller had no idea their subscription was dead — see #445.
      if (isActive) {
        log.error('Consumer iterator exited unexpectedly — subscription is dead', {
          subscriptionId,
          pattern,
          reason: 'consumer_gone',
        });
        isActive = false;
      }
    } catch (error) {
      if (isActive) {
        log.error('Consumer error', { subscriptionId, error: String(error) });
      }
    }
  }

  async function processMessage(msg: JsMsg): Promise<void> {
    let event: OmniEvent<EventType, GenericEventPayload>;

    try {
      // Parse the message
      event = parseMessage(msg);
    } catch (parseError) {
      // Can't parse message, terminate it (don't retry)
      log.error('Failed to parse message', { subscriptionId, error: String(parseError) });
      msg.term();
      return;
    }

    try {
      // Validate event using registry
      const validation = eventRegistry.validate(event.type, event.payload);
      if (!validation.success) {
        throw new Error(`Validation failed: ${validation.error}`);
      }

      // Inject NATS stream sequence into event metadata for offset tracking
      event.metadata.streamSequence = msg.info.streamSequence;

      // Hydrate trace context from inbound message headers (group 2.2 of
      // observability-hub) so any spans created by the handler attach as
      // children of the producer-side trace. No-op when no header / no
      // OTel SDK initialized — handler runs in current context.
      const remoteCtx = extractSpanContextFromMessage(msg);
      if (remoteCtx) {
        const ctxWithRemote = trace.setSpanContext(ROOT_CONTEXT, remoteCtx);
        await otelContext.with(ctxWithRemote, () => handler(event));
      } else {
        await handler(event);
      }

      // Acknowledge successful processing
      msg.ack();
    } catch (error) {
      await handleProcessingError(msg, event, error as Error);
    }
  }

  async function handleProcessingError(msg: JsMsg, event: OmniEvent, error: Error): Promise<void> {
    const redeliveryCount = msg.info.redeliveryCount;

    log.error('Handler error', {
      subscriptionId,
      eventType: event.type,
      attempt: redeliveryCount + 1,
      maxAttempts: maxRetries + 1,
      error: error.message,
    });

    if (redeliveryCount < maxRetries) {
      // Schedule retry with backoff
      const delay = calculateBackoffDelay(redeliveryCount, retryDelayMs);
      msg.nak(delay);
    } else {
      // Max retries exceeded, send to dead letter
      if (onDeadLetter) {
        try {
          await onDeadLetter(event, error, redeliveryCount);
        } catch (dlError) {
          log.error('Dead letter handler failed', { subscriptionId, error: String(dlError) });
        }
      }

      // Terminate the message (don't redeliver)
      msg.term();
    }
  }

  return {
    id: subscriptionId,
    pattern,
    async unsubscribe(): Promise<void> {
      isActive = false;
      abortController.abort();

      try {
        // Drain remaining messages
        await consumer.close();
      } catch {
        // Ignore close errors
      }
    },
  };
}

/**
 * Parse a NATS message into an OmniEvent
 */
function parseMessage(msg: JsMsg): OmniEvent<EventType, GenericEventPayload> {
  const data = new TextDecoder().decode(msg.data);
  const event = JSON.parse(data) as OmniEvent;

  // Ensure required fields exist
  if (!event.id || !event.type || event.payload === undefined) {
    throw new Error('Invalid event structure: missing required fields');
  }

  return event as OmniEvent<EventType, GenericEventPayload>;
}

/**
 * Create a validated subscription that uses Zod schema validation
 */
export interface ValidatedSubscriptionOptions<T> extends Omit<SubscriptionWrapperOptions, 'handler'> {
  /** Zod schema for payload validation */
  schema: ZodSchema<T>;
  /** Handler receives validated and typed payload */
  handler: (event: OmniEvent<EventType, T>) => Promise<void>;
  /** Called when validation fails (before retry) */
  onValidationError?: (event: OmniEvent, error: z.ZodError) => void;
}

/**
 * Create a subscription with Zod schema validation
 *
 * Events that fail validation are rejected without retry (they won't magically pass).
 */
export function createValidatedSubscription<T>(options: ValidatedSubscriptionOptions<T>): Subscription {
  const { schema, handler, onValidationError, ...rest } = options;

  const wrappedHandler: GenericEventHandler = async (event) => {
    const result = schema.safeParse(event.payload);

    if (!result.success) {
      if (onValidationError) {
        onValidationError(event, result.error);
      }
      throw new ValidationError(`Payload validation failed: ${result.error.message}`, result.error);
    }

    // Create typed event with validated payload
    const typedEvent = {
      ...event,
      payload: result.data,
    } as OmniEvent<EventType, T>;

    await handler(typedEvent);
  };

  return createSubscription({
    ...rest,
    handler: wrappedHandler,
  });
}

/**
 * Validation error class for identifying validation failures
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Batch message processing options
 */
export interface BatchProcessOptions {
  /** Maximum number of messages to process in a batch */
  batchSize: number;
  /** Maximum time to wait for batch to fill (ms) */
  batchTimeoutMs: number;
}

/**
 * Subscription manager for tracking active subscriptions
 */
export class SubscriptionManager {
  private subscriptions = new Map<string, Subscription>();

  /**
   * Add a subscription to track
   */
  add(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  /**
   * Remove a subscription from tracking
   */
  remove(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Get a subscription by ID
   */
  get(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * List all active subscriptions
   */
  list(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Unsubscribe all subscriptions
   */
  async unsubscribeAll(): Promise<void> {
    const promises = Array.from(this.subscriptions.values()).map((sub) =>
      sub.unsubscribe().catch((err) => {
        log.error('Failed to unsubscribe', { subscriptionId: sub.id, error: String(err) });
      }),
    );

    await Promise.all(promises);
    this.subscriptions.clear();
  }

  /**
   * Get subscription count
   */
  get size(): number {
    return this.subscriptions.size;
  }
}
