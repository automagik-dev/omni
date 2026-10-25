/**
 * Omni's own DSH plugins (apps/*-dsh) carry the Omni version of their last change.
 *
 * A release cut (scripts/sync-versions.ts, from .github/workflows/version.yml) moves a plugin to
 * the version being cut only when something in its folder changed since the release its current
 * version names (the tag v<version>); otherwise the plugin keeps its version. So a plugin's
 * version is always an Omni release, never newer than the repository's, and the folder at that
 * release's tag is byte-identical to the folder at every later release until it changes again.
 * scripts/verify-versions.ts holds the repository to exactly that.
 *
 * Each plugin declares the oldest Omni it works with in `engines.omni` (`>=<version>`), which
 * scripts/plugin-compat.test.ts checks against that release's API. A minimum above the
 * repository's version names the release the change will be cut in (the API it needs is not
 * released yet): the cut writes that release's version there.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Omni's calver: <major>.<yymmdd>.<build>, no prerelease suffix. */
export const RELEASE_VERSION = /^\d+\.\d{6}\.\d+$/;

/** `engines.omni`: a lower bound, optionally with an upper one (`>=2.261025.2`, `>=2.261025.2 <3`). */
const MINIMUM_RANGE = /^>=\s*(\d+\.\d{6}\.\d+)(?:\s+<\s*\d+(?:\.\d+){0,2})?$/;

export interface OwnPlugin {
  /** Repo-relative folder, e.g. apps/omni-channels-dsh. */
  dir: string;
  name: string;
  version: string;
  /** `engines.omni` as written, or null when the plugin declares none. */
  omniRange: string | null;
}

/** -1, 0 or 1 as `a` is an older, the same or a newer release than `b` (numeric, part by part). */
export function compareRelease(a: string, b: string): number {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let index = 0; index < 3; index++) {
    const diff = (x?.[index] ?? 0) - (y?.[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The minimum Omni release an `engines.omni` range names, or null when it is not `>=<release>`. */
export function minimumOf(range: string | null | undefined): string | null {
  return range ? (MINIMUM_RANGE.exec(range.trim())?.[1] ?? null) : null;
}

/** Omni's own plugins: every apps/*-dsh folder with a package.json that is not private. */
export function ownPlugins(root: string): OwnPlugin[] {
  const apps = join(root, 'apps');
  if (!existsSync(apps)) return [];
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-dsh'))
    .map((entry) => `apps/${entry.name}`)
    .filter((dir) => existsSync(join(root, dir, 'package.json')))
    .sort()
    .flatMap((dir) => {
      const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as {
        name?: unknown;
        version?: unknown;
        private?: unknown;
        engines?: { omni?: unknown };
      };
      if (pkg.private === true) return [];
      return [
        {
          dir,
          name: String(pkg.name ?? dir),
          version: String(pkg.version ?? ''),
          omniRange: typeof pkg.engines?.omni === 'string' ? pkg.engines.omni : null,
        },
      ];
    });
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(root: string, args: string[]): boolean {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit of release `version` (its tag v<version>), fetching just that tag when this clone
 * lacks it (CI checks out shallow and without tags); null when there is no such release.
 */
export function releaseCommit(root: string, version: string): string | null {
  if (!RELEASE_VERSION.test(version)) return null;
  const ref = `refs/tags/v${version}`;
  const resolve = () =>
    gitOk(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`])
      ? git(root, ['rev-parse', `${ref}^{commit}`])
      : null;
  const found = resolve();
  if (found) return found;
  // --depth only in a clone that is already shallow: in a full clone it would make the clone
  // shallow again, and checks that walk history after this one (the market gate) would break.
  const shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  gitOk(root, ['fetch', '--quiet', '--no-tags', ...(shallow ? ['--depth=1'] : []), 'origin', `+${ref}:${ref}`]);
  return resolve();
}

/**
 * Whether `dir` differs between commit `from` and `to`, or the working tree (tracked changes and
 * untracked files that are not ignored) when `to` is null.
 */
function folderChanged(root: string, dir: string, from: string, to: string | null): boolean {
  if (to !== null) return !gitOk(root, ['diff', '--quiet', from, to, '--', dir]);
  if (!gitOk(root, ['diff', '--quiet', from, '--', dir])) return true;
  return git(root, ['ls-files', '--others', '--exclude-standard', '--', dir]) !== '';
}

export interface PluginPlan {
  dir: string;
  name: string;
  /** The plugin's version now. */
  from: string;
  /** Its version after the cut. */
  to: string;
  why: string;
  /** `engines.omni` after the cut, when the cut rewrites a pending minimum; else null. */
  omniRange: string | null;
}

/**
 * What cutting `release` does to each plugin, judged on the working tree: a plugin moves to
 * `release` when its folder changed since the tag of its version (or that tag is missing);
 * otherwise it keeps its version. `previous` is the repository's version before the cut: a
 * plugin minimum above it is pending, and becomes `>=<release>`.
 */
export function planPluginVersions(root: string, release: string, previous: string): PluginPlan[] {
  return ownPlugins(root).map((plugin) => {
    const minimum = minimumOf(plugin.omniRange);
    const pending = minimum !== null && compareRelease(minimum, previous) > 0;
    const omniRange = pending ? (plugin.omniRange as string).replace(minimum, release) : null;
    const base = { dir: plugin.dir, name: plugin.name, from: plugin.version, omniRange };
    if (plugin.version === release) return { ...base, to: release, why: 'already at the release' };
    const commit = releaseCommit(root, plugin.version);
    if (commit === null) return { ...base, to: release, why: `no release tag v${plugin.version}` };
    if (pending || folderChanged(root, plugin.dir, commit, null))
      return { ...base, to: release, why: `changed since v${plugin.version}` };
    return { ...base, to: plugin.version, why: `unchanged since v${plugin.version}` };
  });
}

export interface PluginProblem {
  dir: string;
  problem: string;
}

/**
 * Every way the plugins break the rule, for the repository at `version`. `cut` is the commit of
 * the release the repository is at (its tag, else HEAD while that tag is not pushed yet): a
 * plugin behind the repository must be unchanged between its own release and that one. Changes
 * after `cut` are pending; the next cut bumps them.
 */
export function pluginProblems(root: string, version: string, cut: string): PluginProblem[] {
  const problems: PluginProblem[] = [];
  for (const plugin of ownPlugins(root)) {
    const say = (problem: string) => problems.push({ dir: plugin.dir, problem });
    if (!RELEASE_VERSION.test(plugin.version)) {
      say(`version ${plugin.version || '<missing>'} is not an Omni release version`);
      continue;
    }
    if (compareRelease(plugin.version, version) > 0) say(`${plugin.version} is newer than the repository's ${version}`);
    else if (plugin.version !== version) {
      const own = releaseCommit(root, plugin.version);
      if (own === null) say(`${plugin.version} is not an Omni release (no tag v${plugin.version})`);
      else if (folderChanged(root, plugin.dir, own, cut))
        say(`changed between v${plugin.version} and ${version} but was not moved to ${version}`);
    }
    const minimum = minimumOf(plugin.omniRange);
    if (minimum === null) say(`engines.omni must be ">=<Omni release>", not ${JSON.stringify(plugin.omniRange)}`);
    else if (compareRelease(minimum, plugin.version) > 0 && compareRelease(minimum, version) <= 0)
      say(`engines.omni needs Omni ${minimum}, newer than the plugin's own ${plugin.version}`);
  }
  return problems;
}
