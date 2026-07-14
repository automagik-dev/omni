/**
 * Capability model — the pack's half of the KHAL authorization contract.
 *
 * The BFF is the real enforcement boundary (it mints the Omni key from the
 * verified KHAL session). This module is *defense in depth*: it makes the UI's
 * affordances match what the BFF will actually allow, so an operator is never
 * offered a control that would 403.
 *
 * Three rules, all of them non-negotiable:
 *
 * 1. **Role checks are ordinal, never string equality.** `ROLE_HIERARCHY` is
 *    `['member','platform-dev','platform-admin','platform-owner']` (least →
 *    most privileged); everything goes through `hasMinRole(normalizeRole(...))`.
 * 2. **`KhalAuth.permissions[]` is NOT an authorization scope list.** It is
 *    app-visibility (which apps show up in the KHAL launcher), computed from
 *    each manifest's `minRole`. We gate on `role`, and only on `role`.
 * 3. **Fail closed.** No auth context, an unresolved session, or a role slug we
 *    do not recognise ⇒ *no* capability. `normalizeRole` coerces every unknown
 *    string to `member` (its documented default), and `member` can read every
 *    conversation in the tenant — so trusting it blindly would fail *open* on a
 *    typo or an unseen future role. We therefore recognise the slug ourselves
 *    (canonical + documented aliases) before normalizing it.
 */
import { ROLE_HIERARCHY, hasMinRole, normalizeRole } from '@khal-os/sdk/app';
import type { KhalAuth, Role } from '@khal-os/sdk/app';

/**
 * What a user is allowed to do, in three tiers that mirror the role → Omni
 * key-profile map the BFF applies:
 *
 * | Capability   | Min role         | Omni key profile   |
 * |--------------|------------------|--------------------|
 * | `read`       | `member`         | `console-viewer`   |
 * | `operate`    | `platform-dev`   | `console-operator` |
 * | `administer` | `platform-admin` | `console-admin`    |
 */
export type Capability = 'read' | 'operate' | 'administer';

/** Least-privileged role that satisfies each capability. */
export const CAPABILITY_MIN_ROLE: Record<Capability, Role> = {
  read: 'member',
  operate: 'platform-dev',
  administer: 'platform-admin',
};

/** Human labels for the canonical roles, for denial copy. */
export const ROLE_LABEL: Record<Role, string> = {
  member: 'Member',
  'platform-dev': 'Platform Dev',
  'platform-admin': 'Platform Admin',
  'platform-owner': 'Platform Owner',
};

/**
 * Legacy/shorthand slugs WorkOS may still return, which `normalizeRole` maps
 * onto a canonical role. Listed explicitly so an *unlisted* slug is treated as
 * unknown (→ denied) rather than silently coerced to `member`.
 */
const ROLE_ALIASES: ReadonlySet<string> = new Set(['admin', 'developer', 'owner', 'viewer', 'user', 'dev']);

/** True only for a slug the SDK actually knows: a canonical role or a documented alias. */
export function isKnownRoleSlug(role: unknown): role is string {
  if (typeof role !== 'string') return false;
  return (ROLE_HIERARCHY as readonly string[]).includes(role) || ROLE_ALIASES.has(role);
}

/**
 * The canonical role of a *usable* session, or `null` when there is none:
 * no auth context, a session still resolving, or an unrecognised role slug.
 */
export function sessionRole(auth: KhalAuth | null | undefined): Role | null {
  if (!auth || auth.loading) return null;
  if (!isKnownRoleSlug(auth.role)) return null;
  return normalizeRole(auth.role);
}

/** Whether the session may exercise `capability`. Fails closed on every unknown. */
export function can(auth: KhalAuth | null | undefined, capability: Capability): boolean {
  const role = sessionRole(auth);
  if (!role) return false;
  return hasMinRole(role, CAPABILITY_MIN_ROLE[capability]);
}

/** Denial copy: what the operator would need to perform the action. */
export function requirementReason(capability: Capability): string {
  return `Requires the ${ROLE_LABEL[CAPABILITY_MIN_ROLE[capability]]} role or higher.`;
}

/**
 * Routes that expose key management / tenant administration. `platform-dev` is
 * index 1 of 4 — an operator, not an administrator — so these stay out of reach
 * until `platform-admin`.
 */
export const ADMIN_ROUTES: readonly string[] = [
  '/api-keys',
  '/trust-hosts',
  '/access-rules',
  '/settings',
  '/payload-config',
];

/** Normalise a route path for policy lookup (leading slash, no trailing slash). */
function normalizePath(path: string): string {
  const withLead = path.startsWith('/') ? path : `/${path}`;
  return withLead.length > 1 ? withLead.replace(/\/+$/, '') : withLead;
}

/** The capability required to *view* a route. Everything not admin-only is a read view. */
export function routeCapability(path: string): Capability {
  return ADMIN_ROUTES.includes(normalizePath(path)) ? 'administer' : 'read';
}
