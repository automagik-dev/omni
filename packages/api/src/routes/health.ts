/**
 * Health check endpoints
 */

import { consumerOffsets, instances } from '@omni/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppVariables, HealthCheck, HealthResponse } from '../types';

const VERSION = '2.0.0';
const startTime = Date.now();

export const healthRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /health - Basic health check (no auth required)
 */
healthRoutes.get('/health', async (c) => {
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

  // Check NATS (if available)
  let natsCheck: HealthCheck;
  if (eventBus) {
    // TODO: Add actual NATS health check when eventBus is implemented
    natsCheck = { status: 'ok', details: { connected: true } };
  } else {
    natsCheck = { status: 'ok', details: { connected: false, reason: 'Not configured' } };
  }

  // Get instance counts
  let instanceStats: HealthResponse['instances'] | undefined;
  try {
    const instanceCounts = await db
      .select({
        channel: instances.channel,
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${instances.isActive})::int`,
      })
      .from(instances)
      .groupBy(instances.channel);

    const byChannel: Record<string, number> = {};
    let total = 0;
    let connected = 0;

    for (const row of instanceCounts) {
      byChannel[row.channel] = row.total;
      total += row.total;
      connected += row.active;
    }

    instanceStats = { total, connected, byChannel };
  } catch {
    // Ignore instance stats errors
  }

  // Determine overall status
  const hasErrors = dbCheck.status === 'error' || natsCheck.status === 'error';
  const status: HealthResponse['status'] = hasErrors ? 'degraded' : 'healthy';

  const response: HealthResponse = {
    status,
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      nats: natsCheck,
    },
    instances: instanceStats,
  };

  return c.json(response, status === 'healthy' ? 200 : 503);
});

/**
 * GET /info - System info (no auth required)
 */
healthRoutes.get('/info', async (c) => {
  const db = c.get('db');

  // Get basic stats
  let instancesTotal = 0;
  let instancesConnected = 0;
  const eventsToday = 0;
  const eventsTotal = 0;

  try {
    const [instanceStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        connected: sql<number>`count(*) filter (where ${instances.isActive})::int`,
      })
      .from(instances);

    instancesTotal = instanceStats?.total ?? 0;
    instancesConnected = instanceStats?.connected ?? 0;
  } catch {
    // Ignore errors
  }

  return c.json({
    version: VERSION,
    environment: process.env.NODE_ENV ?? 'development',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    instances: {
      total: instancesTotal,
      connected: instancesConnected,
    },
    events: {
      today: eventsToday,
      total: eventsTotal,
    },
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
 * GET /health/consumers - Consumer lag info (no auth required)
 * Shows per-consumer offset tracking and lag
 */
healthRoutes.get('/health/consumers', async (c) => {
  const db = c.get('db');

  try {
    const offsets = await db.select().from(consumerOffsets);

    const consumers = offsets.map((offset) => ({
      consumer: offset.consumerName,
      stream: offset.streamName,
      lastSequence: offset.lastSequence,
      lastEventId: offset.lastEventId,
      updatedAt: offset.updatedAt.toISOString(),
    }));

    return c.json({
      status: 'ok',
      consumers,
      totalTracked: consumers.length,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        consumers: [],
        totalTracked: 0,
      },
      500,
    );
  }
});
