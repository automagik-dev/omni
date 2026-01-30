/**
 * Event bus interface
 *
 * This defines the contract for event publishing/subscribing.
 * Implementation: NatsEventBus in ./nats/
 */

import type {
  CoreEventType,
  EventPayloadMap,
  EventType,
  GenericEventPayload,
  OmniEvent,
  TypedOmniEvent,
} from './types';

/**
 * Event handler function type for core events
 */
export type EventHandler<T extends CoreEventType> = (event: TypedOmniEvent<T>) => Promise<void>;

/**
 * Generic event handler for custom/system events
 */
export type GenericEventHandler = (event: OmniEvent<EventType, GenericEventPayload>) => Promise<void>;

/**
 * Publish result with acknowledgment info
 */
export interface PublishResult {
  /** Event ID */
  id: string;
  /** NATS sequence number */
  sequence: number;
  /** Stream the event was published to */
  stream: string;
}

/**
 * Subscription options for advanced subscriptions
 */
export interface SubscribeOptions {
  /** Subject pattern with wildcards (e.g., 'message.*.whatsapp.>') */
  pattern?: string;
  /** Queue group name for load balancing across subscribers */
  queue?: string;
  /** Durable consumer name for surviving restarts */
  durable?: string;
  /** Where to start consuming from */
  startFrom?: 'new' | 'first' | 'last' | Date;
  /** Maximum retry attempts before dead letter */
  maxRetries?: number;
  /** Base retry delay in milliseconds (exponential backoff) */
  retryDelayMs?: number;
  /** How long to wait for ack before redelivery (ms) */
  ackWaitMs?: number;
}

/**
 * Event bus interface for publishing and subscribing to events
 */
export interface EventBus {
  /**
   * Connect to the event bus
   */
  connect(): Promise<void>;

  /**
   * Publish a core event (type-safe)
   */
  publish<T extends CoreEventType>(
    type: T,
    payload: EventPayloadMap[T],
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult>;

  /**
   * Publish a custom or system event (runtime validated)
   */
  publishGeneric(
    type: EventType,
    payload: GenericEventPayload,
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult>;

  /**
   * Subscribe to events of a specific core type
   */
  subscribe<T extends CoreEventType>(
    type: T,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;

  /**
   * Subscribe to events with pattern matching
   * Patterns support NATS wildcards:
   * - `*` matches a single token: `message.*.whatsapp.>` matches `message.received.whatsapp.wa-001`
   * - `>` matches one or more tokens: `message.>` matches all message events
   */
  subscribePattern(pattern: string, handler: GenericEventHandler, options?: SubscribeOptions): Promise<Subscription>;

  /**
   * Subscribe to multiple event types with a single handler
   */
  subscribeMany<T extends CoreEventType>(
    types: T[],
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): Promise<Subscription>;

  /**
   * Subscribe to all events (wildcard)
   */
  subscribeAll(handler: (event: OmniEvent) => Promise<void>, options?: SubscribeOptions): Promise<Subscription>;

  /**
   * Gracefully close the event bus connection
   * Drains all pending messages before closing
   */
  close(): Promise<void>;

  /**
   * Check if the bus is connected
   */
  isConnected(): boolean;
}

/**
 * Subscription handle for unsubscribing
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string;

  /** The pattern this subscription is listening to */
  pattern: string;

  /** Unsubscribe from events */
  unsubscribe(): Promise<void>;
}

/**
 * Event bus configuration
 */
export interface EventBusConfig {
  /** NATS server URL (default: nats://localhost:4222) */
  url?: string;

  /** Authentication credentials */
  credentials?: {
    user: string;
    pass: string;
  };

  /** Service name for event source tracking */
  serviceName?: string;

  /** Reconnect configuration */
  reconnect?: {
    /** Maximum number of reconnect attempts (default: 10) */
    maxRetries: number;
    /** Initial delay between retries in ms (default: 1000) */
    delayMs: number;
    /** Maximum delay between retries in ms (default: 30000) */
    maxDelayMs: number;
  };
}
