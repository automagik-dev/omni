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
    expect(dirs).toContain('omni-ui-dsh');
    expect(dirs).toContain('omni-ai-dsh');
    for (const dir of dirs) expect(dir.endsWith('-dsh')).toBe(true);
  });

  test('packs each plugin with npm pack and writes a manifest the server accepts', () => {
    const appsDir = join(root, 'apps');
    plugin(appsDir, 'one-dsh', {
      name: '@automagik/one-dsh',
      version: '2.1.0',
      description: 'One',
      license: 'Apache-2.0',
      repository: 'git+https://github.com/automagik-dev/omni.git',
      peerDependencies: { '@deepseek-ai/cordis': '*' },
      engines: { dsh: '>=0.2.1-rc.2 <0.3.0' },
      dsh: { client: { platform: 'web' } },
      scripts: { prepack: 'exit 1' },
    });
    plugin(appsDir, 'two-dsh', { name: 'two-dsh', version: '2.1.0' });
    plugin(appsDir, 'private-dsh', { name: 'private-dsh', version: '2.1.0', private: true });
    plugin(appsDir, 'ui', { name: 'not-a-plugin', version: '2.1.0' });
    const outDir = join(root, 'out');
    mkdirSync(outDir);
    writeFileSync(join(outDir, 'stale.tgz'), 'old');

    const manifest = packMarket({ appsDir, outDir, omniVersion: '2.1.0', packedAt: 1792553326 });

    expect(MarketManifestSchema.parse(JSON.parse(readFileSync(join(outDir, 'market.json'), 'utf8')))).toEqual(manifest);
    expect(manifest).toMatchObject({ format: 1, omniVersion: '2.1.0', packedAt: 1792553326 });
    expect(manifest.packages.map((pkg) => pkg.name)).toEqual(['@automagik/one-dsh', 'two-dsh']);
    const [one] = manifest.packages;
    const bytes = readFileSync(join(outDir, one?.file ?? ''));
    expect(one).toMatchObject({
      file: 'automagik-one-dsh-2.1.0.tgz',
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

  test("refuses a plugin that is not at Omni's version", () => {
    const appsDir = join(root, 'drift');
    plugin(appsDir, 'old-dsh', { name: 'old-dsh', version: '0.1.9' });
    expect(() => packMarket({ appsDir, outDir: join(root, 'drift-out'), omniVersion: '2.1.0' })).toThrow(
      /not Omni's 2\.1\.0/,
    );
  });
});
