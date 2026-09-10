/**
 * Shared source walker for the tenancy static guards (writer coverage, DB
 * access guard).
 *
 * Sibling suites create and delete scratch directories (`__g3_access_scratch__`,
 * `__g5_egress_scratch__`) inside the scanned tree while a scan runs under the
 * parallel test runner, so any path listed by the walk may be gone by the time
 * it is listed, stat'ed, or read. A vanished path has no call sites: skip it.
 * Every other error still throws. See issue #1080.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceFile {
  readonly file: string;
  readonly source: string;
}

/** Directories excluded from the scan. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '__tests__', 'coverage']);

function isTestFile(path: string): boolean {
  return path.includes('/__tests__/') || /\.(test|spec)\.ts$/.test(path);
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function walk(dir: string, out: SourceFile[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isDirectory()) walk(full, out);
      else if (full.endsWith('.ts') && !isTestFile(full)) out.push({ file: full, source: readFileSync(full, 'utf-8') });
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
  }
}

/** Every non-test `.ts` source under `dir`, tolerating files that vanish mid-walk. */
export function readSources(dir: string): SourceFile[] {
  const out: SourceFile[] = [];
  walk(dir, out);
  return out;
}
