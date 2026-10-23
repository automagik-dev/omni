/**
 * The operator's way in (login/operator.ts), behind an admin key (`auth:admin`):
 *
 *   POST /api/v2/owner/claim     make the key's holder the owner of an unclaimed Omni (`omni claim`)
 *   POST /api/v2/owner/approve   approve a waiting device by its code (`omni approve <code>`)
 *   POST /api/v2/owner/connect   a one-time connect link for one device (`omni connect`)
 *
 * Approve and connect claim an unclaimed Omni first and say so. With login off they answer 409.
 */

import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Login } from '../../login';
import { PublicUrlSchema } from '../../login/config';
import { approveAsOperator, claimForOperator, connectLinkForOperator } from '../../login/operator';
import { requestOrigin } from '../../login/origin';
import type { AppVariables } from '../../types';

type Env = { Variables: AppVariables };

const ApproveSchema = z.object({ userCode: z.string().trim().min(4).max(32) }).strict();
const ConnectSchema = z.object({ url: PublicUrlSchema.optional() }).strict();

const loginOff = {
  error: { code: 'LOGIN_OFF', message: 'Human login is off on this Omni (OMNI_LOGIN_ENABLED=false, or multitenancy).' },
} as const;

/** The app's login, or null when it is off (app.ts sets it for every /api/v2 request). */
const loginOf = (c: Context<Env>): Login | null => c.get('login') ?? null;
const keyIdOf = (c: Context<Env>) => c.get('apiKey')?.id ?? 'unknown';

export const ownerRoutes = new Hono<Env>();

ownerRoutes.post('/claim', async (c) => {
  const login = loginOf(c);
  if (!login) return c.json(loginOff, 409);
  const { owner, claimed } = await claimForOperator(login, { via: 'operator', apiKeyId: keyIdOf(c) });
  return c.json({ data: { claimed, whatsapp: owner.phone !== null } });
});

ownerRoutes.post('/approve', async (c) => {
  const login = loginOf(c);
  if (!login) return c.json(loginOff, 409);
  const body = ApproveSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'Body must be { userCode }' } }, 400);
  const result = await approveAsOperator(login, body.data.userCode, keyIdOf(c));
  if (!result.ok) return c.json({ error: { code: result.code, message: result.message } }, 404);
  return c.json({
    data: {
      approved: true as const,
      client: result.client,
      clientId: result.clientId,
      claimed: result.claimed,
      requestedFrom: result.requestedFrom
        ? { ip: result.requestedFrom.ip, at: new Date(result.requestedFrom.at).toISOString() }
        : null,
    },
  });
});

ownerRoutes.post('/connect', async (c) => {
  const login = loginOf(c);
  if (!login) return c.json(loginOff, 409);
  const body = ConnectSchema.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!body.success) {
    return c.json(
      { error: { code: 'VALIDATION', message: 'Body must be { url? }, url like https://omni.example.com' } },
      400,
    );
  }
  // The admin key's own request is trusted with its address: it is the operator's.
  const origin = body.data.url ?? requestOrigin(c.req.raw);
  if (!origin) {
    return c.json({ error: { code: 'NO_ADDRESS', message: 'Say where devices reach this Omni: { url }' } }, 400);
  }
  const result = await connectLinkForOperator(login, origin, keyIdOf(c));
  if (!result.ok) {
    return c.json(
      { error: { code: result.code, message: result.message, retryAfterSeconds: result.retryAfterSeconds } },
      429,
    );
  }
  return c.json(
    {
      data: {
        url: result.url,
        appLink: result.appLink,
        expiresAt: result.expiresAt.toISOString(),
        claimed: result.claimed,
      },
    },
    201,
  );
});
