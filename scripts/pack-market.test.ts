import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { MarketManifestSchema } from '../packages/api/src/market/manifest';
import { discoverPlugins, packMarket } from './pack-market';

const repoRoot = join(import.meta.dir, '..');
// Archive-backed tests use the marketplace budget of 120 s: bun pm pack and tar run
// subprocesses for each package. Discovery and pre-pack validation tests keep the 5 s default.
const root = mkdtempSync(join(tmpdir(), 'omni-pack-market-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A minimal DSH plugin, as apps/*-dsh lay them out. */
function plugin(appsDir: string, dir: string, pkg: Record<string, unknown>) {
  mkdirSync(join(appsDir, dir), { recursive: true });
  writeFileSync(join(appsDir, dir, 'package.json'), JSON.stringify({ files: ['index.js'], ...pkg }));
  writeFileSync(join(appsDir, dir, 'index.js'), 'export default {};\n');
}

describe('pack-market', () => {
  test('the API image copies the complete local import graph of its build scripts', () => {
    const dockerfile = readFileSync(join(repoRoot, 'deploy/Dockerfile'), 'utf8');
    const stage = dockerfile.match(/FROM [^\n]+ AS deps\n([\s\S]*?)\nFROM deps AS builder\b/)?.[1];
    expect(stage, 'the API image has the deps stage inherited by its builder').toBeDefined();
    const copies = (stage ?? '')
      .split('\n')
      .filter((line) => line.startsWith('COPY ') && !line.startsWith('COPY --from='));
    expect(copies.length).toBeGreaterThan(0);
    const sources = copies.map((line) => {
      const [, source, destination, ...extra] = line.split(/\s+/);
      expect(extra, `update this guard for COPY syntax: ${line}`).toEqual([]);
      // Imports resolve in /src just as in the checkout; a copy to a different path is insufficient.
      expect(resolve(repoRoot, destination ?? ''), line).toBe(resolve(repoRoot, source ?? ''));
      return resolve(repoRoot, source ?? '');
    });
    const copied = (file: string) =>
      sources.some(
        (source) => file === source || (statSync(source).isDirectory() && file.startsWith(`${source}${sep}`)),
      );
    const cli = JSON.parse(readFileSync(join(repoRoot, 'packages/cli/package.json'), 'utf8'));
    const entry = cli.scripts['build:market'].match(/^bun (\S+) /)?.[1];
    expect(entry, 'resolve the actual build:market entry').toBeDefined();
    const scripts = sources.filter((source) => source.startsWith(`${join(repoRoot, 'scripts')}${sep}`));
    expect(scripts.length).toBeGreaterThan(0);
    const queue = [resolve(repoRoot, 'packages/cli', entry ?? ''), ...scripts];
    const seen = new Set<string>();
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    for (const file of queue) {
      if (seen.has(file)) continue;
      seen.add(file);
      expect(copied(file), `${relative(repoRoot, file)} must be COPYed into the API builder`).toBe(true);
      const source = readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, '');
      for (const dependency of transpiler.scanImports(source)) {
        if (dependency.path.startsWith('.')) queue.push(Bun.resolveSync(dependency.path, dirname(file)));
      }
    }
  });

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
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);

  test("the repository's own pin names a release of automagik-dev/automagik", async () => {
    // @ts-expect-error -- plain Node ESM without types
    const { readPin } = await import('../apps/automagik.mjs');
    const pin = readPin();
    expect(Object.keys(pin.packages).sort()).toEqual(['@automagik/bots-dsh', '@automagik/welcome-dsh']);
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
