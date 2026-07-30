/**
 * Platform-wide instance-connection gauge (extracted from `event-listeners.ts`
 * during the G5 consumer conversion — wish: omni-full-multitenancy, G5).
 *
 * This is deliberately its OWN module: it is the one access in the connection
 * listeners that is NOT tenant work. The gauge counts active instances across
 * ALL tenants (grouped by channel only — no tenant labels, so it satisfies the
 * WISH "metrics avoid unbounded tenant labels" by carrying no tenant dimension
 * at all), which a worker tenant scope can by definition not compute.
 *
 * It therefore stays on the ambient pool and keeps its own
 * `pending-G5-conversion` registration in `tenancy-db-access-guard.ts`: under
 * RLS enforcement an ambient runtime-role read returns no rows, so the gauge
 * needs an observability-plane read credential (or a per-tenant emission
 * design) — a decision recorded there as the open question. Splitting it out
 * lets the tenant-work sites in `event-listeners.ts` convert and ratchet
 * without hiding this one behind them.
 */

import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import * as Sentry from '@sentry/bun';
import { eq, sql } from 'drizzle-orm';

/**
 * Count active instances per channel type and emit Sentry gauge metrics.
 * Called on connect/disconnect events to keep the gauge current.
 */
export async function emitConnectionGauge(db: Database): Promise<void> {
  const rows = await db
    .select({
      channel: instances.channel,
      count: sql<number>`count(*)::int`,
    })
    .from(instances)
    .where(eq(instances.isActive, true))
    .groupBy(instances.channel);

  for (const row of rows) {
    Sentry.metrics.gauge('instance.connections', row.count, {
      attributes: { channel_type: row.channel },
    });
  }
}
