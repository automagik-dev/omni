/**
 * Tests for scripts/verify-versions.ts — the NEW-file exemption (#1020) and the plugin fields,
 * which may lag (the rule itself: scripts/plugin-versions.test.ts).
 *
 * Run: bun test scripts/verify-versions.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { getAllVersionFields } from './lib/version-fields';
import { fieldStatus, pluginFieldStatus, readBasePaths } from './verify-versions';

describe('fieldStatus', () => {
  const base = new Set(['package.json', 'packages/api/package.json']);

  test('matching version is OK regardless of base', () => {
    expect(fieldStatus('1.0.0', '1.0.0', 'packages/api/package.json', base)).toBe('OK');
    expect(fieldStatus('1.0.0', '1.0.0', 'packages/new/package.json', null)).toBe('OK');
  });

  test('drift in a file that exists on base is a MISMATCH', () => {
    expect(fieldStatus('0.9.0', '1.0.0', 'packages/api/package.json', base)).toBe('MISMATCH');
    expect(fieldStatus(null, '1.0.0', 'packages/api/package.json', base)).toBe('MISMATCH');
  });

  test('drift in a file absent from base is NEW (exempt)', () => {
    expect(fieldStatus('0.9.0', '1.0.0', 'packages/new/package.json', base)).toBe('NEW');
  });

  test('without a base ref every drift is a MISMATCH', () => {
    expect(fieldStatus('0.9.0', '1.0.0', 'packages/new/package.json', null)).toBe('MISMATCH');
  });
});

describe('pluginFieldStatus', () => {
  const lock = { path: 'apps/omni-channels-dsh/package-lock.json' };

  test("a plugin at the root's version is OK, one behind it LAGS", () => {
    expect(pluginFieldStatus(lock, '1.0.0', '1.0.0', '1.0.0', null)).toBe('OK');
    expect(pluginFieldStatus(lock, '0.9.0', '0.9.0', '1.0.0', null)).toBe('LAGS');
  });

  test("a lockfile that does not carry its plugin's own version is a MISMATCH", () => {
    expect(pluginFieldStatus(lock, '1.0.0', '0.9.0', '1.0.0', null)).toBe('MISMATCH');
    expect(pluginFieldStatus(lock, null, '0.9.0', '1.0.0', null)).toBe('MISMATCH');
  });

  test('a plugin new on this branch is exempt like any new file', () => {
    expect(pluginFieldStatus(lock, '1.0.0', '0.9.0', '1.0.0', new Set(['package.json']))).toBe('NEW');
  });
});

describe('readBasePaths', () => {
  test('null base means no exemption', () => {
    expect(readBasePaths(null)).toBeNull();
  });

  test('lists the tracked tree of a real ref', () => {
    const paths = readBasePaths('HEAD');
    expect(paths?.has('package.json')).toBe(true);
    expect(paths?.has('scripts/verify-versions.ts')).toBe(true);
  });
});

describe('getAllVersionFields', () => {
  test('the DSH plugins are tracked as plugins, npm lockfiles included where a folder keeps one', () => {
    const fields = getAllVersionFields();
    const paths = new Set(fields.map((field) => field.path));
    for (const field of fields)
      expect([field.path, field.plugin ?? null]).toEqual([
        field.path,
        field.path.startsWith('apps/') ? field.path.split('/').slice(0, 2).join('/') : null,
      ]);
    for (const app of ['omni-channels-dsh', 'omni-canvas-dsh']) {
      expect(paths.has(`apps/${app}/package.json`)).toBe(true);
    }
    // Bun's lockfile does not record the root package's own version, so there is nothing to sync.
    for (const app of ['omni-channels-dsh', 'omni-canvas-dsh']) {
      expect(paths.has(`apps/${app}/package-lock.json`)).toBe(true);
    }
    // The Bot team and the welcome carry Automagik's version, in automagik-dev/automagik: the
    // pin (apps/automagik.json) and the Automagik source fetched for tests are not Omni's.
    expect([...paths].some((path) => path.startsWith('apps/automagik') || path.startsWith('apps/.automagik'))).toBe(
      false,
    );
  });
});
