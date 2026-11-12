/**
 * Kapso Platform API helpers (#1676). The global `fetch` is replaced by a table of answers:
 * an unlisted request throws, so no test can reach Kapso. The key is a fixture string.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  KapsoApiError,
  createKapsoCustomer,
  createKapsoSetupLink,
  kapsoMetaApiBaseUrl,
  listKapsoPhoneNumbers,
  upsertKapsoMetaWebhook,
} from '../kapso';

const KEY = 'fixture-kapso-key';
const OPTIONS = { apiKey: KEY, baseUrl: 'https://kapso.test' };

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  redirect?: RequestInit['redirect'];
}

let calls: Call[] = [];
let original: typeof fetch;

function answer(table: Record<string, [number, unknown]>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      redirect: init?.redirect,
    });
    const reply = table[`${method} ${url}`];
    if (!reply) throw new Error(`unmocked ${method} ${url}`);
    const [status, body] = reply;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

describe('Kapso requests', () => {
  it('sends the project key as X-API-Key, refuses redirects, and creates a customer', async () => {
    answer({ 'POST https://kapso.test/platform/v1/customers': [201, { data: { id: 'cus-1', name: 'Omni' } }] });
    expect(await createKapsoCustomer(OPTIONS, { name: 'Omni', externalCustomerId: 'omni-1' })).toEqual({ id: 'cus-1' });
    expect(calls[0]?.headers['x-api-key']).toBe(KEY);
    expect(calls[0]?.redirect).toBe('error');
    expect(calls[0]?.body).toEqual({ customer: { name: 'Omni', external_customer_id: 'omni-1' } });
  });

  it('asks for a coexistence setup link that provisions no number', async () => {
    answer({
      'POST https://kapso.test/platform/v1/customers/cus-1/setup_links': [
        201,
        { data: { id: 'sl-1', url: 'https://app.kapso.ai/whatsapp/setup/abc', expires_at: '2026-12-12T00:00:00Z' } },
      ],
    });
    expect(await createKapsoSetupLink(OPTIONS, 'cus-1')).toEqual({
      url: 'https://app.kapso.ai/whatsapp/setup/abc',
      expiresAt: '2026-12-12T00:00:00Z',
    });
    expect(calls[0]?.body).toEqual({
      setup_link: { allowed_connection_types: ['coexistence'], provision_phone_number: false },
    });
  });

  it('maps the project numbers to phone_number_id, WABA id, display number and name', async () => {
    answer({
      'GET https://kapso.test/platform/v1/whatsapp/phone_numbers?per_page=100': [
        200,
        {
          data: [
            {
              phone_number_id: '111111111111111',
              business_account_id: '222222222222222',
              display_phone_number: '+1 555-000-0000',
              verified_name: 'Fixture Store',
              display_name: 'Store',
            },
            { phone_number_id: '333333333333333', business_account_id: '444444444444444', name: 'Line 2' },
            { phone_number_id: '555555555555555', business_account_id: null },
          ],
          meta: { page: 1 },
        },
      ],
    });
    expect(await listKapsoPhoneNumbers(OPTIONS)).toEqual([
      {
        phoneNumberId: '111111111111111',
        wabaId: '222222222222222',
        displayPhoneNumber: '+1 555-000-0000',
        name: 'Fixture Store',
      },
      { phoneNumberId: '333333333333333', wabaId: '444444444444444', displayPhoneNumber: null, name: 'Line 2' },
    ]);
  });

  it('builds the Meta-compatible base on the Kapso origin', () => {
    expect(kapsoMetaApiBaseUrl('https://kapso.test/platform/v1/')).toBe('https://kapso.test/meta/whatsapp/v24.0');
    expect(kapsoMetaApiBaseUrl()).toBe('https://api.kapso.ai/meta/whatsapp/v24.0');
  });
});

describe('upsertKapsoMetaWebhook', () => {
  const hooks = 'https://kapso.test/platform/v1/whatsapp/phone_numbers/111/webhooks';
  const input = { url: 'https://omni.test/api/v2/channels/whatsapp-business/webhook', secret: 'fixture-secret' };

  it('creates a meta-kind webhook when the number has none', async () => {
    answer({
      [`GET ${hooks}?kind=meta`]: [200, { data: [] }],
      [`POST ${hooks}`]: [201, { data: { id: 'wh-1', kind: 'meta', url: input.url } }],
    });
    expect(await upsertKapsoMetaWebhook(OPTIONS, '111', input)).toEqual({ id: 'wh-1', created: true });
    expect(calls[1]?.body).toEqual({
      whatsapp_webhook: { kind: 'meta', url: input.url, secret_key: input.secret, active: true },
    });
  });

  it('points the existing meta webhook at Omni with the new secret', async () => {
    answer({
      [`GET ${hooks}?kind=meta`]: [200, { data: [{ id: 'wh-old', kind: 'meta', url: 'https://elsewhere.test' }] }],
      [`PATCH ${hooks}/wh-old`]: [200, { data: { id: 'wh-old', kind: 'meta', url: input.url } }],
    });
    expect(await upsertKapsoMetaWebhook(OPTIONS, '111', input)).toEqual({ id: 'wh-old', created: false });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
    expect(calls[1]?.body).toEqual({ whatsapp_webhook: { url: input.url, secret_key: input.secret, active: true } });
  });
});

describe('Kapso errors', () => {
  it("turns Kapso's own words into a plain message without the key", async () => {
    answer({
      'POST https://kapso.test/platform/v1/customers/cus-1/setup_links': [422, { error: 'Customer is archived' }],
    });
    const error = await createKapsoSetupLink(OPTIONS, 'cus-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KapsoApiError);
    expect((error as KapsoApiError).message).toBe('Kapso refused to create a setup link: Customer is archived.');
    expect((error as KapsoApiError).status).toBe(422);
    expect((error as KapsoApiError).message).not.toContain(KEY);
  });

  it('says to check the key on 401', async () => {
    answer({
      'GET https://kapso.test/platform/v1/whatsapp/phone_numbers?per_page=100': [401, { error: 'Invalid API key' }],
    });
    await expect(listKapsoPhoneNumbers(OPTIONS)).rejects.toThrow(
      'Kapso refused to list its numbers: Invalid API key. Check the Kapso project API key.',
    );
  });

  it('names an unreachable Kapso and an unknown reply shape', async () => {
    globalThis.fetch = (async () => {
      throw new Error(`socket closed for ${KEY}`);
    }) as unknown as typeof fetch;
    await expect(listKapsoPhoneNumbers(OPTIONS)).rejects.toThrow('Could not reach Kapso. Try again in a moment.');
    answer({ 'GET https://kapso.test/platform/v1/whatsapp/phone_numbers?per_page=100': [200, { numbers: [] }] });
    await expect(listKapsoPhoneNumbers(OPTIONS)).rejects.toThrow('in a shape Omni does not know');
  });
});
