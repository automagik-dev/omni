/**
 * Tenant-scope → legacy-scope projection
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0006).
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Two scope vocabularies meet at the tenancy edge and, before this module, did
 * not.
 *
 *   * A tenant credential's scopes come from the ROLE CEILING in
 *     `role-policies.ts`: `tenant:read`, `tenant:write`, `tenant:*`,
 *     `keys:delegate`. `TenantKeyService` refuses to mint anything else — a
 *     root key requesting `instances:read` is rejected as "outside the role
 *     ceiling", so no tenant credential in existence can carry a legacy scope
 *     name.
 *   * Every `/api/v2` route authorizes against `SCOPE_MAP`, whose vocabulary is
 *     `instances:read`, `messages:send`, `turns:admin`, …
 *
 * The consequence, without a projection, is that a correctly minted tenant key
 * is 403'd by `scope-enforcer` on EVERY tenant-scoped route — the WISH's
 * Compatibility contract ("`/api/v2` tenant operations may infer the tenant
 * from a tenant key") could not hold, and the HTTP-level two-tenant probes
 * would be testing a surface no tenant credential can reach.
 *
 * WHAT THE PROJECTION IS AND IS NOT
 * ---------------------------------
 * It is a TRANSLATION of authority the credential already holds, in the same
 * spirit as the rest of `projectTenantApiKey`. It is NOT a grant: the tenant
 * boundary is enforced below this layer by the scoped transaction and RLS, so
 * a projected scope can decide "which verb on which resource kind", never
 * "whose data". The tests below pin both halves of that: what each tier
 * expands to, and what it can never contain.
 *
 * THE EXHAUSTIVENESS TEST IS THE IMPORTANT ONE
 * --------------------------------------------
 * `everyScopeMapScopeIsClassified` fails when a route introduces a scope verb
 * the projection does not know. That is deliberate: the alternative — silently
 * dropping an unknown verb — would mean a new route is quietly unreachable by
 * every tenant credential, which reads as a permissions bug months later
 * rather than as a build failure today.
 */

import { describe, expect, test } from 'bun:test';
import { SCOPE_MAP } from '../../constants/scopes';
import { TENANT_ADDRESSABLE_SCOPES } from '../route-ownership';
import { LEGACY_SCOPE_UNIVERSE, classifyLegacyScope, projectTenantScopes } from '../scope-projection';

/** Every distinct scope any route actually requires. */
const requiredScopes = [...new Set(Object.values(SCOPE_MAP))].sort();

describe('the projection covers the whole route surface', () => {
  test('every scope SCOPE_MAP requires is classified', () => {
    const unclassified = requiredScopes.filter((scope) => classifyLegacyScope(scope) === null);
    expect(unclassified).toEqual([]);
  });

  test('the universe is exactly what the routes ask for', () => {
    // Not a tautology: it fails if the universe is hand-maintained and drifts
    // from SCOPE_MAP, which is the way this kind of table normally rots.
    expect([...LEGACY_SCOPE_UNIVERSE].sort()).toEqual(requiredScopes);
  });
});

describe('tiers expand to what the role ceiling means', () => {
  test('tenant:read projects read authority and nothing that mutates', () => {
    const projected = projectTenantScopes(['tenant:read']);
    expect(projected).toContain('instances:read');
    expect(projected).toContain('messages:read');
    expect(projected).not.toContain('instances:write');
    expect(projected).not.toContain('messages:send');
    expect(projected).not.toContain('turns:admin');
  });

  test('tenant:write is a superset of tenant:read', () => {
    const read = new Set(projectTenantScopes(['tenant:read']));
    const write = projectTenantScopes(['tenant:write']);
    for (const scope of read) expect(write).toContain(scope);
    expect(write).toContain('messages:send');
    expect(write).toContain('instances:write');
  });

  test('tenant:write still cannot administer turns', () => {
    // `turns:admin` is the one verb the operator ceiling must not reach:
    // `tenant-operator`'s policy tops out at `tenant:write`.
    expect(projectTenantScopes(['tenant:write'])).not.toContain('turns:admin');
  });

  test('tenant:* reaches every tenant-addressable non-delegation scope, including admin verbs', () => {
    const projected = new Set(projectTenantScopes(['tenant:*']));
    const missing = TENANT_ADDRESSABLE_SCOPES.filter((s) => !s.startsWith('keys:') && !projected.has(s));
    expect(missing).toEqual([]);
    expect(projected.has('turns:admin')).toBe(true);
  });

  test('the widest tier still stops at the tenant-addressable surface', () => {
    // The complement of the assertion above, and the actual bug this pins.
    // These four scopes ARE in SCOPE_MAP, so the previous universe-from-
    // SCOPE_MAP projection emitted them: `tenant:read` handed a viewer key the
    // process-wide log ring buffer and the Prometheus counters, and
    // `tenant:write` handed an operator key mutation rights over the
    // deployment's host-trust registry. `route-ownership.ts` declares every one
    // of those routes platform-admin or control-plane, and no tier may reach
    // them.
    const widest = new Set(projectTenantScopes(['tenant:read', 'tenant:write', 'tenant:*', 'keys:delegate']));
    for (const scope of ['metrics:read', 'logs:read', 'trust:read', 'trust:write']) {
      expect(widest.has(scope)).toBe(false);
      // Not vacuous: each one is a scope some real route requires.
      expect(requiredScopes).toContain(scope);
    }
  });
});

describe('delegation authority is separate from resource authority', () => {
  test('tenant:* alone cannot mint keys', () => {
    const projected = projectTenantScopes(['tenant:*']);
    expect(projected).not.toContain('keys:write');
    expect(projected).not.toContain('keys:read');
  });

  test('keys:delegate grants child-key creation and nothing else on /keys', () => {
    // `keys:write` is what `POST /keys` requires, and a tenant credential on
    // that route is intercepted into the same-tenant child-key path.
    expect(projectTenantScopes(['keys:delegate'])).toEqual(['keys:write']);
  });

  test('keys:delegate cannot read the deployment-wide key index', () => {
    // `keys:read` covers GET /keys, GET /keys/:id and GET /keys/:id/audit over
    // `api_keys` — a table with no tenant column and no RLS. Projecting it made
    // a tenant-admin key an enumerator of every credential in the deployment,
    // including the operator master key it could then revoke.
    expect(projectTenantScopes(['keys:delegate'])).not.toContain('keys:read');
    expect(requiredScopes).toContain('keys:read');
  });

  test('keys:delegate grants no resource authority of its own', () => {
    expect(projectTenantScopes(['keys:delegate'])).not.toContain('instances:read');
  });
});

describe('the projection can never widen beyond the tenant', () => {
  test('no tier ever yields a wildcard or platform scope', () => {
    for (const tier of [['tenant:read'], ['tenant:write'], ['tenant:*'], ['keys:delegate']]) {
      const projected = projectTenantScopes(tier);
      expect(projected).not.toContain('*');
      expect(projected.filter((s) => s.startsWith('platform:'))).toEqual([]);
    }
  });

  test('an unrecognised input scope contributes nothing', () => {
    // Fail closed. A scope the projection does not understand must not fall
    // through as itself, or a future ceiling change would leak its raw name
    // into an authorization decision made by a different rulebook.
    expect(projectTenantScopes(['something:invented'])).toEqual([]);
    expect(projectTenantScopes(['*'])).toEqual([]);
    expect(projectTenantScopes(['platform:tenants:write'])).toEqual([]);
  });

  test('the result is deduplicated and stable', () => {
    const once = projectTenantScopes(['tenant:read', 'tenant:read', 'tenant:write']);
    expect(once).toEqual([...new Set(once)]);
    expect(once).toEqual(projectTenantScopes(['tenant:write', 'tenant:read']));
  });

  test('no scopes in means no scopes out', () => {
    expect(projectTenantScopes([])).toEqual([]);
  });
});
