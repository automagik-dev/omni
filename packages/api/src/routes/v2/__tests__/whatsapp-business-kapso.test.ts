/**
 * Connecting a WhatsApp Business number through Kapso by clicks (#1676).
 *
 * The Kapso key routes, the setup link, the numbers and the per-instance connect, against a
 * stubbed `fetch` that throws on any request it was not told about: no test reaches Kapso or
 * Meta. Kapso, Omni's public origin and multitenancy are read from env too, so each test clears
 * KAPSO_API_KEY, KAPSO_API_BASE_URL, OMNI_PUBLIC_URL and OMNI_MULTITENANCY_ENABLED first.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Database } from '@omni/db';
import { settingChangeHistory } from '@omni/db';
import { Param, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { KAPSO_SETTINGS } from '../../../constants/kapso';
import { SettingsService } from '../../../services/settings';
import { isSealedCredentialField } from '../../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../../tenancy/tenant-scope';
import { buildWorkerTenantContext } from '../../../tenancy/worker-tenant-context';
import type { AppVariables } from '../../../types';
import { settingsRoutes } from '../settings';
import { whatsappBusinessRoutes } from '../whatsapp-business';
import { whatsappBusinessKapsoRoutes } from '../whatsapp-business-kapso';

const KEY = 'fixture-kapso-project-key';
const KAPSO = 'https://kapso.test';
const PUBLIC = 'https://omni.example.com';
const WEBHOOK_URL = `${PUBLIC}/api/v2/channels/whatsapp-business/webhook`;
const INSTANCE_ID = '55555555-5555-4555-8555-555555555555';
const NUMBER = { phone_number_id: '106540352242922', business_account_id: '102290129340398' };
const NUMBERS_URL = `${KAPSO}/platform/v1/whatsapp/phone_numbers?per_page=100`;
const HOOKS_URL = `${KAPSO}/platform/v1/whatsapp/phone_numbers/${NUMBER.phone_number_id}/webhooks`;
const ENV = ['KAPSO_API_KEY', 'KAPSO_API_BASE_URL', 'OMNI_PUBLIC_URL', 'OMNI_MULTITENANCY_ENABLED'] as const;

type Responder = [number, unknown] | ((body: unknown) => [number, unknown]);
interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

let fetchSpy: ReturnType<typeof spyOn>;
let table: Record<string, Responder> = {};
const savedEnv = new Map<string, string | undefined>();

/** Requests to Kapso (or its Meta proxy) this test made; stray calls from other files are ignored. */
function sentToKapso(): Sent[] {
  return fetchSpy.mock.calls
    .map((call: unknown[]) => {
      const init = (call[1] ?? {}) as RequestInit;
      return {
        method: init.method ?? 'GET',
        url: String(call[0]),
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
    })
    .filter((sent: Sent) => sent.url.startsWith(KAPSO));
}

beforeEach(() => {
  for (const name of ENV) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  table = {};
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url}`;
    const found = table[key] ?? Object.entries(table).find(([prefix]) => key.startsWith(prefix))?.[1];
    if (!found) throw new Error(`unmocked ${key}`);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const [status, json] = typeof found === 'function' ? found(body) : found;
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  setTenantSecretMasterKey(null);
});

/** In-memory settings with the service's precedence: stored value, then env, then default. */
function memorySettings(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const read = async (key: string, env?: string, fallback?: string) =>
    values.get(key) || (env ? process.env[env] : undefined) || fallback;
  return {
    values,
    getSecret: (key: string, env?: string) => read(key, env),
    getString: read,
    setValue: mock(async (key: string, value: unknown) => {
      values.set(key, String(value));
      return { key, value: String(value) };
    }),
  };
}

interface Mounted {
  app: Hono<{ Variables: AppVariables }>;
  updates: Record<string, unknown>[];
  credentials: () => Record<string, unknown> | undefined;
}

function mount(settings: unknown, channel = 'whatsapp-business'): Mounted {
  const app = new Hono<{ Variables: AppVariables }>();
  const updates: Record<string, unknown>[] = [];
  let credentials: Record<string, unknown> | undefined;
  const instance = { id: INSTANCE_ID, name: 'Kapso', channel, metaAccessToken: null, metaPhoneNumberId: null };
  app.use('*', async (c, next) => {
    c.set('services', {
      settings,
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
  app.route('/channels/whatsapp-business/kapso', whatsappBusinessKapsoRoutes);
  app.route('/settings', settingsRoutes);
  app.route('/', whatsappBusinessRoutes);
  return { app, updates, credentials: () => credentials };
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const configured = () => memorySettings({ [KAPSO_SETTINGS.apiKey.key]: KEY, [KAPSO_SETTINGS.apiBaseUrl.key]: KAPSO });

describe('PUT /channels/whatsapp-business/kapso/key', () => {
  test('checks the key with Kapso, then saves it sealed; GET /settings masks it', async () => {
    setTenantSecretMasterKey(Buffer.alloc(32, 9));
    const { db, rows } = makeSettingsDb();
    const service = new SettingsService(db);
    await service.seedDefaults();
    await service.setValue(KAPSO_SETTINGS.apiBaseUrl.key, KAPSO);
    table[`GET ${NUMBERS_URL}`] = [200, { data: [] }];
    const { app } = mount(service);
    const tenant = '11111111-1111-4111-8111-11111111111a';
    const inTenant = <T>(run: () => Promise<T>) => runInTenantScope(db, buildWorkerTenantContext(tenant), run);

    const res = await inTenant(async () =>
      app.request('/channels/whatsapp-business/kapso/key', json('PUT', { apiKey: KEY })),
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ data: { saved: true } });
    expect(body).not.toContain(KEY);
    expect(sentToKapso()[0]?.headers['x-api-key']).toBe(KEY);
    const row = rows.find((r) => r.key === KAPSO_SETTINGS.apiKey.key);
    expect(isSealedCredentialField(row?.value)).toBe(true);
    expect(String(row?.value)).not.toContain(KEY);
    expect(await inTenant(() => service.getSecret(KAPSO_SETTINGS.apiKey.key))).toBe(KEY);

    const listed = await inTenant(async () => app.request('/settings'));
    const items = ((await listed.json()) as { items: Array<{ key: string; value: unknown }> }).items;
    expect(items.find((item) => item.key === KAPSO_SETTINGS.apiKey.key)?.value).toBe('********');
    expect(items.find((item) => item.key === KAPSO_SETTINGS.customerId.key)?.value).toBeNull();
  });

  test('a key Kapso refuses is not saved and the reply says so plainly', async () => {
    const settings = memorySettings({ [KAPSO_SETTINGS.apiBaseUrl.key]: KAPSO });
    table[`GET ${NUMBERS_URL}`] = [401, { error: 'Invalid API key' }];

    const res = await mount(settings).app.request(
      '/channels/whatsapp-business/kapso/key',
      json('PUT', { apiKey: KEY }),
    );

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(JSON.parse(body).error).toEqual({
      code: 'KAPSO_KEY_REFUSED',
      message: 'Kapso refused to list its numbers: Invalid API key. Check the Kapso project API key.',
    });
    expect(body).not.toContain(KEY);
    expect(settings.setValue).not.toHaveBeenCalled();
  });
});

describe('POST /channels/whatsapp-business/kapso/setup-link', () => {
  test('creates and remembers a Kapso customer, then asks for a coexistence link', async () => {
    const settings = configured();
    table[`POST ${KAPSO}/platform/v1/customers`] = [201, { data: { id: 'cus-1' } }];
    table[`POST ${KAPSO}/platform/v1/customers/cus-1/setup_links`] = [
      201,
      { data: { url: 'https://app.kapso.ai/whatsapp/setup/abc', expires_at: '2026-12-12T00:00:00Z' } },
    ];

    const res = await mount(settings).app.request('/channels/whatsapp-business/kapso/setup-link', json('POST'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { url: 'https://app.kapso.ai/whatsapp/setup/abc', expiresAt: '2026-12-12T00:00:00Z' },
    });
    expect(settings.values.get(KAPSO_SETTINGS.customerId.key)).toBe('cus-1');
    const [customer, link] = sentToKapso();
    expect((customer?.body as { customer: { name: string } }).customer.name).toBe('Omni');
    expect(link?.body).toEqual({
      setup_link: { allowed_connection_types: ['coexistence'], provision_phone_number: false },
    });
  });

  test('reuses the remembered customer, and replaces it once when Kapso no longer knows it', async () => {
    const settings = configured();
    settings.values.set(KAPSO_SETTINGS.customerId.key, 'cus-gone');
    table[`POST ${KAPSO}/platform/v1/customers/cus-gone/setup_links`] = [404, { error: 'Customer not found' }];
    table[`POST ${KAPSO}/platform/v1/customers`] = [201, { data: { id: 'cus-2' } }];
    table[`POST ${KAPSO}/platform/v1/customers/cus-2/setup_links`] = [
      201,
      { data: { url: 'https://app.kapso.ai/whatsapp/setup/def' } },
    ];

    const res = await mount(settings).app.request('/channels/whatsapp-business/kapso/setup-link', json('POST'));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { url: string } }).data.url).toBe('https://app.kapso.ai/whatsapp/setup/def');
    expect(settings.values.get(KAPSO_SETTINGS.customerId.key)).toBe('cus-2');
    expect(sentToKapso().map((sent) => sent.url.replace(KAPSO, ''))).toEqual([
      '/platform/v1/customers/cus-gone/setup_links',
      '/platform/v1/customers',
      '/platform/v1/customers/cus-2/setup_links',
    ]);
  });

  test('with no key saved it says so and calls nobody', async () => {
    const res = await mount(memorySettings()).app.request('/channels/whatsapp-business/kapso/setup-link', json('POST'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('KAPSO_NOT_CONFIGURED');
    expect(sentToKapso()).toEqual([]);
  });
});

describe('GET /channels/whatsapp-business/kapso/numbers', () => {
  test('lists the numbers and the webhook address Omni would give Kapso', async () => {
    const settings = configured();
    settings.values.set('server.public_url', PUBLIC);
    table[`GET ${NUMBERS_URL}`] = [
      200,
      { data: [{ ...NUMBER, display_phone_number: '+1 555-000-0000', verified_name: 'Fixture Store' }] },
    ];

    const res = await mount(settings).app.request('/channels/whatsapp-business/kapso/numbers');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        items: [
          {
            phoneNumberId: NUMBER.phone_number_id,
            wabaId: NUMBER.business_account_id,
            displayPhoneNumber: '+1 555-000-0000',
            name: 'Fixture Store',
          },
        ],
        webhookUrl: WEBHOOK_URL,
      },
    });
  });

  test('webhookUrl is null without a public https address', async () => {
    const settings = configured();
    process.env.OMNI_PUBLIC_URL = 'http://localhost:8882';
    table[`GET ${NUMBERS_URL}`] = [200, { data: [] }];
    const res = await mount(settings).app.request('/channels/whatsapp-business/kapso/numbers');
    expect(await res.json()).toEqual({ data: { items: [], webhookUrl: null } });
  });
});

describe('POST /instances/:id/whatsapp-business/kapso/connect', () => {
  const kapsoMeta = `${KAPSO}/meta/whatsapp/v24.0`;
  const connectPath = `/${INSTANCE_ID}/whatsapp-business/kapso/connect`;

  test('points the webhook at the public URL with a generated secret and stores that secret on the instance', async () => {
    const settings = configured();
    settings.values.set('server.public_url', PUBLIC);
    table[`GET ${NUMBERS_URL}`] = [200, { data: [{ ...NUMBER, display_phone_number: '+1 555-000-0000' }] }];
    table[`GET ${HOOKS_URL}?kind=meta`] = [200, { data: [] }];
    table[`POST ${HOOKS_URL}`] = [201, { data: { id: 'wh-1', kind: 'meta' } }];
    table[`GET ${kapsoMeta}/${NUMBER.phone_number_id}`] = [
      200,
      { display_phone_number: '+1 555-000-0000', quality_rating: 'GREEN' },
    ];
    const { app, updates, credentials } = mount(settings);

    const res = await app.request(connectPath, json('POST', { phoneNumberId: NUMBER.phone_number_id }));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      data: {
        instanceId: INSTANCE_ID,
        status: 'connected',
        displayPhoneNumber: '+1 555-000-0000',
        qualityRating: 'GREEN',
        webhookUrl: WEBHOOK_URL,
      },
    });
    expect(body).not.toContain(KEY);
    const hook = sentToKapso().find((sent) => sent.method === 'POST' && sent.url === HOOKS_URL);
    const sent = (hook?.body as { whatsapp_webhook: { kind: string; url: string; secret_key: string } })
      .whatsapp_webhook;
    expect(sent.kind).toBe('meta');
    expect(sent.url).toBe(WEBHOOK_URL);
    expect(sent.secret_key).toMatch(/^[0-9a-f]{64}$/);
    expect(body).not.toContain(sent.secret_key);
    expect(updates[0]).toMatchObject({
      metaAccessToken: KEY,
      metaPhoneNumberId: NUMBER.phone_number_id,
      metaWabaId: NUMBER.business_account_id,
      metaConnectionMethod: 'kapso',
      metaApiBaseUrl: kapsoMeta,
      metaAuthMode: 'x-api-key',
      metaWebhookSecret: sent.secret_key,
      metaSignatureMode: 'x-webhook-signature',
    });
    expect(credentials()).toMatchObject({ metaWebhookSecret: sent.secret_key, metaApiBaseUrl: kapsoMeta });
    const probe = sentToKapso().find((request) => request.url.startsWith(kapsoMeta));
    expect(probe?.headers['x-api-key']).toBe(KEY);
  });

  test('with no public address it refuses before calling Kapso or touching the instance', async () => {
    const { app, updates } = mount(configured());

    const res = await app.request(connectPath, json('POST', { phoneNumberId: NUMBER.phone_number_id }));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({
      code: 'PUBLIC_URL_MISSING',
      message: expect.stringContaining('Nothing was created'),
    });
    expect(sentToKapso()).toEqual([]);
    expect(updates).toEqual([]);
  });

  test('a Kapso refusal comes back in plain words and leaves the instance alone', async () => {
    const settings = configured();
    settings.values.set('server.public_url', PUBLIC);
    table[`GET ${NUMBERS_URL}`] = [200, { data: [NUMBER] }];
    table[`GET ${HOOKS_URL}?kind=meta`] = [200, { data: [] }];
    table[`POST ${HOOKS_URL}`] = [422, { error: 'Url is not reachable' }];
    const { app, updates } = mount(settings);

    const res = await app.request(connectPath, json('POST', { phoneNumberId: NUMBER.phone_number_id }));

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(JSON.parse(body).error).toEqual({
      code: 'KAPSO_ERROR',
      message: 'Kapso refused to create the number webhook: Url is not reachable.',
    });
    expect(body).not.toContain(KEY);
    expect(updates).toEqual([]);
  });

  test('a number outside the project is refused', async () => {
    const settings = configured();
    settings.values.set('server.public_url', PUBLIC);
    table[`GET ${NUMBERS_URL}`] = [200, { data: [] }];
    const res = await mount(settings).app.request(connectPath, json('POST', { phoneNumberId: NUMBER.phone_number_id }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('KAPSO_NUMBER_NOT_FOUND');
  });
});

describe('with multitenancy on', () => {
  test('every Kapso route refuses in plain words and calls nobody', async () => {
    process.env.OMNI_MULTITENANCY_ENABLED = 'true';
    const settings = configured();
    settings.values.set('server.public_url', PUBLIC);
    const { app, updates } = mount(settings);

    const replies = await Promise.all([
      app.request('/channels/whatsapp-business/kapso/key', json('PUT', { apiKey: KEY })),
      app.request('/channels/whatsapp-business/kapso/setup-link', json('POST')),
      app.request('/channels/whatsapp-business/kapso/numbers'),
      app.request(
        `/${INSTANCE_ID}/whatsapp-business/kapso/connect`,
        json('POST', { phoneNumberId: NUMBER.phone_number_id }),
      ),
    ]);

    for (const res of replies) {
      expect(res.status).toBe(409);
      const error = ((await res.json()) as { error: { code: string; message: string } }).error;
      expect(error.code).toBe('KAPSO_NOT_AVAILABLE');
      expect(error.message).toContain('not available with multitenancy');
    }
    expect(sentToKapso()).toEqual([]);
    expect(settings.setValue).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Many-row stand-in for `global_settings`, as in services/__tests__/settings-slack-app.test.ts.

function boundKey(condition: unknown): string | undefined {
  if (condition instanceof Param) return typeof condition.value === 'string' ? condition.value : undefined;
  const chunks = (condition as SQL | undefined)?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    const found = boundKey(chunk);
    if (found !== undefined) return found;
  }
  return undefined;
}

type Row = Record<string, unknown> & { key: string };

function makeSettingsDb() {
  const rows: Row[] = [];
  const byKey = (condition: unknown): Row[] => rows.filter((row) => row.key === boundKey(condition));
  const db: Record<string, unknown> = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => undefined,
    insert: (table: unknown) => ({
      values: (v: Row) => {
        const insertRow = (): Row => {
          const row: Row = { id: `set-${rows.length + 1}`, isSecret: false, ...v };
          rows.push(row);
          return row;
        };
        const promise = (async () => {
          if (table !== settingChangeHistory) insertRow();
        })();
        return Object.assign(promise, { returning: async () => [insertRow()] });
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            const row = byKey(condition)[0];
            if (!row) return [];
            Object.assign(row, v);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({ limit: async () => byKey(condition).slice(0, 1) }),
        $dynamic: () => ({ where: () => ({ orderBy: async () => rows }), orderBy: async () => rows }),
      }),
    }),
  };
  return { db: db as unknown as Database, rows };
}
