/**
 * One Bun for the whole repository: `.bun-version` names it, and every place that picks a
 * Bun follows it. A Bun newer than CI's rewrites bun.lock in a format CI cannot read, and a
 * Docker image on another Bun runs what CI never tested, so they move together.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const BUN = read('.bun-version').trim();
const WORKFLOWS = readdirSync(join(ROOT, '.github/workflows')).filter((file) => /\.ya?ml$/.test(file));

describe('the Bun version', () => {
  test('is an exact release', () => {
    expect(BUN).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('every workflow sets up exactly it', () => {
    const pins = WORKFLOWS.flatMap((file) =>
      [...read(`.github/workflows/${file}`).matchAll(/^\s*bun-version:\s*(\S+)/gm)].map(
        ([, version]) => `${file} ${version}`,
      ),
    );
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.filter((pin) => !pin.endsWith(` ${BUN}`))).toEqual([]);
    // setup-bun without a version takes the newest Bun.
    const unpinned = WORKFLOWS.filter((file) => {
      const steps = read(`.github/workflows/${file}`)
        .split(/^\s*- /m)
        .filter((step) => step.includes('oven-sh/setup-bun'));
      return steps.some((step) => !/bun-version:/.test(step));
    });
    expect(unpinned).toEqual([]);
  });

  test('the images build and run on it', () => {
    for (const file of ['deploy/Dockerfile', 'deploy/Dockerfile.admin-ui']) {
      expect(read(file).match(/^ARG BUN_VERSION=(\S+)$/m)?.[1]).toBe(BUN);
    }
  });

  test('packageManager and every @types/bun name it', () => {
    expect(JSON.parse(read('package.json')).packageManager).toBe(`bun@${BUN}`);
    const manifests = [
      'package.json',
      ...['apps', 'packages'].flatMap((dir) =>
        readdirSync(join(ROOT, dir), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${dir}/${entry.name}/package.json`),
      ),
    ].filter((path) => {
      try {
        read(path);
        return true;
      } catch {
        return false;
      }
    });
    const types = manifests.flatMap((path) => {
      const manifest = JSON.parse(read(path));
      const version = manifest.devDependencies?.['@types/bun'] ?? manifest.dependencies?.['@types/bun'];
      return version === undefined ? [] : [`${path} ${version}`];
    });
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((entry) => !entry.endsWith(` ${BUN}`))).toEqual([]);
  });

  test('the install scripts install it', () => {
    for (const file of ['install.sh', 'install-client.sh', 'scripts/check-dependencies.sh']) {
      const installs = [...read(file).matchAll(/bun\.sh\/install \| bash(?: -s "?bun-v([\d.]+)"?)?/g)];
      expect(installs.length).toBeGreaterThan(0);
      expect(installs.map(([, version]) => version)).toEqual(installs.map(() => BUN));
    }
  });
});

describe('what Bun 1.4 changed', () => {
  test('nothing assigns undefined to process.env, which Bun 1.4 stores as the string "undefined"', () => {
    // Reflect.deleteProperty(process.env, 'X') unsets it, so restoring a value that was unset deletes it.
    let found = '';
    try {
      found = execFileSync(
        'git',
        [
          'grep',
          '-n',
          '-E',
          String.raw`process\.env(\.[A-Za-z_]+|\[[^]]+\]) = undefined`,
          '--',
          '*.ts',
          '*.tsx',
          '*.js',
          '*.mjs',
          '*.cjs',
        ],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      // git grep exits 1 when nothing matches.
    }
    const assignments = found.split('\n').filter((line) => line !== '' && !/^[^:]+:\d+:\s*(\/\/|\*)/.test(line));
    expect(assignments).toEqual([]);
  });
});
