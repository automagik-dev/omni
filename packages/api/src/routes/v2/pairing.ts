/**
 * Device pairing routes (wish: omni-labs-distribution, Group 2).
 *
 * Unauthenticated by contract: a device that has no key yet asks for one here.
 * Mounted on the root app before protectedApp (see app.ts), and always mounted:
 * with OMNI_PAIRING_ENABLED unset, or with multitenancy on (paired keys are
 * legacy keys, which a tenant deployment must not mint), every route answers
 * the same 404 an unknown path does.
 *
 *   POST   /api/v2/pair/start  { deviceName }  -> code, where to send it, poll token
 *   GET    /api/v2/pair/:id    x-pairing-token -> status; the key exactly once
 *   DELETE /api/v2/pair/:id    x-pairing-token -> cancel a pending pairing
 *
 * The flow and what is secret are described in services/device-pairing.ts.
 */

import { createLogger } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  pairingPollRateLimitMiddleware,
  pairingStartRateLimitMiddleware,
  requestClientIp,
} from '../../middleware/rate-limit';
import { type PairingConfig, phoneDigits, readPairingConfig } from '../../services/device-pairing';
import { isMultitenancyEnabled } from '../../tenancy/feature-flag';
import type { AppVariables } from '../../types';

const log = createLogger('api:pairing');

export const PairingStartBodySchema = z
  .object({
    deviceName: z.string().trim().min(1).max(80),
  })
  .strict();

const PairingIdSchema = z.string().uuid();
const PollTokenSchema = z.string().min(16).max(200);

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;

let warnedMisconfigured = false;

/** The pairing configuration when pairing is available on this deployment, else null. */
function activeConfig(): PairingConfig | null {
  let config: PairingConfig;
  try {
    config = readPairingConfig();
  } catch (error) {
    if (!warnedMisconfigured) {
      warnedMisconfigured = true;
      log.error('Device pairing is misconfigured and stays off', { error: String(error) });
    }
    return null;
  }
  if (!config.enabled || !config.instanceId || isMultitenancyEnabled()) return null;
  return config;
}

export const pairingRoutes = new Hono<{ Variables: AppVariables }>();

pairingRoutes.post('/start', pairingStartRateLimitMiddleware, async (c) => {
  const config = activeConfig();
  if (!config?.instanceId) return c.json(notFound, 404);

  const body = PairingStartBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: { code: 'VALIDATION', message: 'Body must be { "deviceName": string (1-80) }' } }, 400);
  }

  const services = c.get('services');
  const instance = await services.instances.getById(config.instanceId).catch(() => null);
  const sendTo = phoneDigits(instance?.ownerIdentifier);
  if (!instance || !instance.isActive || instance.channel !== 'whatsapp-baileys' || !sendTo) {
    log.warn('Device pairing requested but the pairing instance cannot take codes', {
      instanceId: config.instanceId,
    });
    return c.json({ error: { code: 'PAIRING_UNAVAILABLE', message: 'Pairing is unavailable right now' } }, 503);
  }

  const started = await services.devicePairing.start({
    deviceName: body.data.deviceName,
    instanceId: instance.id,
    channelType: instance.channel,
    clientIp: requestClientIp(c) ?? null,
  });
  if (!started) {
    return c.json({ error: { code: 'PAIRING_BUSY', message: 'Too many pairings are waiting; try again later' } }, 429);
  }

  return c.json({
    data: {
      pairingId: started.pairingId,
      code: started.code,
      sendTo: `+${sendTo}`,
      waLink: `https://wa.me/${sendTo}?text=${encodeURIComponent(`Omni ${started.code}`)}`,
      expiresAt: started.expiresAt.toISOString(),
      pollToken: started.pollToken,
      pollIntervalMs: 2000,
    },
  });
});

pairingRoutes.get('/:id', pairingPollRateLimitMiddleware, async (c) => {
  const config = activeConfig();
  const id = PairingIdSchema.safeParse(c.req.param('id'));
  const token = PollTokenSchema.safeParse(c.req.header('x-pairing-token'));
  if (!config || !id.success || !token.success) return c.json(notFound, 404);

  const result = await c.get('services').devicePairing.poll(id.data, token.data, config);
  if (!result) return c.json(notFound, 404);

  return c.json({
    data: {
      status: result.status,
      ...(result.apiKey
        ? {
            apiKey: result.apiKey,
            keyId: result.keyId,
            scopes: result.scopes,
            keyExpiresAt: result.keyExpiresAt?.toISOString(),
            apiUrl: config.publicUrl,
          }
        : {}),
    },
  });
});

pairingRoutes.delete('/:id', pairingPollRateLimitMiddleware, async (c) => {
  const config = activeConfig();
  const id = PairingIdSchema.safeParse(c.req.param('id'));
  const token = PollTokenSchema.safeParse(c.req.header('x-pairing-token'));
  if (!config || !id.success || !token.success) return c.json(notFound, 404);

  const cancelled = await c.get('services').devicePairing.cancel(id.data, token.data);
  if (cancelled === null) return c.json(notFound, 404);
  return c.json({ data: { cancelled } });
});
