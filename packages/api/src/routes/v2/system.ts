/**
 * This Omni's own version and the updates its owner confirms (system/update.ts).
 *
 *   GET  /api/v2/system/update   what runs, what the update channel publishes, and any update waiting or running
 *   POST /api/v2/system/update   ask for the published version; the owner confirms it on WhatsApp,
 *                                or, on a loopback-only Omni set up for it, the request starts it
 */

import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type SystemUpdater, UpdateVersionSchema } from '../../system/update';
import type { AppVariables } from '../../types';

const RequestSchema = z.object({ version: UpdateVersionSchema }).strict();

type Env = { Variables: AppVariables };

/** The app's updater (app.ts sets it for every /api/v2 request). */
function updaterOf(c: Context<Env>): SystemUpdater {
  const updater = c.get('updater');
  if (!updater) throw new Error('system routes mounted without an updater');
  return updater;
}

export const systemRoutes = new Hono<Env>();

systemRoutes.get('/update', async (c) => c.json({ data: await updaterOf(c).status() }));

systemRoutes.post('/update', async (c) => {
  const body = RequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: { code: 'VALIDATION', message: 'Body must be { version }, like 2.261023.8' } }, 400);
  }
  const result = await updaterOf(c).request(body.data.version, c.get('apiKey')?.id ?? 'unknown');
  if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, result.status);
  if (result.status === 'started') {
    return c.json(
      { data: { status: result.status, version: result.version, startedAt: result.startedAt.toISOString() } },
      202,
    );
  }
  return c.json(
    { data: { status: result.status, version: result.version, expiresAt: result.expiresAt.toISOString() } },
    202,
  );
});
