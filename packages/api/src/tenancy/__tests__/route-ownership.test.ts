/**
 * Route ownership coverage gate (wish: omni-full-multitenancy, Group G4).
 *
 * The gate itself, plus the two probes that prove it is a gate rather than a
 * decoration: a seeded undeclared route must turn it red, and a route may not
 * be smuggled into the shrinking acknowledged list without an open question.
 */

import { describe, expect, it } from 'bun:test';
import {
  ROUTE_OWNERSHIP,
  type RouteOwnershipDeclaration,
  UNDECLARED_ACKNOWLEDGED,
  UNDECLARED_ACKNOWLEDGED_CEILING,
  enumerateRegisteredRoutes,
  evaluateRouteOwnership,
} from '../route-ownership';

const registered = enumerateRegisteredRoutes();
const report = evaluateRouteOwnership(registered);

describe('route ownership coverage gate', () => {
  it('enumerates the registered route surface across flag combinations', () => {
    expect(registered.length).toBeGreaterThan(300);
    // Flag-gated routes from BOTH worlds are present: the union, not one world.
    expect(registered).toContain('GET /api/v2/platform/tenants');
    expect(registered).toContain('POST /a2a/:instanceId');
    expect(registered).toContain('ALL /a2a/*');
  });

  it('has an explicit ownership declaration for every registered route', () => {
    expect(report.undeclared).toEqual([]);
  });

  it('carries no stale declaration or acknowledgement', () => {
    expect(report.stale).toEqual([]);
  });

  it('justifies every non-tenant-scoped declaration', () => {
    expect(report.unjustified).toEqual([]);
  });

  it('never both declares and acknowledges a route', () => {
    expect(report.doubleCounted).toEqual([]);
  });

  it('states a privacy contract inline on every public-by-contract route', () => {
    const publics = ROUTE_OWNERSHIP.filter((d) => d.class === 'public-by-contract');
    expect(publics.length).toBeGreaterThan(0);
    for (const declaration of publics) {
      // A contract that does not say what is WITHHELD is not a contract.
      expect((declaration.justification ?? '').length).toBeGreaterThan(80);
    }
  });

  it('holds the acknowledged list at or below its ceiling', () => {
    expect(UNDECLARED_ACKNOWLEDGED.length).toBeLessThanOrEqual(UNDECLARED_ACKNOWLEDGED_CEILING);
    for (const entry of UNDECLARED_ACKNOWLEDGED) {
      expect(entry.openQuestion.trim().length).toBeGreaterThan(40);
    }
  });

  it('reports the acknowledged routes as still-open work rather than as covered', () => {
    expect(report.acknowledged.sort()).toEqual(UNDECLARED_ACKNOWLEDGED.map((a) => a.route).sort());
  });
});

describe('route ownership gate fails closed', () => {
  it('goes red on a newly added, undeclared route', () => {
    const seeded = [...registered, 'GET /api/v2/seeded-undeclared-route'];
    const seededReport = evaluateRouteOwnership(seeded);
    expect(seededReport.undeclared).toEqual(['GET /api/v2/seeded-undeclared-route']);
  });

  it('does not let a new route inherit the acknowledged ceiling', () => {
    // The acknowledged set is an inventory of exact routes; a route that is not
    // in it cannot be covered by it however much headroom the ceiling has.
    const seeded = [...registered, 'GET /api/v2/seeded-undeclared-route'];
    const roomy = evaluateRouteOwnership(seeded, ROUTE_OWNERSHIP, [
      ...UNDECLARED_ACKNOWLEDGED,
      { route: 'GET /api/v2/some-other-route', openQuestion: 'unrelated' },
    ]);
    expect(roomy.undeclared).toEqual(['GET /api/v2/seeded-undeclared-route']);
  });

  it('goes red on an unjustified non-tenant-scoped declaration', () => {
    const bad: RouteOwnershipDeclaration[] = [{ route: registered[0] as string, class: 'public-by-contract' }];
    expect(evaluateRouteOwnership([registered[0] as string], bad, []).unjustified).toEqual([registered[0] as string]);
  });

  it('goes red on a declaration whose route no longer exists', () => {
    const stale = evaluateRouteOwnership([], [{ route: 'GET /api/v2/removed', class: 'tenant-scoped' }], []);
    expect(stale.stale).toEqual(['GET /api/v2/removed']);
  });
});
