#!/usr/bin/env bun
/**
 * The Automagik plugin marketplace index (marketplace/automagik.json), a DSH market index (format 1).
 *
 *   bun scripts/marketplace.ts check        validate the index; exit 1 on the first problem
 *   bun scripts/marketplace.ts pin <ref>    point Omni's own git entries at <ref>
 *
 * `check` runs DSH's own parser (parseMarketIndex) and then, for every git entry from this
 * repository, proves that the pinned commit is reachable from HEAD and holds, at the entry's
 * path, a package.json with the entry's name and version. A market installs exactly that
 * commit, so an entry that fails here fails in every user's DSH.
 *
 * This static index is for DSH users without an Omni. Every Omni also serves the Automagik
 * marketplace for its own release at /api/market (packages/api/src/market): Omni's plugins,
 * packed from the release by scripts/pack-market.ts, plus this index's vetted npm add-ons.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';

export const REPO_URL = 'https://github.com/automagik-dev/omni';
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

/** Every problem with the index, empty when it is fit to serve. */
export function checkIndex(value: unknown, repoDir: string): string[] {
  try {
    parseMarketIndex(value, INDEX_URL);
  } catch (error) {
    return [`index: ${(error as Error).message}`];
  }
  const problems: string[] = [];
  for (const plugin of (value as Index).plugins) {
    for (const entry of plugin.versions) {
      const at = `${plugin.name}@${entry.version}`;
      if (entry.source.type === 'git' && !isOurs(entry.source)) {
        problems.push(`${at}: git sources must come from ${REPO_URL}`);
        continue;
      }
      if (!isOurs(entry.source)) continue;
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
 * Point every git entry from this repository at `ref`, adding a version when the package's moved on.
 * A version already listed is re-pointed only when its package is byte-identical at `ref`: what a
 * listed version installs never changes, so a changed package needs a version bump first.
 */
export function pinIndex(value: Index, repoDir: string, ref: string): Index {
  const commit = git(repoDir, ['rev-parse', `${ref}^{commit}`]);
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
    if (same) Object.assign(same, { publishTimestamp, source });
    else plugin.versions.unshift({ ...latest, version: manifest.version, publishTimestamp, source });
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
    writeFileSync(INDEX_PATH, `${JSON.stringify(pinIndex(index, repoDir, ref), null, 2)}\n`);
    console.log(`marketplace: pinned to ${ref}`);
  } else {
    console.error('usage: bun scripts/marketplace.ts check | pin <ref>');
    process.exit(2);
  }
}
