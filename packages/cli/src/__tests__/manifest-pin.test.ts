/**
 * Tests for the CLI-startup manifest self-heal.
 *
 * The .cjs postinstall hook has its own test suite
 * (../../__tests__/postinstall-pin-version.test.ts). This suite covers
 * the TS-side equivalent that runs on every CLI invocation — the
 * "second leg" that closes the bun-lifecycle race where bun writes the
 * manifest AFTER running postinstall.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinManifestEntry } from '../manifest-pin';

let tmp: string;

function manifestAt(deps: Record<string, string>): string {
  const path = join(tmp, 'package.json');
  writeFileSync(path, JSON.stringify({ dependencies: deps }, null, 2));
  return path;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'omni-manifest-pin-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('pinManifestEntry', () => {
  test('rewrites caret range to exact', () => {
    const path = manifestAt({ '@automagik/omni': '^2.260430.10' });
    const changed = pinManifestEntry(path, '2.260430.10');
    expect(changed).toBe(true);
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe('2.260430.10');
  });

  test('rewrites tilde range to exact', () => {
    const path = manifestAt({ '@automagik/omni': '~2.260430.10' });
    const changed = pinManifestEntry(path, '2.260430.10');
    expect(changed).toBe(true);
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe('2.260430.10');
  });

  test('idempotent — already-exact pin is a no-op', () => {
    const path = manifestAt({ '@automagik/omni': '2.260430.10' });
    const before = readFileSync(path, 'utf-8');
    const changed = pinManifestEntry(path, '2.260430.10');
    expect(changed).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(before);
  });

  test('only touches @automagik/omni — leaves other deps alone', () => {
    const path = manifestAt({
      '@automagik/omni': '^2.260430.10',
      '@automagik/genie': '^4.260430.12',
      pgserve: '^2.0.4',
    });
    pinManifestEntry(path, '2.260430.10');
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe('2.260430.10');
    // Other deps unchanged — their ranges are not in scope.
    expect(after.dependencies['@automagik/genie']).toBe('^4.260430.12');
    expect(after.dependencies.pgserve).toBe('^2.0.4');
  });

  test('leaves non-range specs alone (file:, git+, tarball)', () => {
    const path = manifestAt({
      '@automagik/omni': 'file:../local-tarball.tgz',
    });
    const changed = pinManifestEntry(path, '2.260430.10');
    expect(changed).toBe(false);
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe('file:../local-tarball.tgz');
  });

  test('walks devDependencies / peerDependencies / optionalDependencies too', () => {
    const path = join(tmp, 'package.json');
    writeFileSync(
      path,
      JSON.stringify(
        {
          devDependencies: { '@automagik/omni': '^2.260430.10' },
          peerDependencies: { '@automagik/omni': '~2.260430.10' },
          // Note: optionalDependencies left at exact intentionally to
          // confirm the loop continues past unchanged fields.
          optionalDependencies: { '@automagik/omni': '2.260430.10' },
        },
        null,
        2,
      ),
    );
    const changed = pinManifestEntry(path, '2.260430.10');
    expect(changed).toBe(true);
    const after = JSON.parse(readFileSync(path, 'utf-8'));
    expect(after.devDependencies['@automagik/omni']).toBe('2.260430.10');
    expect(after.peerDependencies['@automagik/omni']).toBe('2.260430.10');
    expect(after.optionalDependencies['@automagik/omni']).toBe('2.260430.10');
  });

  test('missing manifest file → false (no crash)', () => {
    const path = join(tmp, 'does-not-exist.json');
    expect(pinManifestEntry(path, '2.260430.10')).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  test('malformed JSON → false (no crash, manifest preserved)', () => {
    const path = join(tmp, 'package.json');
    writeFileSync(path, '{ this is { not valid JSON');
    const before = readFileSync(path, 'utf-8');
    expect(pinManifestEntry(path, '2.260430.10')).toBe(false);
    expect(readFileSync(path, 'utf-8')).toBe(before);
  });

  // Skipped under root: the superuser bypasses filesystem permission bits, so a
  // 0o500 dir is still writable and the "atomic-rename fails" path can't trigger.
  test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'readonly directory → false (no crash, manifest preserved)',
    () => {
      const dir = join(tmp, 'locked');
      mkdirSync(dir);
      const path = join(dir, 'package.json');
      writeFileSync(path, JSON.stringify({ dependencies: { '@automagik/omni': '^2.260430.10' } }));
      require('node:fs').chmodSync(dir, 0o500);
      try {
        const changed = pinManifestEntry(path, '2.260430.10');
        // Atomic-rename failed; the manifest stays as-is.
        expect(changed).toBe(false);
      } finally {
        require('node:fs').chmodSync(dir, 0o755);
      }
    },
  );
});
