/**
 * Writer-coverage inventory tool (wish: omni-full-multitenancy, Group G2).
 *
 *   bun run scripts/check-writer-coverage.ts          # report drift, exit 1 on drift
 *   bun run scripts/check-writer-coverage.ts --write  # regenerate the registry
 *
 * The `--write` form rewrites `REGISTERED_WRITERS` in
 * `src/tenancy-writer-coverage.ts` from a fresh scan. Regenerating is a REVIEWED
 * action: each new entry means a new write path against a tenant-owned table,
 * and its `coverage` value states how that path acquires ownership.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_WRITERS, coverageFor, scanWriteSites } from '../src/tenancy-writer-coverage';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');
const registryFile = join(here, '..', 'src', 'tenancy-writer-coverage.ts');

const found = scanWriteSites(packagesDir, repoRoot);
const foundKeys = new Set(found.map((s) => `${s.file}::${s.table}`));
const registeredKeys = new Set(REGISTERED_WRITERS.map((s) => `${s.file}::${s.table}`));

const unregistered = found.filter((s) => !registeredKeys.has(`${s.file}::${s.table}`));
const stale = REGISTERED_WRITERS.filter((s) => !foundKeys.has(`${s.file}::${s.table}`));

if (process.argv.includes('--write')) {
  const entries = found
    .map((s) => `  { file: '${s.file}', table: '${s.table}', coverage: '${coverageFor(s.table)}' },`)
    .join('\n');
  const source = readFileSync(registryFile, 'utf-8');
  const marker = 'export const REGISTERED_WRITERS: readonly RegisteredWriter[] = ';
  const start = source.indexOf(marker);
  if (start === -1) throw new Error('registry marker not found');
  const next = `${marker}[\n${entries}\n];\n`;
  writeFileSync(registryFile, source.slice(0, start) + next);
  console.log(`wrote ${found.length} write sites to ${registryFile}`);
  process.exit(0);
}

if (unregistered.length === 0 && stale.length === 0) {
  console.log(`writer coverage OK — ${found.length} write sites, all registered`);
  process.exit(0);
}

if (unregistered.length > 0) {
  console.error('UNREGISTERED writers against tenant-owned tables:');
  for (const s of unregistered) console.error(`  ${s.file} -> ${s.table}`);
}
if (stale.length > 0) {
  console.error('STALE registry entries (write site no longer exists):');
  for (const s of stale) console.error(`  ${s.file} -> ${s.table}`);
}
console.error('\nRun: bun run scripts/check-writer-coverage.ts --write, then review the diff.');
process.exit(1);
