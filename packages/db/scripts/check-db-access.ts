/**
 * Direct-database-access inventory tool (wish: omni-full-multitenancy, Group G3).
 *
 *   bun run scripts/check-db-access.ts          # report drift, exit 1 on drift
 *   bun run scripts/check-db-access.ts --write  # regenerate the registry
 *
 * The `--write` form rewrites `REGISTERED_DB_ACCESS` in
 * `src/tenancy-db-access-guard.ts` from a fresh scan, PRESERVING the class and
 * justification already recorded for any site it recognises. A site it has
 * never seen is emitted as `pending-G4-conversion`, which is the conservative
 * default: it means "tenant-scoped and not yet behind the boundary", so a new
 * unscoped call site shows up as debt rather than being waved through.
 *
 * Reclassifying an entry to `control-plane` or `migration-ddl` is a REVIEWED
 * action and requires a justification string; the guard test fails without one.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type DbAccessClass,
  PENDING_G4_CEILING,
  REGISTERED_DB_ACCESS,
  defaultClassFor,
  evaluateDbAccessGuard,
  scanDbAccessSites,
} from '../src/tenancy-db-access-guard';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');
const registryFile = join(here, '..', 'src', 'tenancy-db-access-guard.ts');

const found = scanDbAccessSites(packagesDir, repoRoot);
const report = evaluateDbAccessGuard(found);

function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

if (process.argv.includes('--write')) {
  const previous = new Map(REGISTERED_DB_ACCESS.map((e) => [`${e.file}::${e.table}`, e]));
  const entries = found
    .map((site) => {
      const prior = previous.get(`${site.file}::${site.table}`);
      const fallback = defaultClassFor(site);
      const cls: DbAccessClass = prior?.class ?? fallback.class;
      const justification = prior?.justification ?? (prior ? undefined : fallback.justification);
      const fields = [`file: ${quote(site.file)}`, `table: ${quote(site.table)}`, `class: ${quote(cls)}`];
      if (justification) fields.push(`justification:\n      ${quote(justification)}`);
      return `  {\n    ${fields.join(',\n    ')},\n  },`;
    })
    .join('\n');
  const source = readFileSync(registryFile, 'utf-8');
  const marker = 'export const REGISTERED_DB_ACCESS: readonly RegisteredDbAccess[] = ';
  const start = source.indexOf(marker);
  if (start === -1) throw new Error('registry marker not found');
  writeFileSync(registryFile, `${source.slice(0, start) + marker}[\n${entries}\n];\n`);
  console.log(`wrote ${found.length} db-access sites to ${registryFile}`);
  process.exit(0);
}

const pending = report.counts['pending-G4-conversion'];
const overCeiling = pending > PENDING_G4_CEILING;

if (report.unregistered.length === 0 && report.stale.length === 0 && report.unjustified.length === 0 && !overCeiling) {
  console.log(
    `db-access guard OK — ${found.length} sites: ` +
      `${report.counts['tenant-boundary']} tenant-boundary, ` +
      `${report.counts['control-plane']} control-plane, ` +
      `${report.counts['migration-ddl']} migration-ddl, ` +
      `${pending} pending-G4-conversion (ceiling ${PENDING_G4_CEILING})`,
  );
  process.exit(0);
}

if (report.unregistered.length > 0) {
  console.error('UNREGISTERED database access sites:');
  for (const s of report.unregistered) console.error(`  ${s.file} -> ${s.table}`);
}
if (report.stale.length > 0) {
  console.error('STALE registry entries (site no longer exists):');
  for (const s of report.stale) console.error(`  ${s.file} -> ${s.table}`);
}
if (report.unjustified.length > 0) {
  console.error('UNJUSTIFIED control-plane / migration-ddl exceptions:');
  for (const s of report.unjustified) console.error(`  ${s.file} -> ${s.table} (${s.class})`);
}
if (overCeiling) {
  console.error(`pending-G4-conversion count ${pending} exceeds ceiling ${PENDING_G4_CEILING}`);
}
console.error('\nRun: bun run scripts/check-db-access.ts --write, then classify the diff.');
process.exit(1);
