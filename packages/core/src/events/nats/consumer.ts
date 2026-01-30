/**
 * NATS JetStream consumer configuration
 *
 * Consumers define how events are delivered to subscribers:
 * - Durable consumers survive restarts
 * - Queue groups enable load balancing
 * - Ack policies ensure reliable delivery
 */

import { AckPolicy, type ConsumerConfig, DeliverPolicy } from 'nats';
import type { SubscribeOptions } from '../bus';
import { type StreamName, getStreamForEventType } from './streams';

/**
 * Default consumer configuration
 */
export const DEFAULT_CONSUMER_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 1000,
  ackWaitMs: 30_000,
  maxAckPending: 1000,
} as const;

/**
 * Build a NATS consumer configuration from subscribe options
 */
export function buildConsumerConfig(pattern: string, options: SubscribeOptions = {}): Partial<ConsumerConfig> {
  const {
    durable,
    queue,
    startFrom = 'new',
    maxRetries = DEFAULT_CONSUMER_CONFIG.maxRetries,
    ackWaitMs = DEFAULT_CONSUMER_CONFIG.ackWaitMs,
  } = options;

  const config: Partial<ConsumerConfig> = {
    // Filter to specific subject pattern
    filter_subject: pattern,

    // Explicit ack for reliable delivery
    ack_policy: AckPolicy.Explicit,

    // Wait time before redelivery (in nanoseconds)
    ack_wait: ackWaitMs * 1_000_000,

    // Maximum delivery attempts
    max_deliver: maxRetries + 1, // +1 because first delivery counts

    // Maximum pending acks
    max_ack_pending: DEFAULT_CONSUMER_CONFIG.maxAckPending,

    // Delivery policy
    deliver_policy: mapStartFrom(startFrom),
  };

  // Durable consumer name
  if (durable) {
    config.durable_name = durable;
  }

  // Queue group for load balancing
  if (queue) {
    config.deliver_group = queue;
  }

  return config;
}

/**
 * Map startFrom option to NATS DeliverPolicy
 */
function mapStartFrom(startFrom: SubscribeOptions['startFrom']): DeliverPolicy {
  if (startFrom instanceof Date) {
    return DeliverPolicy.StartTime;
  }

  switch (startFrom) {
    case 'first':
      return DeliverPolicy.All;
    case 'last':
      return DeliverPolicy.Last;
    default:
      return DeliverPolicy.New;
  }
}

/**
 * Get the start time for by_start_time delivery policy
 */
export function getStartTime(startFrom: SubscribeOptions['startFrom']): Date | undefined {
  if (startFrom instanceof Date) {
    return startFrom;
  }
  return undefined;
}

/**
 * Generate a unique consumer name for non-durable consumers
 */
export function generateConsumerName(pattern: string): string {
  const sanitized = pattern.replace(/[.>*]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `consumer-${sanitized}-${randomSuffix}`;
}

/**
 * Get the stream name for a subject pattern
 * Determines which stream to subscribe to based on the pattern
 */
export function getStreamForPattern(pattern: string): StreamName {
  // Extract the first part of the pattern (domain)
  const firstPart = pattern.split('.')[0];
  if (!firstPart) {
    throw new Error(
      `Cannot determine stream for pattern '${pattern}'. Use subscribeAll() or specify a more specific pattern.`,
    );
  }

  // Handle wildcards - they match everything, default to MESSAGE
  if (firstPart === '*' || firstPart === '>') {
    // Can't determine stream from wildcard, will need to use multiple streams
    throw new Error(
      `Cannot determine stream for wildcard pattern '${pattern}'. Use subscribeAll() or specify a more specific pattern.`,
    );
  }

  // Use the event type to determine stream
  return getStreamForEventType(firstPart);
}

/**
 * Calculate exponential backoff delay
 *
 * @param retryCount - Current retry attempt (0-based)
 * @param baseDelayMs - Base delay in milliseconds
 * @param maxDelayMs - Maximum delay in milliseconds
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  retryCount: number,
  baseDelayMs: number = DEFAULT_CONSUMER_CONFIG.retryDelayMs,
  maxDelayMs = 30_000,
): number {
  // Exponential backoff: baseDelay * 2^retryCount
  const delay = baseDelayMs * 2 ** retryCount;

  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);

  return Math.min(delay + jitter, maxDelayMs);
}

/**
 * Consumer info for monitoring
 */
export interface ConsumerInfo {
  name: string;
  pattern: string;
  stream: string;
  durable: boolean;
  queue?: string;
  pending: number;
  redelivered: number;
}
