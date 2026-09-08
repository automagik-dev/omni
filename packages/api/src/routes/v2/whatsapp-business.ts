/**
 * WhatsApp Cloud (Meta) — channel-specific routes.
 *
 * Mounted at `/api/v2/instances/:id/whatsapp-business/...` (see v2/index.ts).
 *
 * Surface (Group 5 of the wish — Embedded Signup + connection lifecycle):
 *   - POST   /oauth/exchange     — code → access_token + WABA discovery
 *   - POST   /connect            — persist Meta config + plugin.connect()
 *   - POST   /register           — POST /{phone_number_id}/register
 *   - POST   /subscribe-app      — POST /{waba_id}/subscribed_apps
 *   - GET    /connection         — read persisted Meta config (no access token)
 *   - DELETE /connection         — plugin.disconnect() + zero Meta columns
 *   - GET    /quality            — phone number info (quality_rating, etc.)
 *   - GET    /analytics          — WABA /conversation_analytics proxy
 *   - GET    /profile            — business profile read
 *   - PUT    /profile            — business profile write
 *   - POST   /profile/photo      — multipart upload (minimal — see TODO inline)
 *
 * Auth: all endpoints require `requireInstanceAccess(:id)` on top of the
 * global API key middleware. Scope strings from the wish ("instances:write",
 * "instances:read") are passed through the API key system, which is currently
 * advisory-only at the route layer (no `requireScope` middleware in the
 * codebase). Instance allowlists are still enforced.
 */

import { zValidator } from '@hono/zod-validator';
import {
  MetaApiError,
  MetaErrorCode,
  MetaWhatsAppClient,
  exchangeCodeForToken,
  getWabaDetails,
  registerPhoneNumber as registerPhoneNumberOAuth,
  subscribeApp,
  uploadHeaderMedia,
} from '@omni/channel-whatsapp-business';
import { createLogger } from '@omni/core';
import {
  EmbeddedSignupExchangeRequestSchema,
  WhatsAppBusinessConnectRequestSchema,
  WhatsAppBusinessRegisterRequestSchema,
} from '@omni/core/schemas';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import * as oauthTokenCache from '../../lib/oauth-token-cache';
import { resolveMetaApiVersion } from '../../lib/whatsapp-business-connection';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

const log = createLogger('api:whatsapp-business');

export const whatsappBusinessRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('id') ?? '');

// All routes are :id-scoped — enforce instance access on every request.
whatsappBusinessRoutes.use('/:id/whatsapp-business/*', instanceAccess);

/**
 * Read META_* env vars at request time so tests can mutate process.env.
 */
function readMetaAppEnv(): { appId: string | undefined; appSecret: string | undefined; apiVersion: string } {
  return {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    apiVersion: resolveMetaApiVersion(undefined) ?? 'v25.0',
  };
}

/**
 * Channel-guard: returns a 400 response if the instance is not whatsapp-business.
 * Also consumed by routes/v2/whatsapp-flows.ts.
 */
export function ensureWhatsAppBusiness(instance: { channel: string }):
  | { ok: true }
  | { ok: false; payload: { error: { code: string; message: string } } } {
  if (instance.channel !== 'whatsapp-business') {
    return {
      ok: false,
      payload: {
        error: {
          code: 'WRONG_CHANNEL',
          message: `Instance channel is "${instance.channel}", expected "whatsapp-business"`,
        },
      },
    };
  }
  return { ok: true };
}

/**
 * Build a client scoped to the instance's persisted Meta config. Returns null
 * if the instance isn't connected yet (caller should 409).
 */
function buildClientFromInstance(instance: {
  metaAccessToken: string | null;
  metaPhoneNumberId: string | null;
  metaWabaId: string | null;
  metaApiVersion: string | null;
}): MetaWhatsAppClient | null {
  if (!instance.metaAccessToken || !instance.metaPhoneNumberId) return null;
  return new MetaWhatsAppClient(
    {
      phoneNumberId: instance.metaPhoneNumberId,
      accessToken: instance.metaAccessToken,
      apiVersion: instance.metaApiVersion ?? 'v25.0',
    },
    instance.metaWabaId ?? undefined,
  );
}

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-business/oauth/exchange
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.post(
  '/:id/whatsapp-business/oauth/exchange',
  zValidator('json', EmbeddedSignupExchangeRequestSchema),
  async (c) => {
    const { code } = c.req.valid('json');
    const { appId, appSecret, apiVersion } = readMetaAppEnv();

    if (!appId || !appSecret) {
      return c.json(
        {
          error: {
            code: 'META_APP_NOT_CONFIGURED',
            message: 'META_APP_ID and META_APP_SECRET env vars must be set to use the Embedded Signup flow',
          },
        },
        500,
      );
    }

    try {
      const token = await exchangeCodeForToken(code, appId, appSecret, undefined, apiVersion);
      const details = await getWabaDetails(token.accessToken, apiVersion);

      // Stash the token server-side under an opaque single-use handle.
      // The browser never sees the raw token — it passes the handle to
      // /connect and the route resolves it internally. Closes the XSS /
      // network-log exposure window flagged by code-review.
      const exchangeHandle = oauthTokenCache.put(token.accessToken);

      return c.json({
        exchangeHandle,
        wabaIds: details.wabaIds,
        phoneNumbers: details.phoneNumbers,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('OAuth exchange failed', { error: message });
      return c.json({ error: { code: 'OAUTH_EXCHANGE_FAILED', message } }, 400);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-business/connect
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.post(
  '/:id/whatsapp-business/connect',
  zValidator('json', WhatsAppBusinessConnectRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');
    const { apiVersion } = readMetaAppEnv();

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppBusiness(instance);
    if (!guard.ok) return c.json(guard.payload, 400);

    // Resolve the access token: either consume the single-use handle from
    // the Embedded Signup exchange, or accept a raw token from the manual
    // paste flow. The Zod refinement guarantees exactly one is present.
    let accessToken: string;
    let connectionMethod: 'manual' | 'embedded_signup';
    if (body.exchangeHandle) {
      const resolved = oauthTokenCache.take(body.exchangeHandle);
      if (!resolved) {
        return c.json(
          {
            error: {
              code: 'EXCHANGE_HANDLE_INVALID',
              message: 'Exchange handle unknown or expired. Restart the Embedded Signup flow.',
            },
          },
          400,
        );
      }
      accessToken = resolved;
      connectionMethod = 'embedded_signup';
    } else if (body.accessToken) {
      accessToken = body.accessToken;
      connectionMethod = 'manual';
    } else {
      // Defensive — the schema refine should make this unreachable.
      return c.json({ error: { code: 'INVALID_REQUEST', message: 'accessToken or exchangeHandle is required' } }, 400);
    }

    // Persist Meta config on the instance row first.
    const updated = await services.instances.update(id, {
      metaAccessToken: accessToken,
      metaPhoneNumberId: body.phoneNumberId,
      metaWabaId: body.wabaId,
      metaAppId: body.appId ?? undefined,
      metaBusinessId: body.businessId ?? undefined,
      metaApiVersion: apiVersion,
      metaConnectionMethod: connectionMethod,
      metaConnectedAt: new Date(),
      isActive: true,
    });

    // Resolve display_phone_number + quality_rating by hitting GET /{phone_number_id}
    // before booting the plugin. Best-effort: failures don't block connect.
    let displayPhoneNumber: string | undefined;
    let qualityRating: string | undefined;
    try {
      const probe = new MetaWhatsAppClient(
        {
          phoneNumberId: body.phoneNumberId,
          accessToken,
          apiVersion,
        },
        body.wabaId,
      );
      const info = (await probe.getPhoneNumberInfo()) as {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      };
      displayPhoneNumber = info.display_phone_number;
      qualityRating = info.quality_rating;

      if (displayPhoneNumber) {
        await services.instances.update(id, { metaDisplayPhoneNumber: displayPhoneNumber });
      }
    } catch (err) {
      log.warn('Failed to fetch phone_number info during connect — continuing', {
        instanceId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Boot the plugin runtime — passes credentials via InstanceConfig.
    const plugin = channelRegistry?.get('whatsapp-business');
    if (!plugin) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'whatsapp-business plugin not registered' } }, 500);
    }

    try {
      await plugin.connect(id, {
        instanceId: id,
        credentials: {
          metaAccessToken: accessToken,
          metaPhoneNumberId: body.phoneNumberId,
          metaWabaId: body.wabaId,
          metaAppId: body.appId,
          metaBusinessId: body.businessId,
          metaApiVersion: apiVersion,
          metaConnectionMethod: connectionMethod,
          metaDisplayPhoneNumber: displayPhoneNumber,
        },
        options: {},
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('plugin.connect failed for whatsapp-business', { instanceId: id, error: message });
      return c.json({ error: { code: 'CONNECT_FAILED', message } }, 500);
    }

    return c.json({
      data: {
        instanceId: updated.id,
        status: 'connected',
        displayPhoneNumber: displayPhoneNumber ?? null,
        qualityRating: qualityRating ?? null,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-business/register
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.post(
  '/:id/whatsapp-business/register',
  zValidator('json', WhatsAppBusinessRegisterRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const services = c.get('services');
    const { pin } = c.req.valid('json');

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppBusiness(instance);
    if (!guard.ok) return c.json(guard.payload, 400);
    if (!instance.metaAccessToken || !instance.metaPhoneNumberId) {
      return c.json(
        { error: { code: 'NOT_CONNECTED', message: 'Instance is not connected to WhatsApp Cloud yet' } },
        409,
      );
    }

    try {
      await registerPhoneNumberOAuth(
        instance.metaAccessToken,
        instance.metaPhoneNumberId,
        pin,
        instance.metaApiVersion ?? 'v25.0',
      );
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('register phone number failed', { instanceId: id, error: message });
      return c.json({ error: { code: 'REGISTER_FAILED', message } }, 500);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-business/subscribe-app
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.post('/:id/whatsapp-business/subscribe-app', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);
  if (!instance.metaAccessToken || !instance.metaWabaId) {
    return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected (missing WABA id)' } }, 409);
  }

  try {
    const result = await subscribeApp(
      instance.metaAccessToken,
      instance.metaWabaId,
      instance.metaApiVersion ?? 'v25.0',
    );
    return c.json({ subscribed: result.success });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('subscribe app failed', { instanceId: id, error: message });
    return c.json({ error: { code: 'SUBSCRIBE_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-business/connection
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.get('/:id/whatsapp-business/connection', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  // Deliberately omit `metaAccessToken` from the response.
  return c.json({
    data: {
      phoneNumberId: instance.metaPhoneNumberId,
      wabaId: instance.metaWabaId,
      appId: instance.metaAppId,
      businessId: instance.metaBusinessId,
      apiVersion: instance.metaApiVersion,
      displayPhoneNumber: instance.metaDisplayPhoneNumber,
      connectionMethod: instance.metaConnectionMethod,
      connectedAt: instance.metaConnectedAt,
      connected: Boolean(instance.metaAccessToken && instance.metaPhoneNumberId),
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /:id/whatsapp-business/connection
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.delete('/:id/whatsapp-business/connection', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  // Best-effort plugin disconnect.
  const plugin = channelRegistry?.get('whatsapp-business');
  if (plugin) {
    try {
      await plugin.disconnect(id);
    } catch (err) {
      log.warn('plugin.disconnect failed during connection delete', {
        instanceId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Zero the Meta columns so the instance can be reconnected later.
  // metaApiVersion is NOT NULL with a default — reset to 'v25.0' rather than null.
  await services.instances.update(id, {
    metaAccessToken: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    metaAppId: null,
    metaBusinessId: null,
    metaApiVersion: 'v25.0',
    metaConnectionMethod: null,
    metaDisplayPhoneNumber: null,
    metaConnectedAt: null,
    isActive: false,
  });

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-business/quality
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.get('/:id/whatsapp-business/quality', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  const client = buildClientFromInstance(instance);
  if (!client) return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance has no Meta credentials' } }, 409);

  try {
    const info = await client.getPhoneNumberInfo();
    return c.json({ data: info });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'QUALITY_FETCH_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-business/analytics
// ---------------------------------------------------------------------------

const analyticsQuerySchema = z.object({
  start: z.coerce.number().int().optional().describe('Unix timestamp (seconds) — start of range'),
  end: z.coerce.number().int().optional().describe('Unix timestamp (seconds) — end of range'),
  granularity: z.enum(['HALF_HOUR', 'DAY', 'MONTH']).default('DAY'),
});

whatsappBusinessRoutes.get('/:id/whatsapp-business/analytics', zValidator('query', analyticsQuerySchema), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const { start, end, granularity } = c.req.valid('query');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);
  if (!instance.metaAccessToken || !instance.metaWabaId) {
    return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected' } }, 409);
  }

  const apiVersion = instance.metaApiVersion ?? 'v25.0';
  const now = Math.floor(Date.now() / 1000);
  const rangeStart = start ?? now - 30 * 24 * 60 * 60;
  const rangeEnd = end ?? now;

  // WABA conversation_analytics is a GET-with-query endpoint exposed on
  // /{waba_id} with `fields=conversation_analytics.start(X).end(Y).granularity(Z)`.
  const fields = `conversation_analytics.start(${rangeStart}).end(${rangeEnd}).granularity(${granularity})`;
  const url = `https://graph.facebook.com/${apiVersion}/${instance.metaWabaId}?fields=${encodeURIComponent(fields)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${instance.metaAccessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return c.json(
        {
          error: {
            code: 'ANALYTICS_FETCH_FAILED',
            message: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`,
          },
        },
        500,
      );
    }
    const data = (await res.json()) as Record<string, unknown>;
    return c.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'ANALYTICS_FETCH_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-business/profile
// ---------------------------------------------------------------------------

whatsappBusinessRoutes.get('/:id/whatsapp-business/profile', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  const client = buildClientFromInstance(instance);
  if (!client) return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance has no Meta credentials' } }, 409);

  try {
    const profile = await client.getBusinessProfile();
    return c.json({ data: profile });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'PROFILE_FETCH_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /:id/whatsapp-business/profile
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.string().email().max(128).optional(),
  vertical: z.string().optional(),
  websites: z.array(z.string().url()).max(2).optional(),
});

whatsappBusinessRoutes.put('/:id/whatsapp-business/profile', zValidator('json', updateProfileSchema), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const body = c.req.valid('json');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  const client = buildClientFromInstance(instance);
  if (!client) return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance has no Meta credentials' } }, 409);

  try {
    const updated = await client.updateBusinessProfile(body);
    return c.json({ data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'PROFILE_UPDATE_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-business/profile/photo
//
// Minimal photo upload — accepts a multipart `file` field and forwards it to
// Meta as a `/{phone_number_id}/whatsapp_business_profile` update.
//
// TODO(group-7): the full Meta photo upload flow is two-step:
//   1. POST /{app_id}/uploads  → returns an upload session id
//   2. POST /{upload_session_id} with binary body + Authorization: OAuth <token>
//      → returns a media handle `h:...`
//   3. POST /{phone_number_id}/whatsapp_business_profile with
//      { profile_picture_handle: 'h:...' }
//
// This endpoint accepts the upload and either forwards it (when `META_APP_ID`
// is configured) or returns a 501 with a clear message so the UI knows to
// fall back. Wiring step (2) requires the Meta App ID for the resumable
// upload session URL.
// ---------------------------------------------------------------------------

/**
 * Parse the multipart body of a profile-photo upload and validate the `file`
 * field. Returns a 400-shaped payload on parse/validation failure (caller
 * responds with status 400), mirroring the `ensureWhatsAppBusiness` guard shape.
 */
async function readProfilePhotoUpload(
  c: Context<{ Variables: AppVariables }>,
): Promise<
  | { ok: true; blob: Blob; fileName: string; fileType: string }
  | { ok: false; payload: { error: { code: string; message: string } } }
> {
  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid multipart body';
    return { ok: false, payload: { error: { code: 'INVALID_MULTIPART', message } } };
  }

  const file = form.file as unknown;
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return { ok: false, payload: { error: { code: 'NO_FILE', message: 'Multipart field "file" is required' } } };
  }
  const blob = file as Blob;
  return {
    ok: true,
    blob,
    fileName: (file as File).name ?? 'profile.jpg',
    fileType: blob.type || 'image/jpeg',
  };
}

whatsappBusinessRoutes.post('/:id/whatsapp-business/profile/photo', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const { appId: envAppId } = readMetaAppEnv();

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppBusiness(instance);
  if (!guard.ok) return c.json(guard.payload, 400);
  if (!instance.metaAccessToken || !instance.metaPhoneNumberId) {
    return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected' } }, 409);
  }

  const upload = await readProfilePhotoUpload(c);
  if (!upload.ok) return c.json(upload.payload, 400);
  const { blob, fileName, fileType } = upload;

  const appIdForUpload = instance.metaAppId ?? envAppId;
  if (!appIdForUpload) {
    // TODO(group-7): without an app id we cannot create a resumable upload
    // session. Skipping the upload until the env is configured.
    return c.json(
      {
        error: {
          code: 'PROFILE_PHOTO_NOT_IMPLEMENTED',
          message:
            'Profile photo upload requires META_APP_ID (env) or instance.metaAppId. Full flow lands in a follow-up wish.',
        },
      },
      501,
    );
  }

  const apiVersion = instance.metaApiVersion ?? 'v25.0';
  const bytes = await blob.arrayBuffer();

  try {
    // Resumable upload (create session → upload bytes → handle).
    // Reuses the same flow as `uploadHeaderMedia` in @omni/channel-whatsapp-business
    // — token in Authorization header, no query string, MetaApiError throws.
    const { handle } = await uploadHeaderMedia(
      appIdForUpload,
      instance.metaAccessToken,
      { bytes, mimeType: fileType, filename: fileName },
      apiVersion,
    );

    // Step 3: attach the handle to the business profile.
    const client = buildClientFromInstance(instance);
    if (!client) return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance has no Meta credentials' } }, 409);
    await client.updateBusinessProfile({ profile_picture_handle: handle });

    return c.json({ ok: true, handle });
  } catch (err) {
    // MetaApiError carries a normalized code already; surface it directly.
    if (err instanceof MetaApiError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        // 400-ish if Meta rejected the file; 500 for transport/auth issues.
        err.code === MetaErrorCode.INVALID_REQUEST ? 400 : 500,
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'PROFILE_PHOTO_FAILED', message } }, 500);
  }
});
