import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { type EventBus, configureLogging, getLogConfig } from '@omni/core';
import { DrizzleQueryError } from 'drizzle-orm';
import { Hono } from 'hono';
import { getAgentKeyRepairHealth, runStartupAgentKeyRepair } from '../agent-key-repair-state';
import { getHealth } from '../routes/health';
import { HealthResponseSchema } from '../schemas/openapi/health';
import type { AppVariables, HealthResponse } from '../types';

const previousEnv = { ...process.env };

// A boot can finish registering HTTP routes after its repair step, without a real DB/server.
async function boot(
  repair: () => Promise<void>,
  reportFailure = mock((_error: unknown) => {}),
  eventBus: EventBus | null = null,
) {
  await runStartupAgentKeyRepair(repair, { reportFailure });
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
  for (const name of ['OMNI_MULTITENANCY_ENABLED', 'OMNI_PAIRED_AGENT_CONSUMERS']) {
    if (previousEnv[name] === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = previousEnv[name];
  }
  // A fresh process starts healthy; restore that state for other health test files.
  await runStartupAgentKeyRepair(async () => {});
});

describe('startup agent key repair', () => {
  test('multitenancy on without the paired flag: failed repair logs once and boot serves degraded health with reason', async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    const error = new Error('tenant repair failed');
    const { app, reportFailure } = await boot(async () => {
      throw error;
    });
    const { response, body } = await health(app);
    expect(response.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.checks.agentKeyRepair?.error).toContain('Agent key repair failed');
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[0]).toBe(error);
  });
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
    expect(reportFailure).toHaveBeenCalledWith(error, null, undefined);
    expect(reportFailure.mock.calls[0]?.[0]).toHaveProperty('cause', cause);
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(body.status).toBe('degraded');
    expect(body.checks.agentKeyRepair).toEqual({
      status: 'error',
      error: 'Agent key repair failed. Restart Omni to retry the repair.',
      details: { agentsWithoutKey: null },
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

  test('health reports only the missing-agent count; one log names them without Drizzle SQL or params', async () => {
    const cause = Object.assign(new Error('permission denied for table api_keys'), { code: '42501' });
    const error = new DrizzleQueryError('UPDATE api_keys SET key_hash = $1', ['secret-key-material'], cause);
    const config = getLogConfig();
    const output: string[] = [];
    const writer = spyOn(process.stderr, 'write').mockImplementation((data) => {
      output.push(String(data));
      return true;
    });
    try {
      configureLogging({ level: 'error', format: 'json', modules: 'agent-key-reconciliation' });
      await runStartupAgentKeyRepair(
        async () => {
          throw error;
        },
        {
          inspectMissingAgents: async () => [
            { id: 'a', name: 'private-agent-A' },
            { id: 'b', name: 'private-agent-B' },
          ],
        },
      );
      expect(getAgentKeyRepairHealth().details).toEqual({ agentsWithoutKey: 2 });
      const health = JSON.stringify(getAgentKeyRepairHealth());
      expect(health).not.toContain('private-agent');
      expect(health).not.toContain('secret-key-material');
      expect(output).toHaveLength(1);
      expect(JSON.parse(output[0] ?? '')).toMatchObject({
        code: '42501',
        message: cause.message,
        agents: ['private-agent-A', 'private-agent-B'],
        agentsWithoutKey: 2,
      });
      expect(output.join('')).not.toContain('UPDATE api_keys');
      expect(output.join('')).not.toContain('secret-key-material');
    } finally {
      configureLogging(config);
      writer.mockRestore();
    }
  });

  test('an unavailable coverage read keeps boot open and reports an unknown count, never zero', async () => {
    const coverageError = new Error('database unavailable');
    const reportFailure = mock((_error: unknown, _missing: unknown, _coverageError: unknown) => {});
    await runStartupAgentKeyRepair(
      async () => {
        throw new Error('repair failed');
      },
      {
        inspectMissingAgents: async () => {
          throw coverageError;
        },
        reportFailure,
      },
    );
    expect(getAgentKeyRepairHealth().details).toEqual({ agentsWithoutKey: null });
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[2]).toBe(coverageError);
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
