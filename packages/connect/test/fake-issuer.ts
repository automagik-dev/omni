/**
 * In-process OpenID Connect issuer: generated RSA keys, discovery, JWKS, an authorize step the test
 * plays, and a token endpoint that checks client_secret_basic, the exact redirect URI, one-use
 * codes and the PKCE S256 verifier. It answers through an injected fetch, so no socket is opened.
 * Every identifier is synthetic.
 */
import { createHash } from 'node:crypto';

export const ISSUER = 'https://issuer.test';
export const CLIENT_ID = 'connect-fixture-client';
export const CLIENT_SECRET = 'fixture-secret-not-real';
export const OWNER = { issuer: ISSUER, subject: 'owner-subject-1' };
export const OWNER_EMAIL = 'owner@example.test';

type Claims = Record<string, unknown>;
/** Claims merge over the defaults (`undefined` removes one); forgeSignature signs with an unpublished key. */
export type TokenPlan = { claims?: Claims; header?: Claims; forgeSignature?: boolean };
type Grant = { challenge: string; nonce: string; redirectUri: string; claims: Claims };

const b64 = (data: string | ArrayBuffer) =>
  Buffer.from(typeof data === 'string' ? data : new Uint8Array(data)).toString('base64url');
const json = (body: unknown, status = 200) => Response.json(body, { status });
const RSA = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

export class FakeIssuer {
  readonly hits: string[] = [];
  plan: TokenPlan = {};
  down = false;
  /** Padding added to the JWKS response, to exceed a size cap. */
  jwksPadding = 0;
  /** When set, the token endpoint waits for it, holding an exchange open. */
  tokenGate: Promise<void> | null = null;
  readonly #codes = new Map<string, Grant>();

  private constructor(
    private readonly key: CryptoKeyPair,
    private readonly stranger: CryptoKeyPair,
    private readonly jwk: Claims,
  ) {}

  static async create(): Promise<FakeIssuer> {
    const [key, stranger] = (await Promise.all(
      [1, 2].map(() => crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])),
    )) as CryptoKeyPair[];
    if (!key || !stranger) throw new Error('key generation failed');
    return new FakeIssuer(key, stranger, (await crypto.subtle.exportKey('jwk', key.publicKey)) as Claims);
  }

  /** Plays the user at the authorization endpoint; returns the query the issuer sends back. */
  authorize(authorizationUrl: string, claims: Claims = {}, state?: string): URLSearchParams {
    const url = new URL(authorizationUrl);
    const p = url.searchParams;
    if (url.origin + url.pathname !== `${ISSUER}/authorize` || p.get('client_id') !== CLIENT_ID)
      throw new Error('wrong authorize');
    const code = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const authTime = p.has('max_age') ? { auth_time: Math.floor(Date.now() / 1000) - 5 } : {};
    const [challenge, nonce, redirectUri] = ['code_challenge', 'nonce', 'redirect_uri'].map((k) => p.get(k) ?? '');
    const grant = { challenge: challenge ?? '', nonce: nonce ?? '', redirectUri: redirectUri ?? '' };
    this.#codes.set(code, { ...grant, claims: { ...authTime, ...claims } });
    return new URLSearchParams({ code, state: state ?? p.get('state') ?? '', iss: ISSUER });
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    this.hits.push(path);
    if (this.down) throw new TypeError('fetch failed: issuer unreachable');
    if (path === '/token') return this.#token(init);
    if (path === '/jwks')
      return json({ keys: [{ ...this.jwk, kid: 'k1', alg: 'RS256', use: 'sig' }], pad: 'x'.repeat(this.jwksPadding) });
    if (path !== '/.well-known/openid-configuration') return json({ error: 'not_found' }, 404);
    const endpoints = { authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token` };
    const supported = { response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'] };
    return json({
      issuer: ISSUER,
      ...endpoints,
      jwks_uri: `${ISSUER}/jwks`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      ...supported,
    });
  };

  async #token(init: RequestInit): Promise<Response> {
    await this.tokenGate;
    const body = new URLSearchParams(String(init.body));
    const auth = new Headers(init.headers).get('authorization') ?? '';
    // RFC 6749 2.3.1: Basic over the form-urlencoded client id and secret.
    const [user, pass] = atob(auth.replace(/^Basic /, ''))
      .split(':')
      .map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
    const grant = this.#codes.get(body.get('code') ?? '');
    this.#codes.delete(body.get('code') ?? '');
    const challenge = createHash('sha256')
      .update(body.get('code_verifier') ?? '')
      .digest('base64url');
    if (!auth.startsWith('Basic ') || user !== CLIENT_ID || pass !== CLIENT_SECRET || body.has('client_secret')) {
      return json({ error: 'invalid_client' }, 401);
    }
    if (body.get('grant_type') !== 'authorization_code' || grant?.redirectUri !== body.get('redirect_uri')) {
      return json({ error: 'invalid_grant' }, 400);
    }
    if (grant.challenge !== challenge) return json({ error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const defaults = { iss: ISSUER, sub: OWNER.subject, aud: CLIENT_ID, iat: now, exp: now + 300, nonce: grant.nonce };
    const claims = { ...defaults, email: OWNER_EMAIL, groups: ['studio-owners'], ...grant.claims, ...this.plan.claims };
    const id_token = await this.#sign(claims);
    const tokens = {
      access_token: 'fixture-access',
      refresh_token: 'fixture-refresh',
      token_type: 'Bearer',
      expires_in: 300,
    };
    return json({ ...tokens, id_token });
  }

  async #sign(claims: Claims): Promise<string> {
    const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...this.plan.header }));
    const payload = b64(JSON.stringify(claims));
    const key = this.plan.forgeSignature ? this.stranger.privateKey : this.key.privateKey;
    return `${head}.${payload}.${b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, Buffer.from(`${head}.${payload}`)))}`;
  }
}
