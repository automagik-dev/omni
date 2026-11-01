import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { Hono } from 'hono';
import { runStartupAgentKeyRepair } from '../agent-key-repair-state';
import { getHealth } from '../routes/health';
import { HealthResponseSchema } from '../schemas/openapi/health';
import type { AppVariables, HealthResponse } from '../types';

// A boot can finish registering HTTP routes after its repair step, without a real DB/server.
async function boot(
  repair: () => Promise<void>,
  reportFailure = mock((_error: unknown) => {}),
  eventBus: EventBus | null = null,
) {
  await runStartupAgentKeyRepair(repair, reportFailure);
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', { execute: async () => [] } as unknown as AppVariables['db']);
    c.set('eventBus', eventBus);
    await next();
  });
  app.get('/health', getHealth);
  return { app, reportFailure };
}

async function health(app: Awaited<ReturnType<typeof boot>>['app']) {
  const response = await app.request('/health');
  return { response, body: (await response.json()) as HealthResponse };
}

afterEach(async () => {
  // A fresh process starts healthy; restore that state for other health test files.
  await runStartupAgentKeyRepair(async () => {});
});

describe('startup agent key repair', () => {
  test('an injected repair failure logs once with its cause and boot still serves degraded health', async () => {
    const cause = new Error('database permission denied');
    const error = new Error('repair failed', { cause });
    const repair = mock(async () => {
      throw error;
    });
    const { app, reportFailure } = await boot(repair);
    const { response, body } = await health(app);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(error);
    expect(reportFailure.mock.calls[0]?.[0]).toHaveProperty('cause', cause);
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(body.status).toBe('degraded');
    expect(body.checks.agentKeyRepair).toEqual({
      status: 'error',
      error: 'Agent key repair failed. Restart Omni to retry the repair.',
    });
    expect(HealthResponseSchema.parse(body).checks.agentKeyRepair).toEqual(body.checks.agentKeyRepair);
    expect(JSON.stringify(body)).not.toContain(cause.message);
    await health(app);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledTimes(1);
  });

  test('a clean repair finishes before boot continues and leaves health healthy', async () => {
    const events: string[] = [];
    const { app, reportFailure } = await boot(async () => {
      await Promise.resolve();
      events.push('repaired');
    });
    events.push('booted');
    const { response, body } = await health(app);
    expect(events).toEqual(['repaired', 'booted']);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.checks.agentKeyRepair).toEqual({ status: 'ok' });
  });

  test('a repair warning does not mask an unavailable dependency', async () => {
    const { app } = await boot(
      async () => {
        throw new Error('repair unavailable');
      },
      mock((_error: unknown) => {}),
      { isConnected: () => false } as unknown as EventBus,
    );
    const { response, body } = await health(app);
    expect(response.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.agentKeyRepair?.status).toBe('error');
    expect(body.checks.nats.status).toBe('error');
  });

  test('the next boot retries a failed repair and clears degraded health on success', async () => {
    await boot(async () => {
      throw new Error('temporary database failure');
    });
    const repair = mock(async () => {});
    const { app } = await boot(repair);
    const { response, body } = await health(app);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(body.checks.agentKeyRepair).toEqual({ status: 'ok' });
  });
});
