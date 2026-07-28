/**
 * G2 ownership contract + schema-drift guards (wish: omni-full-multitenancy).
 *
 * Static checks only — no database connection. They pin the frozen G0
 * classification against the live Drizzle schema and against migration 0041, so
 * a new tenant-capable table or a dropped ownership column fails CI.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import {
  COMPOSITE_FK_TARGETS,
  G2_NEW_TABLES,
  PLATFORM_ONLY_TABLES,
  PLATFORM_TABLE_COUNT,
  SPLIT_DESTINATIONS,
  SPLIT_TABLE_COUNT,
  TENANT_OWNERSHIP_SPECS,
  TENANT_TABLE_COUNT,
  TENANT_UNIQUE_INDEXES,
  compositeFkName,
  tenantIdUniqueIndexName,
  tenantLookupIndexName,
} from './tenancy-ownership';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');
const migrationSql = readFileSync(join(drizzleDir, '0041_tenant_ownership_columns.sql'), 'utf-8');

/**
 * The migration with every `--` comment line removed.
 *
 * Assertions about what the migration DOES must read executable SQL only —
 * otherwise the file's own prose ("no DROP, no RENAME", "built CONCURRENTLY by
 * the online runner") trips them.
 */
const migrationDdl = migrationSql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** Just the `ALTER TABLE ... ADD COLUMN` statements against the 29 legacy tables. */
const addColumnDdl = migrationDdl
  .split('\n')
  .filter((line) => line.includes('ADD COLUMN'))
  .join('\n');
const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf-8')) as {
  entries: { idx: number; when: number; tag: string }[];
};

/** Every `pgTable` exported from schema.ts, keyed by SQL table name. */
function liveTables(): Map<string, ReturnType<typeof getTableConfig>> {
  const out = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const value of Object.values(schema)) {
    // Drizzle pg tables are the only exports getTableConfig accepts.
    try {
      const config = getTableConfig(value as never);
      out.set(config.name, config);
    } catch {
      // Not a pgTable (type alias, enum tuple, relations, helper) — skip.
    }
  }
  return out;
}

const TABLES = liveTables();

// ---------------------------------------------------------------------------
// Manifest reconciliation
// ---------------------------------------------------------------------------

describe('G0 manifest reconciliation against the post-G1 schema', () => {
  test('the legacy inventory is exactly 29 tenant + 7 split + 2 platform tables', () => {
    expect(TENANT_OWNERSHIP_SPECS).toHaveLength(TENANT_TABLE_COUNT);
    expect(TENANT_TABLE_COUNT + SPLIT_TABLE_COUNT + PLATFORM_TABLE_COUNT).toBe(38);
  });

  test('every tenant spec names a table that actually exists in the Drizzle schema', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      expect(TABLES.has(spec.table)).toBe(true);
      expect((schema as Record<string, unknown>)[spec.drizzle]).toBeDefined();
    }
  });

  test('table names are unique across the spec', () => {
    expect(new Set(TENANT_OWNERSHIP_SPECS.map((s) => s.table)).size).toBe(TENANT_TABLE_COUNT);
  });

  test('every owning parent is itself a G2 tenant table with a composite FK target index', () => {
    const byName = new Map(TENANT_OWNERSHIP_SPECS.map((s) => [s.table, s]));
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      for (const parent of spec.parents) {
        const parentSpec = byName.get(parent.parentTable);
        expect(parentSpec).toBeDefined();
        expect(parentSpec?.compositeFkTarget).toBe(true);
      }
    }
  });

  test('a table is a composite FK target only when something actually references it', () => {
    const referenced = new Set(TENANT_OWNERSHIP_SPECS.flatMap((s) => s.parents.map((p) => p.parentTable)));
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      expect(spec.compositeFkTarget).toBe(referenced.has(spec.table));
    }
  });

  test('only tables with zero FK-covered parents may be root or unowned', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      if (spec.derivation === 'root' || spec.derivation === 'unowned') {
        expect(spec.parents).toHaveLength(0);
      } else {
        expect(spec.parents.length).toBeGreaterThan(0);
      }
    }
  });

  test('instances is the only ownership root, and it cites an explicit G0 root rule', () => {
    const roots = TENANT_OWNERSHIP_SPECS.filter((s) => s.derivation === 'root');
    expect(roots.map((s) => s.table)).toEqual(['instances']);
    expect(roots[0]?.g0Rule).toContain('authenticated tenant context');
  });

  test('every parentless non-root table records why it cannot derive ownership in G2', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS.filter((s) => s.derivation === 'unowned')) {
      // persons/conversations carry a bare G0 rule; the rest must explain the gap.
      expect(spec.g0Rule.length).toBeGreaterThan(0);
    }
  });

  test('platform-only legacy tables never join the tenant plane', () => {
    for (const table of PLATFORM_ONLY_TABLES) {
      expect(TENANT_OWNERSHIP_SPECS.some((s) => s.table === table)).toBe(false);
      expect(TABLES.get(table)?.columns.some((c) => c.name === 'tenant_id')).toBe(false);
    }
  });

  test('split legacy tables get no ambiguous nullable tenant owner', () => {
    for (const split of SPLIT_DESTINATIONS) {
      expect(TENANT_OWNERSHIP_SPECS.some((s) => s.table === split.legacyTable)).toBe(false);
      expect(TABLES.get(split.legacyTable)?.columns.some((c) => c.name === 'tenant_id')).toBe(false);
    }
  });

  test('the five remaining split concepts use the canonical settings names', () => {
    expect(SPLIT_DESTINATIONS).toHaveLength(5);
    const settings = SPLIT_DESTINATIONS.find((s) => s.legacyTable === 'global_settings');
    expect(settings?.tenantTable).toBe('tenant_settings');
    expect(settings?.platformTable).toBe('platform_settings');
  });
});

// ---------------------------------------------------------------------------
// ORM ownership columns / indexes
// ---------------------------------------------------------------------------

describe('Drizzle schema carries the G2 ownership contract', () => {
  test('every tenant table has a NULLABLE tenant_id column during the additive phase', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      const column = TABLES.get(spec.table)?.columns.find((c) => c.name === 'tenant_id');
      expect(column).toBeDefined();
      expect(column?.notNull).toBe(false);
    }
  });

  test('no tenant table declares a tenant_id default (a default would forge ownership)', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      const column = TABLES.get(spec.table)?.columns.find((c) => c.name === 'tenant_id');
      expect(column?.hasDefault).toBe(false);
    }
  });

  test('every tenant table declares a tenant_id lookup index', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      const names = (TABLES.get(spec.table)?.indexes ?? []).map((i) => i.config.name);
      expect(names).toContain(tenantLookupIndexName(spec.table));
    }
  });

  test('every composite FK target declares the (tenant_id, id) unique index', () => {
    for (const table of COMPOSITE_FK_TARGETS) {
      const unique = (TABLES.get(table)?.indexes ?? []).filter((i) => i.config.unique);
      expect(unique.map((i) => i.config.name)).toContain(tenantIdUniqueIndexName(table));
    }
  });

  test('every pre-existing global unique index is still declared (old binaries keep working)', () => {
    for (const spec of TENANT_UNIQUE_INDEXES) {
      const names = (TABLES.get(spec.table)?.indexes ?? []).map((i) => i.config.name);
      expect(names).toContain(spec.preservedGlobalIndex);
      expect(names).toContain(spec.name);
    }
  });

  test('all G2 new tables exist in the Drizzle schema', () => {
    for (const table of G2_NEW_TABLES) {
      expect(TABLES.has(table)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Migration 0041 parity
// ---------------------------------------------------------------------------

describe('migration 0041 — additive tenant ownership', () => {
  test('journal registers 0041 with a strictly increasing timestamp', () => {
    const entry = journal.entries.find((e) => e.tag === '0041_tenant_ownership_columns');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(41);
    const whens = journal.entries.map((e) => e.when);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i] as number).toBeGreaterThan(whens[i - 1] as number);
    }
  });

  test('adds a nullable tenant_id to each of the 29 tenant tables, idempotently', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      expect(migrationSql).toContain(`ALTER TABLE "${spec.table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid`);
    }
  });

  test('never declares tenant_id NOT NULL and never sets a default on a legacy table', () => {
    // Scoped to the ADD COLUMN statements: the NEW tenant-plane tables created
    // by this migration correctly declare their own `tenant_id` NOT NULL.
    expect(addColumnDdl).not.toMatch(/NOT NULL/);
    expect(addColumnDdl).not.toMatch(/DEFAULT/);
    expect(migrationDdl).not.toMatch(/ALTER COLUMN "tenant_id" SET NOT NULL/);
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      expect(addColumnDdl).toContain(`ALTER TABLE "${spec.table}" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;`);
    }
  });

  test('is additive only — no destructive DDL against legacy tables or columns', () => {
    expect(migrationDdl).not.toContain('DROP TABLE');
    expect(migrationDdl).not.toContain('DROP COLUMN');
    expect(migrationDdl).not.toContain('RENAME');
    expect(migrationDdl).not.toMatch(/ALTER COLUMN "(?!tenant_id)/);
    expect(migrationDdl).not.toContain('DROP CONSTRAINT');
    expect(migrationDdl).not.toContain('DROP INDEX');
    expect(migrationDdl).not.toContain('TRUNCATE TABLE');
  });

  test('every composite same-tenant FK is introduced NOT VALID and is never validated here', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      for (const parent of spec.parents) {
        const name = compositeFkName(spec.table, parent.column);
        const at = migrationDdl.indexOf(`ADD CONSTRAINT "${name}"`);
        expect(at).toBeGreaterThan(-1);
        // Read the whole statement rather than a fixed window — the longest
        // constraint names would otherwise push NOT VALID past it.
        const statement = migrationDdl.slice(at, migrationDdl.indexOf(';', at));
        expect(statement).toContain('NOT VALID');
        expect(statement).toContain(`REFERENCES "${parent.parentTable}" ("tenant_id", "id")`);
      }
    }
    expect(migrationDdl).not.toContain('VALIDATE CONSTRAINT');
  });

  test('composite FKs reference the parent (tenant_id, id) pair', () => {
    for (const spec of TENANT_OWNERSHIP_SPECS) {
      for (const parent of spec.parents) {
        expect(migrationDdl).toContain(`REFERENCES "${parent.parentTable}" ("tenant_id", "id")`);
      }
    }
  });

  test('tenant-aware unique indexes are PARTIAL so a legacy NULL-owner row cannot violate them', () => {
    for (const spec of TENANT_UNIQUE_INDEXES) {
      const idx = migrationSql.indexOf(`"${spec.name}"`);
      expect(idx).toBeGreaterThan(-1);
      const statement = migrationSql.slice(idx, migrationSql.indexOf(';', idx));
      expect(statement).toContain('WHERE "tenant_id" IS NOT NULL');
    }
  });

  test('creates every split destination and both ledger tables', () => {
    for (const table of G2_NEW_TABLES) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  test('no CREATE INDEX CONCURRENTLY inside the transactional migration runner', () => {
    // applyMigrations() wraps the whole run in one transaction, where
    // CONCURRENTLY is illegal. It may only appear in prose describing the
    // separate online-ddl.ts phase.
    expect(migrationDdl).not.toContain('CONCURRENTLY');
  });

  test('the ledger history is append-only at the database boundary', () => {
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "tenant_migration_ledger_history"');
    expect(migrationSql).toContain('BEFORE TRUNCATE ON "tenant_migration_ledger_history"');
    expect(migrationSql).toContain('migration ledger history is append-only');
  });

  test('the ledger carries the full conjunctive WISH 185-190 contract', () => {
    const required = [
      'source_table',
      'source_primary_key',
      'target_tenant_id',
      'decision_rule',
      'pre_image_redacted',
      'pre_image_checksum',
      'post_image_redacted',
      'post_image_checksum',
      'inverse_action',
      'compensating_action',
      'wal_lsn_high_water',
      'writer_epoch',
      'status',
      'ambiguity_state',
      'reconciliation_receipt',
      'attempt_count',
      'checkpoint',
      'created_at',
      'updated_at',
    ];
    const ledger = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "tenant_migration_ledger"'),
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "tenant_migration_ledger_history"'),
    );
    for (const column of required) expect(ledger).toContain(`"${column}"`);
    expect(ledger).toContain('tenant_migration_ledger_inverse_or_compensating_check');
  });

  test('the ledger stores no plaintext credential or secret column', () => {
    const ledger = migrationSql.slice(migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "tenant_migration_ledger"'));
    expect(ledger).not.toMatch(/"[a-z_]*(secret|password|plaintext|token|key_hash|credential_value)[a-z_]*"/);
  });

  test('all new columns and tables use timestamptz', () => {
    expect(migrationDdl).not.toMatch(/timestamp(?! with time zone)/);
  });
});
