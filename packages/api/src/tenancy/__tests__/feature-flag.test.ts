/**
 * Feature-flag gate tests (wish: omni-full-multitenancy, Group G1).
 */

import { describe, expect, test } from 'bun:test';
import { MULTITENANCY_FLAG_ENV, isMultitenancyEnabled } from '../feature-flag';

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
