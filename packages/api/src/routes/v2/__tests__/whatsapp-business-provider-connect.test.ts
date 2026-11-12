/**
 * POST /:id/whatsapp-business/connect with a Meta-compatible provider (#1661).
 *
 * The route stores the provider settings on the instance, probes the number
 * through the provider with the provider's auth header, and hands the
 * settings to the plugin. A re-connect that omits them keeps the stored
 * values; `null` clears them. Meta-direct connects are unchanged. Routes
 * that only exist on Meta's own Graph API refuse a provider instance before
 * any network call. No live calls: `fetch` is stubbed.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { templatesRoutes } from '../templates';
import { whatsappBusinessRoutes } from '../whatsapp-business';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_BASE = 'https://api.kapso.example/meta/whatsapp/v24.0';
const META_DETAILS = {
  accessToken: 'fixture-provider-key',
  phoneNumberId: '106540352242922',
  wabaId: '102290129340398',
};
const KAPSO = {
  apiBaseUrl: PROVIDER_BASE,
  authMode: 'x-api-key',
  webhookSecret: 'fixture-webhook-secret',
  signatureMode: 'x-webhook-signature',
} as const;
const KAPSO_COLUMNS = {
  metaApiBaseUrl: KAPSO.apiBaseUrl,
  metaAuthMode: KAPSO.authMode,
  metaWebhookSecret: KAPSO.webhookSecret,
  metaSignatureMode: KAPSO.signatureMode,
};
const META_DIRECT_COLUMNS = {
  metaApiBaseUrl: null,
  metaAuthMode: null,
  metaWebhookSecret: null,
  metaSignatureMode: null,
};

interface Mounted {
  app: Hono<{ Variables: AppVariables }>;
  updates: Record<string, unknown>[];
  connectCredentials: () => Record<string, unknown> | undefined;
}

function mount(stored: Record<string, unknown> = {}): Mounted {
  const app = new Hono<{ Variables: AppVariables }>();
  const updates: Record<string, unknown>[] = [];
  let credentials: Record<string, unknown> | undefined;
  const instance = {
    id: INSTANCE_ID,
    name: 'wab-provider',
    channel: 'whatsapp-business',
    metaAccessToken: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    metaApiVersion: null,
    ...stored,
  };

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async () => instance),
        update: mock(async (_id: string, data: Record<string, unknown>) => {
          updates.push(data);
          return { ...instance, ...data };
        }),
      },
    } as never);
    c.set('channelRegistry', {
      get: () => ({
        id: 'whatsapp-business',
        connect: mock(async (_id: string, config: { credentials?: Record<string, unknown> }) => {
          credentials = config.credentials;
        }),
      }),
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/', whatsappBusinessRoutes);
  return { app, updates, connectCredentials: () => credentials };
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    (async () =>
      new Response(JSON.stringify({ display_phone_number: '+1 555-0100', quality_rating: 'GREEN' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch,
  );
});

afterEach(() => fetchSpy.mockRestore());

/** URL and headers of every outbound request the route made. */
/**
 * URL and headers of every outbound request this instance's route made. Matched by the
 * instance's ids or key, not by position: in a full-suite run a stray fetch from an
 * earlier file can land in the spy first.
 */
function outbound(): { url: string; headers: Record<string, string> }[] {
  return fetchSpy.mock.calls
    .map((call: unknown[]) => ({
      url: String(call[0]),
      headers: Object.fromEntries(new Headers((call[1] as RequestInit | undefined)?.headers).entries()),
    }))
    .filter(
      (request: { url: string; headers: Record<string, string> }) =>
        request.url.includes(META_DETAILS.phoneNumberId) ||
        request.url.includes(META_DETAILS.wabaId) ||
        request.headers['x-api-key'] === META_DETAILS.accessToken ||
        request.headers.authorization?.includes(META_DETAILS.accessToken),
    );
}

describe('POST /:id/whatsapp-business/connect through a provider', () => {
  test('persists the provider settings, probes the provider with X-API-Key and hands them to the plugin', async () => {
    const { app, updates, connectCredentials } = mount();

    const res = await app.request(`/${INSTANCE_ID}/whatsapp-business/connect`, post({ ...META_DETAILS, ...KAPSO }));

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject(KAPSO_COLUMNS);
    const [probe] = outbound();
    expect(probe?.url.startsWith(`${PROVIDER_BASE}/${META_DETAILS.phoneNumberId}`)).toBe(true);
    expect(probe?.headers['x-api-key']).toBe(META_DETAILS.accessToken);
    expect(probe?.headers.authorization).toBeUndefined();
    expect(outbound().some((request) => request.url.includes('graph.facebook.com'))).toBe(false);
    expect(connectCredentials()).toMatchObject(KAPSO_COLUMNS);
  });

  test('a re-connect that omits the provider fields keeps the stored provider', async () => {
    const { app, updates, connectCredentials } = mount(KAPSO_COLUMNS);

    const res = await app.request(`/${INSTANCE_ID}/whatsapp-business/connect`, post(META_DETAILS));

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject(KAPSO_COLUMNS);
    expect(outbound()[0]?.url.startsWith(PROVIDER_BASE)).toBe(true);
    expect(connectCredentials()).toMatchObject(KAPSO_COLUMNS);
  });

  test('null clears the stored provider and moves the instance back to Meta direct', async () => {
    const { app, updates } = mount(KAPSO_COLUMNS);

    const res = await app.request(
      `/${INSTANCE_ID}/whatsapp-business/connect`,
      post({
        ...META_DETAILS,
        apiBaseUrl: null,
        authMode: 'bearer',
        webhookSecret: null,
        signatureMode: 'x-hub-signature-256',
      }),
    );

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      ...META_DIRECT_COLUMNS,
      metaAuthMode: 'bearer',
      metaSignatureMode: 'x-hub-signature-256',
    });
    const [probe] = outbound();
    expect(probe?.url.startsWith('https://graph.facebook.com/')).toBe(true);
    expect(probe?.headers.authorization).toBe(`Bearer ${META_DETAILS.accessToken}`);
  });

  test('all four provider fields null return a stored provider instance to Meta direct', async () => {
    const { app, updates, connectCredentials } = mount(KAPSO_COLUMNS);

    const res = await app.request(
      `/${INSTANCE_ID}/whatsapp-business/connect`,
      post({ ...META_DETAILS, apiBaseUrl: null, authMode: null, webhookSecret: null, signatureMode: null }),
    );

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject(META_DIRECT_COLUMNS);
    expect(connectCredentials()).toMatchObject(META_DIRECT_COLUMNS);
    const [probe] = outbound();
    expect(probe?.url.startsWith('https://graph.facebook.com/')).toBe(true);
    expect(probe?.headers.authorization).toBe(`Bearer ${META_DETAILS.accessToken}`);
  });

  test('a provider key with a Meta Graph base URL is refused before anything is stored or sent', async () => {
    // The trailing-dot FQDN is the same host and must not slip past the guard.
    for (const apiBaseUrl of ['https://graph.facebook.com/v24.0', 'https://graph.facebook.com./v24.0']) {
      const { app, updates } = mount();

      const res = await app.request(
        `/${INSTANCE_ID}/whatsapp-business/connect`,
        post({ ...META_DETAILS, apiBaseUrl, authMode: 'x-api-key' }),
      );

      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_PROVIDER_SETTINGS');
      expect(updates).toEqual([]);
    }
    expect(outbound()).toEqual([]);
  });

  test('a provider key without a provider base URL is refused before anything is stored', async () => {
    const { app, updates } = mount();

    const res = await app.request(
      `/${INSTANCE_ID}/whatsapp-business/connect`,
      post({ ...META_DETAILS, authMode: 'x-api-key' }),
    );

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_PROVIDER_SETTINGS');
    expect(updates).toEqual([]);
    expect(outbound()).toEqual([]);
  });

  test('a provider signature without a webhook secret is refused', async () => {
    const { app, updates } = mount();

    const res = await app.request(
      `/${INSTANCE_ID}/whatsapp-business/connect`,
      post({ ...META_DETAILS, apiBaseUrl: PROVIDER_BASE, signatureMode: 'x-webhook-signature' }),
    );

    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });

  test('an http provider base URL fails validation', async () => {
    const { app, updates } = mount();

    const res = await app.request(
      `/${INSTANCE_ID}/whatsapp-business/connect`,
      post({ ...META_DETAILS, apiBaseUrl: 'http://api.kapso.example/meta/whatsapp/v24.0' }),
    );

    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });

  test('Meta direct is unchanged: Graph API with Bearer, provider columns null', async () => {
    const { app, updates, connectCredentials } = mount();

    const res = await app.request(`/${INSTANCE_ID}/whatsapp-business/connect`, post(META_DETAILS));

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject(META_DIRECT_COLUMNS);
    const [probe] = outbound();
    expect(probe?.url.startsWith('https://graph.facebook.com/')).toBe(true);
    expect(probe?.headers.authorization).toBe(`Bearer ${META_DETAILS.accessToken}`);
    expect(probe?.headers['x-api-key']).toBeUndefined();
    expect(connectCredentials()).toMatchObject(META_DIRECT_COLUMNS);
  });
});

describe('a provider instance on routes that only Meta serves', () => {
  const connected = {
    metaAccessToken: 'fixture-provider-key',
    metaPhoneNumberId: META_DETAILS.phoneNumberId,
    metaWabaId: META_DETAILS.wabaId,
    ...KAPSO_COLUMNS,
  };

  test('register and subscribe-app refuse without calling Meta', async () => {
    const { app } = mount(connected);

    const register = await app.request(`/${INSTANCE_ID}/whatsapp-business/register`, post({ pin: '123456' }));
    const subscribe = await app.request(`/${INSTANCE_ID}/whatsapp-business/subscribe-app`, post({}));

    expect([register.status, subscribe.status]).toEqual([400, 400]);
    expect(((await register.json()) as { error: { code: string } }).error.code).toBe('NOT_SUPPORTED_VIA_PROVIDER');
    expect(outbound()).toEqual([]);
  });

  test('GET connection reports the provider and never the webhook secret', async () => {
    const { app } = mount(connected);

    const res = await app.request(`/${INSTANCE_ID}/whatsapp-business/connection`);
    const text = await res.text();

    expect(JSON.parse(text).data).toMatchObject({
      apiBaseUrl: PROVIDER_BASE,
      authMode: 'x-api-key',
      signatureMode: 'x-webhook-signature',
      hasWebhookSecret: true,
    });
    expect(text).not.toContain(KAPSO.webhookSecret);
  });
});

describe('template header media upload', () => {
  test('a provider instance is refused before the Resumable Upload API is called', async () => {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', async (c, next) => {
      c.set('services', {
        instances: {
          getById: mock(async () => ({
            id: INSTANCE_ID,
            channel: 'whatsapp-business',
            metaAccessToken: 'fixture-provider-key',
            metaPhoneNumberId: META_DETAILS.phoneNumberId,
            metaWabaId: META_DETAILS.wabaId,
            metaAppId: '1234567890',
            ...KAPSO_COLUMNS,
          })),
        },
      } as never);
      c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
      await next();
    });
    app.route('/', templatesRoutes);
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'header.png', { type: 'image/png' }));

    const res = await app.request(`/instances/${INSTANCE_ID}/whatsapp-templates/upload-header-media`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_SUPPORTED_VIA_PROVIDER');
    expect(outbound()).toEqual([]);
  });
});
