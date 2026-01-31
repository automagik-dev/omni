/**
 * NATS JetStream EventBus implementation
 *
 * @example
 * import { createEventBus, connectEventBus, createLogger } from '@omni/core';
 *
 * const logger = createLogger('my-service');
 *
 * // Create and connect
 * const eventBus = await connectEventBus({ url: 'nats://localhost:4222' });
 *
 * // Publish events
 * await eventBus.publish('message.received', payload, { instanceId: 'wa-001', channelType: 'whatsapp-baileys' });
 *
 * // Subscribe to events
 * await eventBus.subscribe('message.received', async (event) => {
 *   logger.info('Received event', { type: event.type });
 * });
 *
 * // Pattern subscriptions
 * await eventBus.subscribePattern('message.*.whatsapp-baileys.>', async (event) => {
 *   logger.info('WhatsApp event', { type: event.type });
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
