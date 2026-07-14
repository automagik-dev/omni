/**
 * KHAL role → Omni console key-profile resolution.
 *
 * The only authorization input for Omni is the KHAL session `role` (never
 * `permissions[]`, which are app-visibility flags — CONTRACT §1.4). This module
 * turns that free-form role slug into one of the three console key profiles, or
 * `null` when the slug is not a recognized KHAL role.
 *
 * SECURITY (CONTRACT §2.2 / §4.4): the SDK's `normalizeRole` is FAIL-OPEN — it
 * coerces ANY unrecognized string (a typo, an unseen WorkOS role, an empty
 * value) to `member`, which maps to `console-viewer` = read every conversation
 * in the tenant. We therefore gate minting on EXACT membership in the
 * recognized-slug set (canonical `ROLE_HIERARCHY` ∪ the SDK's documented alias
 * keys) and only then delegate the canonical mapping to `normalizeRole`. An
 * unknown slug returns `null` here → the caller mints no key and returns 401.
 */

import { ROLE_HIERARCHY, normalizeRole } from '@khal-os/sdk/app/roles';
import type { Role } from '@khal-os/sdk/app/roles';

export type ConsoleProfile = 'console-viewer' | 'console-operator' | 'console-admin';

/**
 * Legacy/shorthand slugs WorkOS may still emit, mirrored from the SDK's
 * (non-exported) `ROLE_ALIASES` — `@khal-os/sdk` `app/roles.ts:22-31`, CONTRACT
 * §2.2. Held here ONLY so the exact-membership gate recognizes them; the
 * canonical mapping is still delegated to `normalizeRole`, never reimplemented.
 * The SDK does not export the alias map, so this list must track that source.
 */
const ROLE_ALIAS_SLUGS = ['admin', 'developer', 'owner', 'viewer', 'user', 'dev'] as const;

/** Every incoming slug we accept: exact canonical roles + documented aliases. */
const RECOGNIZED_ROLE_SLUGS: ReadonlySet<string> = new Set<string>([...ROLE_HIERARCHY, ...ROLE_ALIAS_SLUGS]);

/** Canonical role → console profile (CONTRACT §2.3). Exhaustive over `Role`. */
const ROLE_TO_PROFILE: Record<Role, ConsoleProfile> = {
  member: 'console-viewer',
  'platform-dev': 'console-operator',
  'platform-admin': 'console-admin',
  'platform-owner': 'console-admin',
};

/**
 * Resolve a KHAL role slug to a console key profile, or `null` when the slug is
 * not an exact recognized role/alias. A `null` result MUST fail the request
 * closed (401, no key minted) — never substitute a default profile.
 */
export function resolveConsoleProfile(role: string): ConsoleProfile | null {
  if (!RECOGNIZED_ROLE_SLUGS.has(role)) return null;
  return ROLE_TO_PROFILE[normalizeRole(role)];
}
