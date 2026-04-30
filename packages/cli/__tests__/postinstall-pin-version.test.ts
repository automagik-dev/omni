/**
 * Tests for the postinstall-pin-version hook.
 *
 * Why CommonJS .cjs script + TypeScript test? The script must run from
 * raw `node` (no bun, no transpiler) on bare-metal npm/bun installs
 * before any of our build artifacts exist. Tests run via bun:test and
 * shell out to `node` against the real script with a temp HOME so the
 * effects are observable on disk.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '..', 'scripts', 'postinstall-pin-version.cjs');

let tmpHome: string;

function runScript(env: Record<string, string> = {}): { code: number; stderr: string } {
  const result = spawnSync('node', [SCRIPT], {
    env: { ...process.env, HOME: tmpHome, ...env },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stderr: result.stderr };
}

function writeBunGlobalManifest(deps: Record<string, string>): string {
  const dir = join(tmpHome, '.bun', 'install', 'global');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify({ dependencies: deps }, null, 2));
  return path;
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'omni-postinstall-'));
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('postinstall-pin-version', () => {
  test('rewrites caret range to exact for @automagik/omni', async () => {
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': '^2.260430.0',
      '@automagik/genie': '^4.260430.12',
    });

    const { code } = runScript();
    expect(code).toBe(0);

    const after = JSON.parse(readFileSync(manifest, 'utf-8'));
    // @automagik/omni: pinned to whatever this package's version is (no caret)
    expect(after.dependencies['@automagik/omni']).not.toMatch(/^[\^~]/);
    // package.json's own version dictates the pin
    const ourPkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe(ourPkg.version);
    // Other deps untouched (only our package gets pinned)
    expect(after.dependencies['@automagik/genie']).toBe('^4.260430.12');
  });

  test('leaves exact-pinned omni alone (idempotent)', async () => {
    const ourPkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': ourPkg.version, // already exact
    });

    const before = readFileSync(manifest, 'utf-8');
    const { code } = runScript();
    expect(code).toBe(0);
    const after = readFileSync(manifest, 'utf-8');
    expect(after).toBe(before);
  });

  test('also rewrites tilde ranges (~) — they have the same drift risk', async () => {
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': '~2.260430.0',
    });

    runScript();

    const after = JSON.parse(readFileSync(manifest, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).not.toMatch(/^[\^~]/);
  });

  test('leaves non-range specs alone (file:, git+, tarball URL)', async () => {
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': 'file:../local-omni-tarball.tgz',
    });

    runScript();

    const after = JSON.parse(readFileSync(manifest, 'utf-8'));
    expect(after.dependencies['@automagik/omni']).toBe('file:../local-omni-tarball.tgz');
  });

  test('OMNI_SKIP_POSTINSTALL_PIN=1 short-circuits the script', async () => {
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': '^2.260430.0',
    });

    const before = readFileSync(manifest, 'utf-8');
    const { code } = runScript({ OMNI_SKIP_POSTINSTALL_PIN: '1' });
    expect(code).toBe(0);
    const after = readFileSync(manifest, 'utf-8');
    // Nothing was written — operator opt-out respected.
    expect(after).toBe(before);
  });

  test('missing global manifest is a no-op (no error, exit 0)', async () => {
    // No manifest written. Script should exit cleanly.
    const { code } = runScript();
    expect(code).toBe(0);
  });

  test('malformed global manifest is a no-op (no crash, exit 0)', async () => {
    const dir = join(tmpHome, '.bun', 'install', 'global');
    mkdirSync(dir, { recursive: true });
    const manifest = join(dir, 'package.json');
    writeFileSync(manifest, '{ this is { not valid JSON }');

    const { code } = runScript();
    expect(code).toBe(0);
    // The garbage file is left untouched — we never write back malformed
    // content.
    expect(readFileSync(manifest, 'utf-8')).toContain('not valid JSON');
  });

  test('installation never fails — even when manifest write would error', async () => {
    // Make the manifest readonly so writeJsonAtomic's rename throws.
    // The script must STILL exit 0 — install path is too critical to
    // fail on a self-heal hook.
    const manifest = writeBunGlobalManifest({
      '@automagik/omni': '^2.260430.0',
    });
    const dir = join(tmpHome, '.bun', 'install', 'global');
    // Drop write perms on the directory so atomic rename can't clobber.
    require('node:fs').chmodSync(dir, 0o500);

    try {
      const { code } = runScript();
      expect(code).toBe(0);
    } finally {
      // Restore perms so cleanup can rm the dir.
      require('node:fs').chmodSync(dir, 0o755);
      // Ensure manifest still exists (we restored, didn't delete).
      expect(existsSync(manifest)).toBe(true);
    }
  });
});
