/**
 * Gupshup observability helpers
 *
 * Emits structured log payloads for webhook outcomes so any log-scraping
 * metric pipeline can derive counters without requiring a dedicated
 * metrics dependency in the channel plugin.
 *
 * Every webhook processing outcome increments `gupshup.webhook.received`
 * with dimensions `{ instanceId, event_type, handled }` where `handled` is
 * one of:
 *   - 'processed'                     — dispatched to processInboundMessage
 *   - 'dropped_known_non_message'     — denylist hit (message_event, billing…)
 *   - 'dropped_unknown_fail_open'     — unknown event_type, still processed + WARN
 *   - 'dropped_unrecognized_shape'    — schema validation failure
 *   - 'dropped_empty_content'         — content extraction returned null
 *
 * A module-level set (`seenEventTypes`) tracks the first-seen event_type per
 * process so format drift surfaces once at WARN level (would have caught the
 * 2026-04-22 async_response cutover at webhook #1).
 */

import type { Logger } from '@omni/core';

export type GupshupWebhookHandled =
  | 'processed'
  | 'dropped_known_non_message'
  | 'dropped_unknown_fail_open'
  | 'dropped_unrecognized_shape'
  | 'dropped_empty_content';

export interface GupshupWebhookMetricDimensions {
  instanceId: string;
  event_type: string;
  handled: GupshupWebhookHandled;
}

export const GUPSHUP_WEBHOOK_METRIC = 'gupshup.webhook.received';

/**
 * Record a webhook outcome as a structured log emission.
 *
 * Shape is stable so downstream pipelines (Loki/Datadog/CloudWatch) can
 * derive counters via log-based metric extractors.
 */
export function recordGupshupWebhookReceived(logger: Logger, dimensions: GupshupWebhookMetricDimensions): void {
  logger.info('[gupshup] webhook received', {
    metric: GUPSHUP_WEBHOOK_METRIC,
    value: 1,
    dimensions,
  });
}

/**
 * Creates a first-seen event_type tracker. Separate from the module state so
 * tests can get an isolated set instead of bleeding across test runs.
 */
export function createSeenEventTypesTracker() {
  const seen = new Set<string>();
  return {
    /** Returns true the first time each value is seen; false thereafter. */
    markIfFirst(value: string): boolean {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    },
    size(): number {
      return seen.size;
    },
  };
}

/** Shared per-process tracker used by the webhook handler. */
export const seenEventTypes = createSeenEventTypesTracker();
