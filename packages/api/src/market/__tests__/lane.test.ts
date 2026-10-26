import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  LANE_KEYS,
  LANE_URL,
  type Lane,
  createPluginLane,
  packageJsonOf,
  readPluginLaneDir,
  readPluginLaneUrl,
  verifyLane,
} from '../lane';
import { createMarket } from '../service';

const root = mkdtempSync(join(tmpdir(), 'omni-lane-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keys = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() };
const other = generateKeyPairSync('ed25519').privateKey;
const RELEASES = 'https://github.com/automagik-dev/automagik/releases/download';
const FLOOR = { '@automagik/bots-dsh': '3.20.0', '@automagik/welcome-dsh': '3.20.0' };

/** An npm tarball (gzip'd ustar) holding package/package.json. */
function tarballOf(pkg: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const body = Buffer.from(JSON.stringify(pkg));
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padded = Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
  return new Uint8Array(gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)])));
}

const pluginPackage = (name: string, version: string) => ({
  name,
  version,
  description: `${name} from the lane`,
  license: 'Apache-2.0',
  repository: 'https://github.com/automagik-dev/automagik',
  engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' },
  scripts: { test: 'not served' },
});

function lanePlugin(name: string, version: string, bytes: Uint8Array, url?: string) {
  const file = `${name.slice(1).replace('/', '-')}-${version}.tgz`;
  return {
    name,
    version,
    url: url ?? `${RELEASES}/v${version}/${file}`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' },
  };
}

function laneOf(sequence: number, plugins: Lane['plugins'], fields: Partial<Lane> = {}): Lane {
  return {
    schemaVersion: 1,
    publisher: 'automagik',
    keyId: 'test-key',
    sequence,
    issuedAt: '2026-10-26T03:00:00Z',
    repository: 'https://github.com/automagik-dev/automagik',
    version: '3.24.0',
    commit: 'a'.repeat(40),
    base: '3.24.0',
    plugins,
    ...fields,
  };
}

/** A publisher: what a lane URL answers, signed with `key`; tarballs by URL. */
function publisher() {
  const files = new Map<string, Uint8Array>();
  const asked: string[] = [];
  return {
    asked,
    publish(lane: Lane, key = privateKey) {
      const bytes = Buffer.from(JSON.stringify(lane));
      files.set(LANE_URL, bytes);
      files.set(`${LANE_URL}.sig`, Buffer.from(sign(null, bytes, key).toString('base64')));
    },
    put(url: string, bytes: Uint8Array) {
      files.set(url, bytes);
    },
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const bytes = files.get(url);
      return bytes ? new Response(bytes) : new Response('not found', { status: 404 });
    }) as typeof fetch,
  };
}

const bots = (version: string) => {
  const bytes = tarballOf(pluginPackage('@automagik/bots-dsh', version));
  return { bytes, plugin: lanePlugin('@automagik/bots-dsh', version, bytes) };
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(root, 'state-'));
});

describe('lane.json', () => {
  test("is taken only with a pinned key over its exact bytes, and only Automagik's", () => {
    const bytes = Buffer.from(JSON.stringify(laneOf(240000, [])));
    const sig = sign(null, bytes, privateKey).toString('base64');
    expect(verifyLane(bytes, sig, keys)).toMatchObject({ lane: { sequence: 240000 } });
    const tampered = Buffer.from(JSON.stringify(laneOf(240001, [])));
    expect(verifyLane(tampered, sig, keys)).toEqual({ refused: 'lane.json.sig is not a valid signature of lane.json' });
    expect(verifyLane(bytes, sign(null, bytes, other).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining('not a valid signature'),
    });
    const unpinned = Buffer.from(JSON.stringify(laneOf(1, [], { keyId: 'someone-else' })));
    expect(verifyLane(unpinned, sign(null, unpinned, privateKey).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining('does not pin (someone-else)'),
    });
    const foreign = Buffer.from(JSON.stringify(laneOf(1, [], { publisher: 'mallory' })));
    expect(verifyLane(foreign, sign(null, foreign, privateKey).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining("mallory's"),
    });
    const broken = Buffer.from(JSON.stringify({ ...laneOf(1, []), schemaVersion: 2 }));
    expect(verifyLane(broken, sign(null, broken, privateKey).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining('schemaVersion 1'),
    });
    expect(verifyLane(Buffer.from('{'), sig, keys)).toEqual({ refused: 'lane.json is not JSON' });
  });

  test("Automagik's own key is pinned as an ed25519 key", () => {
    expect(Object.keys(LANE_KEYS)).toEqual(['automagik-2026-10']);
    expect(createPublicKey(LANE_KEYS['automagik-2026-10'] ?? '').asymmetricKeyType).toBe('ed25519');
  });

  test("OMNI_PLUGIN_LANE: unset is Automagik's lane, off is none, a URL a mirror", () => {
    expect(readPluginLaneUrl({})).toBe(LANE_URL);
    expect(readPluginLaneUrl({ OMNI_PLUGIN_LANE: 'off' })).toBeNull();
    expect(readPluginLaneUrl({ OMNI_PLUGIN_LANE: 'https://mirror.example/lane.json' })).toBe(
      'https://mirror.example/lane.json',
    );
    expect(readPluginLaneUrl({ OMNI_PLUGIN_LANE: 'nonsense' })).toBeNull();
    expect(readPluginLaneDir({ OMNI_UPDATE_STATE_DIR: '/var/lib/omni/update' })).toBe(
      '/var/lib/omni/update/plugin-lane',
    );
    expect(readPluginLaneDir({ OMNI_PLUGIN_LANE_DIR: '/srv/lane' })).toBe('/srv/lane');
  });

  test("a tarball's package.json is read without unpacking it", () => {
    expect(packageJsonOf(tarballOf({ name: '@automagik/bots-dsh', version: '3.24.0' }))).toEqual({
      name: '@automagik/bots-dsh',
      version: '3.24.0',
    });
  });
});

describe('the market with a plugin lane', () => {
  test("serves a taken lane's plugins over the release's, as an npm registry, and says so", async () => {
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    const published: unknown[] = [];
    const pluginLane = createPluginLane({
      keys,
      floor: FLOOR,
      dir,
      fetchImpl: lane.fetchImpl,
      eventBus: {
        publishGeneric: async (type, payload) => {
          published.push({ type, payload });
          return { id: 'e', sequence: 1 } as never;
        },
      },
    });
    const market = createMarket({ dir: root, lane: pluginLane });
    // Before the lane: Automagik's plugins from the static index, at the floor's commit.
    expect(
      market.index('https://omni.example').plugins.find((entry) => entry.name === '@automagik/bots-dsh')?.versions[0]
        ?.source.type,
    ).toBe('git');
    expect(await pluginLane.refresh()).toBe(true);
    const entry = market.index('https://omni.example').plugins.find((p) => p.name === '@automagik/bots-dsh');
    expect(entry?.versions).toEqual([
      {
        version: '3.24.0',
        publishTimestamp: Date.parse('2026-10-26T03:00:00Z') / 1000,
        source: { type: 'npm', registry: 'https://omni.example/api/market/npm/' },
        engines: { dsh: '>=0.2.1-rc.3 <0.2.2-0' },
      },
    ]);
    const packument = market.packument('@automagik/bots-dsh', 'https://omni.example');
    expect(packument?.versions['3.24.0']?.dist).toEqual({
      tarball: 'https://omni.example/api/market/npm/@automagik/bots-dsh/-/automagik-bots-dsh-3.24.0.tgz',
      integrity: plugin.integrity,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
    expect(packument?.versions['3.24.0']).not.toHaveProperty('scripts');
    expect(packument?.versions['3.24.0']?.repository).toEqual({
      type: 'git',
      url: 'https://github.com/automagik-dev/automagik',
    });
    expect(await market.tarball('@automagik/bots-dsh', 'automagik-bots-dsh-3.24.0.tgz')).toEqual(bytes);
    expect(await market.tarball('@automagik/bots-dsh', 'automagik-bots-dsh-3.20.0.tgz')).toBeNull();
    expect(published).toEqual([
      {
        type: 'system.plugin_lane.taken',
        payload: { sequence: 240000, version: '3.24.0', plugins: [{ name: '@automagik/bots-dsh', version: '3.24.0' }] },
      },
    ]);
    // The same lane again is no news.
    expect(await pluginLane.refresh()).toBe(false);
  });

  test('a lane that does not check out changes nothing, and an older one is never taken', async () => {
    const lane = publisher();
    const good = bots('3.24.0');
    lane.put(good.plugin.url, good.bytes);
    const pluginLane = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: lane.fetchImpl });
    // Signed by another key.
    lane.publish(laneOf(240000, [good.plugin]), other);
    expect(await pluginLane.refresh()).toBe(false);
    expect(pluginLane.current()).toBeNull();
    lane.publish(laneOf(240000, [good.plugin]));
    expect(await pluginLane.refresh()).toBe(true);
    // An older lane, properly signed: a rollback.
    const old = bots('3.23.0');
    lane.put(old.plugin.url, old.bytes);
    lane.publish(laneOf(230000, [old.plugin]));
    expect(await pluginLane.refresh()).toBe(false);
    // A newer lane whose tarball is not the bytes it describes, though its package.json matches.
    const next = bots('3.24.1');
    lane.put(
      next.plugin.url,
      tarballOf({ ...pluginPackage('@automagik/bots-dsh', '3.24.1'), description: 'tampered' }),
    );
    lane.publish(laneOf(240001, [next.plugin]));
    expect(await pluginLane.refresh()).toBe(false);
    // A newer lane whose package.json is another version than it says.
    const liar = tarballOf(pluginPackage('@automagik/bots-dsh', '9.9.9'));
    const lying = lanePlugin('@automagik/bots-dsh', '3.24.2', liar);
    lane.put(lying.url, liar);
    lane.publish(laneOf(240002, [lying]));
    expect(await pluginLane.refresh()).toBe(false);
    expect(pluginLane.current()?.packages.map((pkg) => pkg.version)).toEqual(['3.24.0']);
  });

  test("only Automagik's plugins, on its releases, at or past the floor", async () => {
    const lane = publisher();
    const below = bots('3.19.0');
    const welcome = tarballOf(pluginPackage('@automagik/welcome-dsh', '3.24.0'));
    const elsewhere = lanePlugin(
      '@automagik/welcome-dsh',
      '3.24.0',
      welcome,
      'https://evil.example/automagik-welcome-dsh-3.24.0.tgz',
    );
    const outsider = tarballOf(pluginPackage('left-pad', '1.3.0'));
    const notOurs = lanePlugin('left-pad', '1.3.0', outsider, `${RELEASES}/v3.24.0/left-pad-1.3.0.tgz`);
    for (const [url, bytes] of [
      [below.plugin.url, below.bytes],
      [elsewhere.url, welcome],
      [notOurs.url, outsider],
    ] as const)
      lane.put(url, bytes);
    lane.publish(laneOf(240000, [below.plugin, elsewhere, notOurs]));
    const pluginLane = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: lane.fetchImpl });
    expect(await pluginLane.refresh()).toBe(true);
    expect(pluginLane.current()?.packages).toEqual([]);
    expect(lane.asked).toEqual([LANE_URL, `${LANE_URL}.sig`]);
  });

  test('the lane taken is kept, checked again on start, and served with no request', async () => {
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    expect(await createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: lane.fetchImpl }).refresh()).toBe(true);
    const offline = publisher();
    const restarted = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: offline.fetchImpl });
    await restarted.loaded;
    expect(restarted.current()?.packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toEqual([
      '@automagik/bots-dsh@3.24.0',
    ]);
    expect(offline.asked).toEqual([]);
    // A kept tarball changed on disk is not served, and not fetched either.
    writeFileSync(join(dir, 'automagik-bots-dsh-3.24.0.tgz'), 'changed');
    const tampered = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: offline.fetchImpl });
    await tampered.loaded;
    expect(tampered.current()).toBeNull();
    expect(offline.asked).toEqual([]);
  });

  test('it looks a minute after start, then hourly, and not before', async () => {
    const lane = publisher();
    const scheduled: Array<{ kind: 'timeout' | 'interval'; ms: number; run: () => void }> = [];
    const timers = {
      setTimeout: ((run: () => void, ms: number) => {
        scheduled.push({ kind: 'timeout', ms, run });
        return 1;
      }) as never,
      setInterval: ((run: () => void, ms: number) => {
        scheduled.push({ kind: 'interval', ms, run });
        return 2;
      }) as never,
      clearTimeout: (() => undefined) as never,
      clearInterval: (() => undefined) as never,
    };
    const stop = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: lane.fetchImpl, timers }).start();
    expect(lane.asked).toEqual([]);
    expect(scheduled.map(({ kind, ms }) => [kind, ms])).toEqual([['timeout', 60_000]]);
    scheduled[0]?.run();
    await Bun.sleep(0);
    expect(lane.asked).toEqual([LANE_URL]);
    expect(scheduled.map(({ kind, ms }) => [kind, ms])).toEqual([
      ['timeout', 60_000],
      ['interval', 3_600_000],
    ]);
    stop();
  });
});

describe('what the review asked for', () => {
  test('size, sha256 and sha512 are each checked, and so are the name and the repository', async () => {
    const { bytes, plugin } = bots('3.24.0');
    const cases: Array<[string, Lane['plugins'][number]]> = [
      ['size', { ...plugin, size: plugin.size + 1 }],
      ['sha256', { ...plugin, sha256: '0'.repeat(64) }],
      ['sha512', { ...plugin, integrity: `sha512-${createHash('sha512').update('other').digest('base64')}` }],
    ];
    for (const [what, wrong] of cases) {
      const lane = publisher();
      lane.put(plugin.url, bytes);
      lane.publish(laneOf(240000, [wrong]));
      const pluginLane = createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: lane.fetchImpl });
      expect([what, await pluginLane.refresh()]).toEqual([what, false]);
    }
    const renamed = tarballOf(pluginPackage('@automagik/welcome-dsh', '3.24.0'));
    const lane = publisher();
    const misnamed = lanePlugin('@automagik/bots-dsh', '3.24.0', renamed);
    lane.put(misnamed.url, renamed);
    lane.publish(laneOf(240000, [misnamed]));
    expect(await createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: lane.fetchImpl }).refresh()).toBe(false);
    const elsewhere = Buffer.from(
      JSON.stringify(laneOf(1, [], { repository: 'https://github.com/mallory/automagik' })),
    );
    expect(verifyLane(elsewhere, sign(null, elsewhere, privateKey).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining('mallory/automagik'),
    });
    const proto = Buffer.from(JSON.stringify(laneOf(1, [], { keyId: '__proto__' })));
    expect(verifyLane(proto, sign(null, proto, privateKey).toString('base64'), keys)).toMatchObject({
      refused: expect.stringContaining('does not pin (__proto__)'),
    });
  });

  test('an equal sequence is not newer, and tarball URLs are taken only as written', async () => {
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    const pluginLane = createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: lane.fetchImpl });
    expect(await pluginLane.refresh()).toBe(true);
    lane.publish(laneOf(240000, [plugin], { issuedAt: '2026-10-27T00:00:00Z' }));
    expect(await pluginLane.refresh()).toBe(false);
    for (const url of [
      `${RELEASES}/../../../mallory/x/releases/download/v1/automagik-bots-dsh-3.24.1.tgz`,
      `${RELEASES}/v3.24.1/automagik-bots-dsh-3.24.1.tgz?x=1`,
    ]) {
      const sneaky = publisher();
      const next = bots('3.24.1');
      sneaky.put(url, next.bytes);
      sneaky.publish(laneOf(240001, [{ ...next.plugin, url }]));
      const other = createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: sneaky.fetchImpl });
      expect(await other.refresh()).toBe(true);
      expect(other.current()?.packages).toEqual([]);
    }
  });

  test('a lane or a tarball bigger than allowed is cut off while it arrives', async () => {
    // 10 MB with no content-length, in 64 KB parts: reading stops just past the lane's 256 KB.
    let sent = 0;
    const endless = (async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += 64 * 1024;
            controller.enqueue(new Uint8Array(64 * 1024));
            if (sent >= 10 * 1024 * 1024) controller.close();
          },
        }),
      )) as unknown as typeof fetch;
    expect(await createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: endless }).refresh()).toBe(false);
    expect(sent).toBeLessThan(1024 * 1024);
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, Buffer.concat([bytes, Buffer.alloc(1024)]));
    lane.publish(laneOf(240000, [plugin]));
    expect(await createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: lane.fetchImpl }).refresh()).toBe(false);
  });

  test('one look at a time, and a folder it cannot write keeps the lane in memory', async () => {
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    const blocked = join(dir, 'a-file');
    writeFileSync(blocked, 'not a folder');
    const pluginLane = createPluginLane({ keys, floor: FLOOR, dir: join(blocked, 'lane'), fetchImpl: lane.fetchImpl });
    const [first, second] = await Promise.all([pluginLane.refresh(), pluginLane.refresh()]);
    expect([first, second]).toEqual([true, true]);
    expect(lane.asked.filter((url) => url === LANE_URL)).toHaveLength(1);
    expect(pluginLane.current()?.packages.map((pkg) => pkg.version)).toEqual(['3.24.0']);
  });

  test('the kept lane is one file swapped in whole, and a leftover temp file changes nothing', async () => {
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    expect(await createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: lane.fetchImpl }).refresh()).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(['automagik-bots-dsh-3.24.0.tgz', 'kept.json']);
    writeFileSync(join(dir, 'kept.json.0123456789ab.tmp'), '{"half":');
    const restarted = createPluginLane({ keys, floor: FLOOR, dir, fetchImpl: publisher().fetchImpl });
    await restarted.loaded;
    expect(restarted.current()?.sequence).toBe(240000);
    expect(existsSync(join(dir, 'lane.json'))).toBe(false);
  });

  test("with a bundled market: the newer of the release's and the lane's is served, and both stay installable", async () => {
    const market = mkdtempSync(join(root, 'market-'));
    const bundle = (version: string) => {
      const bytes = tarballOf(pluginPackage('@automagik/bots-dsh', version));
      const file = `automagik-bots-dsh-${version}.tgz`;
      writeFileSync(join(market, file), bytes);
      writeFileSync(
        join(market, 'market.json'),
        JSON.stringify({
          format: 1,
          omniVersion: '2.261026.9',
          packedAt: 1_792_900_000,
          packages: [
            {
              name: '@automagik/bots-dsh',
              version,
              file,
              integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
              shasum: createHash('sha1').update(bytes).digest('hex'),
              size: bytes.byteLength,
            },
          ],
        }),
      );
      return bytes;
    };
    const lane = publisher();
    const { bytes, plugin } = bots('3.24.0');
    lane.put(plugin.url, bytes);
    lane.publish(laneOf(240000, [plugin]));
    const pluginLane = createPluginLane({ keys, floor: FLOOR, dir: null, fetchImpl: lane.fetchImpl });
    expect(await pluginLane.refresh()).toBe(true);
    // A release that bundled a newer Bot team than the lane serves its own.
    bundle('3.25.0');
    const newer = createMarket({ dir: market, lane: pluginLane });
    expect(newer.index('https://o').plugins.find((p) => p.name === '@automagik/bots-dsh')?.versions[0]?.version).toBe(
      '3.25.0',
    );
    // An older bundle: the lane's is the latest, the release's still installs.
    const old = bundle('3.20.0');
    const served = createMarket({ dir: market, lane: pluginLane });
    expect(served.index('https://o').plugins.find((p) => p.name === '@automagik/bots-dsh')?.versions[0]?.version).toBe(
      '3.24.0',
    );
    const packument = served.packument('@automagik/bots-dsh', 'https://o');
    expect(packument?.['dist-tags']).toEqual({ latest: '3.24.0' });
    expect(Object.keys(packument?.versions ?? {}).sort()).toEqual(['3.20.0', '3.24.0']);
    expect(await served.tarball('@automagik/bots-dsh', 'automagik-bots-dsh-3.20.0.tgz')).toEqual(old);
    expect(await served.tarball('@automagik/welcome-dsh', 'automagik-bots-dsh-3.24.0.tgz')).toBeNull();
    // A newer lane later: the one served before still installs.
    const next = bots('3.24.1');
    lane.put(next.plugin.url, next.bytes);
    lane.publish(laneOf(240001, [next.plugin]));
    expect(await pluginLane.refresh()).toBe(true);
    expect(await served.tarball('@automagik/bots-dsh', 'automagik-bots-dsh-3.24.0.tgz')).toEqual(bytes);
    expect(await served.tarball('@automagik/bots-dsh', 'automagik-bots-dsh-3.24.1.tgz')).toEqual(next.bytes);
  });
});
