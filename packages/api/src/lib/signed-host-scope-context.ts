import type { Context } from 'hono';
import type { AppVariables } from '../types';

export type SignedHostScopeContext =
  | { kind: 'unsigned' }
  | { kind: 'valid'; hostId: string; scopes: string[] }
  | { kind: 'invalid'; hostId: string };

/**
 * Parse optional Hono context into a strict authorization state.
 *
 * `signedBy` is absent for bearer-only requests. Once it is present, host
 * scopes are mandatory and must be a string array; missing or malformed scope
 * context is an invalid state that downstream authorization must deny.
 */
export function readSignedHostScopeContext(c: Context<{ Variables: AppVariables }>): SignedHostScopeContext {
  const hostId = c.get('signedBy');
  if (!hostId) return { kind: 'unsigned' };

  const scopes: unknown = c.get('signedByScopes');
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
    return { kind: 'invalid', hostId };
  }

  return { kind: 'valid', hostId, scopes };
}
