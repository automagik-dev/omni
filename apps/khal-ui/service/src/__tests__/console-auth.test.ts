/**
 * Console auth (CONTRACT §4) tests — flag-gated KHAL-session enforcement.
 *
 * The KHAL verifier is exercised for real against SELF-SIGNED HS256 tokens
 * (CONTRACT §4.3 authorizes exactly this), so signature/expiry/Bearer+cookie
 * extraction are proven end-to-end. Only the Omni keys API (mint) and the
 * proxied upstream are mocked via the injected fetch.
 */

import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createConsoleAuth } from '../auth';
import { type BffConfig, type FetchLike, createBff } from '../bff';
import { ConsoleKeyMintError, ConsoleKeyProvider } from '../console-keys';
import { type ConsoleProfile, resolveConsoleProfile } from '../roles';

const BASE = 'http://omni.test';
const SECRET = 'test-hs256-signing-secret-do-not-leak';
const ORG = 'org_allowed_123';
const GOD_KEY = 'omni_sk_godkey_legacy';
const MINT_KEY = 'omni_sk_mint_superset';

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

interface JwtClaims {
  userId?: string;
  sub?: string;
  orgId?: string;
  role?: string;
  permissions?: string[];
  exp?: number;
  nbf?: number;
}

/** Sign a standard HS256 JWT the way `validateKhalSession` expects to verify it. */
function signJwt(claims: JwtClaims, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function validToken(over: Partial<JwtClaims> = {}): string {
  return signJwt({ userId: 'user_a', orgId: ORG, role: 'member', permissions: [], ...over });
}

interface MintCall {
  name: string;
  profile: string;
  mintKey: string | null;
}
interface ProxyCall {
  url: string;
  method: string;
  key: string | null;
}

/** Mock fetch: routes POST /api/v2/keys → mint, everything else → proxied upstream. */
function mockFetch(opts: { mintStatus?: number } = {}) {
  let minted = 0;
  const mints: MintCall[] = [];
  const proxied: ProxyCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    if (url.endsWith('/api/v2/keys') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name: string; profile: string };
      mints.push({ name: body.name, profile: body.profile, mintKey: headers.get('x-api-key') });
      if (opts.mintStatus && opts.mintStatus >= 400) {
        return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), { status: opts.mintStatus });
      }
      minted += 1;
      return new Response(
        JSON.stringify({ data: { plainTextKey: `omni_sk_minted_${minted}`, keyPrefix: `mint${minted}` } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    }
    proxied.push({ url, method, key: headers.get('x-api-key') });
    return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, mints, proxied };
}

function enforcedBff(fetchImpl: FetchLike, extra?: { ttlMs?: number; now?: () => number }) {
  const keyProvider = new ConsoleKeyProvider({
    baseUrl: BASE,
    mintKey: MINT_KEY,
    fetchImpl,
    ttlMs: extra?.ttlMs,
    now: extra?.now,
  });
  const consoleAuth = createConsoleAuth({ orgAllowlist: [ORG], keyProvider, sessionSecret: SECRET });
  const config: BffConfig = {
    apiKey: GOD_KEY,
    baseUrl: BASE,
    corsOrigins: ['http://localhost:5174'],
    fetchImpl,
    authEnforce: true,
    consoleAuth,
  };
  return createBff(config);
}

function omniReq(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:8899${path}`, { headers });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

describe('flag OFF — legacy single-key path is intact', () => {
  test('tokenless request is proxied with the single god-key, no mint', async () => {
    const { fetchImpl, mints, proxied } = mockFetch();
    const bff = createBff({ apiKey: GOD_KEY, baseUrl: BASE, corsOrigins: ['http://localhost:5174'], fetchImpl });
    const res = await bff.fetch(omniReq('/omni/api/v2/instances'));
    expect(res.status).toBe(200);
    expect(mints.length).toBe(0);
    expect(proxied[0]?.key).toBe(GOD_KEY);
  });

  test('createBff throws if authEnforce is on without a consoleAuth policy', () => {
    expect(() => createBff({ apiKey: GOD_KEY, baseUrl: BASE, authEnforce: true })).toThrow();
  });
});

describe('flag ON — fail-closed gate (CONTRACT §4.1/§4.4)', () => {
  test('no token ⇒ 401 UNAUTHENTICATED, no key minted, upstream never called', async () => {
    const { fetchImpl, mints, proxied } = mockFetch();
    const res = await enforcedBff(fetchImpl).fetch(omniReq('/omni/api/v2/instances'));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('UNAUTHENTICATED');
    expect(mints.length).toBe(0);
    expect(proxied.length).toBe(0);
  });

  test('invalid signature ⇒ 401, no mint', async () => {
    const { fetchImpl, mints } = mockFetch();
    const token = signJwt({ userId: 'u', orgId: ORG, role: 'member', permissions: [] }, 'WRONG-SECRET');
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(401);
    expect(mints.length).toBe(0);
  });

  test('expired token ⇒ 401', async () => {
    const { fetchImpl } = mockFetch();
    const token = validToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(401);
  });

  test('orgId not in the allowlist ⇒ 401 ORG_NOT_ALLOWED, no mint (tenant binding)', async () => {
    const { fetchImpl, mints } = mockFetch();
    const token = validToken({ orgId: 'org_some_other_tenant' });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('ORG_NOT_ALLOWED');
    expect(mints.length).toBe(0);
  });

  test('unknown role slug ⇒ 401 ROLE_NOT_RECOGNIZED, no mint (no fail-open member)', async () => {
    const { fetchImpl, mints } = mockFetch();
    const token = validToken({ role: 'org-guest' });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('ROLE_NOT_RECOGNIZED');
    expect(mints.length).toBe(0);
  });
});

describe('flag ON — role → profile minting (CONTRACT §2.3)', () => {
  test.each([
    ['member', 'console-viewer'],
    ['platform-dev', 'console-operator'],
    ['platform-admin', 'console-admin'],
    ['platform-owner', 'console-admin'],
  ])('canonical role %s mints %s and proxies with the minted per-user key', async (role, profile) => {
    const { fetchImpl, mints, proxied } = mockFetch();
    const token = validToken({ userId: `u_${role}`, role });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(200);
    expect(mints.length).toBe(1);
    expect(mints[0]?.profile).toBe(profile);
    expect(mints[0]?.name).toBe(`khal:u_${role}`);
    expect(mints[0]?.mintKey).toBe(MINT_KEY);
    expect(proxied[0]?.key).toBe('omni_sk_minted_1');
    expect(proxied[0]?.key).not.toBe(GOD_KEY);
  });

  test.each([
    ['admin', 'console-admin'],
    ['developer', 'console-operator'],
    ['owner', 'console-admin'],
    ['viewer', 'console-viewer'],
    ['user', 'console-viewer'],
    ['dev', 'console-operator'],
  ])('documented alias %s maps to %s', async (role, profile) => {
    const { fetchImpl, mints } = mockFetch();
    const token = validToken({ userId: `u_${role}`, role });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(200);
    expect(mints[0]?.profile).toBe(profile);
  });
});

describe('flag ON — per-user key lifecycle', () => {
  test('two requests from the same user ⇒ ONE mint, same key reused', async () => {
    const { fetchImpl, mints, proxied } = mockFetch();
    const bff = enforcedBff(fetchImpl);
    const token = validToken({ userId: 'cached_user', role: 'platform-dev' });
    await bff.fetch(omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }));
    await bff.fetch(omniReq('/omni/api/v2/chats', { authorization: `Bearer ${token}` }));
    expect(mints.length).toBe(1);
    expect(proxied.length).toBe(2);
    expect(proxied[0]?.key).toBe(proxied[1]?.key);
  });

  test('two different users ⇒ two mints, distinct names and distinct keys (per-user attribution)', async () => {
    const { fetchImpl, mints, proxied } = mockFetch();
    const bff = enforcedBff(fetchImpl);
    await bff.fetch(
      omniReq('/omni/api/v2/instances', {
        authorization: `Bearer ${validToken({ userId: 'user_one', role: 'member' })}`,
      }),
    );
    await bff.fetch(
      omniReq('/omni/api/v2/instances', {
        authorization: `Bearer ${validToken({ userId: 'user_two', role: 'member' })}`,
      }),
    );
    expect(mints.length).toBe(2);
    expect(mints[0]?.name).toBe('khal:user_one');
    expect(mints[1]?.name).toBe('khal:user_two');
    expect(new Set(mints.map((m) => m.name)).size).toBe(2);
    expect(proxied[0]?.key).not.toBe(proxied[1]?.key);
  });

  test('a cached user whose role changes ⇒ re-mint with the new profile', async () => {
    const { fetchImpl, mints } = mockFetch();
    const bff = enforcedBff(fetchImpl);
    await bff.fetch(
      omniReq('/omni/api/v2/instances', {
        authorization: `Bearer ${validToken({ userId: 'promoted', role: 'member' })}`,
      }),
    );
    await bff.fetch(
      omniReq('/omni/api/v2/instances', {
        authorization: `Bearer ${validToken({ userId: 'promoted', role: 'platform-admin' })}`,
      }),
    );
    expect(mints.length).toBe(2);
    expect(mints[0]?.profile).toBe('console-viewer');
    expect(mints[1]?.profile).toBe('console-admin');
  });

  test('a cached entry past its TTL is re-minted', async () => {
    const { fetchImpl, mints } = mockFetch();
    let clock = 1_000_000;
    const bff = enforcedBff(fetchImpl, { ttlMs: 100, now: () => clock });
    const token = validToken({ userId: 'ttl_user', role: 'member' });
    await bff.fetch(omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }));
    clock += 200;
    await bff.fetch(omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }));
    expect(mints.length).toBe(2);
  });
});

describe('flag ON — token sources', () => {
  test('session accepted from the khal-session cookie (not only Bearer)', async () => {
    const { fetchImpl, mints } = mockFetch();
    const token = validToken({ userId: 'cookie_user', role: 'member' });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { cookie: `khal-session=${token}` }),
    );
    expect(res.status).toBe(200);
    expect(mints[0]?.name).toBe('khal:cookie_user');
  });

  test('Bearer takes precedence over the cookie', async () => {
    const { fetchImpl } = mockFetch();
    const good = validToken({ userId: 'x', role: 'member' });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: 'Bearer not-a-valid-jwt', cookie: `khal-session=${good}` }),
    );
    // The (invalid) Bearer is chosen over the valid cookie ⇒ 401, proving precedence.
    expect(res.status).toBe(401);
  });
});

describe('flag ON — mint failure fails closed', () => {
  test('mint ceiling rejection (403) ⇒ 502 KEY_MINT_FAILED, not proxied, no key leaked', async () => {
    const { fetchImpl, mints, proxied } = mockFetch({ mintStatus: 403 });
    const token = validToken({ userId: 'u', role: 'platform-admin' });
    const res = await enforcedBff(fetchImpl).fetch(
      omniReq('/omni/api/v2/instances', { authorization: `Bearer ${token}` }),
    );
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain(MINT_KEY);
    expect(raw).not.toContain(GOD_KEY);
    const body = JSON.parse(raw) as { error: { code: string; upstreamStatus?: number } };
    expect(body.error.code).toBe('KEY_MINT_FAILED');
    expect(body.error.upstreamStatus).toBe(403);
    expect(mints.length).toBe(1);
    expect(proxied.length).toBe(0);
  });
});

describe('resolveConsoleProfile (unit)', () => {
  const CASES: Array<[string, ConsoleProfile]> = [
    ['member', 'console-viewer'],
    ['platform-dev', 'console-operator'],
    ['platform-admin', 'console-admin'],
    ['platform-owner', 'console-admin'],
    ['admin', 'console-admin'],
    ['developer', 'console-operator'],
    ['owner', 'console-admin'],
    ['viewer', 'console-viewer'],
    ['user', 'console-viewer'],
    ['dev', 'console-operator'],
  ];
  test.each(CASES)('%s → %s', (role, profile) => {
    expect(resolveConsoleProfile(role)).toBe(profile);
  });

  test.each(['', 'org-guest', 'Member', 'PLATFORM-ADMIN', 'root', 'superuser', ' member '])(
    'unrecognized slug %p ⇒ null (fail closed, never fail-open member)',
    (role) => {
      expect(resolveConsoleProfile(role)).toBeNull();
    },
  );
});

describe('ConsoleKeyProvider (unit)', () => {
  test('throws ConsoleKeyMintError when the mint response carries no key', async () => {
    const provider = new ConsoleKeyProvider({
      baseUrl: BASE,
      mintKey: MINT_KEY,
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: {} }), { status: 201, headers: { 'content-type': 'application/json' } }),
    });
    await expect(provider.keyFor('u', 'console-viewer')).rejects.toThrow(ConsoleKeyMintError);
  });

  test('throws ConsoleKeyMintError when the mint endpoint is unreachable', async () => {
    const provider = new ConsoleKeyProvider({
      baseUrl: BASE,
      mintKey: MINT_KEY,
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(provider.keyFor('u', 'console-admin')).rejects.toThrow(ConsoleKeyMintError);
  });
});
