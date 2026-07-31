/**
 * CLI Client Helper
 *
 * Creates SDK client from config and handles auth errors.
 */

import { type OmniClient, createOmniClient } from '@omni/sdk';
import { describeActiveServer, hasAuth, loadConfig } from './config.js';
import * as output from './output.js';
import { type SigningContext, loadSigningContextForServer } from './signing.js';
import { VERSION } from './version.js';

/** Cached client instance */
let cachedClient: OmniClient | null = null;

const DEFAULT_API_URL = 'http://localhost:8882';

/**
 * Abort with a not-authenticated error naming the server entry the command was
 * targeting.
 *
 * With multiple entries in the registry, a bare "run omni auth login" is
 * actively misleading: it would write the key into whichever entry is active,
 * which may not be the one that just failed. The hint is therefore always
 * `--server`-scoped.
 */
export function exitNotAuthenticated(): never {
  const target = describeActiveServer();
  return output.error(
    `Not authenticated for server "${target.name}" (${target.url}). ` +
      `Run: omni auth login --server ${target.name} --api-key <key>`,
    undefined,
    2,
  );
}

/**
 * Get an authenticated SDK client.
 * Exits with error if not authenticated.
 */
export function getClient(): OmniClient {
  if (cachedClient) {
    return cachedClient;
  }

  if (!hasAuth()) {
    exitNotAuthenticated();
  }

  const config = loadConfig();

  // hasAuth() already verified apiKey exists, but we check again for type safety
  if (!config.apiKey) {
    exitNotAuthenticated();
  }

  const baseUrl = config.apiUrl ?? DEFAULT_API_URL;
  cachedClient = createOmniClient({
    baseUrl,
    apiKey: config.apiKey,
    cliVersion: VERSION,
    signRequest: signRequestIfHandshook(baseUrl),
  });

  return cachedClient;
}

/**
 * Get an optional client (doesn't require auth).
 * Returns null if not authenticated.
 */
export function getOptionalClient(): OmniClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  if (!hasAuth()) {
    return null;
  }

  const config = loadConfig();

  // hasAuth() already verified apiKey exists
  if (!config.apiKey) {
    return null;
  }

  const baseUrl = config.apiUrl ?? DEFAULT_API_URL;
  cachedClient = createOmniClient({
    baseUrl,
    apiKey: config.apiKey,
    cliVersion: VERSION,
    signRequest: signRequestIfHandshook(baseUrl),
  });

  return cachedClient;
}

/**
 * Build the SDK's `signRequest` callback when the operator has run
 * `omni trust handshake` AGAINST THIS SERVER. Returns undefined otherwise —
 * the SDK falls back to bearer-only, identical to behavior before P0b.
 *
 * The binding check matters once more than one server is registered: only the
 * server that saw the handshake knows this pubkey, so signing headers sent
 * elsewhere are noise the verifier may reject outright.
 *
 * Cached at module level: re-loading the keypair from disk on every
 * client creation is wasted I/O. Keyed by URL because a single invocation can
 * legitimately build clients for different servers.
 */
const _signingCtxByUrl = new Map<string, SigningContext | null>();
function signRequestIfHandshook(baseUrl: string) {
  let ctx = _signingCtxByUrl.get(baseUrl);
  if (ctx === undefined) {
    ctx = loadSigningContextForServer(baseUrl);
    _signingCtxByUrl.set(baseUrl, ctx);
  }
  if (!ctx) return undefined;
  const bound = ctx;
  return (method: string, path: string, body: string) => bound.signRequest(method, path, body);
}
