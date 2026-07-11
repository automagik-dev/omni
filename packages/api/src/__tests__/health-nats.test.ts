/**
 * Tests for the /health NATS check.
 *
 * Regression coverage for the 2026-07-06 prod incident: /health hardcoded
 * `nats: { status: 'ok', details: { connected: true } }` while the event-bus
 * publisher's NATS connection was permanently dead after a server restart —
 * every publish threw "Not connected to NATS" behind a green health check.
 * The check must reflect the publisher's real connection state
 * (EventBus.isConnected(), the same state the publish path gates on).
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { Hono } from 'hono';
import { getHealth } from '../routes/health';
import type { AppVariables, HealthResponse } from '../types';

function fakeEventBus(connected: boolean): EventBus {
  return { isConnected: () => connected } as unknown as EventBus;
}

function createApp(eventBus: EventBus | null) {
  const app = new Hono<{ Variables: AppVariables }>();

  // Minimal db fake: SELECT 1 succeeds, instance stats are unavailable
  // (getHealth swallows instance-stats errors).
  const fakeDb = {
    execute: async () => [],
    select: () => {
      throw new Error('instance stats not available in tests');
    },
  } as unknown as AppVariables['db'];

  app.use('*', async (c, next) => {
    c.set('db', fakeDb);
    c.set('eventBus', eventBus);
    c.set('channelRegistry', null);
    await next();
  });
  app.get('/health', getHealth);

  return app;
}

describe('GET /health NATS check', () => {
  test('reports ok when the publisher connection is up', async () => {
    const app = createApp(fakeEventBus(true));
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('healthy');
    expect(body.checks.nats.status).toBe('ok');
    expect(body.checks.nats.details).toEqual({ connected: true });
  });

  test('reports error + degraded when the publisher connection is dead', async () => {
    const app = createApp(fakeEventBus(false));
    const res = await app.request('/health');

    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthResponse;
    expect(body.status).toBe('degraded');
    expect(body.checks.nats.status).toBe('error');
    expect(body.checks.nats.details).toEqual({ connected: false });
    expect(body.checks.nats.error).toBeTruthy();
  });

  test('reports ok with connected=false when no event bus is configured', async () => {
    const app = createApp(null);
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthResponse;
    expect(body.checks.nats.status).toBe('ok');
    expect(body.checks.nats.details).toEqual({ connected: false, reason: 'Not configured' });
  });
});
