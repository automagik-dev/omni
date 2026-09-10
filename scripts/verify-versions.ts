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
 * Wired into the Quality Gate job in .github/workflows/ci.yml as the
 * "Verify version sync" step so version drift fails CI fast.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAllVersionFields, repoRoot } from './lib/version-fields';

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

function main(): void {
  const reference = readRootVersion();
  console.log(`Reference version: ${reference}`);

  const baseRef = resolveBaseRef(process.argv.slice(2));
  const basePaths = readBasePaths(baseRef);
  if (baseRef !== null) console.log(`Base ref: ${baseRef} (files absent there are exempt)`);

  const fields = getAllVersionFields();
  let mismatches = 0;
  let fresh = 0;

  for (const field of fields) {
    const actual = field.read();
    const status = fieldStatus(actual, reference, field.path, basePaths);
    const display = actual ?? '<missing>';
    console.log(`${status.padEnd(8)} ${field.path} → ${display}`);
    if (status === 'MISMATCH') mismatches++;
    if (status === 'NEW') fresh++;
  }

  const total = fields.length;
  const matched = total - mismatches - fresh;
  const newNote = fresh > 0 ? `, ${fresh} new (exempt — auto-bump normalizes after merge)` : '';

  if (mismatches === 0) {
    console.log(`\nOK: ${matched}/${total} files match${newNote}`);
    process.exit(0);
  }

  console.log(`\nFAIL: ${mismatches} mismatches found${newNote}`);
  process.exit(1);
}

if (import.meta.main) main();
