import type { Context } from 'hono';
import type { AppVariables } from '../types';

export type SignedHostScopeContext =
  | { kind: 'unsigned' }
  | { kind: 'valid'; hostId: string; scopes: string[] }
  | { kind: 'invalid'; hostId: string };

const GENIE_SIGNATURE_HEADERS = ['x-genie-host-id', 'x-genie-timestamp', 'x-genie-signature'] as const;

function hasAnyGenieSignatureHeader(c: Context<{ Variables: AppVariables }>): boolean {
  return GENIE_SIGNATURE_HEADERS.some((header) => c.req.header(header) !== undefined);
}

/**
 * Parse optional Hono context into a strict authorization state.
 *
 * `signedBy` is absent for bearer-only requests. Once it is present, host
 * scopes are mandatory and must be a string array; missing or malformed scope
 * context is an invalid state that downstream authorization must deny.
 */
export function readSignedHostScopeContext(c: Context<{ Variables: AppVariables }>): SignedHostScopeContext {
  const hostId = c.get('signedBy');
  if (!hostId) {
    // Signature headers assert a signed-host identity. If upstream signature
    // verification did not produce `signedBy`, never downgrade that request
    // to the bearer-only path — verification may have been unavailable or the
    // middleware chain may have drifted. The signature middleware normally
    // rejects first; this is the downstream authorization backstop.
    if (hasAnyGenieSignatureHeader(c)) {
      return { kind: 'invalid', hostId: c.req.header('x-genie-host-id') ?? 'unknown' };
    }
    return { kind: 'unsigned' };
  }

  const scopes: unknown = c.get('signedByScopes');
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    return { kind: 'invalid', hostId };
  }

  return { kind: 'valid', hostId, scopes };
}
