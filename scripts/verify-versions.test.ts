/**
 * Tests for scripts/verify-versions.ts — the NEW-file exemption (#1020).
 *
 * Run: bun test scripts/verify-versions.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { getAllVersionFields } from './lib/version-fields';
import { fieldStatus, readBasePaths } from './verify-versions';

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
  test("the DSH plugins carry Omni's version, npm lockfiles included where a folder keeps one", () => {
    const paths = new Set(getAllVersionFields().map((field) => field.path));
    for (const app of ['omni-ui-dsh', 'omni-ai-dsh', 'omni-channels-dsh', 'omni-canvas-dsh']) {
      expect(paths.has(`apps/${app}/package.json`)).toBe(true);
    }
    // Bun's lockfile does not record the root package's own version, so there is nothing to sync.
    for (const app of ['omni-channels-dsh', 'omni-canvas-dsh']) {
      expect(paths.has(`apps/${app}/package-lock.json`)).toBe(true);
    }
  });
});
