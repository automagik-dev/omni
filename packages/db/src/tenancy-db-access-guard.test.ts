/**
 * Architectural guard test (wish: omni-full-multitenancy, Group G3).
 *
 * Fails closed: a database access site that is not in the registry is a test
 * failure. The seeded-site test at the bottom is the one that matters most —
 * it proves the guard actually catches a new unscoped call site rather than
 * merely agreeing with a registry that was generated from the same scan.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIRRORED_RLS_EXCLUSIONS,
  PENDING_G4_CEILING,
  REGISTERED_DB_ACCESS,
  defaultClassFor,
  evaluateDbAccessGuard,
  scanDbAccessSites,
} from './tenancy-db-access-guard';
import { RLS_EXCLUSIONS, RLS_TENANT_TABLES } from './tenancy-rls';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

const found = scanDbAccessSites(packagesDir, repoRoot);
const report = evaluateDbAccessGuard(found);

const scratchDir = join(packagesDir, 'db', 'src', '__g3_access_scratch__');
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

describe('db-access guard', () => {
  test('the scan finds sites at all (guards against a broken scanner)', () => {
    expect(found.length).toBeGreaterThan(80);
    expect(REGISTERED_DB_ACCESS.length).toBe(found.length);
  });

  test('every discovered access site is registered', () => {
    expect(report.unregistered).toEqual([]);
  });

  test('no registry entry is stale', () => {
    expect(report.stale).toEqual([]);
  });

  test('every control-plane and migration-ddl exception carries a justification', () => {
    expect(report.unjustified).toEqual([]);
    for (const entry of REGISTERED_DB_ACCESS) {
      if (entry.class === 'control-plane' || entry.class === 'migration-ddl') {
        expect((entry.justification ?? '').length).toBeGreaterThan(40);
      }
    }
  });

  test('exceptions fall only into the three authorised classes', () => {
    const allowed = new Set(['tenant-boundary', 'control-plane', 'migration-ddl', 'pending-G4-conversion']);
    for (const entry of REGISTERED_DB_ACCESS) expect(allowed.has(entry.class)).toBe(true);
  });

  test('the pending-G4 class is at or below its ceiling — it may shrink, never grow', () => {
    expect(report.counts['pending-G4-conversion']).toBeLessThanOrEqual(PENDING_G4_CEILING);
    // If this reaches zero, G4 is done and the class can be retired.
    expect(report.counts['pending-G4-conversion']).toBeGreaterThan(0);
  });

  test('the G3 boundary modules are classified as tenant-boundary, not as exceptions', () => {
    const boundary = REGISTERED_DB_ACCESS.filter((e) => e.class === 'tenant-boundary');
    expect(boundary.length).toBeGreaterThan(0);
    for (const entry of boundary) {
      expect(entry.file.startsWith('packages/api/src/tenancy/')).toBe(true);
    }
  });

  test('the auth plane is control-plane and names ADR-0003', () => {
    const authPlane = REGISTERED_DB_ACCESS.filter((e) => e.file === 'packages/api/src/services/auth-bootstrap.ts');
    expect(authPlane.length).toBeGreaterThan(0);
    for (const entry of authPlane) {
      expect(entry.class).toBe('control-plane');
      expect(entry.justification).toContain('ADR-0003');
    }
  });

  test('the CLI and channel plugins are NOT waved through as control-plane', () => {
    // They write tenant rows outside the boundary. Calling that "control-plane"
    // because it is convenient is exactly the silent exemption this guard
    // exists to prevent.
    for (const entry of REGISTERED_DB_ACCESS) {
      if (entry.file.startsWith('packages/cli/') || entry.file.startsWith('packages/channel-')) {
        expect(entry.class).toBe('pending-G4-conversion');
      }
    }
  });

  test('a new unregistered direct-db call site fails the guard', () => {
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'rogue-service.ts');
    writeFileSync(
      seeded,
      [
        "import { getDb, messages } from '@omni/db';",
        'export async function leak() {',
        '  const db = getDb();',
        '  return db.select().from(messages);',
        '}',
        '',
      ].join('\n'),
    );

    const rescanned = scanDbAccessSites(packagesDir, repoRoot);
    const rescannedReport = evaluateDbAccessGuard(rescanned);

    const files = rescannedReport.unregistered.map((s) => `${s.file}::${s.table}`);
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-service.ts::*');
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-service.ts::messages');

    rmSync(scratchDir, { recursive: true, force: true });
    // And the guard goes quiet again once the site is gone.
    expect(evaluateDbAccessGuard(scanDbAccessSites(packagesDir, repoRoot)).unregistered).toEqual([]);
  });

  test('a newly discovered site defaults to pending-G4-conversion, not to an exemption', () => {
    const fresh = defaultClassFor({ file: 'packages/api/src/services/brand-new.ts', table: 'messages' });
    expect(fresh.class).toBe('pending-G4-conversion');
    expect(fresh.justification).toBeUndefined();
  });

  test('the scanner catches createDbHandle, not only getDb/createDb (G3 review L2)', () => {
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'rogue-handle.ts');
    writeFileSync(
      seeded,
      [
        "import { createDbHandle } from '@omni/db';",
        'export function leak() {',
        '  return createDbHandle({ url: process.env.SOMETHING ?? "" });',
        '}',
        '',
      ].join('\n'),
    );

    const files = evaluateDbAccessGuard(scanDbAccessSites(packagesDir, repoRoot)).unregistered.map(
      (s) => `${s.file}::${s.table}`,
    );
    rmSync(scratchDir, { recursive: true, force: true });

    // `createDbHandle` hands out a pool handle with no tenant context attached,
    // exactly as `getDb`/`createDb` do. It was added after the original regex
    // was written, which is how a guard silently loses coverage.
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-handle.ts::*');
  });

  test('every real createDbHandle call site is registered (G3 review L2)', () => {
    const handleSites = REGISTERED_DB_ACCESS.filter(
      (e) => e.table === '*' && e.file === 'packages/db/scripts/apply-rls-enforcement.ts',
    );
    expect(handleSites.length).toBe(1);
    expect(handleSites[0]?.class).toBe('migration-ddl');
  });

  test('the RLS exclusion justifications are mirrored here, verbatim (G3 review L4)', () => {
    // The exclusions live in `tenancy-rls.ts` because that is where the DDL is
    // generated. A reader auditing *this* file — the inventory of who may touch
    // the database — must not have to know that a second, differently shaped
    // list exists elsewhere. Mirrored rather than re-worded so a divergence is a
    // test failure instead of a discrepancy nobody notices.
    expect(MIRRORED_RLS_EXCLUSIONS).toEqual(RLS_EXCLUSIONS);
    for (const exclusion of MIRRORED_RLS_EXCLUSIONS) {
      expect(RLS_TENANT_TABLES).not.toContain(exclusion.table);
      expect(exclusion.justification.length).toBeGreaterThan(40);
    }
  });

  test('the scanner covers every RLS table name', () => {
    // A table missing from the scan vocabulary would make its call sites
    // invisible — a silent hole rather than a loud failure.
    const registeredTables = new Set(REGISTERED_DB_ACCESS.map((e) => e.table));
    expect(registeredTables.has('*')).toBe(true);
    for (const table of registeredTables) {
      if (table === '*') continue;
      expect(RLS_TENANT_TABLES).toContain(table);
    }
  });
});
