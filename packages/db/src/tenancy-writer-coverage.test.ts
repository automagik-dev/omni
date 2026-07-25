/**
 * Writer-coverage guard (wish: omni-full-multitenancy, Group G2).
 *
 * Fails closed: a new write site against a tenant-owned table is a test failure
 * until it is registered with an explicit ownership-coverage decision. No writer
 * can be silently exempt.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_OWNERSHIP_SPECS, getOwnershipSpec } from './tenancy-ownership';
import { REGISTERED_WRITERS, coverageFor, scanWriteSites } from './tenancy-writer-coverage';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');
const migrationSql = readFileSync(join(here, '..', 'drizzle', '0041_tenant_ownership_columns.sql'), 'utf-8');

const found = scanWriteSites(packagesDir, repoRoot);

describe('tenant-table writer coverage', () => {
  test('the scan finds write sites at all (guards against a broken scanner)', () => {
    expect(found.length).toBeGreaterThan(40);
    expect(REGISTERED_WRITERS.length).toBe(found.length);
  });

  test('every write site against a tenant table is registered', () => {
    const registered = new Set(REGISTERED_WRITERS.map((w) => `${w.file}::${w.table}`));
    const unregistered = found.filter((s) => !registered.has(`${s.file}::${s.table}`));
    expect(unregistered).toEqual([]);
  });

  test('no registry entry is stale', () => {
    const foundKeys = new Set(found.map((s) => `${s.file}::${s.table}`));
    const stale = REGISTERED_WRITERS.filter((w) => !foundKeys.has(`${w.file}::${w.table}`));
    expect(stale).toEqual([]);
  });

  test("each registered writer's declared coverage matches its table's ownership class", () => {
    for (const writer of REGISTERED_WRITERS) {
      expect(writer.coverage).toBe(coverageFor(writer.table));
    }
  });

  test('every registered writer targets a table in the frozen G0 tenant inventory', () => {
    for (const writer of REGISTERED_WRITERS) {
      expect(getOwnershipSpec(writer.table)).toBeDefined();
    }
  });

  test('every non-root tenant table has an in-database propagation trigger, so no writer can bypass it', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      if (spec.derivation === 'root') continue;
      expect(migrationSql).toContain(`CREATE TRIGGER "${spec.table}_tenant_ownership_trg" BEFORE INSERT`);
      expect(migrationSql).toContain(`FUNCTION "omni_tenant_ownership_${spec.table}"()`);
    }
  });

  test('the ownership root has NO trigger — its tenant id comes from auth-plane context', () => {
    expect(migrationSql).not.toContain('instances_tenant_ownership_trg');
    const rootWriters = REGISTERED_WRITERS.filter((w) => w.coverage === 'trusted-root');
    expect(rootWriters.length).toBeGreaterThan(0);
    for (const writer of rootWriters) expect(writer.table).toBe('instances');
  });

  test('every derived table trigger discards the caller-supplied tenant id first', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      if (spec.derivation === 'root') continue;
      const fn = migrationSql.slice(migrationSql.indexOf(`FUNCTION "omni_tenant_ownership_${spec.table}"()`));
      const body = fn.slice(0, fn.indexOf('$$;'));
      expect(body).toContain('NEW."tenant_id" := NULL;');
    }
  });

  test('every tenant table with at least one writer is covered by a mechanism', () => {
    const writtenTables = new Set(found.map((s) => s.table));
    for (const table of writtenTables) {
      const spec = getOwnershipSpec(table);
      expect(spec).toBeDefined();
      if (spec?.derivation === 'root') {
        expect(migrationSql).not.toContain(`${table}_tenant_ownership_trg`);
      } else {
        expect(migrationSql).toContain(`${table}_tenant_ownership_trg`);
      }
    }
  });
});
