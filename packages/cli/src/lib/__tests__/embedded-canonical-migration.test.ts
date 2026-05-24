import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readDataDirMajor } from '../embedded-canonical-migration.js';

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
