/**
 * Unit tests for the `omni start` legacy-embedded preflight guard (#722).
 */

import { describe, expect, test } from 'bun:test';
import { legacyEmbeddedNeedsMigration } from '../start.js';

describe('legacyEmbeddedNeedsMigration', () => {
  test('canonical install is never blocked (short-circuits before fs check)', () => {
    // useCanonicalPgserve === true wins regardless of on-disk embedded data.
    expect(legacyEmbeddedNeedsMigration(true, true)).toBe(false);
    expect(legacyEmbeddedNeedsMigration(true, false)).toBe(false);
  });

  test('legacy embedded (no canonical flag + embedded data present) → must migrate', () => {
    expect(legacyEmbeddedNeedsMigration(undefined, true)).toBe(true);
    expect(legacyEmbeddedNeedsMigration(false, true)).toBe(true);
  });

  test('fresh/no-embedded install (no embedded data dir) → not blocked', () => {
    expect(legacyEmbeddedNeedsMigration(undefined, false)).toBe(false);
    expect(legacyEmbeddedNeedsMigration(false, false)).toBe(false);
  });
});
