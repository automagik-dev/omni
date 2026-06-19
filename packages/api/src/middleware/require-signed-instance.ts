/**
 * Per-instance signature requirement enforcement.
 *
 * Wish: omni-host-fingerprint-trust, Group 6.
 *
 * When an instance has `instances.require_genie_signature = true` set
 * (via `omni instances update <id> --require-genie-signature`), every
 * request that targets that instance MUST carry a verified
 * `X-Genie-Signature`. Bearer-only requests get 401 with code
 * `GENIE_SIGNATURE_REQUIRED`.
 *
 * Pipeline placement:
 *
 *   authMiddleware            ← bearer auth, sets `apiKey`
 *   genieSignatureMiddleware  ← verifies signature, sets `signedBy`/`signedByScopes`
 *   requireSignedInstanceMiddleware  ← THIS — 401s when signature is required and missing
 *   scopeEnforcerMiddleware   ← bearer + per-host scope intersection
 *
 * Default behavior is additive: `require_genie_signature` defaults to
 * false on every instance, so this middleware is a no-op until an
 * operator opts in.
 *
 * Target extraction re-uses the same `extractLockTargets` helper as the
 * scope-enforcer to avoid drift between AUTHN (this middleware: 401) and
 * AUTHZ (scope-enforcer: 403). The instance id is read from path params
 * (/instances/:id...) and JSON body (`instanceId`) — same source set.
 *
 * Routes that don't carry an instance target (auth-system routes, trust
 * handshake, etc.) bypass this check entirely.
 */

import { createLogger } from '@omni/core';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppVariables } from '../types';
import { extractLockTargets, readHeaderTargets } from './scope-enforcer';

const log = createLogger('api:require-signed-instance');

/**
 * Decide whether a PATCH body is an "unlock-only" request — i.e. the only
 * change is flipping `requireGenieSignature` to false. Used by the
 * kill-switch exemption: we let unlocks through even when the lockdown is
 * active, but we DON'T let bearer-only callers smuggle other field
 * changes alongside the unlock.
 *
 * Cases:
 *   { requireGenieSignature: false }                → true  (unlock)
 *   { requireGenieSignature: false, name: 'x' }    → false (mixed write)
 *   { requireGenieSignature: true }                → false (no recovery scenario)
 *   { requireGenieSignature: 'false' }             → false (wrong type)
 *   { name: 'x' }                                  → false (no unlock at all)
 *   undefined / non-object / array                 → false
 *
 * Exported so tests can lock down the matrix without HTTP.
 */
export function isUnlockOnlyBody(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return false;
  if (keys[0] !== 'requireGenieSignature') return false;
  return obj.requireGenieSignature === false;
}

/**
 * Safely parse a JSON request body. Returns null when there's no body
 * or it isn't JSON — matches scope-enforcer's behavior.
 */
async function safeReadJsonBody(c: Context<{ Variables: AppVariables }>): Promise<unknown | null> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS') return null;
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export const requireSignedInstanceMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const services = c.get('services');
  if (!services?.instances) {
    // Service registry not initialized — fall through. Bearer auth or
    // downstream middleware will handle it. Failing closed here would
    // mask real causes during boot/healthcheck.
    return next();
  }

  const method = c.req.method.toUpperCase();
  const path = c.req.path;
  const body = await safeReadJsonBody(c);

  const targets = extractLockTargets(method, path, body, readHeaderTargets(c));
  if (!targets.instance) {
    // No instance target → nothing to enforce.
    return next();
  }

  let instance: { id: string; requireGenieSignature: boolean } | null = null;
  try {
    const row = await services.instances.getById(targets.instance);
    instance = { id: row.id, requireGenieSignature: row.requireGenieSignature };
  } catch {
    // Unknown instance → defer to the route handler (it will 404). Don't
    // 401 on an unknown id — that would leak information about whether
    // an instance exists.
    return next();
  }

  if (!instance.requireGenieSignature) {
    // Instance hasn't opted into signature requirement → fall through.
    return next();
  }

  const signedBy = c.get('signedBy');
  if (signedBy) {
    // Already verified by genie-signature middleware → allow.
    return next();
  }

  // KILL-SWITCH EXEMPTION (omni-host-fingerprint-trust hotfix).
  //
  // Without this, the lockdown is a one-way door: an operator with a
  // bearer-only client (the `omni` CLI itself today, or any non-genie
  // caller) flips `requireGenieSignature: true` and then can't flip it
  // back — the unlock PATCH gets gated by the gate it just enabled. The
  // only recovery is a direct DB write or scripting raw signed HTTP from
  // a genie host.
  //
  // We exempt PATCH /instances/:id when the body's ONLY effective change
  // is `requireGenieSignature: false`. Other fields in the same body
  // (name, agentId, etc.) make the request ineligible for the exemption
  // so an attacker can't smuggle changes alongside the unlock.
  //
  // We deliberately do NOT exempt the inverse (`requireGenieSignature:
  // true`) — there's no recovery scenario for "I need to enable this but
  // can't sign," and exempting it would let bearer-only callers escalate.
  if (method === 'PATCH' && isUnlockOnlyBody(body)) {
    log.info('allowing unlock-only PATCH on require_genie_signature instance', {
      instanceId: instance.id,
      apiKeyId: c.get('apiKey')?.id,
    });
    return next();
  }

  const apiKey = c.get('apiKey');
  log.warn('rejecting unsigned request to require_genie_signature instance', {
    instanceId: instance.id,
    apiKeyId: apiKey?.id,
    method,
    path,
  });
  return c.json(
    {
      error: {
        code: 'GENIE_SIGNATURE_REQUIRED',
        message: `Instance ${instance.id} requires a verified X-Genie-Signature; bearer-only requests are rejected. Sign with \`genie omni handshake\` + per-request signing, or unlock with PATCH /api/v2/instances/${instance.id} body {"requireGenieSignature": false} (always allowed via bearer to prevent operator lockout).`,
        instance: instance.id,
      },
    },
    401,
  );
});
