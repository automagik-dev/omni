#!/usr/bin/env bun
/**
 * The Automagik plugin marketplace index (marketplace/automagik.json), a DSH market index (format 1).
 *
 *   bun scripts/marketplace.ts check        validate the index; exit 1 on the first problem
 *   bun scripts/marketplace.ts pin <ref>    list Omni's own plugins at their version at <ref> (and Automagik's at the pin)
 *   bun scripts/marketplace.ts automagik    list Automagik's plugins at the release apps/automagik.json pins
 *
 * `check` runs DSH's own parser (parseMarketIndex) and then, for every git entry from this
 * repository, proves that the pinned commit is reachable from HEAD and holds, at the entry's
 * path, a package.json with the entry's name and version. A market installs exactly that
 * commit, so an entry that fails here fails in every user's DSH.
 *
 * Automagik's plugins (the Bot team Omni's channels and canvases build on, and the welcome) are
 * listed from automagik-dev/automagik at the release apps/automagik.json pins: `check` holds
 * them to that pin, and `pin` and `automagik` keep them on it.
 *
 * automagik-dev/dsh-marketplace lists this index at each Omni release, for DSH users without an
 * Omni (each of Omni's plugins at its own version, pinned to the commit this index names). Every Omni also serves the Automagik
 * marketplace for its own release at /api/market, with its page at /market (packages/api/src/market): Omni's plugins,
 * packed from the release by scripts/pack-market.ts, plus Automagik's plugins at the pin.
 * Outside plugins Automagik vetted are listed by Automagik's own index, not this one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
// @ts-expect-error -- plain Node ESM without types (apps/automagik.mjs), shared with the admin UI image.
import { readPin } from '../apps/automagik.mjs';
import { releaseCommit } from './lib/plugin-versions';

export const REPO_URL = 'https://github.com/automagik-dev/omni';
/** Where the Bot team and the welcome live since they left this repository. */
export const AUTOMAGIK_URL = 'https://github.com/automagik-dev/automagik';
export const INDEX_PATH = join(import.meta.dir, '..', 'marketplace', 'automagik.json');
export const INDEX_URL = 'https://raw.githubusercontent.com/automagik-dev/omni/labs/marketplace/automagik.json';
interface GitSource {
  type: 'git';
  url: string;
  commit: string;
  path?: string;
}
interface IndexVersion {
  version: string;
  publishTimestamp: number;
  source: GitSource | { type: 'npm' };
  engines?: { dsh?: string };
}
interface IndexPlugin {
  name: string;
  versions: IndexVersion[];
}
interface Index {
  plugins: IndexPlugin[];
}

const isOurs = (source: IndexVersion['source']): source is GitSource =>
  source.type === 'git' && source.url.replace(/\.git$/, '') === REPO_URL;
const isAutomagik = (source: IndexVersion['source']): source is GitSource =>
  source.type === 'git' && source.url.replace(/\.git$/, '') === AUTOMAGIK_URL;

interface AutomagikPin {
  version: string;
  commit: string;
  packages: Record<string, { version: string }>;
}
const pinnedAutomagik = (): AutomagikPin => readPin();

/** An Automagik plugin's folder in its repository: apps/<name without the scope>. */
const automagikPath = (name: string) => `apps/${name.replace(/^@automagik\//, '')}`;

function git(cwd: string, args: string[], timeout?: number): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim();
}

function gitOk(cwd: string, args: string[], timeout?: number): boolean {
  try {
    git(cwd, args, timeout);
    return true;
  } catch {
    return false;
  }
}

function packageAt(cwd: string, commit: string, path: string): { name?: string; version?: string } | null {
  try {
    return JSON.parse(git(cwd, ['show', `${commit}:${path}/package.json`]));
  } catch {
    return null;
  }
}

/** Another repository's package.json at `commit`, read from a cached bare clone; null when unreachable. */
export function forkManifest(url: string, commit: string, path: string): { name?: string; version?: string } | null {
  const cache = join(tmpdir(), 'omni-market-forks', url.replace(/[^a-z0-9]+/gi, '-'));
  if (!existsSync(cache)) {
    mkdirSync(cache, { recursive: true });
    git(cache, ['init', '--quiet', '--bare']);
  }
  if (!gitOk(cache, ['cat-file', '-e', `${commit}^{commit}`]))
    gitOk(cache, ['fetch', '--quiet', '--depth', '1', url, commit], 60_000);
  // A bare clone has no working directory for a `./` path to resolve against.
  try {
    return JSON.parse(git(cache, ['show', `${commit}:${path === '.' ? '' : `${path}/`}package.json`]));
  } catch {
    return null;
  }
}

/** Every problem with the index, empty when it is fit to serve. */
export function checkIndex(
  value: unknown,
  repoDir: string,
  readFork = forkManifest,
  automagik: AutomagikPin = pinnedAutomagik(),
): string[] {
  try {
    parseMarketIndex(value, INDEX_URL);
  } catch (error) {
    return [`index: ${(error as Error).message}`];
  }
  const problems: string[] = [];
  for (const plugin of (value as Index).plugins) {
    for (const entry of plugin.versions) {
      const at = `${plugin.name}@${entry.version}`;
      if (isAutomagik(entry.source)) {
        const pinned = automagik.packages[plugin.name];
        const { commit, path = '.' } = entry.source;
        if (!pinned || entry.version !== pinned.version || commit !== automagik.commit) {
          problems.push(
            `${at}: Automagik's plugins are listed at the release apps/automagik.json pins (${automagik.version}, ${automagik.commit.slice(0, 9)}): bun scripts/marketplace.ts automagik`,
          );
          continue;
        }
        const manifest = readFork(AUTOMAGIK_URL, commit, path);
        if (!manifest) problems.push(`${at}: ${AUTOMAGIK_URL} has no ${path}/package.json at ${commit}`);
        else if (manifest.name !== plugin.name || manifest.version !== entry.version)
          problems.push(
            `${at}: ${AUTOMAGIK_URL} ${commit}:${path}/package.json is ${manifest.name}@${manifest.version}`,
          );
        continue;
      }
      if (!isOurs(entry.source)) {
        problems.push(
          `${at}: sources must be git commits of ${REPO_URL} or ${AUTOMAGIK_URL} (Automagik's index lists the outside plugins it vetted)`,
        );
        continue;
      }
      const { commit, path = '.' } = entry.source;
      if (!gitOk(repoDir, ['cat-file', '-e', `${commit}^{commit}`]))
        gitOk(repoDir, ['fetch', '--quiet', 'origin', commit], 30_000);
      if (!gitOk(repoDir, ['merge-base', '--is-ancestor', commit, 'HEAD'])) {
        const shallow = git(repoDir, ['rev-parse', '--is-shallow-repository']) === 'true';
        problems.push(
          `${at}: commit ${commit} is not reachable from HEAD${shallow ? ' (this clone is shallow: git fetch --unshallow)' : ''}`,
        );
        continue;
      }
      const manifest = packageAt(repoDir, commit, path);
      if (!manifest) problems.push(`${at}: ${commit} has no ${path}/package.json`);
      else if (manifest.name !== plugin.name || manifest.version !== entry.version)
        problems.push(`${at}: ${commit}:${path}/package.json is ${manifest.name}@${manifest.version}`);
    }
  }
  return problems;
}

/**
 * List each of this repository's plugins at its version at `ref`, pinned to `ref`, adding that
 * version when it is new. A plugin carries the Omni release of its last change, so at most
 * releases its version is one already listed: that entry stays as it is (its commit and publish
 * time), and its package must be byte-identical at `ref`. What a listed version installs never
 * changes, so a changed package needs a version bump first. Older versions stay listed.
 */
export function pinIndex(value: Index, repoDir: string, ref: string): Index {
  // A release tag (v<version>) is fetched when this clone lacks it, as CI's checkout has no tags.
  const release = /^v(\d+\.\d+\.\d+)$/.exec(ref);
  const commit = release ? releaseCommit(repoDir, release[1]) : git(repoDir, ['rev-parse', `${ref}^{commit}`]);
  if (!commit) throw new Error(`${ref}: no such release`);
  const publishTimestamp = Number(git(repoDir, ['show', '-s', '--format=%ct', commit]));
  for (const plugin of value.plugins) {
    const latest = plugin.versions.find((entry) => isOurs(entry.source));
    if (!latest || !isOurs(latest.source)) continue;
    const manifest = packageAt(repoDir, commit, latest.source.path ?? '.');
    if (!manifest?.version) throw new Error(`${plugin.name}: ${ref} has no package.json at ${latest.source.path}`);
    const source: GitSource = { ...latest.source, commit };
    const same = plugin.versions.find((entry) => entry.version === manifest.version);
    if (same && isOurs(same.source) && same.source.commit !== commit) {
      const unchanged = gitOk(repoDir, ['diff', '--quiet', same.source.commit, commit, '--', same.source.path ?? '.']);
      if (!unchanged)
        throw new Error(
          `${plugin.name}@${same.version} changed since ${same.source.commit.slice(0, 9)}: bump its version first`,
        );
    }
    if (!same) plugin.versions.unshift({ ...latest, version: manifest.version, publishTimestamp, source });
  }
  return value;
}

/**
 * List Automagik's plugins at the pinned release: one version each, a git source at the pin's
 * commit with the plugin's folder. Entries the pin does not name are left as they are.
 */
export function pinAutomagik(
  value: Index,
  automagik: AutomagikPin = pinnedAutomagik(),
  publishTimestamp?: number,
): Index {
  for (const plugin of value.plugins) {
    const pinned = automagik.packages[plugin.name];
    if (!pinned) continue;
    const listed = plugin.versions[0];
    const same = listed && isAutomagik(listed.source) && listed.source.commit === automagik.commit;
    plugin.versions = [
      {
        version: pinned.version,
        publishTimestamp: same ? listed.publishTimestamp : (publishTimestamp ?? Math.floor(Date.now() / 1000)),
        source: { type: 'git', url: AUTOMAGIK_URL, commit: automagik.commit, path: automagikPath(plugin.name) },
        ...(listed?.engines ? { engines: listed.engines } : {}),
      },
    ];
  }
  return value;
}

if (import.meta.main) {
  const [command, ref] = process.argv.slice(2);
  const repoDir = join(import.meta.dir, '..');
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  if (command === 'check') {
    const problems = checkIndex(index, repoDir);
    for (const problem of problems) console.error(`marketplace: ${problem}`);
    if (problems.length > 0) process.exit(1);
    console.log(`marketplace: ${index.plugins.length} plugins ok`);
  } else if (command === 'pin' && ref) {
    writeFileSync(INDEX_PATH, `${JSON.stringify(pinAutomagik(pinIndex(index, repoDir, ref)), null, 2)}\n`);
    console.log(`marketplace: pinned to ${ref}`);
  } else if (command === 'automagik') {
    writeFileSync(INDEX_PATH, `${JSON.stringify(pinAutomagik(index), null, 2)}\n`);
    console.log(`marketplace: Automagik's plugins at ${pinnedAutomagik().version}`);
  } else {
    console.error('usage: bun scripts/marketplace.ts check | pin <ref> | automagik');
    process.exit(2);
  }
}
