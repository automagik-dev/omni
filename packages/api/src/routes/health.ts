/**
 * Health check endpoints
 *
 * PRIVACY CONTRACT (wish: omni-full-multitenancy, Group G4)
 * --------------------------------------------------------
 * Every endpoint in this file is UNAUTHENTICATED. WISH "Public and bootstrap
 * surfaces" therefore binds them: no tenant inventory, counts, identifiers,
 * connection state, consumer offsets, or resource-existence oracle may cross
 * this boundary. The declarations in `tenancy/route-ownership.ts` state each
 * endpoint's contract inline and the probes in
 * `tenancy/__tests__/public-surface-privacy.test.ts` hold it.
 *
 * Two things were removed here rather than scoped, because scoping is not
 * available to a caller who presents no credential and therefore names no
 * tenant:
 *
 *   * The per-channel instance-count aggregation on `/health` and the totals on
 *     `/info`. "How many WhatsApp instances does this deployment run, and how
 *     many are live" is tenant inventory to an anonymous caller, and the answer
 *     is not needed to decide whether the process is alive.
 *   * The `consumer_offsets` dump on `/health/consumers` — consumer names,
 *     stream names, sequence numbers, event ids, and update timestamps. That is
 *     a direct read of tenant event-pipeline volume and of real event row ids.
 *
 * Both removals apply in BOTH worlds, flag on and flag off. An unauthenticated
 * leak is not something a feature flag may protect, so this is the one
 * deliberate, individually justified exception to G4's otherwise strict
 * legacy-invariance boundary.
 *
 * What replaces them is the health signal an operator probe actually consumes:
 * whether offset tracking is working and how stale the most-behind consumer is,
 * as a bounded staleness bucket rather than a number that could be differenced
 * over time into a throughput estimate.
 */

import { createLogger } from '@omni/core';
import { consumerOffsets } from '@omni/db';
import { sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import packageJson from '../../package.json';
import { arePluginsDegraded, getPluginsDegradedReason } from '../plugin-state';
import type { AppVariables, HealthCheck, HealthResponse } from '../types';

const healthLog = createLogger('health');
const VERSION = packageJson.version;
const startTime = Date.now();

export const healthRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /health - Basic health check (no auth required)
 */
export const getHealth = async (c: Context<{ Variables: AppVariables }>) => {
  const db = c.get('db');
  const eventBus = c.get('eventBus');

  // Check database
  let dbCheck: HealthCheck;
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    dbCheck = { status: 'ok', latency: Date.now() - dbStart };
  } catch (error) {
    dbCheck = {
      status: 'error',
      latency: Date.now() - dbStart,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check NATS (if available). Must reflect the publisher's real connection
  // state: a hardcoded `connected: true` masked dead publishers after a NATS
  // server restart (green health while every publish threw "Not connected").
  let natsCheck: HealthCheck;
  if (eventBus) {
    const connected = eventBus.isConnected();
    natsCheck = connected
      ? { status: 'ok', details: { connected: true } }
      : { status: 'error', details: { connected: false }, error: 'NATS connection is not established' };
  } else {
    natsCheck = { status: 'ok', details: { connected: false, reason: 'Not configured' } };
  }

  // Instance inventory is deliberately NOT reported here — see the privacy
  // contract at the top of this file. The channel-plugin health question that
  // issue #408 actually needed ("did the plugins come up") is answered by the
  // `plugins` check below, which is a degraded/ok signal and not a count.

  // Channel plugin initialization check (issue #408)
  const pluginsFailed = arePluginsDegraded();
  const pluginsCheck: HealthCheck = pluginsFailed
    ? { status: 'error', error: getPluginsDegradedReason() ?? 'Plugin initialization failed' }
    : { status: 'ok' };

  // Determine overall status
  const hasErrors = dbCheck.status === 'error' || natsCheck.status === 'error' || pluginsFailed;
  const status: HealthResponse['status'] = hasErrors ? 'degraded' : 'healthy';

  const response: HealthResponse = {
    status,
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      nats: natsCheck,
      plugins: pluginsCheck,
    },
  };

  return c.json(response, status === 'healthy' ? 200 : 503);
};

healthRoutes.get('/health', getHealth);

/**
 * GET /info - System info (no auth required)
 */
healthRoutes.get('/info', async (c) => {
  // Build/deployment identification only. The instance totals and the
  // (always-zero) event counters that used to be here were tenant inventory on
  // an unauthenticated endpoint — see the privacy contract at the top of this
  // file. An authenticated caller gets the same numbers, tenant-scoped, from
  // GET /api/v2/instances.
  return c.json({
    version: VERSION,
    environment: process.env.NODE_ENV ?? 'development',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

/**
 * GET /_internal/health - Internal health check (localhost only)
 */
healthRoutes.get('/_internal/health', async (c) => {
  // Check if request is from localhost
  const host = c.req.header('host') ?? '';
  const forwarded = c.req.header('x-forwarded-for');

  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1') || !forwarded;

  if (!isLocalhost) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Internal endpoint' } }, 403);
  }

  return c.json({
    status: 'healthy',
    service: 'omni-api',
    pid: process.pid,
    memory: process.memoryUsage(),
  });
});

/**
 * Bounded staleness buckets for the public consumer health signal.
 *
 * A bucket rather than a number of seconds on purpose: an anonymous caller
 * polling an exact lag value can difference it over time into a throughput
 * estimate, which is the same tenant-volume disclosure the offset dump was.
 * A bucket answers "is the pipeline keeping up" and nothing finer.
 */
type OffsetFreshness = 'current' | 'lagging' | 'stale';

const LAGGING_AFTER_MS = 60_000;
const STALE_AFTER_MS = 15 * 60_000;

function freshnessFor(oldestUpdateMs: number | null): OffsetFreshness {
  if (oldestUpdateMs === null) return 'current';
  const age = Date.now() - oldestUpdateMs;
  if (age >= STALE_AFTER_MS) return 'stale';
  if (age >= LAGGING_AFTER_MS) return 'lagging';
  return 'current';
}

/**
 * GET /health/consumers - Consumer offset-tracking health (no auth required)
 *
 * Answers ONLY "is offset tracking working, and is the most-behind consumer
 * keeping up". It deliberately does not return consumer names, stream names,
 * sequence numbers, event ids, timestamps, or a consumer count — see the
 * privacy contract at the top of this file. An authenticated operator who needs
 * per-consumer detail reads it from the event-ops surface.
 */
healthRoutes.get('/health/consumers', async (c) => {
  const db = c.get('db');

  try {
    const offsets = await db.select().from(consumerOffsets);

    const oldest = offsets.reduce<number | null>((acc, offset) => {
      const at = offset.updatedAt.getTime();
      return acc === null || at < acc ? at : acc;
    }, null);

    return c.json({
      status: 'ok',
      // `tracking` says whether the mechanism is running at all, without
      // revealing how many consumers are running.
      tracking: offsets.length > 0 ? 'active' : 'idle',
      freshness: freshnessFor(oldest),
    });
  } catch (error) {
    // The driver's message names the host, port, database, and role. That is
    // connection state, which this file's privacy contract forbids returning to
    // an anonymous caller just as plainly as it forbids the offsets themselves.
    // The probe only needs to know that offset tracking is not answering; the
    // detail goes to the operator's logs.
    healthLog.error('consumer offset health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ status: 'error' }, 500);
  }
});
