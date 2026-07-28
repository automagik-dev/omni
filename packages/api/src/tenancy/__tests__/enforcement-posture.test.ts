/**
 * Boot posture: multitenancy on, database enforcement off
 * (wish: omni-full-multitenancy, Group G4).
 *
 * This combination boots — it is the documented migration path, and refusing it
 * would make the intended rollout order impossible to execute. What it may not
 * do is boot SILENTLY: it issues credentials that imply a tenant boundary the
 * database does not enforce, and an operator who reaches production still in
 * this state must have been told.
 *
 * The warning text is asserted on content rather than shape. A warning that
 * does not name both variables cannot be searched for in a log, and one that
 * does not say what is unenforced is not actionable — so those are the
 * assertions, not the wording around them.
 */

import { describe, expect, test } from 'bun:test';
import { mixedTenancyStateWarning } from '../enforcement-posture';

const ON = { OMNI_MULTITENANCY_ENABLED: 'true' } as NodeJS.ProcessEnv;
const OFF = {} as NodeJS.ProcessEnv;

describe('the isolation-free mixed state is announced', () => {
  test('multitenancy on with legacy database enforcement warns', () => {
    expect(mixedTenancyStateWarning('legacy', ON)).not.toBeNull();
  });

  test('the warning names both variables and the consequence', () => {
    const warning = mixedTenancyStateWarning('legacy', ON) ?? '';
    expect(warning).toContain('OMNI_MULTITENANCY_ENABLED');
    expect(warning).toContain('OMNI_DB_ENFORCEMENT');
    // What is actually not enforced, and what to do about it.
    expect(warning).toContain('row-level');
    expect(warning).toContain('OMNI_DB_ENFORCEMENT=on');
  });
});

describe('the three coherent combinations stay silent', () => {
  test('the default deployment — flag off, legacy enforcement — says nothing', () => {
    // Legacy invariance: a pre-wish deployment must not gain a new boot line.
    expect(mixedTenancyStateWarning('legacy', OFF)).toBeNull();
  });

  test('enforcement installed before the flag is turned on says nothing', () => {
    // Strictly safer than the default, and the correct order to arrive in.
    expect(mixedTenancyStateWarning('enforced', OFF)).toBeNull();
  });

  test('the finished state says nothing', () => {
    expect(mixedTenancyStateWarning('enforced', ON)).toBeNull();
  });
});

describe('the flag is read with the same strictness everywhere', () => {
  test('a truthy-looking value that is not the literal "true" is not the flag', () => {
    // `isMultitenancyEnabled` accepts only "true". A warning that fired on "1"
    // or "yes" would claim a control plane is mounted when none is.
    for (const value of ['1', 'yes', 'TRUE', 'false', '']) {
      expect(mixedTenancyStateWarning('legacy', { OMNI_MULTITENANCY_ENABLED: value })).toBeNull();
    }
  });
});
