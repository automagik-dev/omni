/**
 * Registered-route enumeration for the ownership coverage gate
 * (wish: omni-full-multitenancy, Group G4).
 *
 * Split out of `route-ownership.ts` deliberately. The declarations in that
 * module are now read at REQUEST TIME by the tenancy edge (see
 * `resolveRouteOwnership`), and enumeration is the one part of the gate that
 * has to construct the whole application — `createApp` pulls in every route
 * module, which pulls in the middleware chain, which pulls in the tenancy edge.
 * Keeping the enumerator here means the declaration table stays a leaf module
 * with no import cycle back into the app it describes.
 *
 * Routes are read from the Hono app itself rather than from a hand-kept list,
 * under the UNION of the feature-flag combinations that change which routes
 * exist (`A2A_ENABLED`, `OMNI_MULTITENANCY_ENABLED`). A route that only exists
 * when a flag is on is still a route.
 *
 * `app.routes` contains middleware registrations alongside handlers. They are
 * told apart by arity: Hono middleware is `(c, next)` and a terminal handler is
 * `(c)`. Only `ALL`-method entries need the test — every other method is a real
 * route — so a two-argument `ALL` entry is skipped and a one-argument one (the
 * A2A-disabled 503 stub, the SPA fallback) is kept and must be declared.
 */

import { createApp } from '../app';
import type { RouteKey } from './route-ownership';

/**
 * Flag combinations that change the registered route set.
 *
 * OMNI_FORCE_UI_ROUTES is pinned on in every combination: the UI static routes
 * normally register only when apps/ui/dist exists on disk, and the enumerated
 * surface must be the union -- independent of whether the UI bundle happens to
 * be built in this checkout (CI's typecheck builds it; a bare checkout has not).
 */
const FLAG_COMBINATIONS: readonly Record<string, string>[] = [
  { A2A_ENABLED: 'true', OMNI_MULTITENANCY_ENABLED: 'true', OMNI_FORCE_UI_ROUTES: 'true' },
  { A2A_ENABLED: 'true', OMNI_MULTITENANCY_ENABLED: '', OMNI_FORCE_UI_ROUTES: 'true' },
  { A2A_ENABLED: '', OMNI_MULTITENANCY_ENABLED: 'true', OMNI_FORCE_UI_ROUTES: 'true' },
  { A2A_ENABLED: '', OMNI_MULTITENANCY_ENABLED: '', OMNI_FORCE_UI_ROUTES: 'true' },
];

/**
 * Every route the app can register, across flag combinations.
 *
 * Takes a factory so a test can enumerate a DELIBERATELY seeded extra route and
 * prove the gate goes red on it, rather than trusting that it would.
 */
export function enumerateRegisteredRoutes(
  appFactory: () => { routes: { method: string; path: string; handler: { length: number } }[] } = () =>
    createApp(undefined as never, null, null).app,
): RouteKey[] {
  const seen = new Set<RouteKey>();
  const restore = {
    A2A_ENABLED: process.env.A2A_ENABLED,
    OMNI_MULTITENANCY_ENABLED: process.env.OMNI_MULTITENANCY_ENABLED,
    OMNI_FORCE_UI_ROUTES: process.env.OMNI_FORCE_UI_ROUTES,
  };
  try {
    for (const combo of FLAG_COMBINATIONS) {
      for (const [key, value] of Object.entries(combo)) process.env[key] = value;
      for (const route of appFactory().routes) {
        // Middleware, not a route: `(c, next)`.
        if (route.method === 'ALL' && route.handler.length >= 2) continue;
        seen.add(`${route.method} ${route.path}`);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return [...seen].sort();
}
