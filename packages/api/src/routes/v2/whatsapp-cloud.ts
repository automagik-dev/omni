/**
 * WhatsApp Cloud (Meta) — channel-specific routes.
 *
 * Mounted at `/api/v2/instances/:id/whatsapp-cloud/...` (see v2/index.ts).
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
  MetaWhatsAppClient,
  exchangeCodeForToken,
  getWabaDetails,
  registerPhoneNumber as registerPhoneNumberOAuth,
  subscribeApp,
} from '@omni/channel-whatsapp-cloud';
import { createLogger } from '@omni/core';
import {
  EmbeddedSignupExchangeRequestSchema,
  WhatsAppCloudConnectRequestSchema,
  WhatsAppCloudRegisterRequestSchema,
} from '@omni/core/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireInstanceAccess } from '../../middleware/auth';
import type { AppVariables } from '../../types';

const log = createLogger('api:whatsapp-cloud');

export const whatsappCloudRoutes = new Hono<{ Variables: AppVariables }>();

const instanceAccess = requireInstanceAccess((c) => c.req.param('id') ?? '');

// All routes are :id-scoped — enforce instance access on every request.
whatsappCloudRoutes.use('/:id/whatsapp-cloud/*', instanceAccess);

/**
 * Read META_* env vars at request time so tests can mutate process.env.
 */
function readMetaAppEnv(): { appId: string | undefined; appSecret: string | undefined; apiVersion: string } {
  return {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    apiVersion: process.env.META_GRAPH_API_VERSION ?? 'v25.0',
  };
}

/**
 * Channel-guard: returns a 400 response if the instance is not whatsapp-cloud.
 */
function ensureWhatsAppCloud(instance: { channel: string }): { ok: true } | { ok: false; payload: { error: { code: string; message: string } } } {
  if (instance.channel !== 'whatsapp-cloud') {
    return {
      ok: false,
      payload: { error: { code: 'WRONG_CHANNEL', message: `Instance channel is "${instance.channel}", expected "whatsapp-cloud"` } },
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
// POST /:id/whatsapp-cloud/oauth/exchange
// ---------------------------------------------------------------------------

whatsappCloudRoutes.post(
  '/:id/whatsapp-cloud/oauth/exchange',
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

      // NOTE: returning the access token is gated to authenticated callers
      // with instance access. The client (UI) immediately POSTs to /connect
      // and never persists this elsewhere. Sentry scrubbing (Group 8) masks
      // `accessToken` in event payloads.
      return c.json({
        accessToken: token.accessToken,
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
// POST /:id/whatsapp-cloud/connect
// ---------------------------------------------------------------------------

whatsappCloudRoutes.post(
  '/:id/whatsapp-cloud/connect',
  zValidator('json', WhatsAppCloudConnectRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const services = c.get('services');
    const channelRegistry = c.get('channelRegistry');
    const { apiVersion } = readMetaAppEnv();

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppCloud(instance);
    if (!guard.ok) return c.json(guard.payload, 400);

    // Decide provenance: if appId was provided we assume manual paste; OAuth
    // flow doesn't populate appId per-instance (it comes from the env App).
    const connectionMethod = body.appId ? 'manual' : 'embedded_signup';

    // Persist Meta config on the instance row first.
    const updated = await services.instances.update(id, {
      metaAccessToken: body.accessToken,
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
          accessToken: body.accessToken,
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
    const plugin = channelRegistry?.get('whatsapp-cloud');
    if (!plugin) {
      return c.json({ error: { code: 'PLUGIN_NOT_FOUND', message: 'whatsapp-cloud plugin not registered' } }, 500);
    }

    try {
      await plugin.connect(id, {
        instanceId: id,
        credentials: {
          metaAccessToken: body.accessToken,
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
      log.error('plugin.connect failed for whatsapp-cloud', { instanceId: id, error: message });
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
// POST /:id/whatsapp-cloud/register
// ---------------------------------------------------------------------------

whatsappCloudRoutes.post(
  '/:id/whatsapp-cloud/register',
  zValidator('json', WhatsAppCloudRegisterRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const services = c.get('services');
    const { pin } = c.req.valid('json');

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppCloud(instance);
    if (!guard.ok) return c.json(guard.payload, 400);
    if (!instance.metaAccessToken || !instance.metaPhoneNumberId) {
      return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected to WhatsApp Cloud yet' } }, 409);
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
// POST /:id/whatsapp-cloud/subscribe-app
// ---------------------------------------------------------------------------

whatsappCloudRoutes.post('/:id/whatsapp-cloud/subscribe-app', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
  if (!guard.ok) return c.json(guard.payload, 400);
  if (!instance.metaAccessToken || !instance.metaWabaId) {
    return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected (missing WABA id)' } }, 409);
  }

  try {
    const result = await subscribeApp(instance.metaAccessToken, instance.metaWabaId, instance.metaApiVersion ?? 'v25.0');
    return c.json({ subscribed: result.success });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('subscribe app failed', { instanceId: id, error: message });
    return c.json({ error: { code: 'SUBSCRIBE_FAILED', message } }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-cloud/connection
// ---------------------------------------------------------------------------

whatsappCloudRoutes.get('/:id/whatsapp-cloud/connection', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
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
// DELETE /:id/whatsapp-cloud/connection
// ---------------------------------------------------------------------------

whatsappCloudRoutes.delete('/:id/whatsapp-cloud/connection', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const channelRegistry = c.get('channelRegistry');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
  if (!guard.ok) return c.json(guard.payload, 400);

  // Best-effort plugin disconnect.
  const plugin = channelRegistry?.get('whatsapp-cloud');
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
// GET /:id/whatsapp-cloud/quality
// ---------------------------------------------------------------------------

whatsappCloudRoutes.get('/:id/whatsapp-cloud/quality', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
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
// GET /:id/whatsapp-cloud/analytics
// ---------------------------------------------------------------------------

const analyticsQuerySchema = z.object({
  start: z.coerce.number().int().optional().describe('Unix timestamp (seconds) — start of range'),
  end: z.coerce.number().int().optional().describe('Unix timestamp (seconds) — end of range'),
  granularity: z.enum(['HALF_HOUR', 'DAY', 'MONTH']).default('DAY'),
});

whatsappCloudRoutes.get(
  '/:id/whatsapp-cloud/analytics',
  zValidator('query', analyticsQuerySchema),
  async (c) => {
    const id = c.req.param('id');
    const services = c.get('services');
    const { start, end, granularity } = c.req.valid('query');

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppCloud(instance);
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
            error: { code: 'ANALYTICS_FETCH_FAILED', message: `HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}` },
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
  },
);

// ---------------------------------------------------------------------------
// GET /:id/whatsapp-cloud/profile
// ---------------------------------------------------------------------------

whatsappCloudRoutes.get('/:id/whatsapp-cloud/profile', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
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
// PUT /:id/whatsapp-cloud/profile
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(512).optional(),
  email: z.string().email().max(128).optional(),
  vertical: z.string().optional(),
  websites: z.array(z.string().url()).max(2).optional(),
});

whatsappCloudRoutes.put(
  '/:id/whatsapp-cloud/profile',
  zValidator('json', updateProfileSchema),
  async (c) => {
    const id = c.req.param('id');
    const services = c.get('services');
    const body = c.req.valid('json');

    const instance = await services.instances.getById(id);
    const guard = ensureWhatsAppCloud(instance);
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
  },
);

// ---------------------------------------------------------------------------
// POST /:id/whatsapp-cloud/profile/photo
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

whatsappCloudRoutes.post('/:id/whatsapp-cloud/profile/photo', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const { appId: envAppId } = readMetaAppEnv();

  const instance = await services.instances.getById(id);
  const guard = ensureWhatsAppCloud(instance);
  if (!guard.ok) return c.json(guard.payload, 400);
  if (!instance.metaAccessToken || !instance.metaPhoneNumberId) {
    return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance is not connected' } }, 409);
  }

  let form: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    form = await c.req.parseBody();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid multipart body';
    return c.json({ error: { code: 'INVALID_MULTIPART', message } }, 400);
  }

  const file = form.file as unknown;
  if (!(file instanceof File) && !(file instanceof Blob)) {
    return c.json({ error: { code: 'NO_FILE', message: 'Multipart field "file" is required' } }, 400);
  }
  const blob = file as Blob;
  const fileName = (file as File).name ?? 'profile.jpg';
  const fileType = blob.type || 'image/jpeg';

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
    // Step 1: open an upload session.
    // Token goes in the Authorization header (NOT the URL query) so it stays
    // out of proxy access logs, request loggers, and Sentry breadcrumbs that
    // capture URLs but scrub bodies/headers.
    const sessionRes = await fetch(
      `https://graph.facebook.com/${apiVersion}/${appIdForUpload}/uploads?` +
        new URLSearchParams({
          file_length: String(bytes.byteLength),
          file_type: fileType,
          file_name: fileName,
        }).toString(),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${instance.metaAccessToken}` },
      },
    );
    if (!sessionRes.ok) {
      const text = await sessionRes.text();
      return c.json(
        { error: { code: 'UPLOAD_SESSION_FAILED', message: `HTTP ${sessionRes.status}${text ? `: ${text.slice(0, 160)}` : ''}` } },
        500,
      );
    }
    const sessionData = (await sessionRes.json()) as { id?: string };
    if (!sessionData.id) {
      return c.json({ error: { code: 'UPLOAD_SESSION_FAILED', message: 'Meta did not return an upload session id' } }, 500);
    }

    // Step 2: upload bytes — Authorization header is `OAuth <token>` per Meta docs.
    const uploadRes = await fetch(`https://graph.facebook.com/${apiVersion}/${sessionData.id}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${instance.metaAccessToken}`,
        file_offset: '0',
      },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return c.json(
        { error: { code: 'UPLOAD_FAILED', message: `HTTP ${uploadRes.status}${text ? `: ${text.slice(0, 160)}` : ''}` } },
        500,
      );
    }
    const uploadData = (await uploadRes.json()) as { h?: string };
    if (!uploadData.h) {
      return c.json({ error: { code: 'UPLOAD_FAILED', message: 'Meta did not return a media handle' } }, 500);
    }

    // Step 3: attach the handle to the business profile.
    const client = buildClientFromInstance(instance);
    if (!client) return c.json({ error: { code: 'NOT_CONNECTED', message: 'Instance has no Meta credentials' } }, 409);
    await client.updateBusinessProfile({ profile_picture_handle: uploadData.h });

    return c.json({ ok: true, handle: uploadData.h });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: { code: 'PROFILE_PHOTO_FAILED', message } }, 500);
  }
});
