/**
 * Genie host signature verification middleware.
 *
 * Wish: omni-host-fingerprint-trust, Group 4.
 *
 * Reads the three signature headers genie attaches via `signOmniRequest`
 * (Group 3, automagik-dev/genie#1539):
 *
 *   X-Genie-Host-Id    UUID of the registered host
 *   X-Genie-Timestamp  ISO 8601 UTC of when the request was signed
 *   X-Genie-Signature  base64url(ed25519(canonical))
 *
 * Reconstructs the same canonical input the signer used:
 *
 *   <iso8601-timestamp>\n<METHOD>\n<path>\n<sha256(body-utf8) hex>
 *
 * Verifies the ed25519 signature against the host's stored public key. On
 * success, attaches `signedBy = host_id` to the request context for
 * downstream audit consumers; on failure, returns 401 with a clear message.
 *
 * **Behavior is ADDITIVE in this PR**: missing signature headers fall
 * through to the bearer-token auth chain unchanged. Failed signature
 * verification (header present but invalid) returns 401 — that's not
 * fail-open. The per-instance enforcement opt-in
 * (`--require-genie-signature`, Group 6) flips this from "verify when
 * present" to "require always".
 *
 * Security review checklist (per the wish's Group 4 callout):
 *   1. Replay window (±60s tolerance for clock skew)
 *      → enforced via REPLAY_WINDOW_MS below
 *   2. Constant-time signature comparison
 *      → node:crypto's `verify()` uses ed25519 internals which are
 *        constant-time by design (curve25519). No string compares.
 *   3. Pubkey loading — SPKI prefix construction must be byte-exact
 *      → see `buildSpki()` below; matches RFC 8410's
 *        `id-Ed25519` OID.
 *   4. Unknown host_id → 401, not silently fall through
 *      → enforced; see `verifyOrReject()`.
 *   5. Audit log — every signed request records `signedBy`
 *      → c.set('signedBy', host.id) for downstream middleware/handlers.
 *
 * Performance: the GenieHostsService.findById is a single indexed PK
 * lookup; ed25519 verify is ~30µs. Negligible against typical request
 * budgets.
 */

import { type KeyObject, createHash, createPublicKey, verify } from 'node:crypto';
import { createLogger } from '@omni/core';
import { createMiddleware } from 'hono/factory';
import type { AppVariables } from '../types';

const log = createLogger('api:genie-signature');

/**
 * Replay window: reject signed requests whose timestamp is more than 60
 * seconds from server clock in either direction. Tighter than HTTP-Sig's
 * default ~5min because the genie host and omni server live on the same
 * machine in the loopback-only deployment model — clock drift between
 * them is nil. If we add cross-machine deployments later, revisit.
 */
const REPLAY_WINDOW_MS = 60_000;

/**
 * SPKI DER prefix for ed25519 public keys (RFC 8410). 12 bytes.
 *
 *   30 2a   SEQUENCE (42 bytes)
 *     30 05 SEQUENCE (5 bytes — the AlgorithmIdentifier)
 *       06 03 OID (3 bytes)
 *         2b 65 70   id-Ed25519 (1.3.101.112)
 *     03 21 BIT STRING (33 bytes)
 *       00          unused-bits = 0
 *       <32 bytes>  the raw public key
 *
 * `Buffer.from(pubkeyB64Url, 'base64url')` produces the 32-byte raw key;
 * concat the prefix to get a parseable SPKI DER blob.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Headers the signer attaches. Header lookup is case-insensitive in Hono. */
const HEADER_HOST_ID = 'x-genie-host-id';
const HEADER_TIMESTAMP = 'x-genie-timestamp';
const HEADER_SIGNATURE = 'x-genie-signature';

/**
 * Reconstruct the canonical signing input. MUST byte-exactly match
 * `canonicalSigningInput()` in genie's `src/lib/omni-signature.ts`. Any
 * drift here breaks every signed request — treat as wire protocol.
 */
export function canonicalSigningInput(timestamp: string, method: string, path: string, body: string): string {
  const bodyHash = createHash('sha256').update(body, 'utf-8').digest('hex');
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

/** Parse the base64url pubkey into a node:crypto KeyObject. */
function loadPubkey(pubkeyB64Url: string): KeyObject {
  const raw = Buffer.from(pubkeyB64Url, 'base64url');
  if (raw.byteLength !== 32) {
    throw new Error(`expected 32-byte ed25519 pubkey, got ${raw.byteLength} bytes`);
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

type VerificationOutcome =
  | {
      status: 'verified';
      hostId: string;
      reason?: never;
      /**
       * Per-host scopes from `genie_hosts.scopes`. Defaults to `['*']` on first
       * handshake (backward compat with the bearer-only model). The scope-enforcer
       * intersects this with the bearer key's scopes — both must allow the route.
       * Empty array = "no permissions" → every scoped route denied.
       */
      hostScopes: string[];
    }
  | { status: 'no-signature'; hostId?: never; hostScopes?: never; reason?: never }
  | { status: 'invalid'; hostId?: never; hostScopes?: never; reason: string };

/** Pure verifier — no I/O beyond the host lookup. Tested directly. */
export async function verifySignature(opts: {
  hostIdHeader: string | undefined;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  method: string;
  path: string;
  body: string;
  now: number;
  findHost: (id: string) => Promise<{ id: string; pubkey: string; revokedAt: Date | null; scopes: string[] } | null>;
}): Promise<VerificationOutcome> {
  const { hostIdHeader, timestampHeader, signatureHeader, method, path, body, now, findHost } = opts;

  // No signature headers at all → bearer-only path; not our concern.
  if (!hostIdHeader && !timestampHeader && !signatureHeader) {
    return { status: 'no-signature' };
  }

  // Partial headers → invalid (someone is trying to forge a signed request
  // by attaching only some of the headers; or a buggy client).
  if (!hostIdHeader || !timestampHeader || !signatureHeader) {
    return { status: 'invalid', reason: 'partial signature headers' };
  }

  // Replay window check (±60s).
  const ts = Date.parse(timestampHeader);
  if (Number.isNaN(ts)) {
    return { status: 'invalid', reason: 'malformed X-Genie-Timestamp' };
  }
  const drift = Math.abs(now - ts);
  if (drift > REPLAY_WINDOW_MS) {
    return { status: 'invalid', reason: `timestamp drift ${drift}ms exceeds ±${REPLAY_WINDOW_MS}ms window` };
  }

  // Host lookup. Unknown id → invalid (not silent fall-through).
  let host: { id: string; pubkey: string; revokedAt: Date | null; scopes: string[] } | null;
  try {
    host = await findHost(hostIdHeader);
  } catch (err) {
    return { status: 'invalid', reason: `host lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!host) {
    return { status: 'invalid', reason: `unknown host ${hostIdHeader}` };
  }
  if (host.revokedAt) {
    return { status: 'invalid', reason: `host ${hostIdHeader} is revoked` };
  }

  // Cryptographic verify. node:crypto's `verify()` for ed25519 is
  // constant-time; the algorithm rejects malformed inputs without
  // leaking timing information about the secret.
  let pubKey: KeyObject;
  try {
    pubKey = loadPubkey(host.pubkey);
  } catch (err) {
    return {
      status: 'invalid',
      reason: `host pubkey unparseable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signatureHeader, 'base64url');
  } catch {
    return { status: 'invalid', reason: 'malformed X-Genie-Signature (not base64url)' };
  }
  const canonical = canonicalSigningInput(timestampHeader, method, path, body);
  const ok = verify(null, Buffer.from(canonical, 'utf-8'), pubKey, sigBytes);
  if (!ok) {
    return { status: 'invalid', reason: 'signature does not verify under registered pubkey' };
  }

  return { status: 'verified', hostId: host.id, hostScopes: host.scopes };
}

/**
 * Build the path string the verifier sees. Must match what the signer
 * sees on the genie side: pathname + search (no host).
 */
function pathFromRequest(url: URL): string {
  return `${url.pathname}${url.search}`;
}

/**
 * Hono middleware factory. Place AFTER the body-limit middleware so
 * `c.req.text()` returns the same string the signer hashed.
 */
export const genieSignatureMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const services = c.get('services');
  if (!services?.genieHosts) {
    // Service registry not initialized — let the request through; bearer
    // auth will reject if needed. Don't fail closed for an internal-config
    // hiccup.
    return next();
  }

  const hostIdHeader = c.req.header(HEADER_HOST_ID);
  const timestampHeader = c.req.header(HEADER_TIMESTAMP);
  const signatureHeader = c.req.header(HEADER_SIGNATURE);

  // Fast-path: no signature headers → skip work, fall through.
  if (!hostIdHeader && !timestampHeader && !signatureHeader) {
    return next();
  }

  // Read the request body ONCE so we hash the same bytes the signer did.
  // The Hono request object's `.text()` is lazy and idempotent; downstream
  // route handlers that re-read via `.json()` get the parsed copy anyway.
  let body = '';
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    body = await c.req.text();
  }

  const url = new URL(c.req.url);
  const outcome = await verifySignature({
    hostIdHeader,
    timestampHeader,
    signatureHeader,
    method: c.req.method,
    path: pathFromRequest(url),
    body,
    now: Date.now(),
    findHost: async (id: string) => {
      const host = await services.genieHosts.findById(id);
      return host
        ? { id: host.id, pubkey: host.pubkey, revokedAt: host.revokedAt, scopes: host.scopes ?? ['*'] }
        : null;
    },
  });

  if (outcome.status === 'invalid') {
    log.warn('genie signature verification failed', {
      hostId: hostIdHeader,
      reason: outcome.reason,
      method: c.req.method,
      path: url.pathname,
    });
    return c.json(
      {
        error: {
          code: 'INVALID_GENIE_SIGNATURE',
          message: `Genie host signature rejected: ${outcome.reason}`,
        },
      },
      401,
    );
  }

  if (outcome.status === 'verified') {
    c.set('signedBy', outcome.hostId);
    // Per-host scopes consumed by scope-enforcer (Group 5). Always set so the
    // enforcer can distinguish "signed and unrestricted" (['*']) from "signed
    // and unscoped" — the former is the back-compat default; the latter
    // doesn't happen today but the enforcer needs the source of truth either
    // way.
    c.set('signedByScopes', outcome.hostScopes);
    // Best-effort last-seen update; never blocks the request.
    services.genieHosts.touchLastSeen(outcome.hostId).catch((err: unknown) => {
      log.warn('touchLastSeen failed (non-fatal)', { hostId: outcome.hostId, err: String(err) });
    });
  }

  return next();
});
