/**
 * In-memory EventBus for integration tests (#956/#957).
 *
 * Builds envelopes with the SAME `createOmniEvent` factory the NATS bus uses,
 * so correlation self-reference for roots, causation stamping, and tenant
 * defaulting behave byte-identically to production — the point of the
 * correlation-chain tests is to exercise that real defaulting, not a mock's
 * approximation of it.
 *
 * Dispatch is deliberately simple: a subscription made with
 * `subscribePattern('custom.foo.>', handler)` receives every published event
 * whose `type` equals the pattern prefix (`custom.foo`), mirroring how the
 * automation engine's `${eventType}.>` patterns map onto the hierarchical
 * subjects. Handlers run asynchronously (queueMicrotask) like a real consumer,
 * and `idle()` awaits the whole cascade.
 */

import type { EventBus, GenericEventHandler, PublishResult, SubscribeOptions, Subscription } from '../bus';
import { createOmniEvent } from '../factory';
import type {
  CoreEventType,
  EventPayloadMap,
  EventType,
  GenericEventPayload,
  OmniEvent,
  TypedOmniEvent,
} from '../types';

interface PatternSubscription {
  /** Event type prefix the pattern matches (pattern minus the trailing `.>`). */
  prefix: string;
  handler: GenericEventHandler;
}

export class InMemoryEventBus implements EventBus {
  /** Every event published through this bus, in publish order. */
  readonly journal: OmniEvent[] = [];
  private readonly patternSubs: PatternSubscription[] = [];
  private pending: Promise<void>[] = [];
  private connected = true;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async publish<T extends CoreEventType>(
    type: T,
    payload: EventPayloadMap[T],
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    return this.publishInternal(type, payload, metadata);
  }

  async publishGeneric(
    type: EventType,
    payload: GenericEventPayload,
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    return this.publishInternal(type, payload, metadata);
  }

  private async publishInternal(
    type: EventType,
    payload: unknown,
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    const event = createOmniEvent(type, payload, metadata, 'memory-bus');
    this.journal.push(event);

    const delivered = event as OmniEvent<EventType, GenericEventPayload>;
    for (const sub of this.patternSubs) {
      if (sub.prefix === '' || event.type === sub.prefix || event.type.startsWith(`${sub.prefix}.`)) {
        const run = Promise.resolve().then(() => sub.handler(delivered));
        this.pending.push(
          run.catch(() => {
            // A handler error must not reject an unrelated idle() await;
            // real consumers nak/redeliver instead of failing the publisher.
          }),
        );
      }
    }

    return { id: event.id, sequence: this.journal.length, stream: 'memory' };
  }

  async subscribe<T extends CoreEventType>(
    type: T,
    handler: (event: TypedOmniEvent<T>) => Promise<void>,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    return this.addPattern(type, handler as unknown as GenericEventHandler);
  }

  async subscribePattern(
    pattern: string,
    handler: GenericEventHandler,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    const prefix = pattern.endsWith('.>') ? pattern.slice(0, -2) : pattern;
    return this.addPattern(prefix, handler);
  }

  async subscribeMany<T extends CoreEventType>(
    types: T[],
    handler: (event: TypedOmniEvent<T>) => Promise<void>,
    _options?: SubscribeOptions,
  ): Promise<Subscription> {
    for (const type of types) {
      this.patternSubs.push({ prefix: type, handler: handler as unknown as GenericEventHandler });
    }
    return this.makeSubscription(types.join(','));
  }

  async subscribeAll(handler: (event: OmniEvent) => Promise<void>, _options?: SubscribeOptions): Promise<Subscription> {
    return this.addPattern('', handler as GenericEventHandler);
  }

  private addPattern(prefix: string, handler: GenericEventHandler): Subscription {
    this.patternSubs.push({ prefix, handler });
    return this.makeSubscription(prefix);
  }

  private makeSubscription(pattern: string): Subscription {
    return {
      id: crypto.randomUUID(),
      pattern,
      unsubscribe: async () => {
        // Tests tear the whole bus down; per-subscription removal is not needed.
      },
      isAlive: () => true,
    };
  }

  /**
   * Await every handler cascade triggered so far, including handlers that
   * publish further events (multi-hop chains).
   */
  async idle(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending;
      this.pending = [];
      await Promise.all(batch);
    }
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
