/**
 * Server tenancy posture (issue #982).
 *
 * The posture is the authenticated answer to the question a route-level 404
 * cannot answer: which of the four flag/enforcement worlds is this server in?
 * Its two predicates already have their own strictness suites
 * (`feature-flag.test.ts`, `enforcement-posture.test.ts`); what is pinned here
 * is the COMPOSITION — all four combinations render correctly, the mounted
 * fact tracks the same predicate the `app.ts` mount site uses, and the mixed
 * state the posture implies is exactly the one `mixedTenancyStateWarning`
 * warns about, so the two surfaces can never disagree.
 */

import { describe, expect, test } from 'bun:test';
import { mixedTenancyStateWarning } from '../enforcement-posture';
import { serverTenancyPosture } from '../server-posture';

const worlds = [
  { name: 'flag off + legacy (default)', env: {}, enabled: false, db: 'legacy' },
  { name: 'flag off + enforced', env: { OMNI_DB_ENFORCEMENT: 'on' }, enabled: false, db: 'enforced' },
  { name: 'flag on + legacy (mixed)', env: { OMNI_MULTITENANCY_ENABLED: 'true' }, enabled: true, db: 'legacy' },
  {
    name: 'flag on + enforced (finished)',
    env: { OMNI_MULTITENANCY_ENABLED: 'true', OMNI_DB_ENFORCEMENT: 'on' },
    enabled: true,
    db: 'enforced',
  },
] as const;

describe('all four flag/enforcement combinations render correctly', () => {
  for (const world of worlds) {
    test(world.name, () => {
      expect(serverTenancyPosture(world.env as NodeJS.ProcessEnv)).toEqual({
        multitenancyEnabled: world.enabled,
        controlPlaneMounted: world.enabled,
        dbEnforcement: world.db,
      });
    });
  }
});

describe('the posture and the boot warning name the same mixed state', () => {
  for (const world of worlds) {
    test(`${world.name}: warning fires iff the posture is advisory-only`, () => {
      const posture = serverTenancyPosture(world.env as NodeJS.ProcessEnv);
      const advisoryOnly = posture.multitenancyEnabled && posture.dbEnforcement === 'legacy';
      const warning = mixedTenancyStateWarning(posture.dbEnforcement, world.env as NodeJS.ProcessEnv);
      expect(warning !== null).toBe(advisoryOnly);
    });
  }
});

describe('both predicates keep their exact-string strictness through the composition', () => {
  test('a truthy-looking flag that is not the literal "true" is off', () => {
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      const posture = serverTenancyPosture({ OMNI_MULTITENANCY_ENABLED: value } as NodeJS.ProcessEnv);
      expect(posture.multitenancyEnabled).toBe(false);
      expect(posture.controlPlaneMounted).toBe(false);
    }
  });

  test('an enforcement value that is not the literal "on" is legacy', () => {
    for (const value of ['1', 'yes', 'ON', 'true', '']) {
      const posture = serverTenancyPosture({ OMNI_DB_ENFORCEMENT: value } as NodeJS.ProcessEnv);
      expect(posture.dbEnforcement).toBe('legacy');
    }
  });
});
