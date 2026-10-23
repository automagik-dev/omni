/**
 * QA matrix row Identity/bootstrap: every issuance path (login, and setup which rebind also uses)
 * accepts only a freshly exchanged, fully verified ID token; email never stands in for identity.
 * Test names are stable acceptance ids that run-required --require matches; rename them only with
 * the wish's evidence record.
 */
import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectConfigError, type OidcSettings, createOidcClient, readClientSecret } from '../src/oidc';
import { createConnectCore, newSetupCapability } from '../src/sessions';
import { CLIENT_ID, FakeIssuer, ISSUER, OWNER, OWNER_EMAIL, type TokenPlan } from './fake-issuer';
import {
  SESSION,
  TX,
  type Wiring,
  cookie,
  finish,
  request,
  secretFile,
  settings,
  signIn,
  startSetup,
  wire,
} from './setup';

let issuer: FakeIssuer;
beforeAll(async () => {
  issuer = await FakeIssuer.create();
});
const now = () => Math.floor(Date.now() / 1000);
const login = (w: Wiring) => w.core.login(request('/auth/login'));

const BAD_PROOFS: [string, TokenPlan, Parameters<typeof finish>[2]?][] = [
  ['wrong issuer', { claims: { iss: 'https://other-issuer.test' } }],
  ['wrong audience', { claims: { aud: 'another-client' } }],
  ['extra audience without azp', { claims: { aud: [CLIENT_ID, 'another-client'] } }],
  ['azp of another client', { claims: { azp: 'another-client' } }],
  ['forged signature', { forgeSignature: true }],
  ['algorithm other than the pinned one', { header: { alg: 'RS384' } }],
  ['iat older than the transaction start minus 60 s', { claims: { iat: now() - 121 } }],
  ['iat in the future', { claims: { iat: now() + 3600 } }],
  ['expired ID token', { claims: { exp: now() - 120 } }],
  ['nonce of another transaction', { claims: { nonce: 'another-nonce' } }],
  ['state of another transaction', {}, { state: 'another-state' }],
  [
    'PKCE challenge the transaction never made',
    {},
    { tamper: (u) => u.searchParams.set('code_challenge', 'x'.repeat(43)) },
  ],
  ['missing required group', { claims: { groups: ['someone-else'] } }],
  ['group only implied by email', { claims: { groups: undefined, email: 'studio-owners@example.test' } }],
  ['empty subject', { claims: { sub: '' } }],
];

describe('identity: bad proofs deny on every issuance path', () => {
  for (const purpose of ['login', 'setup'] as const) {
    for (const [name, plan, callback] of BAD_PROOFS) {
      test(`${purpose}: ${name}`, async () => {
        const w = await wire(issuer, { enrolled: purpose === 'login' });
        const begun = purpose === 'login' ? await login(w) : await startSetup(w);
        expect(begun.status).toBe(302);
        w.issuer.plan = plan;
        const response = await finish(w, begun, callback);
        expect(response.status).toBe(401);
        expect(cookie(response, SESSION)).toBeNull();
        expect(w.store.calls).not.toContain('issueSession');
        expect(w.store.installation?.binding).toEqual(purpose === 'login' ? OWNER : null);
      });
    }
  }
});

describe('identity: verified proofs', () => {
  test('login binds exact issuer and subject, keeps no provider token and never calls UserInfo', async () => {
    const w = await wire(issuer);
    const spy = spyOn(w.store, 'issueSession');
    const response = await signIn(w);
    expect(response.status).toBe(303);
    expect(cookie(response, SESSION)).not.toBeNull();
    const input = spy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    const keys = ['generation', 'identity', 'purpose', 'secretHash', 'sessionId', 'trustFingerprint', 'userAgent'];
    expect(Object.keys(input).sort()).toEqual(keys);
    expect(input.identity).toEqual({ issuer: ISSUER, subject: OWNER.subject });
    expect(JSON.stringify(input)).not.toMatch(/fixture-(refresh|access)|@example\.test|eyJ/);
    expect(w.issuer.hits).not.toContain('/userinfo');
    expect(w.issuer.hits).toContain('/token');
  });

  test('an email twin with another subject is denied at the binding check', async () => {
    const w = await wire(issuer);
    const response = await signIn(w, { claims: { sub: 'twin-subject', email: OWNER_EMAIL } });
    expect(response.status).toBe(403);
    expect(cookie(response, SESSION)).toBeNull();
    expect(w.store.sessions.size).toBe(0);
  });

  test('setup binds the verified identity and issues its session', async () => {
    const w = await wire(issuer, { enrolled: false });
    const response = await finish(w, await startSetup(w));
    expect(response.status).toBe(303);
    expect(cookie(response, SESSION)).not.toBeNull();
    expect(w.store.installation).toMatchObject({ binding: OWNER, state: 'enrolled' });
  });

  test('concurrent setup posts of one capability bind once', async () => {
    const w = await wire(issuer, { enrolled: false });
    const { capability, hash } = newSetupCapability();
    await w.store.adminUpdate({ op: 'bootstrap', capabilityHash: hash });
    const post = () => w.core.setup(request('/auth/setup', [], { method: 'POST', body: `capability=${capability}` }));
    const responses = await Promise.all([post(), post(), post()]);
    expect(responses.map((r) => r.status).sort()).toEqual([302, 403, 403]);
  });
});

describe('identity: max_age and auth_time', () => {
  test('ordinary login does not request max_age', async () => {
    const url = new URL((await login(await wire(issuer))).headers.get('location') ?? '');
    expect(url.searchParams.has('max_age')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://studio.test/auth/callback');
  });

  const cases: [string, Record<string, unknown>, number][] = [
    ['valid auth_time is accepted', {}, 303],
    ['missing auth_time denies', { auth_time: undefined }, 401],
    ['auth_time older than max_age denies', { auth_time: now() - 3600 }, 401],
    ['auth_time in the future denies', { auth_time: now() + 3600 }, 401],
  ];
  for (const [name, claims, status] of cases) {
    test(`setup with max_age=300: ${name}`, async () => {
      const w = await wire(issuer, { enrolled: false, core: { setupMaxAge: 300 } });
      const begun = await startSetup(w);
      expect(new URL(begun.headers.get('location') ?? '').searchParams.get('max_age')).toBe('300');
      w.issuer.plan = { claims };
      expect((await finish(w, begun)).status).toBe(status);
    });
  }
});

describe('identity: configuration and provider bounds', () => {
  test('settings refuse non-https, non-canonical and symmetric choices; there is no default issuer', () => {
    const bad: Partial<OidcSettings>[] = [
      { issuer: 'http://issuer.test' },
      { issuer: `${ISSUER}/.well-known/openid-configuration` },
      { origin: 'https://studio.test/app' },
      { origin: 'http://studio.test' },
      { idTokenAlg: 'HS256' },
      { scope: 'profile' },
      { issuer: undefined },
    ];
    for (const extra of bad) expect(() => createOidcClient(settings(extra))).toThrow(ConnectConfigError);
    const src = join(import.meta.dir, '../src');
    const sources = readdirSync(src).map((f) => readFileSync(join(src, f), 'utf8'));
    expect(sources.join('\n')).not.toMatch(/lembr|process\.env|Bun\.env/);
  });

  test('the client secret file must be private and hold one secret', () => {
    expect(() => readClientSecret(secretFile(0o644))).toThrow(ConnectConfigError);
    expect(() => readClientSecret(secretFile(0o600, 'two words'))).toThrow(ConnectConfigError);
    expect(readClientSecret(secretFile())).toBe('fixture-secret-not-real');
  });

  test('issuer outage at login is 503 and starts no transaction', async () => {
    const w = await wire(issuer);
    w.issuer.down = true;
    const response = await login(w);
    expect(response.status).toBe(503);
    expect(cookie(response, TX)).toBeNull();
  });

  test('a JWKS larger than the size cap is provider-unavailable, never a grant', async () => {
    const w = await wire(issuer, { oidc: { providerMaxBytes: 4096 } });
    const begun = await login(w);
    w.issuer.jwksPadding = 8192;
    expect((await finish(w, begun)).status).toBe(503);
    expect(w.store.calls).not.toContain('issueSession');
  });

  test('a provider that never answers times out to 503', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const oidc = createOidcClient(settings({ providerTimeoutMs: 200 }), { fetch: hang });
    const core = createConnectCore({ appName: 'brain', store: (await wire(issuer)).store, oidc });
    const started = Date.now();
    expect((await core.login(request('/auth/login'))).status).toBe(503);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('TLS stays verified when NODE_TLS_REJECT_UNAUTHORIZED=0 is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'connect-tls-'));
    const [key, cert] = [join(dir, 'key.pem'), join(dir, 'cert.pem')];
    const subject = ['-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-days', '1', '-nodes'];
    const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-keyout', key, '-out', cert];
    expect(spawnSync('openssl', ['req', '-x509', ...ec, ...subject]).status).toBe(0);
    const tls = { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
    let base = '';
    const doc = () => ({
      issuer: base,
      authorization_endpoint: `${base}/a`,
      token_endpoint: `${base}/t`,
      jwks_uri: `${base}/j`,
    });
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', tls, fetch: () => Response.json(doc()) });
    base = `https://localhost:${server.port}`;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      expect((await fetch(`${base}/.well-known/openid-configuration`)).status).toBe(200);
      const oidc = createOidcClient(settings({ issuer: base }));
      const tx = {
        id: 'i',
        state: 's',
        nonce: 'n',
        codeVerifier: 'v'.repeat(43),
        purpose: 'login',
        generation: 1,
        startedAt: 0,
      } as const;
      const chain: string[] = [];
      let error: unknown = await oidc.authorizationUrl(tx).then(
        () => null,
        (e: unknown) => e,
      );
      for (; error instanceof Error; error = error.cause) chain.push(`${error.name}: ${error.message}`);
      expect(chain.join(' | ')).toMatch(/ProviderUnavailableError.*self.signed certificate/i);
    } finally {
      Reflect.deleteProperty(process.env, 'NODE_TLS_REJECT_UNAUTHORIZED');
      server.stop(true);
    }
  });
});
