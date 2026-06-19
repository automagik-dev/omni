/**
 * Idempotency guard for durable NATS subscribers.
 *
 * Background (#411): NATS JetStream uses at-least-once delivery. If a handler
 * running a non-idempotent side-effect (send WhatsApp message, delete Agno
 * session, dispatch agent turn) is interrupted by PM2 SIGKILL before ACK, the
 * consumer redelivers on next boot and the side-effect fires AGAIN. The real
 * incident (2026-04-14) delivered "✅ Conversa limpa!" up to 5 times to a
 * single user across two rapid restarts.
 *
 * Fix: wrap every side-effect handler body in `withIdempotency(db, event.id,
 * '<durable-name>', async () => { ... })`. The wrapper claims the
 * (event_id, handler) row in `processed_events` BEFORE running the body.
 * On replay the claim fails the PK constraint and the body is skipped — the
 * NATS message is then ack'd normally (no DLQ noise from benign replay).
 *
 * Semantics: **at-most-once** for the side-effect. If the body throws AFTER
 * the claim commits we propagate the error (subscription wrapper NAKs, the
 * retry will re-enter and skip). We deliberately do NOT release the claim on
 * failure — we would rather leave a partially-completed side-effect as-is
 * than re-fire it on the customer (e.g. the send already succeeded but the
 * post-send bookkeeping threw).
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { processedEvents } from '@omni/db';

const log = createLogger('idempotency');

export interface IdempotencyResult {
  /** True if fn was executed (first delivery). False if skipped (replay). */
  executed: boolean;
}

/**
 * Run `fn` at most once for the given (eventId, handler) pair across all
 * processes sharing this database. Safe under NATS redelivery and PM2 restart.
 *
 * @param db         Drizzle Database — writes a row to `processed_events`
 * @param eventId    Canonical OmniEvent.id (unique per publish; stable across redelivery)
 * @param handler    Durable consumer name (e.g. 'session-cleaner', 'agent-dispatcher-msg')
 * @param fn         The side-effect to guard. Only runs on the first claim.
 * @returns          `{ executed: true }` on first claim, `{ executed: false }` on replay skip
 */
export async function withIdempotency(
  db: Database,
  eventId: string,
  handler: string,
  fn: () => Promise<void>,
): Promise<IdempotencyResult> {
  if (!eventId) {
    // No event id → can't dedupe. Fall through to the side-effect so we
    // don't silently drop work. This should not happen for well-formed events.
    log.warn('idempotency: missing event id, running without dedupe', { handler });
    await fn();
    return { executed: true };
  }

  // Claim the (eventId, handler) slot. ON CONFLICT DO NOTHING + RETURNING
  // yields an empty array on conflict (row already exists → this is a replay).
  const claim = await db
    .insert(processedEvents)
    .values({ eventId, handler })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });

  if (claim.length === 0) {
    log.info('idempotency: skipping replay', { eventId, handler });
    return { executed: false };
  }

  // First delivery — run the side-effect. If it throws, the claim row stays
  // put (at-most-once). The subscription wrapper will NAK + retry; the retry
  // will see the row exists and skip, then ack normally.
  await fn();
  return { executed: true };
}
