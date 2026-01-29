/**
 * Event bus interface
 *
 * This defines the contract for event publishing/subscribing.
 * Implementation will be in a separate package (e.g., @omni/nats).
 */

import type { EventPayloadMap, EventType, OmniEvent, TypedOmniEvent } from './types';

/**
 * Event handler function type
 */
export type EventHandler<T extends EventType> = (event: TypedOmniEvent<T>) => Promise<void>;

/**
 * Event bus interface for publishing and subscribing to events
 */
export interface EventBus {
  /**
   * Publish an event to the bus
   */
  publish<T extends EventType>(
    type: T,
    payload: EventPayloadMap[T],
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<void>;

  /**
   * Subscribe to events of a specific type
   */
  subscribe<T extends EventType>(type: T, handler: EventHandler<T>): Promise<Subscription>;

  /**
   * Subscribe to multiple event types with a single handler
   */
  subscribeMany<T extends EventType>(types: T[], handler: EventHandler<T>): Promise<Subscription>;

  /**
   * Subscribe to all events (wildcard)
   */
  subscribeAll(handler: (event: OmniEvent) => Promise<void>): Promise<Subscription>;

  /**
   * Close the event bus connection
   */
  close(): Promise<void>;
}

/**
 * Subscription handle for unsubscribing
 */
export interface Subscription {
  /**
   * Unique subscription ID
   */
  id: string;

  /**
   * Unsubscribe from events
   */
  unsubscribe(): Promise<void>;
}

/**
 * Event bus configuration
 */
export interface EventBusConfig {
  /**
   * NATS server URL
   */
  url: string;

  /**
   * Stream name for JetStream
   */
  streamName?: string;

  /**
   * Consumer name for durable subscriptions
   */
  consumerName?: string;

  /**
   * Maximum retry attempts for failed messages
   */
  maxRetries?: number;

  /**
   * Retry delay in milliseconds
   */
  retryDelayMs?: number;
}
