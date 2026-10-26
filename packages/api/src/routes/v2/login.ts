/**
 * Human login surface (wish: omni-labs-distribution). Unauthenticated by contract:
 * these are how a person and their devices get in. All of it answers 404 when
 * OMNI_LOGIN_ENABLED=false (and always with multitenancy on), like a path that does
 * not exist. Mounted on the root app before protectedApp (see app.ts). The operator's
 * own way in, behind an admin key, is routes/v2/owner.ts.
 *
 *   /api/auth/*            Better Auth itself, limited to PUBLIC_AUTH_PATHS: the device
 *                          flow (RFC 8628), passkeys, session read and sign-out
 *   /api/v2/login/status   claimed or not, and the owner's WhatsApp for the device QR
 *   /api/v2/login/claim/*  claiming an unclaimed Omni with the claim token: on its own, or by
 *                          verifying a WhatsApp number; a phoneless owner links one the same way
 *   /api/v2/login/send-code, /verify   a login code in the owner's WhatsApp self chat
 *   /api/v2/login/device-key           a device trades its one-time device token for an Omni key
 *   /api/v2/login/connect              a device trades a connect link's grant for an Omni key
 *   /api/login/claim, /api/login/device, /api/login/app   the pages a person opens
 *   /  (and /api)                      what a browser sees at this Omni's own address
 */

import { timingSafeEqual } from 'node:crypto';
import { createLogger } from '@omni/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { qrSvg } from '../../lib/qr-svg';
import { type Login, allowCodeSend, ownerAccount, ownerOf } from '../../login';
import { PUBLIC_AUTH_PATHS } from '../../login/auth';
import { DEVICE_CLIENTS, type DeviceClientId, claimTokenOf, deviceKeysFor, isDeviceClient } from '../../login/config';
import { GrantSchema, consumeConnectGrant, isLiveGrant } from '../../login/connect';
import { deviceApprovedMessage } from '../../login/messages';
import { claimForOperator } from '../../login/operator';
import { pendingDeviceCode } from '../../login/operator';
import { publicOrigin } from '../../login/origin';
import { appPage, claimPage, devicePage, landingPage } from '../../login/pages';
import { maskPhone } from '../../login/whatsapp';
import { authRateLimitMiddleware, loginRateLimitMiddleware, requestClientIp } from '../../middleware/rate-limit';
import { getPlugin } from '../../plugins/loader';
import { getQrCode } from '../../plugins/qr-store';
import type { AppVariables } from '../../types';

const log = createLogger('api:login');

const notFound = { error: { code: 'NOT_FOUND', message: 'Not found' } } as const;
const CODE = z.string().regex(/^\d{6}$/);
const InstanceIdSchema = z.object({ instanceId: z.string().uuid() }).strict();
const VerifySchema = z.object({ code: CODE }).strict();
const ClaimVerifySchema = z.object({ instanceId: z.string().uuid(), code: CODE }).strict();
const DeviceNameSchema = z.string().trim().min(1).max(80);
const DeviceKeySchema = z.object({ deviceName: DeviceNameSchema }).strict();

/** The refusal for a client this Omni's device-key scopes leave nothing to, sent before its token is spent. */
function noDeviceScopes(clientId: string) {
  const what = isDeviceClient(clientId) ? DEVICE_CLIENTS[clientId] : 'this device';
  return {
    error: {
      code: 'NO_DEVICE_SCOPES',
      message: `This Omni's device-key scopes (OMNI_DEVICE_KEY_SCOPES) leave nothing for ${what}.`,
    },
  };
}
const ConnectSchema = z
  .object({
    grant: GrantSchema,
    clientId: z.string().refine(isDeviceClient, 'unknown device client'),
    deviceName: DeviceNameSchema,
  })
  .strict();
const UserCodeSchema = z.string().trim().min(4).max(32);
const OWNER_INSTANCE_NAME = 'owner-whatsapp';

type Env = { Variables: AppVariables };

/** Copy Better Auth's Set-Cookie headers onto a JSON reply. */
function withCookies(body: unknown, headers: Headers | undefined, status = 200): Response {
  const reply = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  for (const cookie of headers?.getSetCookie?.() ?? []) reply.headers.append('set-cookie', cookie);
  return reply;
}

const sameSecret = (given: string | undefined, expected: string) => {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Where people reach this Omni, for links handed to whoever asked: the public URL, else this request's address. */
const originOf = (login: Login, c: Context<Env>) => publicOrigin(login.config, c.req.raw) ?? '';

const tooSoon = (c: Context<Env>, retryAfterSeconds: number) =>
  c.json(
    {
      error: {
        code: 'TOO_SOON',
        message: `Wait ${retryAfterSeconds} s before asking for another code`,
        retryAfterSeconds,
      },
    },
    429,
  );

/**
 * Better Auth's own handler at /api/auth/*, limited to the public paths. The request
 * reaches it without its Authorization header: a device's token is good for one thing,
 * /api/v2/login/device-key, and never as a session against Better Auth's endpoints.
 */
export function loginAuthRoutes(login: Login | null) {
  const app = new Hono<Env>();
  // Off answers before anything else runs, rate limiter included.
  app.use('*', async (c, next) => {
    if (!login) return c.json(notFound, 404);
    await next();
  });
  const handle = async (c: Context<Env>) => {
    const path = new URL(c.req.url).pathname.replace(/^\/api\/auth/, '') || '/';
    if (!login || !PUBLIC_AUTH_PATHS.has(path)) return c.json(notFound, 404);
    const headers = new Headers(c.req.raw.headers);
    headers.delete('authorization');
    const request = new Request(c.req.raw, { headers });
    if (path !== '/device/code') return login.auth.handler(request);

    // A new device request: sweep the expired ones (nothing else removes unpolled rows),
    // then remember where it came from for the owner's WhatsApp confirmation.
    const { adapter } = await login.auth.$context;
    await adapter.deleteMany({
      model: 'deviceCode',
      where: [{ field: 'expiresAt', value: new Date(), operator: 'lt' }],
    });
    const response = await login.auth.handler(request);
    const issued = (await response
      .clone()
      .json()
      .catch(() => null)) as { user_code?: string } | null;
    if (issued?.user_code)
      login.deviceRequests.set(issued.user_code, { ip: requestClientIp(c) ?? null, at: Date.now() });
    return response;
  };
  app.post('/device/code', loginRateLimitMiddleware, handle);
  app.all('/*', authRateLimitMiddleware, handle);
  return app;
}

/** The pages a person opens: /api/login/claim, /api/login/device, and the WhatsApp hop. */
export function loginPageRoutes(login: Login | null) {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    if (!login) return c.json(notFound, 404);
    await next();
  });
  const active = login as Login;
  app.get('/claim', (c) => c.html(claimPage({ passkeys: active.config.publicUrl !== null })));
  app.get('/device', (c) => c.html(devicePage(DEVICE_CLIENTS, { passkeys: active.config.publicUrl !== null })));
  // With a connect link's grant (texted "connect"), the page opens the app with it; looking never spends it.
  app.get('/app', async (c) => {
    const grant = c.req.query('grant');
    if (grant === undefined) return c.html(appPage());
    return c.html(appPage((await isLiveGrant(active, grant)) ? { grant } : { expired: true }));
  });
  // What a device's QR opens: the owner's WhatsApp chat with themselves, with the device's
  // code typed. The owner's number is given out only here, and only for a live request.
  app.get('/whatsapp', authRateLimitMiddleware, async (c) => {
    const userCode = UserCodeSchema.safeParse(c.req.query('user_code'));
    if (!userCode.success || !(await pendingDeviceCode(active, userCode.data))) return c.json(notFound, 404);
    const account = await ownerAccount(active);
    if (!account) return c.json(notFound, 404);
    const code = userCode.data.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const shown = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    return c.redirect(`https://wa.me/${account.phone}?text=${encodeURIComponent(`Omni ${shown}`)}`, 302);
  });
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

  const tokenOk = (token: string | undefined) => sameSecret(token, claimTokenOf(active.config));
  /** The claim token, on an Omni nobody owns yet. */
  const claimable = async (token: string | undefined) => tokenOk(token) && !(await ownerOf(active));
  /** The claim token, while there is no owner or the owner has no WhatsApp yet: the WhatsApp steps link one. */
  const linkable = async (token: string | undefined) => {
    if (!tokenOk(token)) return false;
    const owner = await ownerOf(active);
    return owner === null || owner.phone === null;
  };

  app.get('/status', async (c) => {
    const owner = await ownerOf(active);
    return c.json({
      data: {
        claimed: owner !== null,
        // Whether a device's QR can approve it over WhatsApp right now (the owner's account
        // is connected). The number itself is never listed here; see /api/login/whatsapp.
        whatsapp: owner !== null && (await ownerAccount(active)) !== null,
        deviceUrl: `${originOf(active, c)}/api/login/device`,
        whatsappUrl: `${originOf(active, c)}/api/login/whatsapp`,
        // Face ID and fingerprints need a fixed public URL; `omni approve <code>` on the server always works.
        passkeys: active.config.publicUrl !== null,
      },
    });
  });

  // ---- Claiming an unclaimed Omni (claim token from the boot log) ----

  // The token alone: whoever has the boot log runs this server. WhatsApp can be linked after.
  app.post('/claim/token', loginRateLimitMiddleware, async (c) => {
    if (!(await claimable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const { owner, claimed } = await claimForOperator(active, { via: 'claim-token' });
    if (!claimed) return c.json(notFound, 404);
    log.info('Omni claimed with the claim token', { userId: owner.id });
    return c.json({ data: { claimed: true } }, 201);
  });

  app.get('/claim/accounts', loginRateLimitMiddleware, async (c) => {
    if (!(await linkable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const accounts = await active.whatsapp.accounts();
    return c.json({
      data: accounts.map((account) => ({
        instanceId: account.instanceId,
        name: account.instanceName,
        phone: maskPhone(account.phone),
      })),
    });
  });

  app.post('/claim/whatsapp', loginRateLimitMiddleware, async (c) => {
    if (!(await linkable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const plugin = await getPlugin('whatsapp-baileys');
    if (!plugin) return c.json({ error: { code: 'UNAVAILABLE', message: 'WhatsApp is not available here' } }, 503);
    const instance = await active.services.instances.create({ name: OWNER_INSTANCE_NAME, channel: 'whatsapp-baileys' });
    await plugin
      .connect(instance.id, { instanceId: instance.id, credentials: {}, options: { forceNewQr: true } })
      .catch((error) => log.warn('Owner WhatsApp did not start connecting', { error: String(error) }));
    return c.json({ data: { instanceId: instance.id } }, 201);
  });

  app.get('/claim/whatsapp/:id', authRateLimitMiddleware, async (c) => {
    if (!(await linkable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const id = z.string().uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json(notFound, 404);
    const account = (await active.whatsapp.accounts()).find((candidate) => candidate.instanceId === id.data);
    if (account) return c.json({ data: { connected: true, phone: maskPhone(account.phone), qrSvg: null } });
    const code = getQrCode(id.data)?.code;
    return c.json({ data: { connected: false, phone: null, qrSvg: code ? qrSvg(code) : null } });
  });

  app.post('/claim/send-code', loginRateLimitMiddleware, async (c) => {
    if (!(await linkable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const body = InstanceIdSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'VALIDATION', message: 'Body must be { instanceId }' } }, 400);
    const account = (await active.whatsapp.accounts()).find(
      (candidate) => candidate.instanceId === body.data.instanceId,
    );
    if (!account) return c.json({ error: { code: 'NOT_CONNECTED', message: 'That WhatsApp is not connected' } }, 409);
    const wait = allowCodeSend(active, account.phone);
    if (wait > 0) return tooSoon(c, wait);
    await active.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: `+${account.phone}` } });
    return c.json({ data: { sentTo: maskPhone(account.phone) } });
  });

  app.post('/claim/verify', loginRateLimitMiddleware, async (c) => {
    if (!(await linkable(c.req.header('x-omni-claim-token')))) return c.json(notFound, 404);
    const body = ClaimVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: { code: 'VALIDATION', message: 'Body must be { instanceId, code }' } }, 400);
    const account = (await active.whatsapp.accounts()).find(
      (candidate) => candidate.instanceId === body.data.instanceId,
    );
    if (!account) return c.json({ error: { code: 'NOT_CONNECTED', message: 'That WhatsApp is not connected' } }, 409);
    const existing = await ownerOf(active);
    if (existing) return linkOwnerWhatsApp(c, existing.id, account, body.data.code);
    const verified = await active.auth.api
      .verifyPhoneNumber({ body: { phoneNumber: `+${account.phone}`, code: body.data.code }, returnHeaders: true })
      .catch(() => null);
    const owner = await ownerOf(active);
    if (!verified || !owner || owner.phone !== account.phone) {
      return c.json({ error: { code: 'INVALID_CODE', message: 'That code is not right' } }, 400);
    }
    await active.eventBus?.publish(
      'access.owner_claimed',
      { userId: owner.id, instanceId: account.instanceId, via: 'whatsapp' },
      { instanceId: account.instanceId, channelType: 'whatsapp-baileys' },
    );
    log.info('Omni claimed', { instanceId: account.instanceId });
    return withCookies({ data: { claimed: true } }, verified.headers);
  });

  /**
   * An owner who claimed without WhatsApp links one: the code they got in that account's
   * self chat proves the number is theirs. Better Auth updates the number on a session, so
   * the owner gets one for this call only.
   */
  async function linkOwnerWhatsApp(
    c: Context<Env>,
    ownerId: string,
    account: { instanceId: string; phone: string },
    code: string,
  ) {
    const context = await active.auth.$context;
    const session = await context.internalAdapter.createSession(ownerId);
    if (!session) return c.json({ error: { code: 'UNAVAILABLE', message: 'Could not link WhatsApp now' } }, 503);
    try {
      const verified = await active.auth.api
        .verifyPhoneNumber({
          body: { phoneNumber: `+${account.phone}`, code, updatePhoneNumber: true },
          headers: new Headers({ authorization: `Bearer ${session.token}` }),
          returnHeaders: true,
        })
        .catch(() => null);
      const owner = await ownerOf(active);
      if (!verified || owner?.id !== ownerId || owner.phone !== account.phone) {
        return c.json({ error: { code: 'INVALID_CODE', message: 'That code is not right' } }, 400);
      }
    } finally {
      await context.internalAdapter.deleteSession(session.token).catch(() => undefined);
    }
    await active.eventBus?.publish(
      'access.owner_whatsapp_linked',
      { userId: ownerId, instanceId: account.instanceId },
      { instanceId: account.instanceId, channelType: 'whatsapp-baileys' },
    );
    log.info('Owner linked WhatsApp', { instanceId: account.instanceId });
    return c.json({ data: { claimed: true, linked: true } });
  }

  // ---- The owner signing in with a code in their own WhatsApp ----

  app.post('/send-code', loginRateLimitMiddleware, async (c) => {
    const account = await ownerAccount(active);
    if (!account)
      return c.json({ error: { code: 'NOT_CONNECTED', message: "The owner's WhatsApp is not connected" } }, 409);
    const wait = allowCodeSend(active, account.phone);
    if (wait > 0) return tooSoon(c, wait);
    await active.auth.api.sendPhoneNumberOTP({ body: { phoneNumber: `+${account.phone}` } });
    return c.json({ data: { sentTo: maskPhone(account.phone) } });
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
    const session = await active.auth.api.getSession({ headers: new Headers({ authorization }) }).catch(() => null);
    const owner = await ownerOf(active);
    // Only a session the device flow handed a device counts: never a browser's session.
    const clientId = session?.session.deviceClientId;
    if (!session || !clientId || !owner || session.user.id !== owner.id) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Unknown or used device token' } }, 401);
    }
    // A client whose declared scopes this Omni's ceiling leaves empty keeps its token.
    const keys = deviceKeysFor(clientId, active.config.deviceKeyScopes);
    if (keys.scopes.length === 0) return c.json(noDeviceScopes(clientId), 403);
    // The token is spent before the key exists: exactly one caller wins it, and a failure
    // after this point loses a key that was never handed out, rather than leaving the
    // token able to mint more.
    const { adapter } = await active.auth.$context;
    const spent = await adapter.consumeOne<{ id: string }>({
      model: 'session',
      where: [{ field: 'id', value: session.session.id }],
    });
    if (!spent) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Unknown or used device token' } }, 401);

    return c.json({ data: await mintDeviceKey(c, owner.id, clientId, body.data.deviceName, 'device-code', keys) });
  });

  // ---- A connect link's grant for its Omni key (the owner texted "connect") ----

  app.post('/connect', loginRateLimitMiddleware, async (c) => {
    const body = ConnectSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: { code: 'VALIDATION', message: 'Body must be { grant, clientId, deviceName }' } }, 400);
    const owner = await ownerOf(active);
    const keys = deviceKeysFor(body.data.clientId, active.config.deviceKeyScopes);
    if (keys.scopes.length === 0) return c.json(noDeviceScopes(body.data.clientId), 403);
    // Spent before the key exists, as with the device token: exactly one caller wins it.
    const granted = await consumeConnectGrant(active, body.data.grant);
    if (!granted || !owner || granted.userId !== owner.id) {
      return c.json(
        {
          error: {
            code: 'LINK_EXPIRED',
            message:
              'This connect link expired or was already used. Text connect to yourself on WhatsApp, or run omni connect on the server, for a new one.',
          },
        },
        410,
      );
    }
    const clientId = body.data.clientId as DeviceClientId;
    const minted = await mintDeviceKey(c, owner.id, clientId, body.data.deviceName, 'connect-link', keys);
    // Say so in the self chat, with where it came from, so a link that leaked does not pass unnoticed.
    const account = await ownerAccount(active);
    if (account) {
      await active.whatsapp
        .sendToSelf(
          account,
          `connect-done-${minted.keyId}`,
          deviceApprovedMessage(DEVICE_CLIENTS[clientId], { ip: requestClientIp(c) ?? null, at: Date.now() }),
        )
        .catch((error) => log.warn('Could not confirm the connection in the self chat', { error: String(error) }));
    }
    return c.json({ data: minted });
  });

  /**
   * A device key for the owner, as the device flow and connect links hand it out, and the
   * companion keys its client declares (login/config.ts DEVICE_CLIENT_KEYS), all minted here
   * so none outlives the one-time token or grant that paid for them.
   */
  async function mintDeviceKey(
    c: Context<Env>,
    ownerId: string,
    clientId: string,
    deviceName: string,
    via: 'device-code' | 'connect-link',
    keys: ReturnType<typeof deviceKeysFor>,
  ) {
    const keyExpiresAt = active.config.deviceKeyTtlDays
      ? new Date(Date.now() + active.config.deviceKeyTtlDays * 86_400_000)
      : undefined;
    const label = isDeviceClient(clientId) ? DEVICE_CLIENTS[clientId] : 'a device';
    const from = requestClientIp(c) ?? 'an unknown address';
    const created = await active.services.apiKeys.create({
      name: `device: ${deviceName}`,
      description: `Authorized by the owner for ${label}, from ${from}`,
      scopes: keys.scopes,
      ...(keyExpiresAt ? { expiresAt: keyExpiresAt } : {}),
      createdBy: `login:${ownerId}`,
    });
    const companions = [];
    for (const companion of keys.companions) {
      const extra = await active.services.apiKeys.create({
        name: `device: ${deviceName} (${companion.name})`,
        description: `The ${companion.name} key of device key ${created.key.id}, authorized by the owner for ${label}, from ${from}`,
        scopes: companion.scopes,
        ...(keyExpiresAt ? { expiresAt: keyExpiresAt } : {}),
        createdBy: `login:${ownerId}`,
      });
      companions.push({
        name: companion.name,
        apiKey: extra.plainTextKey,
        keyId: extra.key.id,
        scopes: extra.key.scopes,
      });
    }
    await active.eventBus?.publish('access.device_authorized', {
      userId: ownerId,
      clientId,
      deviceName,
      apiKeyId: created.key.id,
      ...(companions.length ? { companionKeyIds: companions.map((companion) => companion.keyId) } : {}),
      via,
    });
    return {
      apiKey: created.plainTextKey,
      keyId: created.key.id,
      scopes: created.key.scopes,
      keyExpiresAt: keyExpiresAt?.toISOString() ?? null,
      apiUrl: originOf(active, c),
      companions,
    };
  }

  return app;
}

/**
 * What a browser sees at this Omni's own address (and /api): what this is, and how to get in.
 * Anything else asking (a client, a script, curl) gets the same JSON 404 as before.
 */
export function landingRoutes(login: Login | null, notFound: (c: Context<Env>) => Response) {
  const app = new Hono<Env>();
  const landing = (c: Context<Env>) =>
    /\btext\/html\b/.test(c.req.header('accept') ?? '')
      ? c.html(landingPage({ publicUrl: login ? publicOrigin(login.config, c.req.raw) : null }))
      : notFound(c);
  app.get('/', landing);
  app.get('/api', landing);
  return app;
}
