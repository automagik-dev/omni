/**
 * Which package manager installs what. The repository is Bun; a DSH profile (the desktop app's,
 * the Admin UI image's, dev/live.mjs's) is installed by DSH's own `dsh plugin`, which is pnpm, and
 * never by npm, whose tree and lockfile DSH's plugin manager does not reconcile against. The DSH
 * plugin folders apps/*-dsh run on Node, as DSH does, and install with Bun, except where Bun cannot.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const PLUGINS = readdirSync(join(ROOT, 'apps')).filter((dir) => dir.endsWith('-dsh'));
// Bun resolves every peer dependency from the registry, and these two peer on Omni's own plugins,
// which ship through the Automagik market rather than npm: their lockfile stays npm's.
const NPM_LOCKED = new Set(['omni-channels-dsh', 'omni-canvas-dsh']);
const NPM_INSTALL = /\bnpm\s+(?:ci|install|i)\b/;

describe('the DSH plugin folders', () => {
  test('are the four Omni plugins', () => {
    expect(PLUGINS.sort()).toEqual(['omni-ai-dsh', 'omni-canvas-dsh', 'omni-channels-dsh', 'omni-ui-dsh']);
  });

  test('lock with Bun, or with npm only where Bun cannot resolve their peers', () => {
    for (const dir of PLUGINS) {
      const npm = existsSync(join(ROOT, 'apps', dir, 'package-lock.json'));
      const bun = existsSync(join(ROOT, 'apps', dir, 'bun.lock'));
      expect({ dir, npm, bun }).toEqual({ dir, npm: NPM_LOCKED.has(dir), bun: !NPM_LOCKED.has(dir) });
    }
  });

  test("a Bun-locked folder never installs the DSH packages it peers on (npm's legacy-peer-deps)", () => {
    for (const dir of PLUGINS.filter((name) => !NPM_LOCKED.has(name))) {
      expect(read(`apps/${dir}/bunfig.toml`)).toMatch(/^\[install\][\s\S]*^peer = false$/m);
      expect(existsSync(join(ROOT, 'apps', dir, '.npmrc'))).toBe(false);
    }
  });

  test('install the pinned DSH harness with Bun, and no script runs an npm install', () => {
    for (const dir of PLUGINS) {
      const { scripts } = JSON.parse(read(`apps/${dir}/package.json`));
      expect(scripts.harness).toBe('bun install --cwd dev/harness --no-save --no-summary');
      for (const [name, command] of Object.entries<string>(scripts)) {
        expect({ name, npmInstall: NPM_INSTALL.test(command) }).toEqual({ name, npmInstall: false });
      }
    }
  });

  test('build with `node scripts/build-client.mjs`, which dev/live.mjs runs directly', () => {
    for (const dir of PLUGINS) {
      expect(JSON.parse(read(`apps/${dir}/package.json`)).scripts.build).toBe('node scripts/build-client.mjs');
    }
    expect(read('apps/omni-ui-dsh/dev/live.mjs')).toContain("spawn(process.execPath, ['scripts/build-client.mjs']");
  });
});

describe('a DSH profile', () => {
  test('dev/live.mjs adds to its profile through dsh plugin, never npm', () => {
    const live = read('apps/omni-ui-dsh/dev/live.mjs');
    expect(live).toContain("'plugin', '--profile', PROFILE, 'add'");
    expect(NPM_INSTALL.test(live)).toBe(false);
    expect(live).not.toMatch(/spawn\(\s*'npm'/);
  });

  test("the Admin UI image's profile is installed by dsh plugin; npm installs only the DSH runtime", () => {
    const prepare = read('deploy/admin-ui/prepare.mjs');
    expect(prepare).toMatch(/'plugin',\s*'--profile',\s*'omni',\s*'install'/);
    expect(NPM_INSTALL.test(prepare)).toBe(false);
    const npmInstalls = prepare.split('\n').filter((line) => /\bnpm\(\[\s*'(?:ci|install|i)'/.test(line));
    expect(npmInstalls.length).toBeGreaterThan(0);
    for (const line of npmInstalls) expect(line).toContain('runtimeDir');
  });
});
