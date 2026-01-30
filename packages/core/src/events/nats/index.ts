/**
 * NATS JetStream EventBus implementation
 *
 * @example
 * import { createEventBus, connectEventBus } from '@omni/core/events/nats';
 *
 * // Create and connect
 * const eventBus = await connectEventBus({ url: 'nats://localhost:4222' });
 *
 * // Publish events
 * await eventBus.publish('message.received', payload, { instanceId: 'wa-001', channelType: 'whatsapp-baileys' });
 *
 * // Subscribe to events
 * await eventBus.subscribe('message.received', async (event) => {
 *   console.log('Received:', event);
 * });
 *
 * // Pattern subscriptions
 * await eventBus.subscribePattern('message.*.whatsapp-baileys.>', async (event) => {
 *   console.log('WhatsApp event:', event);
 * });
 *
 * // Clean shutdown
 * await eventBus.close();
 */

// Main client
export { NatsEventBus, createEventBus, connectEventBus } from './client';

// Stream configuration
export { STREAM_NAMES, STREAM_CONFIGS, ensureStreams, getStreamForEventType, getStreamInfo } from './streams';
export type { StreamName } from './streams';

// Subject utilities
export { buildSubject, buildSubscribePattern, parseSubject, eventTypeToPattern, matchesPattern } from './subjects';
export type { ParsedSubject } from './subjects';

// Consumer configuration
export {
  buildConsumerConfig,
  generateConsumerName,
  getStreamForPattern,
  calculateBackoffDelay,
  DEFAULT_CONSUMER_CONFIG,
} from './consumer';
export type { ConsumerInfo } from './consumer';

// Subscription management
export {
  createSubscription,
  createValidatedSubscription,
  ValidationError as EventValidationError,
  SubscriptionManager,
} from './subscription';
export type { SubscriptionWrapperOptions, ValidatedSubscriptionOptions, BatchProcessOptions } from './subscription';

// Event registry
export {
  EventRegistry,
  eventRegistry,
  createEventSchema,
  registerSchemas,
  SystemEventSchemas,
} from './registry';
export type { EventSchemaEntry, ValidationResult } from './registry';
