/**
 * The rule Omni's own DSH plugins are versioned by (scripts/lib/plugin-versions.ts): a cut moves a
 * plugin to the release only when its folder changed since the release its version names, and
 * the repository is held to that. Each test builds a small repository with real tags.
 *
 * Run: bun test scripts/plugin-versions.test.ts
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRelease, minimumOf, planPluginVersions, pluginProblems, releaseCommit } from './lib/plugin-versions';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const R1 = '2.000101.1';
const R2 = '2.000101.2';
const R3 = '2.000102.1';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function writeJson(root: string, path: string, value: unknown) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}
const readJson = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
function setVersion(root: string, path: string, version: string) {
  writeJson(root, path, { ...readJson(root, path), version });
}

/** A repository at release R1: root package.json and two plugins, both at R1, tagged v<R1>. */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'omni-plugin-versions-'));
  roots.push(root);
  git(root, 'init', '--quiet', '--initial-branch=dev');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  writeJson(root, 'package.json', { name: 'omni-v2', version: R1 });
  for (const name of ['omni-channels-dsh', 'omni-canvas-dsh']) {
    writeJson(root, `apps/${name}/package.json`, {
      name: `@automagik/${name}`,
      version: R1,
      engines: { omni: `>=${R1}` },
    });
    writeFileSync(join(root, `apps/${name}/index.js`), 'export default {}\n');
  }
  commitAndTag(root, R1);
  return root;
}
function commitAndTag(root: string, version: string | null, message = 'change') {
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', message);
  if (version) git(root, 'tag', `v${version}`);
}
/** What sync-versions does with the plan: the root to `release`, each plugin to its planned version. */
function cut(root: string, release: string) {
  const previous = readJson(root, 'package.json').version;
  const plans = planPluginVersions(root, release, previous);
  setVersion(root, 'package.json', release);
  for (const plan of plans) {
    setVersion(root, `${plan.dir}/package.json`, plan.to);
    if (plan.omniRange) {
      const pkg = readJson(root, `${plan.dir}/package.json`);
      writeJson(root, `${plan.dir}/package.json`, { ...pkg, engines: { ...pkg.engines, omni: plan.omniRange } });
    }
  }
  commitAndTag(root, release, `chore(version): bump to ${release}`);
  return plans;
}
const versions = (root: string) =>
  ['omni-canvas-dsh', 'omni-channels-dsh'].map((name) => readJson(root, `apps/${name}/package.json`).version);

describe('release versions', () => {
  test('compare part by part, numerically', () => {
    expect(compareRelease('2.261025.10', '2.261025.9')).toBe(1);
    expect(compareRelease('2.261024.9', '2.261025.1')).toBe(-1);
    expect(compareRelease('2.261025.1', '2.261025.1')).toBe(0);
  });

  test('engines.omni names a minimum release', () => {
    expect(minimumOf('>=2.261025.2')).toBe('2.261025.2');
    expect(minimumOf('>= 2.261025.2 <3')).toBe('2.261025.2');
    expect(minimumOf('^2.261025.2')).toBeNull();
    expect(minimumOf(null)).toBeNull();
  });
});

describe('a release cut', () => {
  test('with no plugin change keeps both plugins at their version', () => {
    const root = repo();
    writeFileSync(join(root, 'server.ts'), 'export {}\n');
    commitAndTag(root, null, 'feat(api): something');
    const plans = cut(root, R2);
    expect(plans.map((plan) => [plan.dir, plan.to])).toEqual([
      ['apps/omni-canvas-dsh', R1],
      ['apps/omni-channels-dsh', R1],
    ]);
    expect(versions(root)).toEqual([R1, R1]);
    expect(pluginProblems(root, R2, git(root, 'rev-parse', 'HEAD'))).toEqual([]);
  });

  test('with a channels change moves only channels', () => {
    const root = repo();
    writeFileSync(join(root, 'apps/omni-channels-dsh/index.js'), 'export default { changed: true }\n');
    commitAndTag(root, null, 'feat(omni-channels): something');
    cut(root, R2);
    expect(versions(root)).toEqual([R1, R2]);
    // The next cut, with nothing new in either folder, moves neither.
    writeFileSync(join(root, 'server.ts'), 'export {}\n');
    commitAndTag(root, null, 'feat(api): something');
    cut(root, R3);
    expect(versions(root)).toEqual([R1, R2]);
    expect(pluginProblems(root, R3, git(root, 'rev-parse', 'HEAD'))).toEqual([]);
  });

  test('counts a new file in the folder as a change, and an untracked one before it is committed', () => {
    const root = repo();
    writeFileSync(join(root, 'apps/omni-canvas-dsh/extra.js'), 'export {}\n');
    expect(planPluginVersions(root, R2, R1).find((plan) => plan.dir === 'apps/omni-canvas-dsh')?.to).toBe(R2);
    commitAndTag(root, null);
    cut(root, R2);
    expect(versions(root)).toEqual([R2, R1]);
  });

  test('moves a plugin whose version names no release tag', () => {
    const root = repo();
    git(root, 'tag', '-d', `v${R1}`);
    expect(planPluginVersions(root, R2, R1).map((plan) => [plan.to, plan.why])).toEqual([
      [R2, `no release tag v${R1}`],
      [R2, `no release tag v${R1}`],
    ]);
  });

  test('a re-run of the same cut changes nothing', () => {
    const root = repo();
    cut(root, R2);
    const plans = planPluginVersions(root, R2, R2);
    expect(plans.map((plan) => plan.to)).toEqual([R1, R1]);
  });

  test('writes the release into a pending engines.omni minimum, and moves that plugin', () => {
    const root = repo();
    const path = 'apps/omni-channels-dsh/package.json';
    writeJson(root, path, { ...readJson(root, path), engines: { omni: '>=9.999999.1' } });
    commitAndTag(root, null, 'feat(omni-channels): use an API of the next release');
    expect(pluginProblems(root, R1, git(root, 'rev-parse', `v${R1}`))).toEqual([]);
    cut(root, R2);
    expect(readJson(root, path)).toMatchObject({ version: R2, engines: { omni: `>=${R2}` } });
    expect(versions(root)).toEqual([R1, R2]);
  });
});

describe('the repository is held to the rule', () => {
  test('a plugin behind the repository, unchanged since its release, passes', () => {
    const root = repo();
    cut(root, R2);
    expect(pluginProblems(root, R2, git(root, 'rev-parse', `v${R2}`))).toEqual([]);
  });

  test('changes after the last cut are pending, not drift', () => {
    const root = repo();
    cut(root, R2);
    writeFileSync(join(root, 'apps/omni-canvas-dsh/index.js'), 'export default { pending: true }\n');
    commitAndTag(root, null, 'feat(omni-canvas): pending');
    expect(pluginProblems(root, R2, git(root, 'rev-parse', `v${R2}`))).toEqual([]);
  });

  test('a plugin that changed by the cut but kept its version fails', () => {
    const root = repo();
    writeFileSync(join(root, 'apps/omni-canvas-dsh/index.js'), 'export default { changed: true }\n');
    setVersion(root, 'package.json', R2);
    commitAndTag(root, R2, 'a cut that forgot the canvas plugin');
    expect(pluginProblems(root, R2, git(root, 'rev-parse', `v${R2}`))).toEqual([
      { dir: 'apps/omni-canvas-dsh', problem: `changed between v${R1} and ${R2} but was not moved to ${R2}` },
    ]);
  });

  test('on the cut commit before its tag is pushed, HEAD stands for the release', () => {
    const root = repo();
    writeFileSync(join(root, 'apps/omni-canvas-dsh/index.js'), 'export default { changed: true }\n');
    setVersion(root, 'package.json', R2);
    commitAndTag(root, null, 'a cut that forgot the canvas plugin, not tagged yet');
    expect(releaseCommit(root, R2)).toBeNull();
    expect(pluginProblems(root, R2, 'HEAD').map((problem) => problem.dir)).toEqual(['apps/omni-canvas-dsh']);
  });

  test('a plugin newer than the repository fails', () => {
    const root = repo();
    setVersion(root, 'apps/omni-channels-dsh/package.json', R2);
    expect(pluginProblems(root, R1, 'HEAD')).toEqual([
      { dir: 'apps/omni-channels-dsh', problem: `${R2} is newer than the repository's ${R1}` },
    ]);
  });

  test('a plugin version that is no Omni release fails', () => {
    const root = repo();
    cut(root, R3);
    setVersion(root, 'apps/omni-channels-dsh/package.json', R2);
    setVersion(root, 'apps/omni-canvas-dsh/package.json', '1.0.0-beta.1');
    expect(pluginProblems(root, R3, 'HEAD').map((problem) => problem.problem)).toEqual([
      'version 1.0.0-beta.1 is not an Omni release version',
      `${R2} is not an Omni release (no tag v${R2})`,
    ]);
  });

  test('a minimum newer than the plugin itself, or none, fails', () => {
    const root = repo();
    cut(root, R2);
    const path = 'apps/omni-canvas-dsh/package.json';
    writeJson(root, path, { ...readJson(root, path), engines: { omni: `>=${R2}` } });
    const channels = 'apps/omni-channels-dsh/package.json';
    writeJson(root, channels, { ...readJson(root, channels), engines: {} });
    expect(pluginProblems(root, R2, git(root, 'rev-parse', `v${R2}`)).map((problem) => problem.problem)).toEqual([
      `engines.omni needs Omni ${R2}, newer than the plugin's own ${R1}`,
      'engines.omni must be ">=<Omni release>", not null',
    ]);
  });
});
