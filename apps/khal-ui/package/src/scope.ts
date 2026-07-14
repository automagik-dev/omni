import { validateManifest } from '@khal-os/types';
import rawManifest from '../../khal-app.json';

/**
 * Install-scope enforcement for the `omni-admin` pack.
 *
 * `khal-app.json` declares `defaultScope` / `allowedScopes`, but a declaration
 * the pack never reads is a claim, not a contract. These helpers make the
 * manifest the single source of truth so a host asking us to mount under an
 * undeclared scope fails loudly instead of silently mounting.
 *
 * Runtime consumer: the KHAL OS host handshake (Phase 2 / Group 6) supplies the
 * requested data-scope at install/mount time and calls `resolveScope`. No such
 * host exists in Phase 1, so these helpers are exercised by tests rather than a
 * live caller yet — they are the Phase-1 deliverable, not dead code.
 *
 * Values are derived from `validateManifest()`'s parsed output (which enforces
 * the `KhalScope` type) rather than casting the raw JSON import, so a manifest
 * with an undeclared scope fails at parse time instead of leaking past a cast.
 */
export type AppScope = 'shared' | 'user';

const manifest = validateManifest(rawManifest);

export const ALLOWED_SCOPES: readonly AppScope[] = manifest.allowedScopes;
export const DEFAULT_SCOPE: AppScope = manifest.defaultScope;

export function isScopeAllowed(scope: string): scope is AppScope {
  return (ALLOWED_SCOPES as readonly string[]).includes(scope);
}

/**
 * Resolve the scope the pack should run under. `undefined` (host did not ask
 * for one) falls back to the manifest's `defaultScope`; anything outside
 * `allowedScopes` throws.
 */
export function resolveScope(requested?: string | null): AppScope {
  if (requested === undefined || requested === null || requested === '') return DEFAULT_SCOPE;
  if (!isScopeAllowed(requested)) {
    throw new Error(
      `omni-admin: scope "${requested}" is not declared in khal-app.json allowedScopes (${ALLOWED_SCOPES.join(', ')})`,
    );
  }
  return requested;
}
