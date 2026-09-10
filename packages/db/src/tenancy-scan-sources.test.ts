import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSources } from './tenancy-scan-sources';

const root = mkdtempSync(join(tmpdir(), 'tenancy-scan-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('readSources', () => {
  test('tolerates entries that vanish between listing and read (issue #1080)', () => {
    mkdirSync(join(root, '__g5_egress_scratch__'), { recursive: true });
    writeFileSync(join(root, 'kept.ts'), 'export const kept = 1;');
    writeFileSync(join(root, 'kept.test.ts'), 'export const test = 1;');
    // A dangling symlink is listed by readdir but fails stat/read with ENOENT —
    // the same shape as a sibling test deleting its scratch file mid-walk.
    symlinkSync(join(root, 'gone.ts'), join(root, '__g5_egress_scratch__', 'rogue-egress.ts'));
    symlinkSync(join(root, 'gone-dir'), join(root, 'vanished-dir'));

    const files = readSources(root).map((s) => s.file);
    expect(files).toEqual([join(root, 'kept.ts')]);
  });

  test('returns nothing for a root that no longer exists', () => {
    expect(readSources(join(root, 'never-existed'))).toEqual([]);
  });
});
