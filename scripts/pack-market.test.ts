import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { MarketManifestSchema } from '../packages/api/src/market/manifest';
import { discoverPlugins, packMarket } from './pack-market';

const repoRoot = join(import.meta.dir, '..');
const root = mkdtempSync(join(tmpdir(), 'omni-pack-market-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A minimal DSH plugin, as apps/*-dsh lay them out. */
function plugin(appsDir: string, dir: string, pkg: Record<string, unknown>) {
  mkdirSync(join(appsDir, dir), { recursive: true });
  writeFileSync(join(appsDir, dir, 'package.json'), JSON.stringify({ files: ['index.js'], ...pkg }));
  writeFileSync(join(appsDir, dir, 'index.js'), 'export default {};\n');
}

describe('pack-market', () => {
  test('discovers every apps/*-dsh plugin, never a hard-coded list', () => {
    const dirs = discoverPlugins(join(repoRoot, 'apps')).map((dir) => basename(dir));
    expect(dirs).toContain('omni-channels-dsh');
    expect(dirs).toContain('omni-canvas-dsh');
    for (const dir of dirs) expect(dir.endsWith('-dsh')).toBe(true);
  });

  test('packs each plugin with npm pack and writes a manifest the server accepts', async () => {
    const appsDir = join(root, 'apps');
    plugin(appsDir, 'one-dsh', {
      name: '@automagik/one-dsh',
      version: '2.261025.2',
      description: 'One',
      license: 'Apache-2.0',
      repository: 'git+https://github.com/automagik-dev/omni.git',
      peerDependencies: { '@deepseek-ai/cordis': '*' },
      engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
      dsh: { client: { platform: 'web' } },
      scripts: { prepack: 'exit 1' },
    });
    plugin(appsDir, 'two-dsh', { name: 'two-dsh', version: '2.261025.2' });
    plugin(appsDir, 'private-dsh', { name: 'private-dsh', version: '2.261025.2', private: true });
    plugin(appsDir, 'ui', { name: 'not-a-plugin', version: '2.261025.2' });
    const outDir = join(root, 'out');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'stale.tgz'), 'old');

    const manifest = await packMarket({
      appsDir,
      outDir,
      omniVersion: '2.261025.2',
      packedAt: 1792553326,
      automagik: false,
    });

    expect(MarketManifestSchema.parse(JSON.parse(readFileSync(join(outDir, 'market.json'), 'utf8')))).toEqual(manifest);
    expect(manifest).toMatchObject({ format: 1, omniVersion: '2.261025.2', packedAt: 1792553326 });
    expect(manifest.packages.map((pkg) => pkg.name)).toEqual(['@automagik/one-dsh', 'two-dsh']);
    const [one] = manifest.packages;
    const bytes = readFileSync(join(outDir, one?.file ?? ''));
    expect(one).toMatchObject({
      file: 'automagik-one-dsh-2.261025.2.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex'),
      size: bytes.byteLength,
      description: 'One',
      license: 'Apache-2.0',
      repository: { type: 'git', url: 'git+https://github.com/automagik-dev/omni.git' },
      peerDependencies: { '@deepseek-ai/cordis': '*' },
      engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
      dsh: { client: { platform: 'web' } },
    });
    // The out dir holds exactly this release: the stale tarball is gone.
    expect(() => readFileSync(join(outDir, 'stale.tgz'))).toThrow();
  });

  test('packs a plugin at its own version, the Omni release of its last change', async () => {
    const appsDir = join(root, 'lagging');
    plugin(appsDir, 'kept-dsh', { name: 'kept-dsh', version: '2.261024.6' });
    plugin(appsDir, 'moved-dsh', { name: 'moved-dsh', version: '2.261025.2' });
    const manifest = await packMarket({
      appsDir,
      outDir: join(root, 'lagging-out'),
      omniVersion: '2.261025.2',
      automagik: false,
    });
    expect(manifest.omniVersion).toBe('2.261025.2');
    expect(manifest.packages.map((pkg) => [pkg.name, pkg.version, pkg.file])).toEqual([
      ['kept-dsh', '2.261024.6', 'kept-dsh-2.261024.6.tgz'],
      ['moved-dsh', '2.261025.2', 'moved-dsh-2.261025.2.tgz'],
    ]);
  });

  test('refuses a plugin newer than Omni, or at a version that is no Omni release', async () => {
    for (const [dir, version] of [
      ['ahead', '2.261026.1'],
      ['other', '0.1.9'],
    ] as const) {
      const appsDir = join(root, dir);
      plugin(appsDir, 'odd-dsh', { name: 'odd-dsh', version });
      await expect(
        packMarket({ appsDir, outDir: join(root, `${dir}-out`), omniVersion: '2.261025.2', automagik: false }),
      ).rejects.toThrow(`odd-dsh is ${version}: a plugin carries the Omni release of its last change`);
    }
  });

  test('carries the pinned Automagik release, at its own version, and refuses other bytes', async () => {
    // A release's tarball, as automagik's release.yml packs it.
    const release = join(root, 'automagik-release');
    plugin(join(root, 'automagik-src'), 'bots-dsh', {
      name: '@automagik/bots-dsh',
      version: '3.261023.1',
      description: 'The Bot team',
      dsh: { client: { platform: 'web' } },
    });
    mkdirSync(release, { recursive: true });
    Bun.spawnSync([process.execPath, 'pm', 'pack', '--quiet', '--destination', release], {
      cwd: join(root, 'automagik-src', 'bots-dsh'),
    });
    const file = 'automagik-bots-dsh-3.261023.1.tgz';
    const bytes = readFileSync(join(release, file));
    const pin = {
      repository: 'https://github.com/automagik-dev/automagik',
      version: '3.261023.1',
      commit: 'a'.repeat(40),
      packages: {
        '@automagik/bots-dsh': {
          version: '3.261023.1',
          file,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          size: bytes.byteLength,
        },
      },
    };
    const pinFile = join(root, 'automagik.json');
    writeFileSync(pinFile, JSON.stringify(pin));
    const appsDir = join(root, 'with-automagik');
    plugin(appsDir, 'omni-channels-dsh', { name: '@automagik/omni-channels-dsh', version: '2.261025.2' });
    const outDir = join(root, 'with-automagik-out');

    const manifest = await packMarket({
      appsDir,
      outDir,
      omniVersion: '2.261025.2',
      automagik: { pinFile, from: release },
    });

    expect(manifest.packages.map((pkg) => [pkg.name, pkg.version])).toEqual([
      ['@automagik/bots-dsh', '3.261023.1'],
      ['@automagik/omni-channels-dsh', '2.261025.2'],
    ]);
    expect(manifest.packages[0]).toMatchObject({
      file,
      integrity: pin.packages['@automagik/bots-dsh'].integrity,
      description: 'The Bot team',
      dsh: { client: { platform: 'web' } },
    });
    expect(readFileSync(join(outDir, file))).toEqual(bytes);

    // Other bytes under the pinned name are refused.
    const tampered = join(root, 'tampered');
    mkdirSync(tampered, { recursive: true });
    writeFileSync(join(tampered, file), 'not the release');
    await expect(
      packMarket({
        appsDir,
        outDir: join(root, 'tampered-out'),
        omniVersion: '2.261025.2',
        automagik: { pinFile, from: tampered },
      }),
    ).rejects.toThrow(/is not the pinned tarball/);
  });

  test("the repository's own pin names a release of automagik-dev/automagik", async () => {
    // @ts-expect-error -- plain Node ESM without types
    const { readPin } = await import('../apps/automagik.mjs');
    const pin = readPin();
    expect(Object.keys(pin.packages).sort()).toEqual(['@automagik/bots-dsh', '@automagik/welcome-dsh']);
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
