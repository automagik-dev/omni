import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MIGRATION_SKIP_TABLES,
  compareVersionDesc,
  embeddedPostgresPackage,
  readDataDirMajor,
} from '../embedded-canonical-migration.js';

// readDataDirMajor underpins the matching-major reader selection: the temp
// postmaster MUST be the same PG major as the data dir's catalog, or it
// refuses to start ("database files are incompatible with server").

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'omni-pgver-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reads the PG_VERSION catalog major (17)', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'PG_VERSION'), '17\n');
    expect(readDataDirMajor(dir)).toBe(17);
  });
});

test('reads PG_VERSION major 18', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'PG_VERSION'), '18');
    expect(readDataDirMajor(dir)).toBe(18);
  });
});

test('returns null when PG_VERSION is absent', () => {
  withTempDir((dir) => {
    expect(readDataDirMajor(dir)).toBeNull();
  });
});

test('returns null on a non-numeric PG_VERSION', () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, 'PG_VERSION'), 'not-a-version');
    expect(readDataDirMajor(dir)).toBeNull();
  });
});

test('compareVersionDesc sorts autopg version dirs newest-first, deterministically', () => {
  const dirs = ['v2.6.1', 'v3.0.7', 'v2.6.10', 'v3.0.6'];
  expect([...dirs].sort(compareVersionDesc)).toEqual(['v3.0.7', 'v3.0.6', 'v2.6.10', 'v2.6.1']);
  // numeric (not lexicographic): 2.6.10 must sort above 2.6.1
  expect(compareVersionDesc('v2.6.10', 'v2.6.1')).toBeLessThan(0);
});

test('install-local auth tables are preserved (never overwritten by migration)', () => {
  // Regression guard: copying embedded api_keys broke `omni` CLI auth
  // ("Invalid API key") immediately after migration.
  expect(MIGRATION_SKIP_TABLES.has('api_keys')).toBe(true);
  expect(MIGRATION_SKIP_TABLES.has('api_key_audit_logs')).toBe(true);
  expect(MIGRATION_SKIP_TABLES.has('media_content')).toBe(true);
});

test('embeddedPostgresPackage maps the host to a real @embedded-postgres package', () => {
  const pkg = embeddedPostgresPackage();
  // On supported CI/dev hosts (linux/darwin x64/arm64) it resolves; never throws.
  if (pkg !== null) {
    expect(pkg).toMatch(/^@embedded-postgres\/(linux|darwin|windows)-(x64|arm64)$/);
  }
});
