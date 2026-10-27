import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaneSchema } from '../packages/api/src/market/lane';
import { packMarket } from './pack-market';
import { KEY_ID, LANE_BASE, manifest, readKeys, sequenceOf, signLane, verifyLane } from './plugin-lane';

const root = mkdtempSync(join(tmpdir(), 'omni-plugin-lane-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const COMMIT = 'a'.repeat(40);

/** A minimal DSH plugin, as apps/*-dsh lay them out. */
function plugin(appsDir: string, dir: string, pkg: Record<string, unknown>, body = 'export default {};\n') {
  mkdirSync(join(appsDir, dir), { recursive: true });
  writeFileSync(join(appsDir, dir, 'package.json'), JSON.stringify({ files: ['index.js'], ...pkg }));
  writeFileSync(join(appsDir, dir, 'index.js'), body);
}

async function packed(name: string, body?: string) {
  const appsDir = join(root, name, 'apps');
  plugin(
    appsDir,
    'one-dsh',
    { name: '@automagik/one-dsh', version: '2.261025.2', engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' } },
    body,
  );
  const dir = join(root, name, 'pack');
  await packMarket({ appsDir, outDir: dir, omniVersion: '2.261025.2', packedAt: 1792553326, automagik: false });
  return dir;
}

describe('plugin-lane', () => {
  test('orders releases by day, then by cut', () => {
    expect(sequenceOf('2.261025.2')).toBe(2610250002);
    expect(sequenceOf('2.261025.12')).toBeGreaterThan(sequenceOf('2.261025.2'));
    expect(sequenceOf('2.261101.1')).toBeGreaterThan(sequenceOf('2.261031.99'));
    expect(() => sequenceOf('3.31.3')).toThrow();
    expect(() => sequenceOf('2.261025.10000')).toThrow();
  });

  test('lists each packed plugin with checksums of its bytes and the URL on the rolling release', async () => {
    const dir = await packed('fresh');
    const lane = manifest(dir, { version: '2.261025.2', commit: COMMIT, issuedAt: '2026-10-25T00:00:00Z' });
    expect(LaneSchema.parse(lane)).toEqual(lane);
    expect(lane).toMatchObject({
      publisher: 'omni',
      keyId: KEY_ID,
      base: LANE_BASE,
      sequence: 2610250002,
      commit: COMMIT,
    });
    const [one] = lane.plugins;
    const bytes = readFileSync(join(dir, 'automagik-one-dsh-2.261025.2.tgz'));
    expect(one).toEqual({
      name: '@automagik/one-dsh',
      version: '2.261025.2',
      url: 'https://github.com/automagik-dev/omni/releases/download/plugin-lane/automagik-one-dsh-2.261025.2.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' },
    });
  });

  test('a version the lane already carries keeps its tarball, byte for byte', async () => {
    const kept = await packed('kept', 'export default { first: true };\n');
    const dir = await packed('again');
    const lane = manifest(dir, { version: '2.261025.3', commit: COMMIT, issuedAt: '2026-10-25T00:00:00Z', kept });
    const before = readFileSync(join(kept, 'automagik-one-dsh-2.261025.2.tgz'));
    expect(readFileSync(join(dir, 'automagik-one-dsh-2.261025.2.tgz'))).toEqual(before);
    expect(lane.plugins[0]?.sha256).toBe(createHash('sha256').update(before).digest('hex'));
  });

  test('a kept tarball that holds another package is refused', async () => {
    const dir = await packed('mismatch');
    const kept = join(root, 'mismatch-kept');
    mkdirSync(join(kept, 'package'), { recursive: true });
    writeFileSync(
      join(kept, 'package', 'package.json'),
      JSON.stringify({ name: '@automagik/one-dsh', version: '2.261025.1' }),
    );
    execFileSync('tar', ['-czf', join(kept, 'automagik-one-dsh-2.261025.2.tgz'), '-C', kept, 'package']);
    expect(() =>
      manifest(dir, { version: '2.261025.2', commit: COMMIT, issuedAt: '2026-10-25T00:00:00Z', kept }),
    ).toThrow(/holds @automagik\/one-dsh@2\.261025\.1/);
  });

  test('a signed lane verifies; changed bytes, another key or another publisher do not', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keys = [{ keyId: KEY_ID, publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    const lane = manifest(await packed('signed'), {
      version: '2.261025.2',
      commit: COMMIT,
      issuedAt: '2026-10-25T00:00:00Z',
    });
    const bytes = Buffer.from(JSON.stringify(lane));
    const signature = signLane(bytes, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    expect(verifyLane(bytes, signature, keys).version).toBe('2.261025.2');
    expect(() => verifyLane(Buffer.from(JSON.stringify({ ...lane, base: '0.0.1' })), signature, keys)).toThrow(
      /signature/,
    );
    expect(() => verifyLane(bytes, signature, readKeys())).toThrow(/signature/);
    const theirs = Buffer.from(JSON.stringify({ ...lane, publisher: 'automagik' }));
    expect(() =>
      verifyLane(theirs, signLane(theirs, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()), keys),
    ).toThrow(/published by automagik/);
  });

  test('plugin-lane/keys.json pins the key the lane names', () => {
    expect(readKeys().map((key) => key.keyId)).toContain(KEY_ID);
  });
});
