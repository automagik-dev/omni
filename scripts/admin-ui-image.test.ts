/**
 * The Omni Admin UI image (deploy/Dockerfile.admin-ui): DSH with Omni's plugins behind
 * deploy/admin-ui/server.mjs, keeping the contract the Helm chart's adminUi workload uses.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain Node module with no type declarations.
import { configOf, dshArgsOf, installProfile, launchPathOf, writeLink } from '../deploy/admin-ui/server.mjs';

const ROOT = join(import.meta.dir, '..');
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

describe('what the image ships', () => {
  test('the DSH it runs is the one the plugins are tested on', () => {
    const tested = readJson('apps/omni-ui-dsh/dev/harness/package.json').dependencies['@deepseek-ai/dsh'];
    expect(readJson('deploy/admin-ui/runtime/package.json').dependencies['@deepseek-ai/dsh']).toBe(tested);
    expect(
      readJson('deploy/admin-ui/runtime/package-lock.json').packages['node_modules/@deepseek-ai/dsh'].version,
    ).toBe(tested);
  });

  test("the profile bundles Omni's apps/*-dsh plugins and the vetted add-ons, each at an exact version", () => {
    const profile = readJson('deploy/admin-ui/profile/package.json');
    for (const name of Object.keys(profile.dependencies)) {
      expect(profile.dsh.profile.bundles).toContain(name);
    }
    const names = ['omni-ui-dsh', 'omni-channels-dsh', 'omni-canvas-dsh', 'omni-ai-dsh'].map(
      (dir) => readJson(`apps/${dir}/package.json`).name,
    );
    const addons = { '@goodandready/dsh-subscriptions': '0.7.19' };
    expect(Object.keys(profile.dependencies).sort()).toEqual([...names, ...Object.keys(addons)].sort());
    for (const [name, version] of Object.entries(addons)) expect(profile.dependencies[name]).toBe(version);
    // No local-Ollama fallback: a chat never moves to another model on its own.
    expect(readFileSync(join(ROOT, 'deploy/admin-ui/profile/cordis.patch.yml'), 'utf8')).toMatch(
      /^- id: dsh-subscriptions\n {2}config:\n {4}ollamaFallback: false$/m,
    );
  });
});

describe('server.mjs', () => {
  test('the chart contract: port 8899 on 0.0.0.0, DSH beside it on loopback', () => {
    const config = configOf({});
    expect(config).toMatchObject({ host: '0.0.0.0', port: 8899, dshPort: 8900, publicUrl: null, home: '/data' });
    expect(dshArgsOf(config, 'bin.js')).toEqual([
      'bin.js',
      '--profile',
      'omni',
      '--no-open',
      '--host',
      '127.0.0.1',
      '--port',
      '8900',
    ]);
    expect(() => configOf({ PORT: '8899', DSH_PORT: '8899' })).toThrow('DSH_PORT');
    expect(() => configOf({ PORT: 'eighty' })).toThrow('PORT');
  });

  test('a public URL is advertised and its host trusted', () => {
    const config = configOf({ OMNI_UI_PUBLIC_URL: 'https://ui.example.test/omni' });
    expect(config.publicUrl.href).toBe('https://ui.example.test/omni/');
    expect(dshArgsOf(config, 'bin.js').slice(-4)).toEqual([
      '--public-url',
      'https://ui.example.test/omni/',
      '--trusted-host',
      'ui.example.test',
    ]);
    expect(() => configOf({ OMNI_UI_PUBLIC_URL: 'ftp://ui.example.test/' })).toThrow('http');
  });

  test('the Omni link is written 0600 and keeps what it held while the URL and key stay', () => {
    const home = mkdtempSync(join(tmpdir(), 'admin-ui-'));
    expect(writeLink({ home, baseUrl: 'http://omni:8882', apiKey: null })).toBe(false);
    expect(writeLink({ home, baseUrl: 'http://omni:8882/api/v2/', apiKey: 'omni_sk_one' })).toBe(true);
    const path = join(home, 'ui', 'omni.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const first = JSON.parse(readFileSync(path, 'utf8'));
    expect(first).toMatchObject({ url: 'http://omni:8882', key: 'omni_sk_one' });
    writeFileSync(path, JSON.stringify({ ...first, marketOffered: true }));
    writeLink({ home, baseUrl: 'http://omni:8882', apiKey: 'omni_sk_one' });
    expect(JSON.parse(readFileSync(path, 'utf8')).marketOffered).toBe(true);
    writeLink({ home, baseUrl: 'http://omni:8882', apiKey: 'omni_sk_two' });
    const moved = JSON.parse(readFileSync(path, 'utf8'));
    expect(moved.key).toBe('omni_sk_two');
    expect(moved.marketOffered).toBeUndefined();
  });

  test('the launch path comes from the URL DSH prints', () => {
    expect(launchPathOf('dsh web: https://ui.example.test/?token=abc_DEF-1\n')).toBe('/?token=abc_DEF-1');
    expect(launchPathOf('dsh web: http://127.0.0.1:8900/?token=xyz')).toBe('/?token=xyz');
    expect(launchPathOf('dsh web: listening on 0.0.0.0 over plain HTTP')).toBeNull();
  });

  test("a new image's profile replaces the shipped packages and keeps the user's", () => {
    const base = mkdtempSync(join(tmpdir(), 'admin-ui-'));
    const source = join(base, 'source');
    const dshHome = join(base, 'dsh');
    const shipped = {
      dependencies: { '@automagik/omni-dsh': 'file:vendor/omni-dsh-1.tgz' },
      dsh: { profile: { bundles: ['@automagik/omni-dsh'] } },
    };
    mkdirSync(join(source, 'node_modules', '@automagik', 'omni-dsh'), { recursive: true });
    mkdirSync(join(source, 'vendor'), { recursive: true });
    writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'one');
    writeFileSync(join(source, 'package.json'), JSON.stringify(shipped));
    writeFileSync(join(source, 'cordis.patch.yml'), '[]\n');
    writeFileSync(join(source, 'pnpm-workspace.yaml'), 'packages: [.]\n');
    writeFileSync(join(source, '.build-id'), 'one');
    expect(installProfile({ dshHome, source }).installed).toBe(true);
    expect(installProfile({ dshHome, source }).installed).toBe(false);

    const target = join(dshHome, 'profiles', 'omni');
    writeFileSync(join(target, 'cordis.patch.yml'), '- id: mine\n');
    writeFileSync(
      join(target, 'package.json'),
      JSON.stringify({
        dependencies: { ...shipped.dependencies, 'added-plugin': '1.0.0' },
        dsh: { profile: { bundles: ['@automagik/omni-dsh', 'added-plugin'] } },
      }),
    );
    writeFileSync(join(source, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'two');
    writeFileSync(join(source, '.build-id'), 'two');
    expect(installProfile({ dshHome, source }).installed).toBe(true);
    expect(readFileSync(join(target, 'node_modules', '@automagik', 'omni-dsh', 'index.js'), 'utf8')).toBe('two');
    expect(readFileSync(join(target, 'cordis.patch.yml'), 'utf8')).toBe('- id: mine\n');
    const merged = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(merged.dependencies['added-plugin']).toBe('1.0.0');
    expect(merged.dsh.profile.bundles).toEqual(['@automagik/omni-dsh', 'added-plugin']);
  });
});
