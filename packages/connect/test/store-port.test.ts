/**
 * The store port contract on the reference model, and the core's fail-closed use of it: every port
 * failure denies, no path falls through to issuance, resource answers carry the full context.
 * Test names are stable acceptance ids that run-required --require matches; rename them only with
 * the wish's evidence record.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { hashSecret } from '../src/sessions';
import { type ConnectStore, type IssueSessionInput, callStore } from '../src/store-port';
import { FakeIssuer, OWNER } from './fake-issuer';
import { MemoryStore, SESSION_DAYS } from './memory-store';
import { SESSION, type Wiring, cookie, finish, request, signIn, startSetup, wire } from './setup';

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await FakeIssuer.create();
});
const TRUST = 'a'.repeat(64);
const UNAVAILABLE = { kind: 'unavailable' } as const;
const denied = <R extends string>(reason: R) => ({ kind: 'denied' as const, reason });
const idOf = (session: string | null) => session?.split('=')[1]?.split('.')[0] ?? '';

async function installation(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.adminUpdate({ op: 'init', installationId: 'inst-1', trustFingerprint: TRUST });
  return store;
}
function issue(generation: number, extra: Partial<IssueSessionInput> = {}): IssueSessionInput {
  const id = { sessionId: `s-${Math.random()}`, secretHash: hashSecret('x'), userAgent: null };
  return { purpose: 'setup', generation, trustFingerprint: TRUST, identity: OWNER, ...id, ...extra };
}

describe('store port: installation, setup and generation', () => {
  test('a missing installation is `missing`, never an open door', async () => {
    const w = await wire(issuer);
    w.store.installation = null;
    expect(await w.store.readAuthority()).toEqual({ kind: 'missing' });
    const login = await w.core.login(request('/auth/login'));
    expect([login.status, login.headers.get('location')]).toEqual([403, null]);
    expect(w.store.calls).not.toContain('issueSession');
  });

  test('a setup capability is one-use, lives 15 minutes, and bootstrap cancels the previous one', async () => {
    const store = await installation();
    const consume = (h: string) =>
      store.adminUpdate({ op: 'consume-setup', capabilityHash: h, trustFingerprint: TRUST });
    const bootstrap = (h: string) => store.adminUpdate({ op: 'bootstrap', capabilityHash: h });
    await bootstrap('h1');
    await bootstrap('h2');
    expect(await consume('h1')).toEqual(denied('invalid-capability'));
    await bootstrap('h3');
    store.now += 15 * 60 * 1000;
    expect(await consume('h3')).toEqual(denied('invalid-capability'));
    expect(await consume('h4')).toEqual(denied('invalid-capability'));
    const fresh = await bootstrap('h4');
    expect(await consume('h4')).toEqual(fresh);
    expect(await consume('h4')).toEqual(denied('invalid-capability'));
  });

  test('concurrent setup issuance binds exactly once', async () => {
    const store = await installation();
    await store.adminUpdate({ op: 'bootstrap', capabilityHash: 'h' });
    const r = await store.adminUpdate({ op: 'consume-setup', capabilityHash: 'h', trustFingerprint: TRUST });
    const g = r.kind === 'ok' ? r.generation : -1;
    const other = { identity: { issuer: OWNER.issuer, subject: 'someone-else' } };
    const results = await Promise.all([store.issueSession(issue(g)), store.issueSession(issue(g, other))]);
    expect(results.map((x) => x.kind).sort()).toEqual(['denied', 'issued']);
    expect(store.installation?.binding).toEqual(OWNER);
  });

  test('issuance needs the snapshot generation, trust and exact binding; deadline is 7 days of store time', async () => {
    const store = await installation();
    Object.assign(store.installation ?? {}, { state: 'enrolled', binding: OWNER });
    const g = store.installation?.generation ?? 0;
    const login = (extra: Partial<IssueSessionInput>) => store.issueSession(issue(g, { purpose: 'login', ...extra }));
    expect(await login({ generation: g - 1 })).toEqual(denied('stale-generation'));
    expect(await login({ trustFingerprint: 'b'.repeat(64) })).toEqual(denied('trust-mismatch'));
    const twin = { issuer: 'https://other.test', subject: OWNER.subject };
    expect(await login({ identity: twin })).toEqual(denied('identity-mismatch'));
    const ok = await login({});
    expect(ok.kind === 'issued' && ok.expiresAt.getTime() - ok.issuedAt.getTime()).toBe(SESSION_DAYS * 86_400_000);
  });

  test('revocation is permanent: rebind, bootstrap and re-enrolment never revive a session', async () => {
    const w = await wire(issuer);
    const id = idOf(cookie(await signIn(w), SESSION));
    expect(await w.store.revokeSession({ sessionId: id })).toEqual({ kind: 'revoked' });
    const confirm = { confirmBinding: OWNER, confirmTrust: w.store.installation?.trustFingerprint ?? '' };
    const wrong = { ...confirm, confirmBinding: { ...OWNER, subject: 'x' } };
    expect(await w.store.adminUpdate({ op: 'rebind', ...wrong, capabilityHash: 'h' })).toEqual(
      denied('confirmation-mismatch'),
    );
    expect((await w.store.adminUpdate({ op: 'rebind', ...confirm, capabilityHash: 'h' })).kind).toBe('ok');
    expect((await finish(w, await startSetup(w))).status).toBe(303);
    expect(await w.store.resolveSession({ sessionId: id })).toEqual(denied('revoked'));
  });

  test('revokeAll advances the generation and revokes every session', async () => {
    const w = await wire(issuer);
    const session = cookie(await signIn(w), SESSION);
    const before = w.store.installation?.generation ?? 0;
    expect(await w.store.revokeAll()).toEqual({ kind: 'revoked', generation: before + 1 });
    expect((await w.core.authenticate(request('/', [session]))).kind).toBe('signed-out');
  });
});

describe('store port: failures deny', () => {
  test('callStore turns throws and malformed answers into unavailable, never a grant', async () => {
    const answer = (value: unknown) => callStore(() => Promise.resolve(value as { kind: 'authorized' }));
    expect(await callStore(() => Promise.reject(new Error('down')))).toEqual(UNAVAILABLE);
    expect([await answer(undefined), await answer({}), await answer(null)]).toEqual([
      UNAVAILABLE,
      UNAVAILABLE,
      UNAVAILABLE,
    ]);
  });

  const post = (path: string, session: string | null, body?: string) =>
    request(path, [session], { method: 'POST', body });
  const paths: [string, (w: Wiring, session: string | null) => Promise<Response>][] = [
    ['login start', (w) => w.core.login(request('/auth/login'))],
    ['logout', (w, s) => w.core.logout(post('/auth/logout', s))],
    ['logout-all', (w, s) => w.core.logoutAll(post('/auth/logout-all', s))],
    ['session list', (w, s) => w.core.sessions(request('/auth/sessions', [s]))],
    ['setup', (w) => w.core.setup(post('/auth/setup', null, `capability=${'a'.repeat(27)}`))],
  ];
  for (const [name, call] of paths) {
    test(`unreachable store on ${name} is 503 without a session cookie`, async () => {
      const w = await wire(issuer);
      const session = cookie(await signIn(w), SESSION);
      w.store.broken = true;
      const response = await call(w, session);
      expect([response.status, cookie(response, SESSION)]).toEqual([503, null]);
    });
  }

  test('an active answer for another session id or a passed deadline is still refused', async () => {
    const w = await wire(issuer);
    const session = cookie(await signIn(w), SESSION);
    const resolve = w.store.resolveSession.bind(w.store);
    const lie = (patch: object) => {
      w.store.resolveSession = async (input) => {
        const result = await resolve(input);
        return result.kind === 'active' ? { ...result, session: { ...result.session, ...patch } } : result;
      };
    };
    lie({ id: 'x'.repeat(22) });
    expect(await w.core.authenticate(request('/', [session]))).toEqual({ kind: 'signed-out', reason: 'invalid' });
    lie({ expiresAt: new Date(w.store.now) });
    expect(await w.core.authenticate(request('/', [session]))).toEqual({ kind: 'signed-out', reason: 'expired' });
  });

  test('a store that fails while issuing answers 503 and sets no session', async () => {
    const w = await wire(issuer);
    w.store.beforeIssue = async () => {
      w.store.broken = true;
    };
    const response = await signIn(w);
    expect([response.status, cookie(response, SESSION)]).toEqual([503, null]);
  });
});

describe('store port: resources are app policy carried as full context', () => {
  test('admitBrain and authorizeBrain return the exact registry context; a changed row denies', async () => {
    const w = await wire(issuer);
    const sessionId = idOf(cookie(await signIn(w), SESSION));
    const row = { brainId: 'b1', createdAt: '2026-01-01', ownerType: 'user', ownerId: 'studio', home: '/fixture/a' };
    w.store.registry.set('b1', row);
    const port: ConnectStore = w.store;
    const input = { brainId: 'b1', originSessionId: sessionId, targetHome: row.home } as const;
    expect((await port.admitBrain({ ...input, provenance: 'studio-created' })).kind).toBe('admitted');
    const context = { ...row, installationId: 'inst-1', admissionId: 'adm-b1', provenance: 'studio-created' as const };
    expect(await port.authorizeBrain({ sessionId, brainId: 'b1' })).toEqual({ kind: 'authorized', context });
    w.store.registry.set('b1', { ...row, home: '/fixture/b' });
    expect(await port.authorizeBrain({ sessionId, brainId: 'b1' })).toEqual(denied('registry-changed'));
    w.store.broken = true;
    expect(await callStore(() => port.authorizeBrain({ sessionId, brainId: 'b1' }))).toEqual(UNAVAILABLE);
  });
});
