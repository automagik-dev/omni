/**
 * QA matrix rows Durability and Races (core share): idempotent login, the seven-day deadline in
 * store time, explicit fresh login only, generation fences in both orders, and the bounded
 * transaction, cookie and response rules. Test names are stable acceptance ids that run-required
 * --require matches; rename them only with the wish's evidence record.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { type OidcSettings, createOidcClient } from '../src/oidc';
import { createConnectCore, hashSecret } from '../src/sessions';
import { TransactionStore } from '../src/transactions';
import { FakeIssuer } from './fake-issuer';
import { SESSION_DAYS } from './memory-store';
import { SESSION, TX, type Wiring, cookie, finish, request, settings, signIn, wire } from './setup';

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await FakeIssuer.create();
});
const DAY = 86_400_000;
const ATTRS = 'Path=/; Max-Age=';
const post = (path: string, session: string | null) => request(path, [session], { method: 'POST' });
const kind = async (w: Wiring, session: string | null) => (await w.core.authenticate(request('/', [session]))).kind;

async function signedIn(w: Wiring): Promise<string> {
  const response = await signIn(w);
  expect(response.status).toBe(303);
  return cookie(response, SESSION) ?? '';
}
const idOf = (session: string | null) => session?.split('=')[1]?.split('.')[0] ?? '';

describe('cookies and auth responses', () => {
  test('exact host-only cookies; no-store, no-referrer, fixed return path; no auth query echoed', async () => {
    const w = await wire(issuer);
    const login = await w.core.login(request('/auth/login'));
    const tx = /^__Host-brain_connect_tx=[\w-]{43}; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/;
    expect(login.headers.getSetCookie()).toEqual([expect.stringMatching(tx)]);
    const query = w.issuer.authorize(login.headers.get('location') ?? '');
    const callback = await w.core.callback(request(`/auth/callback?${query}`, [cookie(login, TX)]));
    expect(callback.headers.get('location')).toBe('/');
    const session =
      /^__Host-brain_connect_session=[\w-]{22}\.[\w-]{43}; Path=\/; Max-Age=604800; Secure; HttpOnly; SameSite=Lax$/;
    const clearTx = `${TX}=; ${ATTRS}0; Secure; HttpOnly; SameSite=Lax`;
    expect(callback.headers.getSetCookie()).toEqual([clearTx, expect.stringMatching(session)]);
    const replay = await w.core.callback(request(`/auth/callback?${query}`, [cookie(login, TX)]));
    for (const r of [login, callback, replay]) {
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.getSetCookie().join()).not.toMatch(/Domain=/i);
    }
    const echoed = `${[...callback.headers.values(), ...replay.headers.values()]} ${await replay.text()}`;
    for (const value of query.values()) expect(echoed).not.toContain(value);
  });

  test('the store keeps only the secret hash', async () => {
    const w = await wire(issuer);
    const [id = '', secret = ''] = (await signedIn(w)).split('=')[1]?.split('.') ?? [];
    expect(w.store.sessions.get(id)?.secretHash).toBe(hashSecret(secret));
    expect(JSON.stringify([...w.store.sessions.values()])).not.toContain(secret);
  });
});

describe('durability', () => {
  test('login with a valid cookie is idempotent: no OIDC, no issuance, no Set-Cookie, same deadline', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    const [hits, calls] = [w.issuer.hits.length, w.store.calls.length];
    const deadline = w.store.sessions.get(idOf(session))?.expiresAt;
    const again = await w.core.login(request('/auth/login', [session]));
    expect([again.status, again.headers.get('location')]).toEqual([303, '/']);
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(w.issuer.hits.length).toBe(hits);
    expect(w.store.calls.slice(calls)).toEqual(['resolveSession']);
    expect(w.store.sessions.size).toBe(1);
    expect(w.store.sessions.get(idOf(session))?.expiresAt).toBe(deadline);
    expect(await kind(w, session)).toBe('active');
  });

  test('store failure on the valid-cookie path is 503 and never falls through to issuance', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    const hits = w.issuer.hits.length;
    w.store.broken = true;
    const response = await w.core.login(request('/auth/login', [session]));
    expect([response.status, response.headers.getSetCookie().length, w.issuer.hits.length]).toEqual([503, 0, hits]);
  });

  for (const ending of ['expired', 'revoked'] as const) {
    test(`${ending} session on the login path answers signed-out; only a later explicit login starts OIDC`, async () => {
      const w = await wire(issuer);
      const session = await signedIn(w);
      if (ending === 'expired') w.store.now += SESSION_DAYS * DAY;
      else await w.core.logout(post('/auth/logout', session));
      const [hits, calls] = [w.issuer.hits.length, w.store.calls.length];
      const response = await w.core.login(request('/auth/login', [session]));
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([`${SESSION}=; ${ATTRS}0; Secure; HttpOnly; SameSite=Lax`]);
      expect(w.issuer.hits.length).toBe(hits);
      expect(w.store.calls.slice(calls)).toEqual(['resolveSession']);
      expect((await w.core.login(request('/auth/login'))).status).toBe(302);
    });
  }

  test('the seven-day deadline is store time, independent of the five-minute ID token', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    w.store.now += SESSION_DAYS * DAY - 1000;
    expect(await kind(w, session)).toBe('active');
    w.store.now += 1000;
    expect(await w.core.authenticate(request('/', [session]))).toEqual({ kind: 'signed-out', reason: 'expired' });
  });

  test('independent fresh logins stay distinct; revoking one leaves the other', async () => {
    const w = await wire(issuer);
    const [a, b] = [await signedIn(w), await signedIn(w)];
    expect(idOf(a)).not.toBe(idOf(b));
    expect((await w.core.revoke(post('/', b), idOf(a))).status).toBe(204);
    expect([await kind(w, a), await kind(w, b)]).toEqual(['signed-out', 'active']);
    const list = (await (await w.core.sessions(request('/auth/sessions', [b]))).json()) as {
      sessions: { current: boolean }[];
    };
    expect(list.sessions.map((s) => s.current)).toEqual([true]);
  });
});

describe('durability across restart and provider outage', () => {
  test('a new core over the same store keeps both profiles; an issuer outage revokes nothing', async () => {
    const w = await wire(issuer);
    const [a, b] = [await signedIn(w), await signedIn(w)];
    const oidc = createOidcClient(settings(), { fetch: issuer.fetch });
    const restarted = createConnectCore({ appName: 'brain', store: w.store, oidc });
    w.issuer.down = true;
    for (const session of [a, b]) expect((await restarted.authenticate(request('/', [session]))).kind).toBe('active');
    const again = await restarted.login(request('/auth/login', [a]));
    expect([again.status, again.headers.getSetCookie().length]).toEqual([303, 0]);
  });

  test('the right session id with a wrong secret is signed-out; login answers 401 without OIDC or a store write', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    const forged = `${session.slice(0, session.indexOf('.') + 1)}${'A'.repeat(43)}`;
    expect(await w.core.authenticate(request('/', [forged]))).toEqual({ kind: 'signed-out', reason: 'invalid' });
    const [hits, calls] = [w.issuer.hits.length, w.store.calls.length];
    expect((await w.core.login(request('/auth/login', [forged]))).status).toBe(401);
    expect(w.issuer.hits.length).toBe(hits);
    expect(w.store.calls.slice(calls)).toEqual(['resolveSession']);
    expect(await kind(w, session)).toBe('active');
  });
});

describe('trust: a changed issuer, client, origin or group policy needs local confirmation', () => {
  const changes: [string, Partial<OidcSettings>][] = [
    ['issuer', { issuer: 'https://other-issuer.test' }],
    ['client', { clientId: 'another-client' }],
    ['origin', { origin: 'https://other-studio.test' }],
    ['group policy', { requiredGroup: 'another-group' }],
  ];
  for (const [name, change] of changes) {
    test(`changed ${name}: existing sessions and login start are refused until confirm-trust`, async () => {
      const w = await wire(issuer);
      const session = await signedIn(w);
      const oidc = createOidcClient(settings(change), { fetch: issuer.fetch });
      const changed = createConnectCore({ appName: 'brain', store: w.store, oidc });
      expect(await changed.authenticate(request('/', [session]))).toEqual({
        kind: 'unavailable',
        reason: 'trust-mismatch',
      });
      const [hits, rows] = [w.issuer.hits.length, w.store.sessions.size];
      expect((await changed.login(request('/auth/login', [session]))).status).toBe(503);
      expect((await changed.login(request('/auth/login'))).status).toBe(503);
      expect([w.issuer.hits.length, w.store.sessions.size]).toEqual([hits, rows]);
      const previousTrust = w.store.installation?.trustFingerprint ?? '';
      await w.store.adminUpdate({ op: 'confirm-trust', previousTrust, trustFingerprint: oidc.trustFingerprint });
      expect(await changed.authenticate(request('/', [session]))).toEqual({ kind: 'signed-out', reason: 'revoked' });
      // The fixture serves only its own issuer, so a confirmed new issuer fails at discovery instead.
      expect((await changed.login(request('/auth/login'))).status).toBe(name === 'issuer' ? 503 : 302);
    });
  }
});

describe('races: generation fences in both orders', () => {
  const ops: Record<string, (w: Wiring, other: string) => Promise<unknown>> = {
    'logout-all': (w, other) => w.core.logoutAll(post('/auth/logout-all', other)),
    disable: (w) => w.store.adminUpdate({ op: 'disable' }),
    rebind: (w) => {
      const { binding = null, trustFingerprint: confirmTrust = '' } = w.store.installation ?? {};
      const confirm = { confirmBinding: binding ?? { issuer: '', subject: '' }, confirmTrust };
      return w.store.adminUpdate({ op: 'rebind', ...confirm, capabilityHash: hashSecret('c') });
    },
    'config change': (w) => {
      const previousTrust = w.store.installation?.trustFingerprint ?? '';
      return w.store.adminUpdate({ op: 'confirm-trust', previousTrust, trustFingerprint: 'f'.repeat(64) });
    },
  };
  for (const [name, op] of Object.entries(ops)) {
    test(`${name} before the issuing transaction denies the paused callback`, async () => {
      const w = await wire(issuer);
      const other = await signedIn(w);
      w.store.beforeIssue = async () => void (await op(w, other));
      const response = await signIn(w);
      expect([response.status, cookie(response, SESSION)]).toEqual([403, null]);
    });
    test(`${name} after commit, before the response is delivered, voids the delivered cookie`, async () => {
      const w = await wire(issuer);
      const other = await signedIn(w);
      w.store.afterIssue = async () => void (await op(w, other));
      const delivered = cookie(await signIn(w), SESSION);
      expect(delivered).not.toBeNull();
      expect(await kind(w, delivered)).not.toBe('active');
    });
  }

  test('committed S revoked from another profile before delivery never authorizes', async () => {
    const w = await wire(issuer);
    const other = await signedIn(w);
    w.store.afterIssue = async () =>
      void (await w.core.revoke(post('/', other), [...w.store.sessions.keys()].at(-1) ?? ''));
    const delivered = cookie(await signIn(w), SESSION);
    expect(await w.core.authenticate(request('/', [delivered]))).toEqual({ kind: 'signed-out', reason: 'revoked' });
  });

  test('an idempotent login response held across a logout with its cookie sets nothing; the id stays revoked', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    const held = await w.core.login(request('/auth/login', [session]));
    await w.core.logout(post('/auth/logout', session));
    expect([held.headers.getSetCookie().length, w.store.sessions.size, await kind(w, session)]).toEqual([
      0,
      1,
      'signed-out',
    ]);
  });

  test('a new login after logout-all may succeed', async () => {
    const w = await wire(issuer);
    const session = await signedIn(w);
    await w.core.logoutAll(post('/auth/logout-all', session));
    expect(await kind(w, session)).toBe('signed-out');
    expect(await kind(w, await signedIn(w))).toBe('active');
  });
});

describe('transactions and limits', () => {
  test('consume once: a replayed callback finds nothing and never reaches the token endpoint again', async () => {
    const w = await wire(issuer);
    const login = await w.core.login(request('/auth/login'));
    const query = w.issuer.authorize(login.headers.get('location') ?? '');
    const hits = w.issuer.hits.length;
    const call = () => w.core.callback(request(`/auth/callback?${query}`, [cookie(login, TX)]));
    const statuses = (await Promise.all([call(), call()])).map((r) => r.status).sort();
    expect(statuses).toEqual([303, 400]);
    expect(w.issuer.hits.slice(hits).filter((h) => h === '/token')).toEqual(['/token']);
  });

  test('one active transaction per browser; a callback without its cookie is refused', async () => {
    const w = await wire(issuer);
    const first = await w.core.login(request('/auth/login'));
    const second = await w.core.login(request('/auth/login', [cookie(first, TX)]));
    expect((await finish(w, first)).status).toBe(400);
    const query = w.issuer.authorize(second.headers.get('location') ?? '');
    expect((await w.core.callback(request(`/auth/callback?${query}`))).status).toBe(400);
  });

  test('ten-minute TTL and 128 entries bound memory', () => {
    let now = 0;
    const store = new TransactionStore(undefined, () => now);
    const fields = { state: 's', nonce: 'n', codeVerifier: 'v', purpose: 'login' as const, generation: 1 };
    const first = store.begin(null, fields);
    for (let i = 1; i < 128; i++) expect(store.begin(null, fields)).not.toBeNull();
    expect(store.begin(null, fields)).toBeNull();
    now = 10 * 60 * 1000;
    expect(store.consume(first?.id ?? null)).toBeNull();
    expect([store.begin(null, fields) !== null, store.size]).toEqual([true, 1]);
  });

  test('start, setup and body limits', async () => {
    const w = await wire(issuer, { core: { limits: { startsPerMinute: 1, setupsPerMinute: 1, setupBodyBytes: 64 } } });
    expect((await w.core.login(request('/auth/login'))).status).toBe(302);
    expect((await w.core.login(request('/auth/login'))).status).toBe(429);
    const setup = (body: string) => w.core.setup(request('/auth/setup', [], { method: 'POST', body }));
    expect((await setup(`capability=${'a'.repeat(100)}`)).status).toBe(413);
    expect((await setup('capability=x')).status).toBe(429);
  });

  test('concurrent provider exchanges are capped', async () => {
    const w = await wire(issuer, { core: { limits: { maxConcurrentExchanges: 1 } } });
    const [a, b] = [await w.core.login(request('/auth/login')), await w.core.login(request('/auth/login'))];
    let release = () => {};
    w.issuer.tokenGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = finish(w, a);
    await Bun.sleep(20);
    expect((await finish(w, b)).status).toBe(503);
    release();
    expect((await pending).status).toBe(303);
  });
});
