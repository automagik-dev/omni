/**
 * update-canonical-preflight tests
 *
 * Covers `checkCanonicalPgservePreflight` — the phase-2 cutoff guard
 * that halts `omni update` when crossing the canonical-pgserve default
 * flip on a host that hasn't migrated and has no pgserve binary.
 *
 * The function is pure (no I/O, no globals) so we drive it with a small
 * matrix of (currentVersion, targetVersion, useCanonicalPgserve,
 * pgserveOnPath) tuples and assert the expected halt vs proceed.
 */

import { describe, expect, test } from 'bun:test';
import { checkCanonicalPgservePreflight } from '../commands/update.js';

describe('checkCanonicalPgservePreflight', () => {
  // ----------------------------------------------------------------------
  // Safe-to-proceed paths
  // ----------------------------------------------------------------------

  test('returns null when current AND target are both pre-cutoff (irrelevant)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.20',
      targetVersion: '2.260501.7',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    expect(result).toBeNull();
  });

  test('returns null when current is already past cutoff (post-flip operator)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260502.5',
      targetVersion: '2.260503.1',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    expect(result).toBeNull();
  });

  test('returns null when operator has migrated (useCanonicalPgserve=true)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.1',
      useCanonicalPgserve: true,
      pgserveOnPath: false,
    });
    expect(result).toBeNull();
  });

  test('returns null when operator has explicitly opted into embedded (useCanonicalPgserve=false)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.1',
      useCanonicalPgserve: false,
      pgserveOnPath: false,
    });
    expect(result).toBeNull();
  });

  test('returns null when pgserve binary is on PATH (auto-detected)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.1',
      useCanonicalPgserve: undefined,
      pgserveOnPath: true,
    });
    expect(result).toBeNull();
  });

  // ----------------------------------------------------------------------
  // Dangerous path — must halt
  // ----------------------------------------------------------------------

  test('returns error when crossing cutoff with undefined flag AND no pgserve binary', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.1',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    expect(result).not.toBeNull();
    expect(result).toContain('Refusing to upgrade');
    expect(result).toContain('omni doctor --fix');
    expect(result).toContain('bun add -g pgserve');
    expect(result).toContain('useCanonicalPgserve');
  });

  test('error message offers all three remediation paths (migrate / pin / bypass)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.5',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    // (recommended) — canonical migration
    expect(result).toContain('omni doctor --fix');
    // (transitional) — explicit embedded opt-in
    expect(result).toContain('server.useCanonicalPgserve');
    // (escape hatch) — bypass flag
    expect(result).toContain('--skip-canonical-preflight');
  });

  // ----------------------------------------------------------------------
  // Edge cases — version parsing
  // ----------------------------------------------------------------------

  test('returns null when target version has malformed minor (defensive)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.not-a-number.5',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    // Defensive: a malformed version means we can't decide; default to proceed
    // rather than block legitimate upgrades on parse failures.
    expect(result).toBeNull();
  });

  test('cutoff boundary: target == 2.260502.0 triggers the check (>=, not >)', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260502.0',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    expect(result).not.toBeNull();
  });

  test('cutoff boundary: target one day before cutoff does NOT trigger', () => {
    const result = checkCanonicalPgservePreflight({
      currentVersion: '2.260430.10',
      targetVersion: '2.260501.99',
      useCanonicalPgserve: undefined,
      pgserveOnPath: false,
    });
    expect(result).toBeNull();
  });
});
