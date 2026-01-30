/**
 * NatsEventBus - NATS JetStream implementation of the EventBus interface
 *
 * Features:
 * - Hierarchical subjects for multi-instance filtering
 * - 7 streams for event categorization
 * - Durable consumers for reliability
 * - Queue groups for load balancing
 * - Automatic reconnection with exponential backoff
 * - Graceful shutdown with drain
 */

import {
  type ConnectionOptions,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  StringCodec,
  connect,
} from 'nats';
import type {
  EventBus,
  EventBusConfig,
  EventHandler,
  GenericEventHandler,
  PublishResult,
  SubscribeOptions,
  Subscription,
} from '../bus';
import type {
  CoreEventType,
  EventPayloadMap,
  EventType,
  GenericEventPayload,
  OmniEvent,
  TypedOmniEvent,
} from '../types';
import { buildConsumerConfig, generateConsumerName, getStreamForPattern } from './consumer';
import { eventRegistry } from './registry';
import { STREAM_NAMES, ensureStreams, getStreamForEventType } from './streams';
import { buildSubject, eventTypeToPattern } from './subjects';
import { SubscriptionManager, createSubscription } from './subscription';

/**
 * Default configuration values
 */
const DEFAULTS = {
  url: 'nats://localhost:4222',
  serviceName: 'omni',
  reconnect: {
    maxRetries: 10,
    delayMs: 1000,
    maxDelayMs: 30_000,
  },
} as const;

/**
 * Internal config type with properly typed credentials
 */
interface InternalConfig {
  url: string;
  serviceName: string;
  credentials?: { user: string; pass: string };
  reconnect: {
    maxRetries: number;
    delayMs: number;
    maxDelayMs: number;
  };
}

/**
 * NatsEventBus implementation
 */
export class NatsEventBus implements EventBus {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private readonly config: InternalConfig;
  private readonly sc = StringCodec();
  private readonly subscriptionManager = new SubscriptionManager();
  private connectionAttempts = 0;
  private isClosing = false;

  constructor(config: EventBusConfig = {}) {
    this.config = {
      url: config.url ?? DEFAULTS.url,
      serviceName: config.serviceName ?? DEFAULTS.serviceName,
      credentials: config.credentials,
      reconnect: {
        ...DEFAULTS.reconnect,
        ...config.reconnect,
      },
    };
  }

  /**
   * Connect to NATS and initialize JetStream
   */
  async connect(): Promise<void> {
    if (this.nc?.isClosed() === false) {
      return; // Already connected
    }

    const connectionOptions: ConnectionOptions = {
      servers: this.config.url,
      name: this.config.serviceName,
      reconnect: true,
      maxReconnectAttempts: this.config.reconnect.maxRetries,
      reconnectTimeWait: this.config.reconnect.delayMs,
      waitOnFirstConnect: true,
    };

    // Add credentials if provided
    if (this.config.credentials) {
      connectionOptions.user = this.config.credentials.user;
      connectionOptions.pass = this.config.credentials.pass;
    }

    try {
      this.connectionAttempts++;
      this.nc = await connect(connectionOptions);

      // Setup connection status handlers
      this.setupConnectionHandlers();

      // Get JetStream client and manager
      this.js = this.nc.jetstream();
      this.jsm = await this.nc.jetstreamManager();

      // Ensure all streams exist
      await ensureStreams(this.jsm);

      console.log(`[NatsEventBus] Connected to ${this.config.url}`);
      this.connectionAttempts = 0;
    } catch (error) {
      console.error(`[NatsEventBus] Connection failed (attempt ${this.connectionAttempts}):`, error);

      if (this.connectionAttempts < this.config.reconnect.maxRetries) {
        const delay = this.calculateReconnectDelay();
        console.log(`[NatsEventBus] Retrying in ${delay}ms...`);
        await this.sleep(delay);
        return this.connect();
      }

      throw new Error(`Failed to connect to NATS after ${this.connectionAttempts} attempts: ${error}`);
    }
  }

  /**
   * Publish a core event (type-safe)
   */
  async publish<T extends CoreEventType>(
    type: T,
    payload: EventPayloadMap[T],
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    return this.publishInternal(type, payload, metadata);
  }

  /**
   * Publish a custom or system event (runtime validated)
   */
  async publishGeneric(
    type: EventType,
    payload: GenericEventPayload,
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    // Validate via registry
    const validation = eventRegistry.validate(type, payload);
    if (!validation.success) {
      throw new Error(`Event validation failed: ${validation.error}`);
    }

    return this.publishInternal(type, payload, metadata);
  }

  /**
   * Internal publish implementation
   */
  private async publishInternal(
    type: EventType,
    payload: unknown,
    metadata?: Partial<OmniEvent['metadata']>,
  ): Promise<PublishResult> {
    this.ensureConnected();

    const eventId = crypto.randomUUID();
    const timestamp = Date.now();

    const event: OmniEvent = {
      id: eventId,
      type,
      payload,
      timestamp,
      metadata: {
        correlationId: metadata?.correlationId ?? eventId,
        instanceId: metadata?.instanceId,
        channelType: metadata?.channelType,
        personId: metadata?.personId,
        platformIdentityId: metadata?.platformIdentityId,
        traceId: metadata?.traceId ?? eventId,
        source: metadata?.source ?? this.config.serviceName,
      },
    };

    // Build subject with hierarchy if instance info available
    let subject: string;
    if (metadata?.channelType && metadata?.instanceId) {
      subject = buildSubject(type, metadata.channelType, metadata.instanceId);
    } else {
      // Simple subject for events without instance context
      subject = type;
    }

    // Encode and publish
    const js = this.requireJetStream();
    const data = this.sc.encode(JSON.stringify(event));
    const ack = await js.publish(subject, data);

    return {
      id: eventId,
      sequence: ack.seq,
      stream: getStreamForEventType(type),
    };
  }

  /**
   * Subscribe to events of a specific core type
   */
  async subscribe<T extends CoreEventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<Subscription> {
    const pattern = options.pattern ?? eventTypeToPattern(type);

    // Wrap handler to cast to typed event
    const wrappedHandler: GenericEventHandler = async (event) => {
      await handler(event as unknown as TypedOmniEvent<T>);
    };

    return this.subscribeInternal(pattern, wrappedHandler, options);
  }

  /**
   * Subscribe to events with pattern matching
   */
  async subscribePattern(
    pattern: string,
    handler: GenericEventHandler,
    options: SubscribeOptions = {},
  ): Promise<Subscription> {
    return this.subscribeInternal(pattern, handler, options);
  }

  /**
   * Subscribe to multiple event types with a single handler
   */
  async subscribeMany<T extends CoreEventType>(
    types: T[],
    handler: EventHandler<T>,
    options: SubscribeOptions = {},
  ): Promise<Subscription> {
    // Create a pattern that matches any of the types
    // For simplicity, we subscribe to each type individually and combine
    const subscriptions: Subscription[] = [];

    for (const type of types) {
      const sub = await this.subscribe(type, handler, options);
      subscriptions.push(sub);
    }

    // Return a combined subscription
    const combinedId = crypto.randomUUID();
    const combinedPattern = types.join(',');

    const combined: Subscription = {
      id: combinedId,
      pattern: combinedPattern,
      async unsubscribe() {
        await Promise.all(subscriptions.map((s) => s.unsubscribe()));
      },
    };

    this.subscriptionManager.add(combined);
    return combined;
  }

  /**
   * Subscribe to all events (wildcard)
   */
  async subscribeAll(
    handler: (event: OmniEvent) => Promise<void>,
    options: SubscribeOptions = {},
  ): Promise<Subscription> {
    // Subscribe to each stream's root subject
    const subscriptions: Subscription[] = [];

    for (const streamName of Object.values(STREAM_NAMES)) {
      const pattern = `${streamName.toLowerCase()}.>`;
      try {
        const sub = await this.subscribeInternal(pattern, handler as GenericEventHandler, {
          ...options,
          durable: options.durable ? `${options.durable}-${streamName}` : undefined,
        });
        subscriptions.push(sub);
      } catch (error) {
        // Some streams might not match the pattern, ignore
        console.warn(`[NatsEventBus] Could not subscribe to ${pattern}:`, error);
      }
    }

    // Return combined subscription
    const combinedId = crypto.randomUUID();

    const combined: Subscription = {
      id: combinedId,
      pattern: '*',
      async unsubscribe() {
        await Promise.all(subscriptions.map((s) => s.unsubscribe()));
      },
    };

    this.subscriptionManager.add(combined);
    return combined;
  }

  /**
   * Internal subscribe implementation
   */
  private async subscribeInternal(
    pattern: string,
    handler: GenericEventHandler,
    options: SubscribeOptions,
  ): Promise<Subscription> {
    const js = this.requireJetStream();
    const jsm = this.requireJetStreamManager();

    // Determine which stream to subscribe to
    let streamName: string;
    try {
      streamName = getStreamForPattern(pattern);
    } catch {
      // Fall back to checking the pattern prefix
      const prefix = pattern.split('.')[0] ?? 'custom';
      streamName = getStreamForEventType(prefix);
    }

    // Build consumer config
    const consumerConfig = buildConsumerConfig(pattern, options);

    // Create consumer name
    const consumerName = options.durable ?? generateConsumerName(pattern);

    // Add consumer to stream
    await jsm.consumers.add(streamName, {
      ...consumerConfig,
      name: consumerName,
    });

    // Get consumer
    const consumer = await js.consumers.get(streamName, consumerName);

    // Start consuming
    const messages = await consumer.consume();

    // Create subscription wrapper
    const subscription = createSubscription({
      pattern,
      consumer: messages,
      handler,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      onDeadLetter: async (event, error, retryCount) => {
        // Publish to system.dead_letter
        await this.publishGeneric(
          'system.dead_letter',
          {
            originalEventId: event.id,
            originalEventType: event.type,
            error: error.message,
            retryCount,
            timestamp: Date.now(),
          },
          { source: this.config.serviceName },
        );
      },
    });

    this.subscriptionManager.add(subscription);
    return subscription;
  }

  /**
   * Gracefully close the event bus connection
   */
  async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;

    console.log('[NatsEventBus] Closing connection...');

    // Unsubscribe all subscriptions
    await this.subscriptionManager.unsubscribeAll();

    // Drain and close connection
    if (this.nc && !this.nc.isClosed()) {
      await this.nc.drain();
    }

    this.nc = null;
    this.js = null;
    this.jsm = null;
    this.isClosing = false;

    console.log('[NatsEventBus] Connection closed');
  }

  /**
   * Check if the bus is connected
   */
  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }

  /**
   * Get the JetStream manager for advanced operations
   */
  getJetStreamManager(): JetStreamManager | null {
    return this.jsm;
  }

  /**
   * Get current subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptionManager.size;
  }

  /**
   * Ensure connected before operations
   */
  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('Not connected to NATS. Call connect() first.');
    }
  }

  /**
   * Get guaranteed connected JetStream client
   * Throws if not connected
   */
  private requireJetStream(): JetStreamClient {
    this.ensureConnected();
    if (!this.js) {
      throw new Error('JetStream not initialized');
    }
    return this.js;
  }

  /**
   * Get guaranteed connected JetStream manager
   * Throws if not connected
   */
  private requireJetStreamManager(): JetStreamManager {
    this.ensureConnected();
    if (!this.jsm) {
      throw new Error('JetStreamManager not initialized');
    }
    return this.jsm;
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    if (!this.nc) return;

    // Handle connection status events
    (async () => {
      if (!this.nc) return;
      for await (const status of this.nc.status()) {
        switch (status.type) {
          case 'disconnect':
            console.warn('[NatsEventBus] Disconnected from NATS');
            break;
          case 'reconnect':
            console.log('[NatsEventBus] Reconnected to NATS');
            break;
          case 'error':
            console.error('[NatsEventBus] Connection error:', status.data);
            break;
          case 'ldm':
            console.warn('[NatsEventBus] Lame duck mode - server is shutting down');
            break;
        }
      }
    })().catch(() => {
      // Connection closed, ignore
    });
  }

  /**
   * Calculate reconnect delay with exponential backoff
   */
  private calculateReconnectDelay(): number {
    const { delayMs, maxDelayMs } = this.config.reconnect;
    const delay = delayMs * 2 ** (this.connectionAttempts - 1);
    return Math.min(delay, maxDelayMs);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a NatsEventBus instance
 */
export function createEventBus(config?: EventBusConfig): NatsEventBus {
  return new NatsEventBus(config);
}

/**
 * Create and connect a NatsEventBus instance
 */
export async function connectEventBus(config?: EventBusConfig): Promise<NatsEventBus> {
  const bus = new NatsEventBus(config);
  await bus.connect();
  return bus;
}
