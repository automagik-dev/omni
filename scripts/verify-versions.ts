#!/usr/bin/env bun

/**
 * Verify every tracked version field matches the root package.json.
 *
 * Usage: bun scripts/verify-versions.ts [--base <git-ref>]
 *
 * Reads the root package.json `version` as the reference value, then walks
 * every entry from scripts/lib/version-fields.ts and prints a per-file
 * status line. Exits 0 when all files match, 1 when any field drifts (or
 * is missing).
 *
 * With --base, tracked files that do NOT exist on the base ref are reported
 * as NEW and exempt from the check (#1020). On a PR merge ref the auto-bump
 * on dev has already rewritten every pre-existing file, but a file the PR
 * introduces (a new channel package.json) can only carry the
 * version the author last synced — so it re-drifts on every merge to dev
 * and the author races the merge cadence. The first auto-bump after merge
 * normalizes it anyway, so exempting it loses nothing. Files that exist on
 * the base keep the strict check: a mismatch there is real drift.
 *
 * Omni's own DSH plugins (apps/*-dsh) carry the Omni version of their last change
 * (scripts/lib/plugin-versions.ts): a plugin may lag the root, and is then
 * reported LAGS, as long as its version is an Omni release no newer than the
 * root's, its folder is unchanged between that release and the root's, its
 * npm lockfile carries its own version, and its `engines.omni` minimum is a
 * release no newer than its own (or a pending one above the root's). Changes
 * after the root's release are pending: the next cut moves the plugin. The
 * releases are read from their tags, fetched one by one in a shallow clone.
 *
 * Wired into the Quality Gate job in .github/workflows/ci.yml as the
 * "Verify version sync" step so version drift fails CI fast.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pluginProblems, releaseCommit } from './lib/plugin-versions';
import { type VersionField, getAllVersionFields, repoRoot } from './lib/version-fields';

function readRootVersion(): string {
  const content = readFileSync(join(repoRoot, 'package.json'), 'utf-8');
  const data = JSON.parse(content) as { version?: unknown };
  if (typeof data.version !== 'string') {
    throw new Error('root package.json has no string `version` field');
  }
  return data.version;
}

function resolveBaseRef(argv: readonly string[]): string | null {
  const flagIndex = argv.indexOf('--base');
  if (flagIndex === -1) return null;
  const value = argv[flagIndex + 1];
  if (!value) {
    console.error('--base requires a git ref argument');
    process.exit(2);
  }
  return value;
}

/** Repo-relative paths present in the base ref's tree, or null when no base was given. */
export function readBasePaths(baseRef: string | null): Set<string> | null {
  if (baseRef === null) return null;
  const result = Bun.spawnSync(['git', 'ls-tree', '-r', '--name-only', '--full-tree', baseRef], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    console.error(`Cannot list base ref "${baseRef}": ${result.stderr.toString().trim()}`);
    process.exit(2);
  }
  return new Set(result.stdout.toString().split('\n').filter(Boolean));
}

export function fieldStatus(
  actual: string | null,
  reference: string,
  path: string,
  basePaths: Set<string> | null,
): 'OK' | 'NEW' | 'MISMATCH' {
  if (actual === reference) return 'OK';
  if (basePaths !== null && !basePaths.has(path)) return 'NEW';
  return 'MISMATCH';
}

/** A plugin's own version: its package.json's, which its lockfile must carry too. */
function pluginVersion(dir: string): string | null {
  try {
    const data = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * A plugin field's status: its package.json is OK at the root's version and LAGS behind it (the
 * rule itself is pluginProblems'); its lockfile must carry the plugin's own version.
 */
export function pluginFieldStatus(
  field: Pick<VersionField, 'path'>,
  actual: string | null,
  own: string | null,
  reference: string,
  basePaths: Set<string> | null,
): 'OK' | 'LAGS' | 'NEW' | 'MISMATCH' {
  const expected = own ?? reference;
  if (actual !== null && actual === expected) return actual === reference ? 'OK' : 'LAGS';
  if (basePaths !== null && !basePaths.has(field.path)) return 'NEW';
  return 'MISMATCH';
}

function main(): void {
  const reference = readRootVersion();
  console.log(`Reference version: ${reference}`);

  const baseRef = resolveBaseRef(process.argv.slice(2));
  const basePaths = readBasePaths(baseRef);
  if (baseRef !== null) console.log(`Base ref: ${baseRef} (files absent there are exempt)`);

  const fields = getAllVersionFields();
  let mismatches = 0;
  let fresh = 0;
  let lagging = 0;

  for (const field of fields) {
    const actual = field.read();
    const status = field.plugin
      ? pluginFieldStatus(field, actual, pluginVersion(field.plugin), reference, basePaths)
      : fieldStatus(actual, reference, field.path, basePaths);
    const display = actual ?? '<missing>';
    console.log(`${status.padEnd(8)} ${field.path} → ${display}`);
    if (status === 'MISMATCH') mismatches++;
    if (status === 'NEW') fresh++;
    if (status === 'LAGS') lagging++;
  }

  // The plugins' own rule. The root's release is its tag; on the cut commit itself, before that
  // tag is pushed, it is HEAD.
  const cut = releaseCommit(repoRoot, reference) ?? 'HEAD';
  const newPlugins = new Set(
    fields.filter((field) => field.plugin && basePaths !== null && !basePaths.has(field.path)).map((f) => f.plugin),
  );
  for (const { dir, problem } of pluginProblems(repoRoot, reference, cut)) {
    if (newPlugins.has(dir)) continue;
    console.log(`MISMATCH ${dir}: ${problem}`);
    mismatches++;
  }

  const total = fields.length;
  const matched = total - mismatches - fresh;
  const newNote =
    (lagging > 0 ? `, ${lagging} plugin fields at their own last-change release` : '') +
    (fresh > 0 ? `, ${fresh} new (exempt — auto-bump normalizes after merge)` : '');

  if (mismatches === 0) {
    console.log(`\nOK: ${matched}/${total} files match${newNote}`);
    process.exit(0);
  }

  console.log(`\nFAIL: ${mismatches} mismatches found${newNote}`);
  process.exit(1);
}

if (import.meta.main) main();
