/**
 * detectParallelNpmGlobalInstall tests
 *
 * Pure-ish unit tests for the parallel-npm-global-install probe used by
 * `omni update`. Omni installs via `bun add -g`; an npm-global install of
 * `@automagik/omni` shadows the bun binary on PATH and confuses
 * `which omni`. The probe runs early in `omni update` to surface this with
 * a one-line warning + the offending path.
 *
 * Tests inject a stubbed `npmRoot()` + `exists()` so we never spawn `npm`
 * or touch the developer's actual filesystem.
 */

import { describe, expect, test } from 'bun:test';
import { detectParallelNpmGlobalInstall } from '../commands/update.js';

describe('detectParallelNpmGlobalInstall', () => {
  test('returns { detected: true, path } when @automagik/omni exists in npm root', () => {
    const result = detectParallelNpmGlobalInstall({
      npmRoot: () => '/usr/lib/node_modules',
      exists: (p) => p === '/usr/lib/node_modules/@automagik/omni',
    });
    expect(result.detected).toBe(true);
    expect(result.path).toBe('/usr/lib/node_modules/@automagik/omni');
    expect(result.skipped).toBeUndefined();
  });

  test('returns { detected: false } when npm root exists but no @automagik/omni present', () => {
    const result = detectParallelNpmGlobalInstall({
      npmRoot: () => '/usr/lib/node_modules',
      exists: () => false,
    });
    expect(result.detected).toBe(false);
    expect(result.path).toBeUndefined();
    expect(result.skipped).toBeUndefined();
  });

  test('returns { detected: false, skipped: "npm-not-on-path" } when npm root is null', () => {
    const result = detectParallelNpmGlobalInstall({
      npmRoot: () => null,
      exists: () => false,
    });
    expect(result.detected).toBe(false);
    expect(result.skipped).toBe('npm-not-on-path');
  });

  test('returns { detected: false, skipped: "npm-not-on-path" } when npm root is empty string', () => {
    const result = detectParallelNpmGlobalInstall({
      npmRoot: () => '',
      exists: () => false,
    });
    expect(result.detected).toBe(false);
    expect(result.skipped).toBe('npm-not-on-path');
  });

  test('returns { detected: false, skipped: "npm-root-failed" } when npmRoot throws', () => {
    const result = detectParallelNpmGlobalInstall({
      npmRoot: () => {
        throw new Error('npm not found');
      },
      exists: () => false,
    });
    expect(result.detected).toBe(false);
    expect(result.skipped).toBe('npm-root-failed');
  });

  test('checks the canonical sub-path <root>/@automagik/omni (joined with platform separator)', () => {
    let probedPath = '';
    detectParallelNpmGlobalInstall({
      npmRoot: () => '/opt/npm/global',
      exists: (p) => {
        probedPath = p;
        return false;
      },
    });
    // join() collapses separators; just check both segments are present
    expect(probedPath).toContain('/opt/npm/global');
    expect(probedPath).toContain('@automagik');
    expect(probedPath).toContain('omni');
  });
});
