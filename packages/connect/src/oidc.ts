/**
 * OpenID Connect relying party for one exact issuer and one confidential client: authorization
 * code with PKCE S256, state, nonce, the exact callback `<origin>/auth/callback`, client_secret_basic.
 *
 * Every identity comes from a freshly exchanged ID token. openid-client checks the pinned alg,
 * iss, aud, exp, nonce, state and a requested max_age, and (with its non-repudiation checks
 * enabled here) the signature against the issuer's JWKS; this module checks again the exact
 * issuer, audience, azp, subject, iat (not older than the transaction start minus 60 s, not in
 * the future), auth_time and the required group. No UserInfo, no token-exchange input, no email
 * authority; the token response is dropped once the identity is read.
 *
 * Provider traffic is https only, without redirects, with a timeout and a response size cap, and
 * TLS verification forced on: NODE_TLS_REJECT_UNAUTHORIZED=0 cannot turn it off for this client.
 * openid-client keeps the JWKS at most five minutes and refetches at most once a minute on an
 * unknown key id. There is no default issuer and nothing is read from the environment.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as client from 'openid-client';
import type { VerifiedIdentity } from './store-port';
import { type PendingTransaction, readCapped } from './transactions';

export const CALLBACK_PATH = '/auth/callback';
/** Largest clock difference accepted between this host and the issuer, in seconds. */
export const MAX_SKEW_SECONDS = 60;
const ASYMMETRIC_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
/** Implicit, hybrid and JARM response parameters are refused at a code-flow callback. */
const FORBIDDEN_CALLBACK_PARAMS = ['id_token', 'access_token', 'token', 'response'];

export interface OidcSettings {
  /** The exact issuer identifier (https). */
  readonly issuer: string;
  readonly clientId: string;
  /** Absolute path of a file holding only the client secret, mode 600. */
  readonly clientSecretFile: string;
  /** The app's canonical https origin, such as https://studio.example. */
  readonly origin: string;
  /** When set, the ID token's groups claim must list this exact value. */
  readonly requiredGroup?: string;
  readonly groupsClaim?: string;
  readonly idTokenAlg?: string;
  readonly scope?: string;
  readonly providerTimeoutMs?: number;
  readonly providerMaxBytes?: number;
}
type Resolved = Required<Omit<OidcSettings, 'requiredGroup'>> & { requiredGroup: string | null };
export type FetchLike = (url: string, init: BunFetchRequestInit) => Promise<Response>;
/** `fetch` defaults to the platform fetch, which verifies TLS; tests pass an in-process issuer. */
export type OidcDependencies = { fetch?: FetchLike; now?: () => number };

type ClaimReason = 'issuer' | 'audience' | 'azp' | 'subject' | 'iat' | 'auth-time' | 'group';
export type RejectReason = ClaimReason | 'callback-parameters' | 'provider-proof' | 'no-id-token';
export type ExchangeResult =
  | { kind: 'verified'; identity: VerifiedIdentity }
  | { kind: 'rejected'; reason: RejectReason }
  | { kind: 'unavailable' };

export interface OidcClient {
  readonly redirectUri: string;
  /** Digest of issuer, client, origin and group policy; a change needs local confirmation. */
  readonly trustFingerprint: string;
  authorizationUrl(tx: PendingTransaction): Promise<URL>;
  exchange(tx: PendingTransaction, callbackQuery: URLSearchParams): Promise<ExchangeResult>;
}

export class ConnectConfigError extends Error {
  override readonly name = 'ConnectConfigError';
}
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';
}

function httpsUrl(value: unknown, name: string): URL {
  const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new ConnectConfigError(`${name} must be an https URL without credentials, query or fragment`);
  }
  return url;
}

function text(value: unknown, name: string, fallback?: string): string {
  const v = value ?? fallback;
  if (typeof v !== 'string' || v === '' || v.length > 255 || /\s/.test(v)) {
    throw new ConnectConfigError(`${name} must be a non-empty string without whitespace`);
  }
  return v;
}

function int(value: unknown, name: string, fallback: number, min: number, max: number): number {
  const v = value ?? fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ConnectConfigError(`${name} must be an integer from ${min} to ${max}`);
  }
  return v;
}

/** Validates explicit settings. */
export function validateOidcSettings(input: OidcSettings): Resolved {
  if (httpsUrl(input.issuer, 'issuer').href.includes('/.well-known/')) {
    throw new ConnectConfigError('issuer must be the issuer identifier');
  }
  if (input.origin !== httpsUrl(input.origin, 'origin').origin) {
    throw new ConnectConfigError('origin must be a canonical origin such as https://host');
  }
  if (typeof input.clientSecretFile !== 'string' || !isAbsolute(input.clientSecretFile)) {
    throw new ConnectConfigError('clientSecretFile must be an absolute path');
  }
  const idTokenAlg = text(input.idTokenAlg, 'idTokenAlg', 'RS256');
  if (!ASYMMETRIC_ALGS.includes(idTokenAlg)) throw new ConnectConfigError('idTokenAlg must be an asymmetric JWS alg');
  const scope = input.scope ?? 'openid';
  if (typeof scope !== 'string' || !scope.split(' ').includes('openid'))
    throw new ConnectConfigError('scope needs openid');
  return {
    issuer: input.issuer,
    clientId: text(input.clientId, 'clientId'),
    clientSecretFile: input.clientSecretFile,
    origin: input.origin,
    requiredGroup: input.requiredGroup === undefined ? null : text(input.requiredGroup, 'requiredGroup'),
    groupsClaim: text(input.groupsClaim, 'groupsClaim', 'groups'),
    idTokenAlg,
    scope,
    providerTimeoutMs: int(input.providerTimeoutMs, 'providerTimeoutMs', 10_000, 100, 60_000),
    providerMaxBytes: int(input.providerMaxBytes, 'providerMaxBytes', 256 * 1024, 1024, 4 * 1024 * 1024),
  };
}

/** Reads the client secret from a regular file only its owner can read or write. */
export function readClientSecret(path: string): string {
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new ConnectConfigError('clientSecretFile must be a regular file readable by its owner only (mode 600)');
  }
  const secret = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  if (secret === '' || /\s/.test(secret)) throw new ConnectConfigError('clientSecretFile must hold one secret');
  return secret;
}

function boundedFetch(inner: FetchLike, timeoutMs: number, maxBytes: number): client.CustomFetch {
  return async (url, options) => {
    if (!url.startsWith('https://')) throw new ProviderUnavailableError('provider endpoint is not https');
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
    try {
      // A Uint8Array body is copied into an ArrayBuffer-backed one, which every lib accepts as BodyInit.
      const body = options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body;
      const init = { ...options, body, redirect: 'manual', signal, tls: { rejectUnauthorized: true } } as const;
      const response = await inner(url, init);
      const bytes = await readCapped(response.body, maxBytes);
      if (bytes === null) throw new ProviderUnavailableError('provider response exceeds the size cap');
      return new Response(bytes, { status: response.status, headers: response.headers });
    } catch (cause) {
      throw cause instanceof ProviderUnavailableError
        ? cause
        : new ProviderUnavailableError('provider request failed', { cause });
    }
  };
}

/** True when the provider failed rather than the proof: network, timeout, size cap or 5xx. */
function providerDown(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e instanceof Error; depth += 1) {
    if (e instanceof ProviderUnavailableError || e.name === 'TimeoutError' || e.name === 'AbortError') return true;
    if (e instanceof client.ResponseBodyError && e.status >= 500) return true;
    if (e.cause instanceof Response && e.cause.status >= 500) return true;
    e = e.cause;
  }
  return false;
}

function checkClaims(s: Resolved, claims: client.IDToken, tx: PendingTransaction, nowMs: number): ExchangeResult {
  const reject = (reason: RejectReason): ExchangeResult => ({ kind: 'rejected', reason });
  const now = nowMs / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== s.issuer) return reject('issuer');
  if (!aud.includes(s.clientId)) return reject('audience');
  if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== s.clientId) return reject('azp');
  if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 255) return reject('subject');
  if (claims.iat < tx.startedAt / 1000 - MAX_SKEW_SECONDS || claims.iat > now + MAX_SKEW_SECONDS) return reject('iat');
  const at = claims.auth_time;
  const authTimeOk =
    typeof at === 'number' && at <= now + MAX_SKEW_SECONDS && now - at <= (tx.maxAge ?? 0) + MAX_SKEW_SECONDS;
  if (tx.maxAge !== undefined && !authTimeOk) return reject('auth-time');
  const groups = claims[s.groupsClaim];
  if (s.requiredGroup !== null && !(Array.isArray(groups) && groups.includes(s.requiredGroup))) return reject('group');
  return { kind: 'verified', identity: { issuer: claims.iss, subject: claims.sub } };
}

export function createOidcClient(settings: OidcSettings, deps: OidcDependencies = {}): OidcClient {
  const s = validateOidcSettings(settings);
  const auth = client.ClientSecretBasic(readClientSecret(s.clientSecretFile));
  const now = deps.now ?? Date.now;
  const options: client.DiscoveryRequestOptions = {
    [client.customFetch]: boundedFetch(deps.fetch ?? fetch, s.providerTimeoutMs, s.providerMaxBytes),
    timeout: Math.ceil(s.providerTimeoutMs / 1000),
    // Off by default: openid-client otherwise trusts TLS for ID tokens from the token endpoint.
    execute: [client.enableNonRepudiationChecks],
  };
  const redirectUri = `${s.origin}${CALLBACK_PATH}`;
  const material = [s.issuer, s.clientId, s.origin, s.requiredGroup, s.groupsClaim, s.idTokenAlg];
  let cached: Promise<client.Configuration> | undefined;

  const configuration = (): Promise<client.Configuration> => {
    if (cached) return cached;
    const pending = client.discovery(
      new URL(s.issuer),
      s.clientId,
      { id_token_signed_response_alg: s.idTokenAlg },
      auth,
      options,
    );
    const checked = pending.then((config) => {
      const meta = config.serverMetadata();
      const endpoints = [meta.authorization_endpoint, meta.token_endpoint, meta.jwks_uri];
      if (meta.issuer !== s.issuer || !endpoints.every((e) => e?.startsWith('https://'))) {
        throw new ProviderUnavailableError('discovery document does not match the configured issuer');
      }
      return config;
    });
    checked.catch(() => {
      if (cached === checked) cached = undefined;
    });
    cached = checked;
    return checked;
  };

  return {
    redirectUri,
    trustFingerprint: createHash('sha256').update(JSON.stringify(material)).digest('hex'),
    async authorizationUrl(tx) {
      const params: Record<string, string> = {
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: s.scope,
        state: tx.state,
        nonce: tx.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(tx.codeVerifier),
        code_challenge_method: 'S256',
      };
      if (tx.maxAge !== undefined) params.max_age = String(tx.maxAge);
      return client.buildAuthorizationUrl(await configuration(), params);
    },
    async exchange(tx, query) {
      if ([...query.keys()].some((k) => FORBIDDEN_CALLBACK_PARAMS.includes(k) || query.getAll(k).length > 1)) {
        return { kind: 'rejected', reason: 'callback-parameters' };
      }
      const callbackUrl = new URL(`${redirectUri}?${query}`);
      const checks = {
        pkceCodeVerifier: tx.codeVerifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      };
      try {
        const grant = tx.maxAge === undefined ? checks : { ...checks, maxAge: tx.maxAge };
        const claims = (await client.authorizationCodeGrant(await configuration(), callbackUrl, grant)).claims();
        return claims ? checkClaims(s, claims, tx, now()) : { kind: 'rejected', reason: 'no-id-token' };
      } catch (error) {
        return providerDown(error) ? { kind: 'unavailable' } : { kind: 'rejected', reason: 'provider-proof' };
      }
    },
  };
}
