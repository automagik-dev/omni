/**
 * Human login surface (wish: omni-labs-distribution). Unauthenticated by contract:
 * these are how a person and their devices get in. All of it answers 404 unless
 * OMNI_LOGIN_ENABLED=true (and never with multitenancy on), like a path that does
 * not exist. Mounted on the root app before protectedApp (see app.ts).
 *
 *   /api/auth/*            Better Auth itself, limited to PUBLIC_AUTH_PATHS: the device
 *                          flow (RFC 8628), passkeys, session read and sign-out
 *   /api/v2/login/status   claimed or not, and the owner's WhatsApp for the device QR
 *   /api/v2/login/claim/*  claiming an unclaimed Omni (needs the claim token)
 *   /api/v2/login/send-code, /verify   a login code in the owner's WhatsApp self chat
 *   /api/v2/login/device-key           a device trades its one-time device token for an Omni key
 *   /api/login/claim, /api/login/device        the pages a person opens
 */

import { createLogger } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { qrSvg } from '../../lib/qr-svg';
import { type Login, ownerAccount, ownerOf } from '../../login';
import { PUBLIC_AUTH_PATHS } from '../../login/auth';
import { DEVICE_CLIENTS, claimTokenOf, isDeviceClient } from '../../login/config';
import { claimPage, devicePage } from '../../login/pages';
import { maskPhone } from '../../login/whatsapp';
import { loginRateLimitMiddleware, requestClientIp } from '../../middleware/rate-limit';
import { getPlugin } from '../../plugins/loader';
import { getQrCode } from '../../plugins/qr-store';
import type { AppVariables } from '../../types';

const log = createLogger('api:login');

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
const CODE = z.string().regex(/^\d{6}$/);
const InstanceIdSchema = z.object({ instanceId: z.string().uuid() }).strict();
const VerifySchema = z.object({ code: CODE }).strict();
const ClaimVerifySchema = z.object({ instanceId: z.string().uuid(), code: CODE }).strict();
const DeviceKeySchema = z.object({ deviceName: z.string().trim().min(1).max(80) }).strict();
const OWNER_INSTANCE_NAME = 'owner-whatsapp';

type Env = { Variables: AppVariables };

/** Copy Better Auth's Set-Cookie headers onto a JSON reply. */
function withCookies(body: unknown, headers: Headers | undefined, status = 200): Response {
  const reply = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  for (const cookie of headers?.getSetCookie?.() ?? []) reply.headers.append('set-cookie', cookie);
  return reply;
}

/** Better Auth's own handler, limited to the public paths, at /api/auth/*. */
export function loginAuthRoutes(login: Login | null) {
  const app = new Hono<Env>();
  app.all('/*', (c) => {
    const path = new URL(c.req.url).pathname.replace(/^\/api\/auth/, '') || '/';
    if (!login || !PUBLIC_AUTH_PATHS.has(path)) return c.json(notFound, 404);
    return login.auth.handler(c.req.raw);
  });
  return app;
}

/** The pages a person opens: /api/login/claim and /api/login/device. */
export function loginPageRoutes(login: Login | null) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (!login) return c.json(notFound, 404);
    await next();
  });
  app.get('/claim', (c) => c.html(claimPage()));
  app.get('/device', (c) => c.html(devicePage(DEVICE_CLIENTS)));
  return app;
}

/** Omni's own login endpoints at /api/v2/login. */
export function loginApiRoutes(login: Login | null) {
  const app = new Hono<Env>();
  // Off answers before anything else runs, rate limiter included.
  app.use('*', async (c, next) => {
    if (!login) return c.json(notFound, 404);
    await next();
  });
  // Routes exist whether or not login is on (the route-ownership gate lists them); the
  // guard above answers 404 before any handler runs when it is off.
  const active = login as Login;

  const claimable = async (token: string | undefined) =>
    token !== undefined && token === claimTokenOf(active.config) && !(await ownerOf(active));

  app.get('/status', async (c) => {
    const owner = await ownerOf(active);
    const self = owner ? await ownerAccount(active) : null;
    return c.json({
      data: {
        claimed: owner !== null,
        // The owner's own number, so a device can show a QR that opens their self chat.
        whatsapp: self ? `+${self.phone}` : null,
        deviceUrl: `${active.config.publicUrl}/api/login/device`,
      },
    });
  });

  // ---- Claiming an unclaimed Omni (claim token from the boot log) ----

  app.get('/claim/accounts', loginRateLimitMiddleware, async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const selves = await active.whatsapp.accounts();
    return c.json({
      data: selves.map((self) => ({
        instanceId: self.instanceId,
        name: self.instanceName,
        phone: maskPhone(self.phone),
      })),
    });
  });

  app.post('/claim/whatsapp', loginRateLimitMiddleware, async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const plugin = await getPlugin('whatsapp-baileys');
    if (!plugin) return c.json({ error: { code: 'UNAVAILABLE', message: 'WhatsApp is not available here' } }, 503);
    const instance = await active.services.instances.create({ name: OWNER_INSTANCE_NAME, channel: 'whatsapp-baileys' });
    await plugin
      .connect(instance.id, { instanceId: instance.id, credentials: {}, options: { forceNewQr: true } })
      .catch((error) => log.warn('Owner WhatsApp did not start connecting', { error: String(error) }));
    return c.json({ data: { instanceId: instance.id } }, 201);
  });

  app.get('/claim/whatsapp/:id', async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json(notFound, 404);
    const self = (await active.whatsapp.accounts()).find((candidate) => candidate.instanceId === id.data);
    if (self) return c.json({ data: { connected: true, phone: maskPhone(self.phone), qrSvg: null } });
    const code = getQrCode(id.data)?.code;
    return c.json({ data: { connected: false, phone: null, qrSvg: code ? qrSvg(code) : null } });
  });

  app.post('/claim/send-code', loginRateLimitMiddleware, async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const body = InstanceIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'Body must be { instanceId }' } }, 400);
    const self = (await active.whatsapp.accounts()).find((candidate) => candidate.instanceId === body.data.instanceId);
    if (!self) return c.json({ error: { code: 'NOT_CONNECTED', message: 'That WhatsApp is not connected' } }, 409);
    await active.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: `+${self.phone}` } });
    return c.json({ data: { sentTo: maskPhone(self.phone) } });
  });

  app.post('/claim/verify', loginRateLimitMiddleware, async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const body = ClaimVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: { code: 'VALIDATION', message: 'Body must be { instanceId, code }' } }, 400);
    const self = (await active.whatsapp.accounts()).find((candidate) => candidate.instanceId === body.data.instanceId);
    if (!self) return c.json({ error: { code: 'NOT_CONNECTED', message: 'That WhatsApp is not connected' } }, 409);
    const verified = await active.auth.api
      .verifyPhoneNumber({ body: { phoneNumber: `+${self.phone}`, code: body.data.code }, returnHeaders: true })
      .catch(() => null);
    const owner = await ownerOf(active);
    if (!verified || !owner) return c.json({ error: { code: 'INVALID_CODE', message: 'That code is not right' } }, 400);
    await active.eventBus?.publish(
      'access.owner_claimed',
      { userId: owner.id, instanceId: self.instanceId },
      { instanceId: self.instanceId, channelType: 'whatsapp-baileys' },
    );
    log.info('Omni claimed', { instanceId: self.instanceId });
    return withCookies({ data: { claimed: true } }, verified.headers);
  });

  // ---- The owner signing in with a code in their own WhatsApp ----

  app.post('/send-code', loginRateLimitMiddleware, async (c) => {
    const self = await ownerAccount(active);
    if (!self)
      return c.json({ error: { code: 'NOT_CONNECTED', message: "The owner's WhatsApp is not connected" } }, 409);
    await active.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: `+${self.phone}` } });
    return c.json({ data: { sentTo: maskPhone(self.phone) } });
  });

  app.post('/verify', loginRateLimitMiddleware, async (c) => {
    const body = VerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'Body must be { code }' } }, 400);
    const owner = await ownerOf(active);
    if (!owner?.phone) return c.json(notFound, 404);
    const verified = await active.auth.api
      .verifyPhoneNumber({ body: { phoneNumber: `+${owner.phone}`, code: body.data.code }, returnHeaders: true })
      .catch(() => null);
    if (!verified) return c.json({ error: { code: 'INVALID_CODE', message: 'That code is not right' } }, 400);
    return withCookies({ data: { signedIn: true } }, verified.headers);
  });

  // ---- A device's one-time token for its Omni key ----

  app.post('/device-key', loginRateLimitMiddleware, async (c) => {
    const authorization = c.req.header('authorization') ?? '';
    if (!/^Bearer \S+$/.test(authorization))
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Bearer device token required' } }, 401);
    const body = DeviceKeySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'Body must be { deviceName }' } }, 400);
    // Only the bearer token counts here, never a browser's cookie.
    const session = await active.auth.api.getSession({ headers: new Headers({ authorization }) }).catch(() => null);
    const owner = await ownerOf(active);
    if (!session || !owner || session.user.id !== owner.id) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Unknown or used device token' } }, 401);
    }
    const clientId = c.req.header('x-omni-client') ?? 'omni-device';
    const keyExpiresAt = active.config.deviceKeyTtlDays
      ? new Date(Date.now() + active.config.deviceKeyTtlDays * 86_400_000)
      : undefined;
    const created = await active.services.apiKeys.create({
      name: `device: ${body.data.deviceName}`,
      description: `Authorized by the owner through ${isDeviceClient(clientId) ? DEVICE_CLIENTS[clientId] : 'a device'}, from ${requestClientIp(c) ?? 'an unknown address'}`,
      scopes: active.config.deviceKeyScopes,
      ...(keyExpiresAt ? { expiresAt: keyExpiresAt } : {}),
      createdBy: `login:${owner.id}`,
    });
    // One key per device token: the session that carried it ends here.
    await active.auth.api
      .revokeSession({ headers: new Headers({ authorization }), body: { token: session.session.token } })
      .catch(() => null);
    await active.eventBus?.publish('access.device_authorized', {
      userId: owner.id,
      clientId,
      deviceName: body.data.deviceName,
      apiKeyId: created.key.id,
    });
    return c.json({
      data: {
        apiKey: created.plainTextKey,
        keyId: created.key.id,
        scopes: created.key.scopes,
        keyExpiresAt: keyExpiresAt?.toISOString() ?? null,
        apiUrl: active.config.publicUrl,
      },
    });
  });

  return app;
}
