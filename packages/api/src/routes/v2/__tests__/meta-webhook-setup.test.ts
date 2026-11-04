import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { NotFoundError, getLogBuffer } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import { MetaWebhookSetupSchema } from '../../../schemas/openapi/channels';
import { SettingsService } from '../../../services/settings';
import type { ApiKeyData, AppVariables } from '../../../types';
import { channelsRoutes } from '../channels';

const PATH = '/api/v2/channels/whatsapp-business/webhook-setup';
const readSetup = async (response: Response) =>
  z.object({ data: MetaWebhookSetupSchema }).parse(await response.json()).data;
const previous = {
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN,
  META_APP_SECRET: process.env.META_APP_SECRET,
  OMNI_PUBLIC_URL: process.env.OMNI_PUBLIC_URL,
};
beforeEach(() => {
  process.env.META_VERIFY_TOKEN = 'test-verify-token';
  process.env.META_APP_SECRET = 'test-app-secret';
  process.env.OMNI_PUBLIC_URL = 'https://env.example.com';
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function app(overrides: Partial<ApiKeyData> = {}, tenant = false, storedUrl?: string) {
  const key: ApiKeyData = {
    id: 'test-key',
    name: 'test',
    scopes: ['settings:write'],
    instanceIds: null,
    expiresAt: null,
    ...overrides,
  };
  const settings = new SettingsService({} as never);
  settings.getByKey = async (key) => {
    expect(key).toBe('server.public_url');
    if (storedUrl === undefined) throw new NotFoundError('setting', key);
    return { value: storedUrl } as never;
  };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', key);
    c.set('services', { settings } as never);
    if (tenant) c.set('authContext', { credentialClass: 'tenant', tenantId: 'tenant-a' } as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.route('/api/v2/channels', channelsRoutes);
  return app;
}
describe('Meta webhook setup', () => {
  for (const scopes of [['settings:write'], ['settings:*'], ['*']])
    test(`global ${scopes} reads active config, no-store, no secrets logged`, async () => {
      const res = await app({ scopes }, false, 'https://public.example.com/omni/').request(PATH);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        data: {
          callbackUrl: 'https://public.example.com/omni/api/v2/channels/whatsapp-business/webhook',
          verifyToken: 'test-verify-token',
          appSecretConfigured: true,
          state: 'ready',
        },
      });
      const logs = JSON.stringify(getLogBuffer().getRecent());
      expect(logs).not.toContain('test-verify-token');
      expect(logs).not.toContain('test-app-secret');
    });
  test('the configured setting wins; otherwise use the documented env fallback', async () => {
    const reply = await app().request(PATH);
    expect((await readSetup(reply)).callbackUrl).toBe(
      'https://env.example.com/api/v2/channels/whatsapp-business/webhook',
    );
  });
  for (const [label, key, tenant] of [
    ['read only', { scopes: ['settings:read'] }, false],
    ['tenant', {}, true],
    ['instanceIds', { instanceIds: ['instance-a'] }, false],
    ['empty instanceIds', { instanceIds: [] }, false],
    ['instance lock', { instanceAllowlist: ['instance-a'] }, false],
    ['chat lock', { chatAllowlist: ['chat-a'] }, false],
    ['outbound lock', { outboundRecipientAllowlist: ['recipient-a'] }, false],
    ['required empty lock', { profile: 'personal' }, false],
  ] as const)
    test(`${label} cannot retrieve the shared token`, async () => {
      const res = await app(key as Partial<ApiKeyData>, tenant).request(PATH);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('test-verify-token');
    });
  for (const publicUrl of [
    'not a url',
    'https://',
    'https://[zz::1]',
    'https://[fe80::1%25eth0]',
    'https://999.1.1.1',
    'http://public.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://10.255.255.254',
    'https://172.16.0.1',
    'https://172.31.255.254',
    'https://192.168.0.1',
    'https://100.64.0.0',
    'https://100.127.255.255',
    'https://[::ffff:100.64.0.0]',
    'https://[::ffff:100.127.255.255]',
    'https://[64:ff9b::]',
    'https://[64:ff9b::ffff:ffff]',
    'https://[64:ff9b::808:808]',
    'https://[2002::]',
    'https://[2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[2002:808:808::]',
    'https://[::2]',
    'https://[::a00:1]',
    'https://[::10.0.0.1]',
    'https://[::8.8.8.8]',
    'https://[::ffff:ffff]',
    'https://169.254.0.0',
    'https://169.254.255.255',
    'https://[fc00::]',
    'https://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[fe80::]',
    'https://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[FC00:0000:0000:0000:0000:0000:0000:0001]',
    'https://[::ffff:10.0.0.0]',
    'https://[::ffff:10.255.255.255]',
    'https://[::ffff:172.16.0.0]',
    'https://[::ffff:172.31.255.255]',
    'https://[::ffff:192.168.0.0]',
    'https://[::ffff:192.168.255.255]',
    'https://[::ffff:169.254.0.0]',
    'https://[::ffff:169.254.255.255]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:0.0.0.0]',
    'https://[0:0:0:0:0:ffff:a00:1]',
    'https://[::FFFF:C0A8:101]',
    'https://omni.local',
    'https://OMNI.LOCAL.',
    'https://public.example.com/?query=x',
    'https://user:pass@public.example.com',
  ])
    test(`unusable public URL is not guessed: ${publicUrl}`, async () => {
      Reflect.deleteProperty(process.env, 'OMNI_PUBLIC_URL');
      const res = await app({}, false, publicUrl).request(`http://request-host.invalid${PATH}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await readSetup(res)).toMatchObject({ callbackUrl: null, state: 'public_url_invalid' });
    });
  for (const host of ['172.15.255.254', '172.32.0.1', '192.167.255.254', '192.169.0.1', '10.example.com'])
    test(`public host outside the private ranges remains usable: ${host}`, async () => {
      const res = await app({}, false, `https://${host}`).request(PATH);
      expect(await readSetup(res)).toMatchObject({
        callbackUrl: `https://${host}/api/v2/channels/whatsapp-business/webhook`,
        state: 'ready',
      });
    });
  for (const publicUrl of [
    'https://100.63.255.255',
    'https://100.128.0.0',
    'https://[::ffff:100.63.255.255]',
    'https://[::ffff:100.128.0.0]',
    'https://[64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[64:ff9b::1:0:0]',
    'https://[2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[2003::]',
    'https://[::1:0:0]',
    'https://100.64.example.com',
    'https://169.253.255.255',
    'https://169.255.0.0',
    'https://[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[fe00::]',
    'https://[fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff]',
    'https://[fc::1]',
    'https://[fe8::1]',
    'https://[::ffff:9.255.255.255]',
    'https://[::ffff:11.0.0.0]',
    'https://[::ffff:172.15.255.255]',
    'https://[::ffff:172.32.0.0]',
    'https://[::ffff:192.167.255.255]',
    'https://[::ffff:192.169.0.0]',
    'https://[::ffff:169.253.255.255]',
    'https://[::ffff:169.255.0.0]',
    'https://169.254.example.com',
  ])
    test(`host outside the denied subnets remains usable: ${publicUrl}`, async () => {
      const res = await app({}, false, publicUrl).request(PATH);
      expect(await readSetup(res)).toMatchObject({
        callbackUrl: `${new URL(publicUrl).href}api/v2/channels/whatsapp-business/webhook`,
        state: 'ready',
      });
    });
  for (const publicUrl of ['', '   '])
    test(`empty configuration keeps the missing state: ${JSON.stringify(publicUrl)}`, async () => {
      Reflect.deleteProperty(process.env, 'OMNI_PUBLIC_URL');
      Reflect.deleteProperty(process.env, 'META_VERIFY_TOKEN');
      const res = await app({}, false, publicUrl).request(PATH);
      expect(res.status).toBe(200);
      expect(await readSetup(res)).toMatchObject({
        callbackUrl: null,
        verifyToken: null,
        state: 'public_url_missing',
      });
    });
  test('an invalid URL takes precedence over a missing token', async () => {
    Reflect.deleteProperty(process.env, 'META_VERIFY_TOKEN');
    const res = await app({}, false, 'not a url').request(PATH);
    expect(res.status).toBe(200);
    expect(await readSetup(res)).toMatchObject({
      callbackUrl: null,
      verifyToken: null,
      state: 'public_url_invalid',
    });
  });
  test('missing token and app secret are reported without returning either secret', async () => {
    Reflect.deleteProperty(process.env, 'META_VERIFY_TOKEN');
    Reflect.deleteProperty(process.env, 'META_APP_SECRET');
    const res = await app().request(PATH);
    expect(await res.json()).toEqual({
      data: {
        callbackUrl: 'https://env.example.com/api/v2/channels/whatsapp-business/webhook',
        verifyToken: null,
        appSecretConfigured: false,
        state: 'verify_token_missing',
      },
    });
  });
  test('the returned token is accepted by the real Meta challenge verifier', async () => {
    const { handleVerifyChallenge } = await import(
      new URL('../../../../../channel-whatsapp-business/src/handlers/webhook.ts', import.meta.url).href
    );
    const response = await app().request(PATH);
    const data = await readSetup(response);
    if (!data.callbackUrl || !data.verifyToken) throw new Error('Expected configured Meta webhook setup');
    const url = new URL(data.callbackUrl);
    url.search = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': data.verifyToken,
      'hub.challenge': 'test-challenge',
    }).toString();
    const verified = handleVerifyChallenge(new Request(url.href), process.env.META_VERIFY_TOKEN);
    expect(verified.status).toBe(200);
    expect(await verified.text()).toBe('test-challenge');
  });
  test('an unauthenticated request gets no token and cannot cache the response', async () => {
    const bare = new Hono<{ Variables: AppVariables }>();
    bare.route('/api/v2/channels', channelsRoutes);
    const response = await bare.request(PATH);
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('test-verify-token');
  });
});

// IANA special-purpose registries (2026-11-02), plus non-unicast/deprecated
// transition/site-local space. Adjacent addresses may belong to another denied
// range; the explicit booleans pin those shared edges rather than widening them.
const deniedLiteralBoundaries = [
  {
    range: '2001::/32',
    first: '2001::',
    last: '2001:0:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['2001:1::', false],
  },
  {
    range: '0.0.0.0/8',
    first: '0.0.0.0',
    last: '0.255.255.255',
    after: ['1.0.0.0', true],
  },
  {
    range: '192.0.0.0/24',
    first: '192.0.0.0',
    last: '192.0.0.255',
    before: ['191.255.255.255', true],
    after: ['192.0.1.0', true],
  },
  {
    range: '192.0.2.0/24',
    first: '192.0.2.0',
    last: '192.0.2.255',
    before: ['192.0.1.255', true],
    after: ['192.0.3.0', true],
  },
  {
    range: '192.88.99.0/24',
    first: '192.88.99.0',
    last: '192.88.99.255',
    before: ['192.88.98.255', true],
    after: ['192.88.100.0', true],
  },
  {
    range: '198.18.0.0/15',
    first: '198.18.0.0',
    last: '198.19.255.255',
    before: ['198.17.255.255', true],
    after: ['198.20.0.0', true],
  },
  {
    range: '198.51.100.0/24',
    first: '198.51.100.0',
    last: '198.51.100.255',
    before: ['198.51.99.255', true],
    after: ['198.51.101.0', true],
  },
  {
    range: '203.0.113.0/24',
    first: '203.0.113.0',
    last: '203.0.113.255',
    before: ['203.0.112.255', true],
    after: ['203.0.114.0', true],
  },
  {
    range: '224.0.0.0/4',
    first: '224.0.0.0',
    last: '239.255.255.255',
    before: ['223.255.255.255', true],
    after: ['240.0.0.0', false],
  },
  {
    range: '240.0.0.0/4',
    first: '240.0.0.0',
    last: '255.255.255.255',
    before: ['239.255.255.255', false],
  },
  {
    range: '::ffff:0:0:0/96',
    first: '::ffff:0:0:0',
    last: '::ffff:0:ffff:ffff',
    before: ['::fffe:ffff:ffff:ffff', true],
    after: ['::ffff:1:0:0', true],
  },
  {
    range: '64:ff9b:1::/48',
    first: '64:ff9b:1::',
    last: '64:ff9b:1:ffff:ffff:ffff:ffff:ffff',
    before: ['64:ff9b:0:ffff:ffff:ffff:ffff:ffff', true],
    after: ['64:ff9b:2::', true],
  },
  {
    range: '100::/64',
    first: '100::',
    last: '100::ffff:ffff:ffff:ffff',
    before: ['ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['100:0:0:1::', false],
  },
  {
    range: '100:0:0:1::/64',
    first: '100:0:0:1::',
    last: '100::1:ffff:ffff:ffff:ffff',
    before: ['100::ffff:ffff:ffff:ffff', false],
    after: ['100:0:0:2::', true],
  },
  {
    range: '2001::/23',
    first: '2001::',
    last: '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['2001:200::', true],
  },
  {
    range: '2001:db8::/32',
    first: '2001:db8::',
    last: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['2001:db9::', true],
  },
  {
    range: '3fff::/20',
    first: '3fff::',
    last: '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['3fff:1000::', true],
  },
  {
    range: '5f00::/16',
    first: '5f00::',
    last: '5f00:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['5eff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['5f01::', true],
  },
  {
    range: 'fec0::/10',
    first: 'fec0::',
    last: 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
    after: ['ff00::', false],
  },
  {
    range: 'ff00::/8',
    first: 'ff00::',
    last: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', false],
  },
] as const;
const publicExceptionBoundaries = [
  {
    range: '192.0.0.9/32',
    first: '192.0.0.9',
    last: '192.0.0.9',
    before: ['192.0.0.8', false],
    after: ['192.0.0.10', true],
  },
  {
    range: '192.0.0.10/32',
    first: '192.0.0.10',
    last: '192.0.0.10',
    before: ['192.0.0.9', true],
    after: ['192.0.0.11', false],
  },
  {
    range: '2001:1::1/128',
    first: '2001:1::1',
    last: '2001:1::1',
    before: ['2001:1::', false],
    after: ['2001:1::2', true],
  },
  {
    range: '2001:1::2/128',
    first: '2001:1::2',
    last: '2001:1::2',
    before: ['2001:1::1', true],
    after: ['2001:1::3', true],
  },
  {
    range: '2001:1::3/128',
    first: '2001:1::3',
    last: '2001:1::3',
    before: ['2001:1::2', true],
    after: ['2001:1::4', false],
  },
  {
    range: '2001:3::/32',
    first: '2001:3::',
    last: '2001:3:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2001:2:ffff:ffff:ffff:ffff:ffff:ffff', false],
    after: ['2001:4::', false],
  },
  {
    range: '2001:4:112::/48',
    first: '2001:4:112::',
    last: '2001:4:112:ffff:ffff:ffff:ffff:ffff',
    before: ['2001:4:111:ffff:ffff:ffff:ffff:ffff', false],
    after: ['2001:4:113::', false],
  },
  {
    range: '2001:20::/28',
    first: '2001:20::',
    last: '2001:2f:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2001:1f:ffff:ffff:ffff:ffff:ffff:ffff', false],
    after: ['2001:30::', true],
  },
  {
    range: '2001:30::/28',
    first: '2001:30::',
    last: '2001:3f:ffff:ffff:ffff:ffff:ffff:ffff',
    before: ['2001:2f:ffff:ffff:ffff:ffff:ffff:ffff', true],
    after: ['2001:40::', false],
  },
] as const;

async function expectLiteralSetup(address: string, usable: boolean) {
  const publicUrl = `https://${address.includes(':') ? `[${address}]` : address}`;
  const res = await app({}, false, publicUrl).request(PATH);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await readSetup(res)).toMatchObject(
    usable
      ? {
          callbackUrl: `${new URL(publicUrl).href}api/v2/channels/whatsapp-business/webhook`,
          state: 'ready',
        }
      : { callbackUrl: null, state: 'public_url_invalid' },
  );
}

for (const [label, boundaries, insidePublic] of [
  ['special-use', deniedLiteralBoundaries, false],
  ['globally reachable exception', publicExceptionBoundaries, true],
] as const) {
  describe(`Meta webhook ${label} literal boundaries`, () => {
    for (const boundary of boundaries) {
      const cases: Array<readonly [string, string, boolean]> = [
        ['first', boundary.first, insidePublic],
        ['last', boundary.last, insidePublic],
      ];
      if ('before' in boundary) cases.push(['before', ...boundary.before]);
      if ('after' in boundary) cases.push(['after', ...boundary.after]);
      for (const [edge, address, usable] of cases) {
        test(`${boundary.range} ${edge}: ${address}`, () => expectLiteralSetup(address, usable));
        if (!address.includes(':'))
          test(`${boundary.range} ${edge} mapped: ${address}`, () => expectLiteralSetup(`::ffff:${address}`, usable));
      }
    }
  });
}

describe('Meta webhook public literals and special-use interior points', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '::ffff:8.8.8.8',
    '::ffff:1.1.1.1',
    '192.31.196.0',
    '192.31.196.255',
    '192.52.193.0',
    '192.52.193.255',
    '192.175.48.0',
    '192.175.48.255',
    '2620:4f:8000::',
    '2620:4f:8000:ffff:ffff:ffff:ffff:ffff',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ])
    test(`public address remains accepted: ${address}`, () => expectLiteralSetup(address, true));
  for (const address of [
    '0.1.2.3',
    '192.0.0.8',
    '192.0.0.170',
    '192.0.0.171',
    '192.88.99.2',
    '224.0.0.1',
    '239.255.255.250',
    '255.255.255.255',
    '::ffff:0:8.8.8.8',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'ff02::fb',
    'ff0e::1',
  ])
    test(`non-public interior address is refused: ${address}`, () => expectLiteralSetup(address, false));
  for (const host of ['192.0.0.example.com', '198.18.example.com', '224.example.com'])
    test(`IP-shaped DNS name remains accepted: ${host}`, async () => {
      const res = await app({}, false, `https://${host}`).request(PATH);
      expect((await readSetup(res)).state).toBe('ready');
    });
});
