/**
 * Non-sensitive server tenancy posture for authenticated callers
 * (issue #982; wish: omni-full-multitenancy, follow-up to Group G4).
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A route-level 404 on `/api/v2/platform/**` is ambiguous three ways: the
 * multitenancy flag may be off, the server may predate the control plane
 * entirely, or the caller may hold the wrong credential class. An operator
 * diagnosing a deployment needs the server to SAY which world it is in — on an
 * authenticated surface, never an anonymous one.
 *
 * WHAT MAY BE SAID, AND WHERE
 * ---------------------------
 * Three deployment-level booleans/enums, nothing more:
 *
 *   * `multitenancyEnabled` — the `OMNI_MULTITENANCY_ENABLED` flag state.
 *   * `controlPlaneMounted` — whether `/api/v2/platform` exists on this server.
 *   * `dbEnforcement` — `legacy` | `enforced`, the same posture value the boot
 *     path feeds `warnOnMixedTenancyState` (enforcement-posture.ts).
 *
 * None of these name a tenant, count anything, or reveal resource existence,
 * so the block cannot become an inventory oracle. It still lives ONLY behind
 * auth (`POST /auth/validate`): the health-route privacy contract
 * (routes/health.ts) is untouched, and `public-surface-privacy.test.ts`
 * asserts these field names never appear on an unauthenticated surface.
 *
 * WHY THE ENVIRONMENT IS READ PER CALL
 * ------------------------------------
 * Both underlying predicates (`isMultitenancyEnabled`, `resolveEnforcementMode`)
 * deliberately read the environment on every call so tests can toggle them
 * without import-order coupling; this module follows suit. `controlPlaneMounted`
 * is derived from the exact predicate the mount site in `app.ts` uses, so in
 * any process whose environment is stable after boot — every real deployment —
 * it equals the actual mount decision. The field exists separately from
 * `multitenancyEnabled` because ABSENCE of the whole block is the third state:
 * a server too old to report posture at all, which is exactly the ambiguity
 * the block exists to resolve.
 */

import { resolveEnforcementMode } from '@omni/db';
import type { DbEnforcementPosture } from './enforcement-posture';
import { isMultitenancyEnabled } from './feature-flag';

export interface ServerTenancyPosture {
  /** `OMNI_MULTITENANCY_ENABLED` flag state (exact-string `"true"` semantics). */
  readonly multitenancyEnabled: boolean;
  /** Whether `/api/v2/platform` is mounted — same predicate as the `app.ts` mount site. */
  readonly controlPlaneMounted: boolean;
  /** Database enforcement posture, mirroring `warnOnMixedTenancyState`'s input. */
  readonly dbEnforcement: DbEnforcementPosture;
}

export function serverTenancyPosture(env: NodeJS.ProcessEnv = process.env): ServerTenancyPosture {
  const enabled = isMultitenancyEnabled(env);
  return {
    multitenancyEnabled: enabled,
    controlPlaneMounted: enabled,
    dbEnforcement: resolveEnforcementMode(env),
  };
}
