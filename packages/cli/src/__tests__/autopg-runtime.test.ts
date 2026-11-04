/**
 * The sandbox's autopg runtime, from autopg's GitHub release tarball pinned by sha256.
 *
 * No network: downloads are fakes that record their URL. Tarballs are real (built with tar in
 * a temp dir), so the extract and the seed of autopg's binary cache are checked on disk.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTOPG_PIN,
  type AutopgPin,
  autopgRuntimeReady,
  autopgTarget,
  detectLibc,
  installAutopgRuntime,
  readPgPasswordFile,
} from '../autopg-runtime.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-autopg-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A tarball in the release layout: autopg/{autopg, postgres/{bin,lib,share}}. */
function fixtureTarball(omit: string[] = []): { path: string; bytes: Uint8Array; sha256: string } {
  const stage = mkdtempSync(join(root, 'stage-'));
  const files: Record<string, string> = {
    'autopg/autopg': '#!/bin/sh\n',
    'autopg/postgres/bin/postgres': '#!/bin/sh\n',
    'autopg/postgres/bin/initdb': '#!/bin/sh\n',
    'autopg/postgres/lib/libpq.so.5': 'lib',
    'autopg/postgres/share/postgres.bki': 'share',
  };
  for (const [file, content] of Object.entries(files)) {
    if (omit.includes(file)) continue;
    mkdirSync(join(stage, file, '..'), { recursive: true });
    writeFileSync(join(stage, file), content, { mode: 0o755 });
  }
  const path = join(root, `fixture-${omit.length}.tar.gz`);
  const tar = Bun.spawnSync({ cmd: ['tar', '-czf', path, '-C', stage, 'autopg'] });
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
  const bytes = new Uint8Array(readFileSync(path));
  return { path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const pinFor = (fixture: { sha256: string; bytes: Uint8Array }, size = fixture.bytes.length): AutopgPin => ({
  version: '3.3.0',
  pgRuntime: '18.3.0-beta.17',
  platforms: { 'linux-arm64': { sha256: fixture.sha256, size } },
});

const LINUX_ARM64 = { platform: 'linux', arch: 'arm64', libc: 'glibc' } as const;

describe('autopgTarget', () => {
  test('the pin covers darwin-arm64, linux-arm64 and linux-x64-glibc, each by its release sha256', () => {
    expect(AUTOPG_PIN.version).toBe('3.3.0');
    expect(AUTOPG_PIN.pgRuntime).toBe('18.3.0-beta.17');
    expect(Object.keys(AUTOPG_PIN.platforms).sort()).toEqual(['darwin-arm64', 'linux-arm64', 'linux-x64-glibc']);
    for (const pinned of Object.values(AUTOPG_PIN.platforms)) expect(pinned?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a pinned platform gets its release asset and autopg binary-cache key', () => {
    const base = 'https://github.com/automagik-dev/autopg/releases/download/v3.3.0';
    expect(autopgTarget(AUTOPG_PIN, { platform: 'darwin', arch: 'arm64', libc: null })).toMatchObject({
      platform: 'darwin-arm64',
      cacheKey: 'darwin-arm64',
      url: `${base}/autopg-3.3.0-darwin-arm64.tar.gz`,
    });
    expect(autopgTarget(AUTOPG_PIN, LINUX_ARM64)).toMatchObject({ platform: 'linux-arm64', cacheKey: 'linux-arm64' });
    expect(autopgTarget(AUTOPG_PIN, { platform: 'linux', arch: 'x64', libc: 'glibc' })).toMatchObject({
      platform: 'linux-x64-glibc',
      cacheKey: 'linux-x64',
      sha256: AUTOPG_PIN.platforms['linux-x64-glibc']?.sha256,
      url: `${base}/autopg-3.3.0-linux-x64-glibc.tar.gz`,
    });
  });

  test('every other platform has no target, so it keeps npm pgserve', () => {
    for (const host of [
      { platform: 'darwin', arch: 'x64', libc: null },
      { platform: 'linux', arch: 'x64', libc: 'musl' },
      { platform: 'linux', arch: 'arm64', libc: 'musl' },
      { platform: 'linux', arch: 'ia32', libc: 'glibc' },
      { platform: 'win32', arch: 'x64', libc: null },
    ] as const) {
      expect(autopgTarget(AUTOPG_PIN, host)).toBeNull();
    }
  });

  test('a platform autopg ships but the pin leaves out is refused, never sent to npm pgserve', () => {
    const pin = pinFor({ sha256: '0'.repeat(64), bytes: new Uint8Array(1) });
    expect(() => autopgTarget(pin, { platform: 'darwin', arch: 'arm64', libc: null })).toThrow(
      /pin has no darwin-arm64 entry/,
    );
  });

  test('libc: musl where its loader is, glibc on any other Linux, none elsewhere', () => {
    const musl = (path: string) => path === '/lib/ld-musl-aarch64.so.1';
    expect(detectLibc('linux', 'arm64', musl)).toBe('musl');
    expect(detectLibc('linux', 'x64', musl)).toBe('glibc');
    expect(detectLibc('darwin', 'arm64', () => true)).toBeNull();
  });
});

describe('installAutopgRuntime', () => {
  const paths = () => ({ dir: join(root, 'home', 'autopg'), configDir: join(root, 'home', 'pgserve') });

  test('unpacks the verified tarball and seeds autopg binary cache, so autopg downloads nothing', async () => {
    const fixture = fixtureTarball();
    const target = autopgTarget(pinFor(fixture), LINUX_ARM64);
    if (!target) throw new Error('no target');
    const downloads: string[] = [];
    const binary = await installAutopgRuntime(paths(), target, {
      download: async (url) => {
        downloads.push(url);
        return fixture.bytes;
      },
    });

    expect(downloads).toEqual([
      'https://github.com/automagik-dev/autopg/releases/download/v3.3.0/autopg-3.3.0-linux-arm64.tar.gz',
    ]);
    expect(binary).toBe(join(root, 'home', 'autopg', '3.3.0', 'autopg'));
    expect(existsSync(binary)).toBe(true);
    // autopg's isCachedValid: bin/initdb, bin/postgres and a .version equal to its PINNED_PG_VERSION.
    const seed = join(root, 'home', 'pgserve', 'bin', 'linux-arm64');
    expect(existsSync(join(seed, 'bin', 'initdb'))).toBe(true);
    expect(existsSync(join(seed, 'bin', 'postgres'))).toBe(true);
    expect(existsSync(join(seed, 'lib', 'libpq.so.5'))).toBe(true);
    expect(existsSync(join(seed, 'share', 'postgres.bki'))).toBe(true);
    expect(readFileSync(join(seed, '.version'), 'utf-8').trim()).toBe('18.3.0-beta.17');
    expect(autopgRuntimeReady(paths(), target)).toBe(true);
  });

  test('a tarball whose sha256 is not the pin is refused, and nothing is written', async () => {
    const fixture = fixtureTarball();
    const target = autopgTarget(pinFor(fixture), LINUX_ARM64);
    if (!target) throw new Error('no target');
    const flipped = new Uint8Array(fixture.bytes);
    flipped[100] = (flipped[100] ?? 0) ^ 1;
    await expect(installAutopgRuntime(paths(), target, { download: async () => flipped })).rejects.toThrow(
      /sha256 .* is not the pinned/,
    );
    expect(existsSync(join(root, 'home', 'autopg', '3.3.0'))).toBe(false);
    expect(existsSync(join(root, 'home', 'pgserve', 'bin', 'linux-arm64'))).toBe(false);
  });

  test('a tarball whose size is not the pin is refused before it is hashed', async () => {
    const fixture = fixtureTarball();
    const target = autopgTarget(pinFor(fixture, fixture.bytes.length + 1), LINUX_ARM64);
    if (!target) throw new Error('no target');
    await expect(installAutopgRuntime(paths(), target, { download: async () => fixture.bytes })).rejects.toThrow(
      /size \d+ is not the pinned \d+/,
    );
    expect(existsSync(join(root, 'home', 'autopg'))).toBe(false);
  });

  test('a tarball without Postgres is refused', async () => {
    const fixture = fixtureTarball(['autopg/postgres/bin/initdb']);
    const target = autopgTarget(pinFor(fixture), LINUX_ARM64);
    if (!target) throw new Error('no target');
    await expect(installAutopgRuntime(paths(), target, { download: async () => fixture.bytes })).rejects.toThrow(
      /has no postgres\/bin\/initdb/,
    );
    expect(existsSync(join(root, 'home', 'autopg', '3.3.0'))).toBe(false);
  });

  test('installs from a local tarball offline, and a runtime in place downloads nothing', async () => {
    const fixture = fixtureTarball();
    const target = autopgTarget(pinFor(fixture), LINUX_ARM64);
    if (!target) throw new Error('no target');
    const offline = async (url: string): Promise<Uint8Array> => {
      throw new Error(`unexpected download of ${url}`);
    };
    await installAutopgRuntime(paths(), target, { tarball: fixture.path, download: offline });
    await installAutopgRuntime(paths(), target, { download: offline });
    expect(autopgRuntimeReady(paths(), target)).toBe(true);
  });

  test('a seed whose .version autopg would reject is not ready, and a reinstall restores it', async () => {
    const fixture = fixtureTarball();
    const target = autopgTarget(pinFor(fixture), LINUX_ARM64);
    if (!target) throw new Error('no target');
    let downloads = 0;
    const download = async () => {
      downloads++;
      return fixture.bytes;
    };
    await installAutopgRuntime(paths(), target, { download });
    writeFileSync(join(root, 'home', 'pgserve', 'bin', 'linux-arm64', '.version'), '17.0.0\n');
    expect(autopgRuntimeReady(paths(), target)).toBe(false);
    await installAutopgRuntime(paths(), target, { download });
    expect(downloads).toBe(2);
    expect(autopgRuntimeReady(paths(), target)).toBe(true);
  });
});

describe('readPgPasswordFile', () => {
  // Not a secret: a fixture of the length an embedding app's files have at least.
  const PASSWORD = 'test-not-a-secret-pg-password';
  const write = (content: string, mode = 0o600): string => {
    const path = join(root, `pw-${Math.random().toString(36).slice(2)}`);
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);
    return path;
  };

  test('reads one line, without its newline', () => {
    expect(readPgPasswordFile(write(`${PASSWORD}\n`))).toBe(PASSWORD);
    expect(readPgPasswordFile(write(PASSWORD, 0o400))).toBe(PASSWORD);
  });

  test('refuses what autopg refuses, and a short password, never printing it', () => {
    const link = join(root, 'link');
    symlinkSync(write(PASSWORD), link);
    const cases: Array<[string, RegExp]> = [
      ['relative/pg-password', /must be absolute/],
      [link, /is a symlink/],
      [root, /not a regular file/],
      [write(PASSWORD, 0o644), /mode is 0644/],
      [write(`${PASSWORD}\n${PASSWORD}\n`), /one line/],
      [write('short\n'), /at least 16 characters/],
      [join(root, 'missing'), /cannot read it/],
    ];
    for (const [path, reason] of cases) {
      let message = '';
      try {
        readPgPasswordFile(path);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(reason);
      expect(message).not.toContain(PASSWORD);
    }
    expect(() => readPgPasswordFile(write(PASSWORD), (process.getuid?.() ?? 0) + 1)).toThrow(/not owned by this user/);
  });
});
