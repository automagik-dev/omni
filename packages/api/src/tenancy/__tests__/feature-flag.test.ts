/**
 * Feature-flag gate tests (wish: omni-full-multitenancy, Group G1).
 */

import { describe, expect, test } from 'bun:test';
import { MULTITENANCY_FLAG_ENV, isMultitenancyEnabled, pairedAgentFlagState } from '../feature-flag';

describe('isMultitenancyEnabled', () => {
  test('enabled ONLY on the exact string "true"', () => {
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: 'true' })).toBe(true);
  });

  test('disabled by default and for every other value', () => {
    expect(isMultitenancyEnabled({})).toBe(false);
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: '' })).toBe(false);
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: 'TRUE' })).toBe(false);
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: '1' })).toBe(false);
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: 'yes' })).toBe(false);
    expect(isMultitenancyEnabled({ [MULTITENANCY_FLAG_ENV]: 'false' })).toBe(false);
  });
});

describe('pairedAgentFlagState', () => {
  test('consumers is enabled only by exact true with multitenancy off', () => {
    for (const multitenancy of [undefined, '', 'false', '1', 'TRUE']) {
      expect(
        pairedAgentFlagState('consumers', {
          OMNI_PAIRED_AGENT_CONSUMERS: 'true',
          OMNI_MULTITENANCY_ENABLED: multitenancy,
        }),
      ).toEqual({ slice: 'consumers', flag: 'OMNI_PAIRED_AGENT_CONSUMERS', enabled: true, reason: null });
    }
  });

  test('all other flag values are flag_unset, including when multitenancy is on', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
      for (const multitenancy of [undefined, 'true']) {
        expect(
          pairedAgentFlagState('consumers', {
            OMNI_PAIRED_AGENT_CONSUMERS: value,
            OMNI_MULTITENANCY_ENABLED: multitenancy,
          }),
        ).toEqual({ slice: 'consumers', flag: 'OMNI_PAIRED_AGENT_CONSUMERS', enabled: false, reason: 'flag_unset' });
      }
    }
  });

  test('refuses multitenancy with a reason and reads the environment on each call', () => {
    const env = { OMNI_PAIRED_AGENT_CONSUMERS: 'true', OMNI_MULTITENANCY_ENABLED: 'true' };
    expect(pairedAgentFlagState('consumers', env)).toEqual({
      slice: 'consumers',
      flag: 'OMNI_PAIRED_AGENT_CONSUMERS',
      enabled: false,
      reason: 'multitenancy_enabled',
    });
    env.OMNI_MULTITENANCY_ENABLED = 'false';
    expect(pairedAgentFlagState('consumers', env).enabled).toBe(true);
    env.OMNI_PAIRED_AGENT_CONSUMERS = '';
    expect(pairedAgentFlagState('consumers', env).reason).toBe('flag_unset');
  });
});
