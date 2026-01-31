/**
 * Dead Letter Queue Handler
 *
 * Captures and stores failed events for debugging and auto/manual retry.
 * Auto-retry schedule: 1h → 6h → 24h, then manual intervention required.
 *
 * @see events-ops wish
 */

import type { OmniEvent } from './types';

/**
 * Auto-retry delays in milliseconds
 * Attempt 1: 1 hour after creation
 * Attempt 2: 6 hours after last retry
 * Attempt 3: 24 hours after last retry
 * Attempt 4+: Manual only (nextAutoRetryAt = null)
 */
export const AUTO_RETRY_DELAYS_MS = [
  1 * 60 * 60 * 1000, // 1 hour
  6 * 60 * 60 * 1000, // 6 hours
  24 * 60 * 60 * 1000, // 24 hours
] as const;

/**
 * Maximum auto-retry attempts before requiring manual intervention
 */
export const MAX_AUTO_RETRIES = 3;

/**
 * Dead letter entry structure (matches database schema)
 */
export interface DeadLetterEntry {
  id: string;
  eventId: string;
  eventType: string;
  subject: string;
  payload: Record<string, unknown>;
  error: string;
  stack?: string | null;
  autoRetryCount: number;
  manualRetryCount: number;
  nextAutoRetryAt: Date | null;
  status: 'pending' | 'retrying' | 'resolved' | 'abandoned';
  createdAt: Date;
  lastRetryAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

/**
 * Options for creating a dead letter entry
 */
export interface CreateDeadLetterOptions {
  event: OmniEvent;
  subject: string;
  error: Error;
  retryCount: number;
}

/**
 * Calculate the next auto-retry timestamp based on retry count
 *
 * @param autoRetryCount - Current auto-retry count (0-based)
 * @param fromTime - Base time to calculate from (defaults to now)
 * @returns Next retry timestamp, or null if max retries exceeded
 */
export function calculateNextAutoRetryAt(autoRetryCount: number, fromTime = new Date()): Date | null {
  if (autoRetryCount >= MAX_AUTO_RETRIES) {
    return null; // No more auto-retries
  }

  const delay = AUTO_RETRY_DELAYS_MS[autoRetryCount] ?? AUTO_RETRY_DELAYS_MS[AUTO_RETRY_DELAYS_MS.length - 1];
  if (delay === undefined) {
    return null;
  }
  return new Date(fromTime.getTime() + delay);
}

/**
 * Prepare data for inserting a new dead letter event
 */
export function prepareDeadLetterInsert(options: CreateDeadLetterOptions): {
  eventId: string;
  eventType: string;
  subject: string;
  payload: Record<string, unknown>;
  error: string;
  stack: string | null;
  autoRetryCount: number;
  nextAutoRetryAt: Date | null;
  status: 'pending';
} {
  const { event, subject, error } = options;

  return {
    eventId: event.id,
    eventType: event.type,
    subject,
    payload: event as unknown as Record<string, unknown>,
    error: error.message,
    stack: error.stack ?? null,
    autoRetryCount: 0,
    nextAutoRetryAt: calculateNextAutoRetryAt(0),
    status: 'pending' as const,
  };
}

/**
 * System event payload for dead letter creation
 * Published to system.dead_letter when an event is sent to DLQ
 */
export interface DeadLetterSystemEventPayload {
  deadLetterId: string;
  originalEventId: string;
  originalEventType: string;
  error: string;
  retryCount: number;
  nextAutoRetryAt: number | null;
  timestamp: number;
}

/**
 * Create the payload for a system.dead_letter event
 */
export function createDeadLetterSystemPayload(
  deadLetterId: string,
  entry: Pick<DeadLetterEntry, 'eventId' | 'eventType' | 'error' | 'autoRetryCount' | 'nextAutoRetryAt'>,
): DeadLetterSystemEventPayload {
  return {
    deadLetterId,
    originalEventId: entry.eventId,
    originalEventType: entry.eventType,
    error: entry.error,
    retryCount: entry.autoRetryCount,
    nextAutoRetryAt: entry.nextAutoRetryAt?.getTime() ?? null,
    timestamp: Date.now(),
  };
}
