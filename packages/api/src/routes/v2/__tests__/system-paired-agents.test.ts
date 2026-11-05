import { afterEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { z } from 'zod';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import { PairedAgentsStatusSchema } from '../../../schemas/openapi/system';
import type { ApiKeyData, AppVariables } from '../../../types';
import { systemRoutes } from '../system';

const previous = { ...process.env };
afterEach(() => {
  for (const name of ['OMNI_PAIRED_AGENT_CONSUMERS', 'OMNI_MULTITENANCY_ENABLED']) {
    if (previous[name] === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = previous[name];
  }
});
function mount(scopes: string[]) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const apiKey: ApiKeyData = {
      id: 'status-test',
      name: 'status',
      scopes,
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    };
    c.set('apiKey', apiKey);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.route('/api/v2/system', systemRoutes);
  return app;
}
for (const mode of ['on', 'unset', 'multitenancy'] as const) {
  test(`${mode}: mounted system route returns the effective flag state`, async () => {
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    if (mode === 'unset') Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    if (mode === 'multitenancy') process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    const response = await mount(['system:read']).request('/api/v2/system/paired-agents');
    expect(response.status).toBe(200);
    const body = z.object({ data: PairedAgentsStatusSchema }).parse(await response.json());
    expect(body.data.consumers).toEqual({
      flag: 'OMNI_PAIRED_AGENT_CONSUMERS',
      enabled: mode === 'on',
      reason: mode === 'on' ? null : mode === 'unset' ? 'flag_unset' : 'multitenancy_enabled',
    });
  });
}
test('a key without system:read cannot read paired-agent configuration', async () => {
  const response = await mount(['events:read']).request('/api/v2/system/paired-agents');
  expect(response.status).toBe(403);
});
