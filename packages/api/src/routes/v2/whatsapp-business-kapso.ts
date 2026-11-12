/**
 * Kapso: the deployment-wide half of connecting a WhatsApp Business number through Kapso by
 * clicks (#1676). Mounted at `/api/v2/channels/whatsapp-business/kapso` (see v2/index.ts).
 *
 *   - PUT  /key         save the Kapso project key (sealed `kapso.api_key`), write-only
 *   - POST /setup-link  a Kapso setup link for this Omni's Kapso customer
 *   - GET  /numbers     the Kapso project's numbers, and whether Omni has a public address
 *
 * The per-instance half, `POST /instances/:id/whatsapp-business/kapso/connect`, lives with the
 * other connect route in routes/v2/whatsapp-business.ts. Every Kapso call is made by
 * `@omni/channel-whatsapp-business` (kapso.ts); every route refuses with multitenancy on.
 */

import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  KapsoApiError,
  type KapsoOptions,
  createKapsoCustomer,
  createKapsoSetupLink,
  listKapsoPhoneNumbers,
} from '@omni/channel-whatsapp-business';
import { createLogger } from '@omni/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { KAPSO_SETTINGS } from '../../constants/kapso';
import { resolveWhatsAppBusinessCallback } from '../../lib/whatsapp-business-callback';
import {
  KAPSO_NOT_CONFIGURED,
  type KapsoRefusal,
  kapsoErrorReply,
  kapsoUnavailable,
  resolveKapso,
  resolveKapsoBaseUrl,
} from '../../lib/whatsapp-business-kapso';
import type { AppVariables } from '../../types';

const log = createLogger('api:whatsapp-business-kapso');

export const whatsappBusinessKapsoRoutes = new Hono<{ Variables: AppVariables }>();

const KapsoKeyBodySchema = z.object({
  apiKey: z.string().trim().min(8).max(4096).regex(/^\S+$/, 'The key has no spaces'),
});

const reply = (c: Context, refusal: KapsoRefusal) => c.json(refusal.payload, refusal.status);

whatsappBusinessKapsoRoutes.use('*', async (c, next) => {
  const unavailable = kapsoUnavailable();
  if (unavailable) return reply(c, unavailable);
  await next();
});

/** Run a Kapso call; a Kapso refusal becomes its plain reply, anything else rethrows. */
async function kapso<T>(
  c: Context,
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; res: Response }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    const refused = kapsoErrorReply(error);
    if (!refused) throw error;
    log.warn('Kapso refused a request', { status: (error as KapsoApiError).status, code: refused.payload.error.code });
    return { ok: false, res: reply(c, refused) };
  }
}

// PUT /key — checked against Kapso first, so a mistyped key is never saved.
whatsappBusinessKapsoRoutes.put('/key', zValidator('json', KapsoKeyBodySchema), async (c) => {
  const { apiKey } = c.req.valid('json');
  const services = c.get('services');
  const candidate: KapsoOptions = { apiKey, baseUrl: await resolveKapsoBaseUrl(services.settings) };
  const checked = await kapso(c, () => listKapsoPhoneNumbers(candidate));
  if (!checked.ok) return checked.res;
  await services.settings.setValue(KAPSO_SETTINGS.apiKey.key, apiKey, {
    reason: 'Kapso project key saved from the WhatsApp Business connect page',
    changedBy: c.get('apiKey')?.name ?? 'api',
  });
  return c.json({ data: { saved: true } });
});

/**
 * This Omni's Kapso customer: the remembered one, or a new one remembered now. `stale` is the
 * id Kapso just said it does not know, so a deleted customer is replaced once.
 */
async function kapsoCustomerId(c: Context<{ Variables: AppVariables }>, options: KapsoOptions, stale?: string) {
  const settings = c.get('services').settings;
  const remembered = (await settings.getString(KAPSO_SETTINGS.customerId.key))?.trim();
  if (remembered && remembered !== stale) return remembered;
  const created = await createKapsoCustomer(options, { name: 'Omni', externalCustomerId: `omni-${randomUUID()}` });
  await settings.setValue(KAPSO_SETTINGS.customerId.key, created.id, {
    reason: 'Kapso customer created for WhatsApp setup links',
    changedBy: c.get('apiKey')?.name ?? 'api',
  });
  return created.id;
}

// POST /setup-link — Kapso revokes the customer's previous link, so the page keeps this one.
whatsappBusinessKapsoRoutes.post('/setup-link', async (c) => {
  const options = await resolveKapso(c.get('services').settings);
  if (!options) return reply(c, KAPSO_NOT_CONFIGURED);
  const made = await kapso(c, async () => {
    const customerId = await kapsoCustomerId(c, options);
    try {
      return await createKapsoSetupLink(options, customerId);
    } catch (error) {
      if (!(error instanceof KapsoApiError) || error.status !== 404) throw error;
      return createKapsoSetupLink(options, await kapsoCustomerId(c, options, customerId));
    }
  });
  if (!made.ok) return made.res;
  return c.json({ data: made.value });
});

// GET /numbers — and the webhook address Omni would give Kapso (null: no public address).
whatsappBusinessKapsoRoutes.get('/numbers', async (c) => {
  const settings = c.get('services').settings;
  const options = await resolveKapso(settings);
  if (!options) return reply(c, KAPSO_NOT_CONFIGURED);
  const listed = await kapso(c, () => listKapsoPhoneNumbers(options));
  if (!listed.ok) return listed.res;
  const { callbackUrl } = await resolveWhatsAppBusinessCallback(settings);
  return c.json({ data: { items: listed.value, webhookUrl: callbackUrl } });
});
