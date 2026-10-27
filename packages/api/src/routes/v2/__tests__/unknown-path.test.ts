import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { automationsRoutes } from '../automations';

describe('root automation lookup routing (#1400)', () => {
  it('returns 404 for unknown segments without consulting services', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.route('/api/v2/automations', automationsRoutes);
    app.route('/api/v2', automationsRoutes);
    app.notFound((c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));
    for (const path of ['channels', 'no-such-path', 'automations/not-a-uuid']) {
      const response = await app.request(`/api/v2/${path}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('preserves UUID lookups under both mounts', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    const id = '12345678-1234-4234-8234-123456789abc';
    const lookedUp: string[] = [];
    app.use('*', async (c, next) => {
      c.set('services', { automations: { getById: async (value: string) => {
        lookedUp.push(value);
        return { id: value };
      } } } as unknown as AppVariables['services']);
      await next();
    });
    app.route('/api/v2/automations', automationsRoutes);
    app.route('/api/v2', automationsRoutes);
    for (const path of [id, `automations/${id}`]) {
      const response = await app.request(`/api/v2/${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { id } });
    }
    expect(lookedUp).toEqual([id, id]);
  });
});
