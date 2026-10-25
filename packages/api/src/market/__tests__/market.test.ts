import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { Hono } from 'hono';
import staticIndex from '../../../../../marketplace/automagik.json';
import { type MarketManifest, MarketManifestSchema } from '../manifest';
import { marketPageRoutes, marketRoutes } from '../routes';
import { type MarketIndex, type Packument, createMarket } from '../service';

const PUBLIC = 'https://omni.example.com';
const VERSION = '2.261019.10';
const PACKED_AT = 1792553326;
// Every plugin the static index lists from a repository other than Omni's: Automagik's plugins
// (the Bot team, the welcome) at the pinned release.
const ADD_ONS = staticIndex.plugins
  .filter((plugin) =>
    plugin.versions.some(
      (entry) =>
        entry.source.type === 'npm' ||
        ('url' in entry.source &&
          typeof entry.source.url === 'string' &&
          !entry.source.url.startsWith('https://github.com/automagik-dev/omni')),
    ),
  )
  .map((plugin) => plugin.name);
// The plugins the bundle below carries are served from this Omni instead.
const CARRIED = new Set(['@automagik/bots-dsh']);
const THIRD_PARTY = ADD_ONS.filter((name) => !CARRIED.has(name));

let root: string;
let marketDir: string;
const tarballs = new Map<string, Buffer>();

/** A real, tiny npm tarball: package/package.json and package/index.js. */
function tinyTarball(dir: string, name: string, file: string): Buffer {
  const src = mkdtempSync(join(root, 'src-'));
  mkdirSync(join(src, 'package'));
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify({ name, version: VERSION, main: 'index.js' }));
  writeFileSync(join(src, 'package', 'index.js'), 'export default {};\n');
  execFileSync('tar', ['-czf', join(dir, file), '-C', src, 'package']);
  return readFileSync(join(dir, file));
}

function entry(name: string, file: string, extra: Partial<MarketManifest['packages'][number]> = {}) {
  const bytes = tinyTarball(marketDir, name, file);
  tarballs.set(name, bytes);
  return {
    name,
    version: VERSION,
    file,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex'),
    size: bytes.byteLength,
    peerDependencies: { '@deepseek-ai/cordis': '*' },
    ...extra,
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-market-'));
  marketDir = join(root, 'market');
  mkdirSync(marketDir);
  const manifest = MarketManifestSchema.parse({
    format: 1,
    omniVersion: VERSION,
    packedAt: PACKED_AT,
    packages: [
      entry('@automagik/bots-dsh', 'automagik-bots-dsh-2.261019.10.tgz', {
        description: 'The Bot team, carried from the Automagik release Omni pins',
        license: 'Apache-2.0',
        repository: {
          type: 'git',
          url: 'git+https://github.com/automagik-dev/automagik.git',
          directory: 'apps/bots-dsh',
        },
      }),
      entry('@automagik/omni-new-dsh', 'automagik-omni-new-dsh-2.261019.10.tgz', {
        description: 'A plugin the static index does not list yet',
        keywords: ['omni'],
        engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
        repository: {
          type: 'git',
          url: 'git+https://github.com/automagik-dev/omni.git',
          directory: 'apps/omni-new-dsh',
        },
      }),
      // Listed, but its tarball is missing from the bundle: dropped, not served.
      {
        name: '@automagik/omni-gone-dsh',
        version: VERSION,
        file: 'gone.tgz',
        integrity: `sha512-${'A'.repeat(86)}==`,
        shasum: '0'.repeat(40),
        size: 1,
      },
    ],
  });
  writeFileSync(join(marketDir, 'market.json'), JSON.stringify(manifest));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function appWith(options: Parameters<typeof createMarket>[0]) {
  const app = new Hono();
  const market = createMarket(options);
  app.route('/api/market', marketRoutes(market));
  app.route('/market', marketPageRoutes(market));
  return (path: string) => app.request(`http://127.0.0.1:8882${path}`);
}

describe('market index', () => {
  test("is a valid DSH market index: this release's plugins from this Omni, Automagik's at their pin", async () => {
    const get = appWith({ dir: marketDir, publicUrl: PUBLIC });
    const response = await get('/api/market/index.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await response.json()) as MarketIndex;
    const parsed = parseMarketIndex(body, `${PUBLIC}/api/market/index.json`);
    expect(parsed.title).toEqual({ en: 'Automagik' });
    expect(parsed.metadata.categories).toHaveProperty('omni');
    expect(parsed.metadata.labels).toHaveProperty('official');
    // Outside plugins are Automagik's index's to list, never Omni's.
    expect(parsed.metadata.labels).not.toHaveProperty('vetted');
    expect(parsed.plugins.map((plugin) => plugin.name)).toEqual([
      '@automagik/bots-dsh',
      '@automagik/omni-new-dsh',
      ...THIRD_PARTY,
    ]);
    const [omni, fresh] = parsed.plugins;
    expect(omni?.versions).toEqual([
      {
        version: VERSION,
        publishTimestamp: PACKED_AT,
        source: { type: 'npm', registry: `${PUBLIC}/api/market/npm/` },
        engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
      },
    ]);
    // The static index's presentation for a plugin it lists; derived from the package for one it does not.
    expect(omni?.title).toEqual(staticIndex.plugins.find((plugin) => plugin.name === omni?.name)?.title);
    expect(omni?.title).toBeTruthy();
    expect(fresh?.description).toBe('A plugin the static index does not list yet');
    expect(fresh?.repository).toEqual({ url: 'https://github.com/automagik-dev/omni', directory: 'apps/omni-new-dsh' });
    expect(fresh?.metadata).toMatchObject({ category: 'omni', labels: ['official'] });
    // No git pins into Omni's own repository: Omni's plugins install from this Omni. Automagik's
    // install from the commit the static index pins.
    for (const plugin of parsed.plugins)
      for (const v of plugin.versions)
        if (v.source.type === 'git') expect(v.source.url).not.toContain('automagik-dev/omni');
    for (const plugin of parsed.plugins.slice(2)) {
      const listed = staticIndex.plugins.find((entry) => entry.name === plugin.name);
      const want: unknown = listed?.versions[0]?.source;
      expect(plugin.versions[0]?.source as unknown).toEqual(want);
    }
  });

  test('without a public URL, the registry is the request origin, cached only per client', async () => {
    const response = await appWith({ dir: marketDir })('/api/market/index.json');
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    const body = (await response.json()) as MarketIndex;
    expect(body.plugins[0]?.versions[0]?.source).toEqual({
      type: 'npm',
      registry: 'http://127.0.0.1:8882/api/market/npm/',
    });
  });

  test("without a bundled market, Automagik's plugins are still listed and nothing crashes", async () => {
    const empty = mkdtempSync(join(root, 'empty-'));
    const corrupt = mkdtempSync(join(root, 'corrupt-'));
    writeFileSync(join(corrupt, 'market.json'), '{"format": 2');
    for (const dir of [empty, corrupt]) {
      const get = appWith({ dir, publicUrl: PUBLIC });
      const body = (await (await get('/api/market/index.json')).json()) as MarketIndex;
      // A server run from source carries nothing: Automagik's plugins are listed from their pinned commit.
      expect(parseMarketIndex(body, `${PUBLIC}/api/market/index.json`).plugins.map((p) => p.name)).toEqual(ADD_ONS);
      const packument = await get('/api/market/npm/@automagik%2fbots-dsh');
      expect(packument.status).toBe(302);
      expect((await get('/market')).status).toBe(200);
    }
  });
});

describe('market npm registry', () => {
  const get = () => appWith({ dir: marketDir, publicUrl: PUBLIC });

  test('serves a packument for a carried plugin, scoped name encoded or not', async () => {
    for (const path of [
      '/api/market/npm/@automagik%2fbots-dsh',
      '/api/market/npm/@automagik%2Fbots-dsh',
      '/api/market/npm/@automagik/bots-dsh',
    ]) {
      const response = await get()(path);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      const body = (await response.json()) as Packument;
      const bytes = tarballs.get('@automagik/bots-dsh') as Buffer;
      expect(body.name).toBe('@automagik/bots-dsh');
      expect(body['dist-tags']).toEqual({ latest: VERSION });
      expect(body.time[VERSION]).toBe(new Date(PACKED_AT * 1000).toISOString());
      expect(body.versions[VERSION]).toMatchObject({
        name: '@automagik/bots-dsh',
        version: VERSION,
        description: 'The Bot team, carried from the Automagik release Omni pins',
        license: 'Apache-2.0',
        peerDependencies: { '@deepseek-ai/cordis': '*' },
        dist: {
          tarball: `${PUBLIC}/api/market/npm/@automagik/bots-dsh/-/automagik-bots-dsh-2.261019.10.tgz`,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          shasum: createHash('sha1').update(bytes).digest('hex'),
        },
      });
    }
  });

  test('serves the listed tarball bytes, immutable', async () => {
    const response = await get()('/api/market/npm/@automagik/bots-dsh/-/automagik-bots-dsh-2.261019.10.tgz');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(await response.arrayBuffer()).equals(tarballs.get('@automagik/bots-dsh') as Buffer)).toBe(true);
    const encoded = await get()('/api/market/npm/@automagik%2fbots-dsh/-/automagik-bots-dsh-2.261019.10.tgz');
    expect(encoded.status).toBe(200);
  });

  test('sends any name it does not carry to the public npm registry', async () => {
    const scoped = await get()('/api/market/npm/@someone%2fthing');
    expect(scoped.status).toBe(302);
    expect(scoped.headers.get('location')).toBe('https://registry.npmjs.org/@someone%2fthing');
    const plain = await get()('/api/market/npm/dsh-oh-my-claude');
    expect(plain.headers.get('location')).toBe('https://registry.npmjs.org/dsh-oh-my-claude');
    // A listed package whose tarball is missing from the bundle is not carried.
    expect((await get()('/api/market/npm/@automagik%2fomni-gone-dsh')).status).toBe(302);
  });

  test('serves no file the manifest does not list for that package', async () => {
    for (const path of [
      '/api/market/npm/@automagik/bots-dsh/-/..%2fmarket.json',
      '/api/market/npm/@automagik/bots-dsh/-/%2e%2e%2f%2e%2e%2fmarket.tgz',
      '/api/market/npm/@automagik/bots-dsh/-/market.json',
      '/api/market/npm/@automagik/bots-dsh/-/automagik-omni-new-dsh-2.261019.10.tgz',
      '/api/market/npm/@automagik/bots-dsh/-/other.tgz/-/x.tgz',
      '/api/market/npm/@automagik/omni-gone-dsh/-/gone.tgz',
      '/api/market/npm/@someone/thing/-/thing-1.0.0.tgz',
      '/api/market/npm/..%2f..%2fetc',
      '/api/market/npm/%E0%A4%A',
    ]) {
      const response = await get()(path);
      expect([path, response.status]).toEqual([path, 404]);
    }
  });
});

describe('market page', () => {
  test('is at /market, beside the UI; /api/market sends a person there', async () => {
    const response = await appWith({ dir: marketDir, publicUrl: PUBLIC })('/api/market');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/market');
  });

  test('lists the catalog and the index URL, with every text inserted as text', async () => {
    const hostile = structuredClone(staticIndex);
    const plugin = hostile.plugins.find((p) => p.name === '@automagik/welcome-dsh');
    if (plugin) plugin.description = { en: '</script><script>alert(1)</script>' };
    const response = await appWith({ dir: marketDir, publicUrl: PUBLIC, staticIndex: hostile })('/market');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Automagik marketplace');
    expect(html).toContain(`"indexUrl":"${PUBLIC}/api/market/index.json"`);
    expect(html).toContain('"name":"@automagik/bots-dsh"');
    expect(html).toContain('Settings → Plugins');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c/script>\\u003cscript>alert(1)');
    expect(html).not.toContain('innerHTML');
  });
});

describe("Omni's plugins at their own versions", () => {
  test('a plugin unchanged since an older release is listed and served at that version, not Omni’s', async () => {
    const dir = mkdtempSync(join(root, 'own-versions-'));
    const kept = '2.261024.6';
    const src = mkdtempSync(join(root, 'src-'));
    mkdirSync(join(src, 'package'));
    writeFileSync(
      join(src, 'package', 'package.json'),
      JSON.stringify({ name: '@automagik/omni-kept-dsh', version: kept }),
    );
    const file = `automagik-omni-kept-dsh-${kept}.tgz`;
    execFileSync('tar', ['-czf', join(dir, file), '-C', src, 'package']);
    const bytes = readFileSync(join(dir, file));
    const manifest = MarketManifestSchema.parse({
      format: 1,
      omniVersion: '2.261025.2',
      packedAt: PACKED_AT,
      packages: [
        {
          name: '@automagik/omni-kept-dsh',
          version: kept,
          file,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          shasum: createHash('sha1').update(bytes).digest('hex'),
          size: bytes.byteLength,
          engines: { dsh: '>=0.2.1-rc.2 <0.3.0', omni: '>=2.261024.1' },
        },
      ],
    });
    writeFileSync(join(dir, 'market.json'), JSON.stringify(manifest));
    const get = appWith({ dir, publicUrl: PUBLIC });
    const index = parseMarketIndex(
      await (await get('/api/market/index.json')).json(),
      `${PUBLIC}/api/market/index.json`,
    );
    expect(
      index.plugins.find((plugin) => plugin.name === '@automagik/omni-kept-dsh')?.versions.map((v) => v.version),
    ).toEqual([kept]);
    const packument = (await (await get('/api/market/npm/@automagik%2fomni-kept-dsh')).json()) as Packument;
    expect(packument['dist-tags'].latest).toBe(kept);
    // The packument carries engines whole, so DSH's pnpm sees the Omni the plugin needs.
    expect(packument.versions[kept]?.engines).toEqual({ dsh: '>=0.2.1-rc.2 <0.3.0', omni: '>=2.261024.1' });
    const tarball = await get(`/api/market/npm/@automagik/omni-kept-dsh/-/${file}`);
    expect(tarball.status).toBe(200);
    expect(Buffer.from(await tarball.arrayBuffer()).equals(bytes)).toBe(true);
  });
});
