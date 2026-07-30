/**
 * Runtime-isolation guard (wish: omni-full-multitenancy, Group G6).
 *
 * G6 ships TOOLING and docs; the application's default and enforcement behaviour
 * must be byte-identical before and after. The one way that regresses silently is
 * a runtime module importing a G6 tooling module — pulling migration/backfill
 * code onto the request/worker import graph. This machine check fails loudly if
 * that ever happens:
 *
 *   1. No file under the runtime import graph (packages/api/src, packages/core/src,
 *      channel-* packages) imports anything from `packages/db/src/backfill/`.
 *   2. `packages/db/src/index.ts` does NOT barrel-export the backfill tooling, so
 *      `@omni/db` cannot pull it in transitively.
 *
 * Pure/no-server; part of every `bun test` run.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', 'coverage', '__tests__']);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
}

/** Directories that make up the RUNTIME import graph — never G6 tooling. */
function runtimeSourceDirs(): string[] {
  const dirs = [join(packagesDir, 'api', 'src'), join(packagesDir, 'core', 'src')];
  // Every channel-* package's src.
  for (const entry of readdirSync(packagesDir)) {
    if (entry.startsWith('channel-')) dirs.push(join(packagesDir, entry, 'src'));
  }
  return dirs.filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

/** An import that reaches the backfill tooling by any spelling. */
const BACKFILL_IMPORT =
  /\b(?:import|export|require)\b[^\n;]*?['"][^'"]*(?:\/backfill\/|@omni\/db\/.*backfill)[^'"]*['"]/;

describe('G6 runtime isolation', () => {
  test('no runtime source file imports packages/db/src/backfill/*', () => {
    const offenders: string[] = [];
    for (const dir of runtimeSourceDirs()) {
      const files: string[] = [];
      walk(dir, files);
      for (const file of files) {
        const source = readFileSync(file, 'utf-8');
        if (BACKFILL_IMPORT.test(source)) offenders.push(file.replace(`${repoRoot}/`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('packages/db/src/index.ts does not barrel-export the backfill tooling', () => {
    const barrel = readFileSync(join(here, '..', 'index.ts'), 'utf-8');
    expect(barrel.includes('backfill')).toBe(false);
  });

  test('the runtime-graph directories actually exist (guard is not vacuous)', () => {
    // If this ever finds nothing, the isolation assertion above would pass
    // vacuously — so prove the graph is real.
    expect(runtimeSourceDirs().length).toBeGreaterThanOrEqual(2);
  });
});
