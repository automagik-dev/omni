/**
 * The nats-server installer: the pinned release, checked by size and sha256 before it is unpacked.
 *
 * No network: fetch is a spy that serves a real archive built with tar in a temp dir and records
 * every URL. The archive is unpacked for real, so what lands on disk is checked on disk. A verified
 * install leaves `<target>.pin` beside the binary; a binary without the pinned one is replaced.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { installNatsBinary } from '../nats-install.js';

let root: string;
let fetchSpy: ReturnType<typeof spyOn> | undefined;
let urls: string[];

/** The installer's name for this host's archive: <os>-<arch>. */
const HOST = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`;
const RELEASE = 'https://github.com/nats-io/nats-server/releases/download/v2.12.15';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-nats-test-'));
  urls = [];
});

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
  rmSync(root, { recursive: true, force: true });
});

/** An archive in the release layout: nats-server-v2.12.15-<os>-<arch>/{nats-server,LICENSE}. */
function fixtureArchive(): { bytes: Uint8Array; sha256: string } {
  const stage = join(root, 'stage');
  const dir = join(stage, `nats-server-v2.12.15-${HOST}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nats-server'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(dir, 'LICENSE'), 'license\n');
  const path = join(root, 'fixture.tar.gz');
  const tar = Bun.spawnSync({ cmd: ['tar', '-czf', path, '-C', stage, `nats-server-v2.12.15-${HOST}`] });
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
  const bytes = new Uint8Array(readFileSync(path));
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function serve(bytes: Uint8Array): void {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL | Request) => {
    urls.push(String(input instanceof Request ? input.url : input));
    return new Response(bytes);
  }) as typeof fetch);
}

const pinFor = (sha256: string, size: number) => ({ version: '2.12.15', platforms: { [HOST]: { sha256, size } } });

/** The marker a verified install of this archive leaves beside the binary. */
const markerFor = (sha256: string) => `2.12.15 ${sha256}\n`;
const OLD_MARKER = `2.12.4 ${'0'.repeat(64)}\n`;

/** An archive with one byte flipped: same size, another sha256. */
function flippedBytes(bytes: Uint8Array): Uint8Array {
  const flipped = new Uint8Array(bytes);
  flipped[bytes.length - 20] = (flipped[bytes.length - 20] ?? 0) ^ 1;
  return flipped;
}

/** A nats-server installed earlier at home/bin, with `marker` as its .pin file (none when undefined). */
function installedEarlier(marker?: string): string {
  const target = join(root, 'home', 'bin', 'nats-server');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'old nats-server', { mode: 0o755 });
  if (marker !== undefined) writeFileSync(`${target}.pin`, marker);
  return target;
}

/** Everything under the install's directory, the target's own dir. */
const left = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : []);

describe('installNatsBinary', () => {
  test('installs the pinned version once its size and sha256 match, leaving the binary and its marker', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = join(root, 'home', 'bin', 'nats-server');

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('installed');
    expect(urls).toEqual([`${RELEASE}/nats-server-v2.12.15-${HOST}.tar.gz`]);
    expect(readFileSync(target, 'utf-8')).toBe('#!/bin/sh\n');
    expect(readFileSync(`${target}.pin`, 'utf-8')).toBe(markerFor(archive.sha256));
    expect(left(join(root, 'home', 'bin')).sort()).toEqual(['nats-server', 'nats-server.pin']);
  });

  test('an archive whose sha256 is not the pin is refused before it is unpacked, and nothing is written', async () => {
    const archive = fixtureArchive();
    serve(flippedBytes(archive.bytes));
    const target = join(root, 'home', 'bin', 'nats-server');

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('failed');
    expect(existsSync(target)).toBe(false);
    expect(left(join(root, 'home', 'bin'))).toEqual([]);
  });

  test('an archive whose size is not the pin is refused, even with the pinned sha256', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = join(root, 'home', 'bin', 'nats-server');

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length + 1))).toBe('failed');
    expect(existsSync(target)).toBe(false);
    expect(left(join(root, 'home', 'bin'))).toEqual([]);
  });

  test('a platform the pin has no checksum for is refused without a download', async () => {
    serve(fixtureArchive().bytes);
    const target = join(root, 'home', 'bin', 'nats-server');

    expect(await installNatsBinary(target, { version: '2.12.15', platforms: {} })).toBe('failed');
    expect(urls).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

});

describe('installNatsBinary over a nats-server installed earlier', () => {
  test('one with no marker is replaced by the pinned release', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = installedEarlier();

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('installed');
    expect(urls).toEqual([`${RELEASE}/nats-server-v2.12.15-${HOST}.tar.gz`]);
    expect(readFileSync(target, 'utf-8')).toBe('#!/bin/sh\n');
    expect(readFileSync(`${target}.pin`, 'utf-8')).toBe(markerFor(archive.sha256));
  });

  test('one whose marker names another release is replaced', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = installedEarlier(OLD_MARKER);

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('installed');
    expect(urls).toHaveLength(1);
    expect(readFileSync(target, 'utf-8')).toBe('#!/bin/sh\n');
    expect(readFileSync(`${target}.pin`, 'utf-8')).toBe(markerFor(archive.sha256));
    expect(left(dirname(target)).sort()).toEqual(['nats-server', 'nats-server.pin']);
  });

  test('one whose marker is the pin is kept, with nothing fetched', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = installedEarlier(markerFor(archive.sha256));

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('kept');
    expect(urls).toEqual([]);
    expect(readFileSync(target, 'utf-8')).toBe('old nats-server');
  });

  test('a refused upgrade leaves the old binary and its marker byte for byte, and nothing beside them', async () => {
    const archive = fixtureArchive();
    serve(flippedBytes(archive.bytes));
    const target = installedEarlier(OLD_MARKER);

    expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('failed');
    expect(urls).toHaveLength(1);
    expect(readFileSync(target, 'utf-8')).toBe('old nats-server');
    expect(readFileSync(`${target}.pin`, 'utf-8')).toBe(OLD_MARKER);
    expect(left(dirname(target)).sort()).toEqual(['nats-server', 'nats-server.pin']);
  });

  test('an upgrade renames the new binary over the old one: a process holding the old file still reads it whole', async () => {
    const archive = fixtureArchive();
    serve(archive.bytes);
    const target = installedEarlier();
    const running = openSync(target, 'r');
    try {
      expect(await installNatsBinary(target, pinFor(archive.sha256, archive.bytes.length))).toBe('installed');
      const seen = Buffer.alloc(64);
      expect(seen.subarray(0, readSync(running, seen, 0, 64, 0)).toString()).toBe('old nats-server');
      expect(readFileSync(target, 'utf-8')).toBe('#!/bin/sh\n');
    } finally {
      closeSync(running);
    }
  });

  test('on a platform the pin has no checksum for, a binary installed by hand is kept', async () => {
    serve(fixtureArchive().bytes);
    const target = installedEarlier();

    expect(await installNatsBinary(target, { version: '2.12.15', platforms: {} })).toBe('kept');
    expect(urls).toEqual([]);
    expect(readFileSync(target, 'utf-8')).toBe('old nats-server');
  });
});

describe('the nats pin', () => {
  test('v2.12.15, with a size and sha256 for every platform the installer serves', () => {
    const pin = JSON.parse(readFileSync(join(import.meta.dir, '..', 'nats-pin.json'), 'utf-8'));
    expect(pin.version).toBe('2.12.15');
    expect(Object.keys(pin.platforms).sort()).toEqual(['darwin-amd64', 'darwin-arm64', 'linux-amd64', 'linux-arm64']);
    for (const asset of Object.values(pin.platforms) as Array<{ sha256: string; size: number }>) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.size).toBeGreaterThan(1_000_000);
    }
  });
});
