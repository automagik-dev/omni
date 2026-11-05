/**
 * Browser session core as Fetch handlers, routed by the app after its own Host, Origin and CSRF
 * checks. A valid session cookie never starts OIDC, issues or sets a cookie (login is idempotent:
 * same id, secret and deadline); a revoked, expired or unknown one on the login path answers
 * signed-out, and only a later explicit login without it starts a sign-in; an unreachable store is
 * 503. Sessions are a random id plus a 32-byte secret whose SHA-256 alone reaches the store, with
 * no refresh, rotation or successor. Cookies are `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/,
 * no Domain. Responses are no-store, no-referrer, return to `/`, never echo the callback query.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { OidcClient } from './oidc';
import {
  type ConnectStore,
  type IssuePurpose,
  type SessionDenial,
  type VerifiedIdentity,
  callStore,
} from './store-port';
import { type PendingTransaction, TransactionStore, randomToken, rateLimiter, readBoundedText } from './transactions';

export const RETURN_PATH = '/';
const SESSION_COOKIE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const CAPABILITY = /^[A-Za-z0-9_-]{27}$/;

export type CoreLimits = {
  startsPerMinute: number;
  setupsPerMinute: number;
  setupBodyBytes: number;
  maxConcurrentExchanges: number;
};
export const CORE_LIMITS: CoreLimits = {
  startsPerMinute: 30,
  setupsPerMinute: 5,
  setupBodyBytes: 2048,
  maxConcurrentExchanges: 8,
};

export interface ConnectCoreOptions {
  /** Names the cookies `__Host-<appName>_connect_session` and `__Host-<appName>_connect_tx`. */
  readonly appName: string;
  readonly store: ConnectStore;
  readonly oidc: OidcClient;
  /** Seconds. When set, setup and rebind send max_age and require a valid auth_time. */
  readonly setupMaxAge?: number;
  readonly limits?: Partial<CoreLimits>;
  readonly transactions?: TransactionStore;
  readonly now?: () => number;
}

export type AuthResult =
  | { kind: 'active'; sessionId: string; expiresAt: Date; csrfToken: string }
  | { kind: 'signed-out'; reason: 'no-cookie' | 'malformed' | 'invalid' | SessionDenial }
  | { kind: 'unavailable'; reason: 'store' | 'trust-mismatch' };
type Active = Extract<AuthResult, { kind: 'active' }>;

/** Hex SHA-256 of a session secret or setup capability: the only form the store sees. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** A one-use setup capability for the operator's terminal, and the hash the store keeps. */
export function newSetupCapability(): { capability: string; hash: string } {
  const capability = randomToken(20);
  return { capability, hash: hashSecret(capability) };
}

/** Constant-time equality; hashes and CSRF tokens compared here are fixed-length digests. */
function sameText(a: string, b: string): boolean {
  const [left, right] = [Buffer.from(a), Buffer.from(b)];
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The single value of a cookie; null when absent or sent more than once. */
function readCookie(request: Request, name: string): string | null {
  const parts = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim());
  const values = parts.filter((part) => part.startsWith(`${name}=`)).map((part) => part.slice(name.length + 1));
  return values.length === 1 ? (values[0] ?? null) : null;
}

function respond(status: number, body?: string, cookies: string[] = [], location?: string): Response {
  const headers = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  if (location) headers.set('location', location);
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  if (body !== undefined)
    headers.set('content-type', body.startsWith('{') ? 'application/json' : 'text/plain; charset=utf-8');
  return new Response(body ?? null, { status, headers });
}
const unavailable = (cookies: string[] = []) => respond(503, 'unavailable', cookies);

export class ConnectCore {
  readonly cookieNames: { readonly session: string; readonly transaction: string };
  readonly #store: ConnectStore;
  readonly #oidc: OidcClient;
  readonly #limits: CoreLimits;
  readonly #transactions: TransactionStore;
  /** Per core, so per installation, not per client: the app keys a per-client limit in front (Group 4). */
  readonly #starts: { take(): boolean };
  readonly #setups: { take(): boolean };
  readonly #setupMaxAge: number | undefined;
  #exchanges = 0;

  constructor(options: ConnectCoreOptions) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(options.appName)) throw new TypeError('appName must match [a-z][a-z0-9-]{0,31}');
    const now = options.now ?? Date.now;
    const prefix = `__Host-${options.appName}_connect`;
    this.cookieNames = { session: `${prefix}_session`, transaction: `${prefix}_tx` };
    this.#store = options.store;
    this.#oidc = options.oidc;
    this.#limits = { ...CORE_LIMITS, ...options.limits };
    this.#transactions = options.transactions ?? new TransactionStore(undefined, now);
    this.#starts = rateLimiter(this.#limits.startsPerMinute, 60_000, now);
    this.#setups = rateLimiter(this.#limits.setupsPerMinute, 60_000, now);
    this.#setupMaxAge = options.setupMaxAge;
  }

  #cookie(name: string, value: string, maxAgeSeconds: number): string {
    return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
  }

  #clearSession(): string[] {
    return [this.#cookie(this.cookieNames.session, '', 0)];
  }

  /** Reads the live session for this request; no positive result is ever cached. */
  async authenticate(request: Request): Promise<AuthResult> {
    if (!(request.headers.get('cookie') ?? '').includes(`${this.cookieNames.session}=`)) {
      return { kind: 'signed-out', reason: 'no-cookie' };
    }
    const [, sessionId = '', secret = ''] =
      SESSION_COOKIE.exec(readCookie(request, this.cookieNames.session) ?? '') ?? [];
    if (!sessionId) return { kind: 'signed-out', reason: 'malformed' };
    const result = await callStore(() => this.#store.resolveSession({ sessionId }));
    if (result.kind === 'unavailable') return { kind: 'unavailable', reason: 'store' };
    if (result.kind === 'denied') return { kind: 'signed-out', reason: result.reason };
    const { session } = result;
    if (session.id !== sessionId || !sameText(session.secretHash, hashSecret(secret))) {
      return { kind: 'signed-out', reason: 'invalid' };
    }
    if (session.expiresAt.getTime() <= session.storeNow.getTime()) return { kind: 'signed-out', reason: 'expired' };
    if (result.trustFingerprint !== this.#oidc.trustFingerprint)
      return { kind: 'unavailable', reason: 'trust-mismatch' };
    const csrfToken = createHash('sha256').update(`csrf:${secret}`).digest('base64url');
    return { kind: 'active', sessionId, expiresAt: session.expiresAt, csrfToken };
  }

  /** Session-bound CSRF check for mutations; the app serves the token from its session metadata. */
  verifyCsrf(auth: AuthResult, token: string | null): boolean {
    return auth.kind === 'active' && token !== null && sameText(auth.csrfToken, token);
  }

  /** GET /auth/login. */
  async login(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (auth.kind === 'active') return respond(303, undefined, [], RETURN_PATH);
    if (auth.kind === 'unavailable') return unavailable();
    if (auth.reason !== 'no-cookie') return respond(401, 'signed-out', this.#clearSession());
    if (!this.#starts.take()) return respond(429, 'busy');
    const read = await callStore(() => this.#store.readAuthority());
    if (read.kind === 'unavailable') return unavailable();
    if (read.kind === 'missing' || read.authority.state !== 'enrolled') return respond(403, 'not-enrolled');
    if (read.authority.trustFingerprint !== this.#oidc.trustFingerprint) return unavailable();
    return this.#redirect(request, 'login', read.authority.generation);
  }

  /** POST /auth/setup, after the app checked its setup form token; consumes the capability. */
  async setup(request: Request): Promise<Response> {
    if (!this.#setups.take()) return respond(429, 'busy');
    const body = await readBoundedText(request, this.#limits.setupBodyBytes);
    if (body === null) return respond(413, 'too-large');
    const capability = new URLSearchParams(body).get('capability')?.trim() ?? '';
    if (!CAPABILITY.test(capability)) return respond(403, 'setup-denied');
    const update = {
      op: 'consume-setup',
      capabilityHash: hashSecret(capability),
      trustFingerprint: this.#oidc.trustFingerprint,
    } as const;
    const result = await callStore(() => this.#store.adminUpdate(update));
    if (result.kind === 'unavailable') return unavailable();
    if (result.kind === 'denied') return respond(403, 'setup-denied');
    return this.#redirect(request, 'setup', result.generation);
  }

  async #redirect(request: Request, purpose: IssuePurpose, generation: number): Promise<Response> {
    const maxAge = purpose === 'setup' ? this.#setupMaxAge : undefined;
    const fields = { state: randomToken(), nonce: randomToken(), codeVerifier: randomToken(), purpose, generation };
    const tx = this.#transactions.begin(
      readCookie(request, this.cookieNames.transaction),
      maxAge === undefined ? fields : { ...fields, maxAge },
    );
    if (!tx) return respond(503, 'busy');
    try {
      const url = await this.#oidc.authorizationUrl(tx);
      return respond(302, undefined, [this.#cookie(this.cookieNames.transaction, tx.id, 600)], url.href);
    } catch {
      this.#transactions.consume(tx.id);
      return respond(503, 'provider-unavailable');
    }
  }

  /** GET /auth/callback. The transaction is consumed before the code is exchanged. */
  async callback(request: Request): Promise<Response> {
    const clearTx = [this.#cookie(this.cookieNames.transaction, '', 0)];
    const tx = this.#transactions.consume(readCookie(request, this.cookieNames.transaction));
    if (!tx) return respond(400, 'login-expired', clearTx);
    if (this.#exchanges >= this.#limits.maxConcurrentExchanges) return respond(503, 'busy', clearTx);
    this.#exchanges += 1;
    const exchanged = await this.#oidc.exchange(tx, new URL(request.url).searchParams).finally(() => {
      this.#exchanges -= 1;
    });
    if (exchanged.kind === 'unavailable') return respond(503, 'provider-unavailable', clearTx);
    if (exchanged.kind === 'rejected') return respond(401, 'signed-out', clearTx);
    return this.#issue(request, tx, exchanged.identity, clearTx);
  }

  async #issue(request: Request, tx: PendingTransaction, identity: VerifiedIdentity, clearTx: string[]) {
    const [sessionId, secret] = [randomToken(16), randomToken(32)];
    const userAgent = request.headers.get('user-agent')?.slice(0, 200) || null;
    const trustFingerprint = this.#oidc.trustFingerprint;
    const input = { purpose: tx.purpose, generation: tx.generation, trustFingerprint, identity, sessionId, userAgent };
    const result = await callStore(() => this.#store.issueSession({ ...input, secretHash: hashSecret(secret) }));
    if (result.kind === 'unavailable') return unavailable(clearTx);
    if (result.kind === 'denied') return respond(403, 'signed-out', clearTx);
    const maxAge = Math.max(0, Math.floor((result.expiresAt.getTime() - result.issuedAt.getTime()) / 1000));
    const session = this.#cookie(this.cookieNames.session, `${sessionId}.${secret}`, maxAge);
    return respond(303, undefined, [...clearTx, session], RETURN_PATH);
  }

  async #active(request: Request): Promise<Active | Response> {
    const auth = await this.authenticate(request);
    if (auth.kind === 'active') return auth;
    return auth.kind === 'unavailable' ? unavailable() : respond(401, 'signed-out', this.#clearSession());
  }

  /** POST /auth/logout: permanently revokes this session and clears its cookie. */
  async logout(request: Request): Promise<Response> {
    const auth = await this.authenticate(request);
    if (auth.kind === 'unavailable') return unavailable();
    const sessionId = auth.kind === 'active' ? auth.sessionId : null;
    const revoked = sessionId ? await callStore(() => this.#store.revokeSession({ sessionId })) : null;
    return revoked?.kind === 'unavailable' ? unavailable() : respond(204, undefined, this.#clearSession());
  }

  /** POST /auth/logout-all: advances the generation, revoking every session and pending login. */
  async logoutAll(request: Request): Promise<Response> {
    const auth = await this.#active(request);
    if (auth instanceof Response) return auth;
    const result = await callStore(() => this.#store.revokeAll());
    return result.kind === 'unavailable' ? unavailable() : respond(204, undefined, this.#clearSession());
  }

  /** POST /auth/sessions/:id/revoke. */
  async revoke(request: Request, sessionId: string): Promise<Response> {
    const auth = await this.#active(request);
    if (auth instanceof Response) return auth;
    const result = await callStore(() => this.#store.revokeSession({ sessionId }));
    if (result.kind === 'unavailable') return unavailable();
    if (result.kind === 'denied') return respond(404, 'not-found');
    return respond(204, undefined, sessionId === auth.sessionId ? this.#clearSession() : []);
  }

  /** GET /auth/sessions: the installation's active sessions, the caller's marked current. */
  async sessions(request: Request): Promise<Response> {
    const auth = await this.#active(request);
    if (auth instanceof Response) return auth;
    const read = await callStore(() => this.#store.readAuthority({ includeSessions: true }));
    if (read.kind !== 'ok') return unavailable();
    const sessions = (read.authority.sessions ?? []).map((s) => ({ ...s, current: s.id === auth.sessionId }));
    return respond(200, JSON.stringify({ sessions }));
  }
}

export function createConnectCore(options: ConnectCoreOptions): ConnectCore {
  return new ConnectCore(options);
}
