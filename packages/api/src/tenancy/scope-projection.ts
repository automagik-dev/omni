/**
 * Tenant-scope → legacy-scope projection
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0006).
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A tenant credential and a `/api/v2` route speak different scope languages.
 *
 * `TenantKeyService` will only mint scopes inside the role ceiling declared in
 * `role-policies.ts` — `tenant:read`, `tenant:write`, `tenant:*`,
 * `keys:delegate` — and rejects anything else as "outside the role ceiling".
 * `scope-enforcer`, meanwhile, authorizes each route against `SCOPE_MAP`, whose
 * vocabulary is `instances:read`, `messages:send`, `turns:admin`, and so on.
 *
 * Without a translation the two never meet: a correctly minted tenant key is
 * denied on every tenant-scoped route, and the WISH's Compatibility contract —
 * "`/api/v2` tenant operations may infer the tenant from a tenant key" — cannot
 * hold. This module is that translation, and `projectTenantApiKey` at the edge
 * is its only caller.
 *
 * WHY THIS IS NOT A PRIVILEGE GRANT
 * ---------------------------------
 * A projected scope answers "which verb, on which KIND of resource". It cannot
 * answer "whose data" — that is decided strictly below this layer by the
 * tenant-stamped transaction and RLS, neither of which consults a scope. So the
 * widest possible projection, `tenant:*`, still reaches exactly one tenant's
 * rows, and a projection bug is a permissions bug, never a containment one.
 *
 * That is also why the tiering is coarse rather than per-namespace: the role
 * ceiling is deliberately coarse (ADR-0006 chose four roles over a scope
 * matrix), and inventing a finer tenant-side vocabulary here would create a
 * second rulebook that the issuance path does not enforce.
 *
 * FAIL CLOSED, AND FAIL LOUD
 * --------------------------
 * Two rules keep this from rotting:
 *
 *   1. An input scope this module does not recognise contributes NOTHING. It is
 *      never passed through as itself — a raw `tenant:*`-adjacent name landing
 *      in an authorization decision made by `ApiKeyService.scopeAllows` would be
 *      evaluated by a rulebook that never vetted it.
 *   2. The output universe is DERIVED rather than listed here, and
 *      `classifyLegacyScope` returns `null` for a verb it does not know.
 *      `scope-projection.test.ts` fails on any unclassified scope, so adding a
 *      route with a novel verb breaks the build instead of silently making that
 *      route unreachable for every tenant credential.
 *
 * WHAT IT IS DERIVED FROM, AND WHY THAT CHANGED
 * ---------------------------------------------
 * The output universe used to be all of `SCOPE_MAP` — every scope any route
 * requires. That was wrong in a way the "cannot widen beyond the tenant"
 * argument above does not cover, because it assumed every route is a
 * tenant-data route. Some are not. `GET /metrics` and `GET /logs/recent` read
 * PROCESS-WIDE state with no tenant column to scope, and `/trust/hosts` is
 * deployment infrastructure — `route-ownership.ts` declares all of them
 * platform-admin or control-plane precisely because they are cross-tenant. A
 * tier that swept `metrics:read`/`logs:read`/`trust:write` up with
 * `instances:read` therefore handed a tenant-viewer key a genuine cross-tenant
 * READ, and a tenant-operator key mutation rights over host trust — neither of
 * which RLS can claw back, because there is no row-level boundary there to
 * enforce.
 *
 * So the universe is now `TENANT_ADDRESSABLE_SCOPES`: the scopes required by
 * routes the ownership table declares tenant-addressable, and nothing else. The
 * projection can no longer emit a scope that authorizes a route the ownership
 * declaration forbids, which is the drift that produced the bug.
 */

import { SCOPE_MAP } from '../constants/scopes';
import { TENANT_ADDRESSABLE_SCOPES } from './route-ownership';

/**
 * Authority tiers, ordered. A tier includes everything below it.
 *
 *   * `read`  — observation only.
 *   * `write` — mutation of tenant resources.
 *   * `admin` — operations that administer the tenant's own machinery rather
 *     than its data. Today this is `turns:admin`; the tier exists so such a
 *     verb cannot be swept into `write` and handed to `tenant-operator`, whose
 *     role ceiling tops out at `tenant:write`.
 */
export type ScopeTier = 'read' | 'write' | 'admin';

const TIER_BY_VERB: Readonly<Record<string, ScopeTier>> = Object.freeze({
  read: 'read',
  /** `auth:validate` — a credential describing itself. Strictly observation. */
  validate: 'read',
  write: 'write',
  send: 'write',
  close: 'write',
  synthesize: 'write',
  admin: 'admin',
});

const TIER_ORDER: readonly ScopeTier[] = ['read', 'write', 'admin'];

/**
 * The delegation namespace is projected ONLY from `keys:delegate`, never from a
 * resource tier. ADR-0006 makes the authority to mint a child key a distinct
 * grant from the authority to use the tenant's resources, and collapsing them
 * would mean `tenant:*` silently implied key issuance.
 */
const DELEGATION_NAMESPACE = 'keys';

/**
 * Every scope some route actually requires, derived so it cannot drift.
 *
 * This is the CLASSIFICATION universe, not the projection universe: the
 * exhaustiveness test walks it so a novel verb anywhere in `SCOPE_MAP` is a
 * build failure. What a tenant credential may actually be granted is the
 * narrower `TENANT_ADDRESSABLE_SCOPES`.
 */
export const LEGACY_SCOPE_UNIVERSE: readonly string[] = Object.freeze([...new Set(Object.values(SCOPE_MAP))].sort());

/**
 * The tier a legacy scope belongs to, or `null` when its verb is unknown.
 *
 * `null` is a build failure via the test, not a runtime fallback.
 */
export function classifyLegacyScope(scope: string): ScopeTier | null {
  const verb = scope.split(':')[1];
  if (verb === undefined) return null;
  return TIER_BY_VERB[verb] ?? null;
}

function scopesUpToTier(tier: ScopeTier): string[] {
  const ceiling = TIER_ORDER.indexOf(tier);
  return TENANT_ADDRESSABLE_SCOPES.filter((scope) => {
    if (scope.startsWith(`${DELEGATION_NAMESPACE}:`)) return false;
    const scopeTier = classifyLegacyScope(scope);
    if (scopeTier === null) return false;
    return TIER_ORDER.indexOf(scopeTier) <= ceiling;
  });
}

/**
 * What each tenant-vocabulary scope expands to. Anything absent projects to
 * nothing.
 *
 * `keys:delegate` intersects the delegation namespace with the addressable set,
 * which reduces it to `keys:write` alone — the scope `POST /keys` requires,
 * where a tenant credential is intercepted and served by the tenant child-key
 * path. It deliberately does NOT yield `keys:read`: that scope's only routes
 * are the legacy list/read/audit verbs over the deployment-wide, un-RLS'd
 * `api_keys` table, so granting it would let a tenant-admin enumerate every
 * credential in the deployment.
 */
const EXPANSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'tenant:read': Object.freeze(scopesUpToTier('read')),
  'tenant:write': Object.freeze(scopesUpToTier('write')),
  'tenant:*': Object.freeze(scopesUpToTier('admin')),
  'keys:delegate': Object.freeze(
    TENANT_ADDRESSABLE_SCOPES.filter((scope) => scope.startsWith(`${DELEGATION_NAMESPACE}:`)),
  ),
});

/**
 * Expand a tenant credential's role-ceiling scopes into the vocabulary the
 * routes authorize against.
 *
 * Order is stable and duplicates are collapsed, so the projected `ApiKeyData`
 * is a pure function of the frozen context — two requests on one credential
 * cannot produce differently-shaped authority.
 */
export function projectTenantScopes(scopes: readonly string[]): string[] {
  const projected = new Set<string>();
  for (const scope of scopes) {
    for (const expanded of EXPANSIONS[scope] ?? []) projected.add(expanded);
  }
  return [...projected].sort();
}
