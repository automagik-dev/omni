/**
 * requirements tests
 *
 * Covers the compile-time peer-version manifest introduced by
 * `.genie/wishes/pgserve-singleton-no-proxy/` (Group 6):
 *   - REQUIREMENTS exposes `pgserve` + `genie` with `>=` shape
 *   - parseVersionTriple is robust to typical CLI output shapes
 *   - parseConstraint rejects unsupported shapes (no `~`, no `^`)
 *   - compareVersions sorts triples deterministically
 *   - satisfiesConstraint round-trips through parse + compare
 *   - checkPeerVersion honors the override path (no shell-out under test)
 *   - unknown peer name returns a typed error result, never throws
 */

import { describe, expect, test } from 'bun:test';
import {
  REQUIREMENTS,
  checkPeerVersion,
  compareVersions,
  parseConstraint,
  parseVersionTriple,
  satisfiesConstraint,
} from '../lib/requirements.js';

describe('REQUIREMENTS manifest', () => {
  test('declares pgserve at >=2.3', () => {
    expect(REQUIREMENTS.pgserve).toBe('>=2.3');
  });

  test('declares genie at >=5.0', () => {
    expect(REQUIREMENTS.genie).toBe('>=5.0');
  });

  test('every entry uses the >= shape', () => {
    for (const [name, spec] of Object.entries(REQUIREMENTS)) {
      expect(spec.startsWith('>=')).toBe(true);
      // Sanity: every declared spec must round-trip through parseConstraint
      // (compile-time invariant — broken release would surface here).
      expect(() => parseConstraint(spec)).not.toThrow();
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('parseVersionTriple', () => {
  test('parses canonical "MAJOR.MINOR.PATCH" form', () => {
    expect(parseVersionTriple('2.3.1')).toEqual({ major: 2, minor: 3, patch: 1 });
  });

  test('parses "MAJOR.MINOR" form (patch defaults to 0)', () => {
    expect(parseVersionTriple('5.0')).toEqual({ major: 5, minor: 0, patch: 0 });
  });

  test('skips a leading binary name + space', () => {
    expect(parseVersionTriple('pgserve 2.3.1')).toEqual({ major: 2, minor: 3, patch: 1 });
  });

  test('skips a leading "v" prefix embedded in the line', () => {
    expect(parseVersionTriple('genie v5.0.0-rc.2')).toEqual({ major: 5, minor: 0, patch: 0 });
  });

  test('parses CalVer date-style versions (omni)', () => {
    expect(parseVersionTriple('omni 2.260507.4')).toEqual({ major: 2, minor: 260507, patch: 4 });
  });

  test('returns null when no triple is present', () => {
    expect(parseVersionTriple('not-a-version')).toBeNull();
  });

  test('returns null on empty input', () => {
    expect(parseVersionTriple('')).toBeNull();
  });
});

describe('parseConstraint', () => {
  test('parses ">=2.3" into a triple', () => {
    expect(parseConstraint('>=2.3')).toEqual({ major: 2, minor: 3, patch: 0 });
  });

  test('parses ">=5.0.1"', () => {
    expect(parseConstraint('>=5.0.1')).toEqual({ major: 5, minor: 0, patch: 1 });
  });

  test('throws on unsupported shapes (^, ~, ranges)', () => {
    expect(() => parseConstraint('^2.3.0')).toThrow(/Unsupported version constraint shape/);
    expect(() => parseConstraint('~2.3.0')).toThrow(/Unsupported version constraint shape/);
    expect(() => parseConstraint('2.3.0')).toThrow(/Unsupported version constraint shape/);
  });

  test('throws when the embedded triple is malformed', () => {
    expect(() => parseConstraint('>=not-a-version')).toThrow(/Could not parse version triple/);
  });
});

describe('compareVersions', () => {
  test('major-minor-patch ordering', () => {
    expect(compareVersions({ major: 2, minor: 3, patch: 1 }, { major: 2, minor: 3, patch: 1 })).toBe(0);
    expect(compareVersions({ major: 2, minor: 3, patch: 1 }, { major: 2, minor: 3, patch: 0 })).toBeGreaterThan(0);
    expect(compareVersions({ major: 2, minor: 3, patch: 0 }, { major: 2, minor: 4, patch: 0 })).toBeLessThan(0);
    expect(compareVersions({ major: 3, minor: 0, patch: 0 }, { major: 2, minor: 99, patch: 99 })).toBeGreaterThan(0);
  });
});

describe('satisfiesConstraint', () => {
  test('exact match satisfies >=', () => {
    expect(satisfiesConstraint('2.3.0', '>=2.3')).toBe(true);
  });

  test('newer patch satisfies', () => {
    expect(satisfiesConstraint('2.3.5', '>=2.3')).toBe(true);
  });

  test('newer minor satisfies', () => {
    expect(satisfiesConstraint('2.4.0', '>=2.3')).toBe(true);
  });

  test('older minor does NOT satisfy', () => {
    expect(satisfiesConstraint('2.2.99', '>=2.3')).toBe(false);
  });

  test('older major does NOT satisfy', () => {
    expect(satisfiesConstraint('1.99.0', '>=2.3')).toBe(false);
  });

  test('CalVer satisfies under >=2.3 (since 260507 > 3)', () => {
    expect(satisfiesConstraint('2.260507.4', '>=2.3')).toBe(true);
  });

  test('malformed current version returns false (does not throw)', () => {
    expect(satisfiesConstraint('not-a-version', '>=2.3')).toBe(false);
  });
});

describe('checkPeerVersion (override path)', () => {
  test('returns ok=true when override is at requirement', async () => {
    const result = await checkPeerVersion('pgserve', '2.3.0');
    expect(result.ok).toBe(true);
    expect(result.current).toBe('2.3.0');
    expect(result.required).toBe('>=2.3');
    expect(result.reason).toBeUndefined();
  });

  test('returns ok=true when override is above requirement', async () => {
    const result = await checkPeerVersion('genie', '6.1.0');
    expect(result.ok).toBe(true);
    expect(result.current).toBe('6.1.0');
  });

  test('returns ok=false with remediation reason when override is below requirement', async () => {
    const result = await checkPeerVersion('pgserve', '2.2.4');
    expect(result.ok).toBe(false);
    expect(result.current).toBe('2.2.4');
    expect(result.reason).toContain('does not satisfy');
    expect(result.reason).toContain('pgserve update');
  });

  test('returns ok=false when override is null (peer not installed)', async () => {
    const result = await checkPeerVersion('pgserve', null);
    expect(result.ok).toBe(false);
    expect(result.current).toBeNull();
    expect(result.reason).toContain('not installed');
  });

  test('returns ok=false on unknown peer name (no throw)', async () => {
    const result = await checkPeerVersion('does-not-exist');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Unknown peer');
  });

  test('parses a noisy override (binary name + version)', async () => {
    const result = await checkPeerVersion('pgserve', 'pgserve 2.3.1\n');
    expect(result.ok).toBe(true);
    expect(result.current).toBe('2.3.1');
  });

  test('returns ok=false with parse-error reason on a totally bogus override', async () => {
    const result = await checkPeerVersion('pgserve', 'no version here');
    expect(result.ok).toBe(false);
    expect(result.current).toBe('no version here');
    expect(result.reason).toContain('parse');
  });
});
