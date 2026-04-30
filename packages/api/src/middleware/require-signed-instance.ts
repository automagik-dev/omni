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
import { extractLockTargets } from './scope-enforcer';

const log = createLogger('api:require-signed-instance');

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

  const targets = extractLockTargets(method, path, body);
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
        message: `Instance ${instance.id} requires a verified X-Genie-Signature; bearer-only requests are rejected. Sign with \`genie omni handshake\` + per-request signing, or remove the requirement via \`omni instances update ${instance.id} --no-require-genie-signature\`.`,
        instance: instance.id,
      },
    },
    401,
  );
});
