/**
 * Migration + journal contract tests for the multitenancy control plane
 * (wish: omni-full-multitenancy, Group G1).
 *
 * Static checks only — they read the migration SQL and journal from disk and
 * never connect to or mutate any database. They guard the additive-only and
 * no-hard-delete guarantees at the SQL level, and pin schema/migration parity.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');
const migrationSql = readFileSync(join(drizzleDir, '0040_multitenancy_control_plane.sql'), 'utf-8');
const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf-8')) as {
  entries: { idx: number; when: number; tag: string }[];
};

const NEW_TABLES = [
  'tenants',
  'principals',
  'tenant_memberships',
  'tenant_role_policies',
  'platform_api_keys',
  'tenant_key_lineage',
  'auth_credentials',
  'tenant_audit_logs',
  'platform_audit_logs',
];

describe('0040 migration journal', () => {
  test('journal registers the 0040 migration', () => {
    const entry = journal.entries.find((e) => e.tag === '0040_multitenancy_control_plane');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(40);
  });

  test('journal when-timestamps are strictly increasing (migrate.ts count guard)', () => {
    const whens = journal.entries.map((e) => e.when);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i] as number).toBeGreaterThan(whens[i - 1] as number);
    }
  });
});

describe('0040 migration SQL — additive control plane', () => {
  test('creates every new control-plane table', () => {
    for (const table of NEW_TABLES) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  test('does NOT touch legacy api_keys or any existing business table', () => {
    expect(migrationSql).not.toContain('"api_keys"');
    expect(migrationSql).not.toMatch(/ALTER TABLE "(instances|messages|persons|chats|api_keys)"/);
    // Additive only: no DROP of any kind.
    expect(migrationSql).not.toContain('DROP TABLE');
    expect(migrationSql).not.toContain('DROP COLUMN');
  });

  test('no foreign key cascades a tenant delete or erases lineage/audit', () => {
    expect(migrationSql).not.toContain('ON DELETE CASCADE');
    // Every FK referencing tenants uses RESTRICT.
    const restrictCount = (migrationSql.match(/ON DELETE RESTRICT/g) ?? []).length;
    expect(restrictCount).toBeGreaterThanOrEqual(8);
    expect(migrationSql).toContain('BEFORE DELETE ON "tenants"');
    expect(migrationSql).toContain('reject_tenant_hard_delete');
  });

  test('enforces class separation and forbids platform authority on tenant credentials', () => {
    expect(migrationSql).toContain('auth_credentials_class_separation_check');
    expect(migrationSql).toContain('auth_credentials_tenant_no_wildcard_check');
    expect(migrationSql).toContain('tenant_key_lineage_no_platform_authority_check');
    expect(migrationSql).toContain('tenant_role_policies_no_platform_authority_check');
    expect(migrationSql).toContain("array_to_string(\"scopes\", ',') !~ '(^|,)platform:'");
    expect(migrationSql).toContain('array_position("scopes", NULL) IS NULL');
    expect(migrationSql).toMatch(/"credential_class" = 'platform'[\s\S]*?"membership_id" IS NULL/);
  });

  test('seeds exactly the four fixed roles with bounded (non-wildcard) ceilings', () => {
    for (const role of ['tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer']) {
      expect(migrationSql).toContain(`'${role}'`);
    }
    // The seed INSERT must never grant the platform '*' capability.
    const seedSection = migrationSql.slice(migrationSql.indexOf('INSERT INTO "tenant_role_policies"'));
    const seedInsert = seedSection.slice(0, seedSection.indexOf('ON CONFLICT'));
    expect(seedInsert).not.toContain("'*'");
    expect(seedInsert).toContain("ARRAY['tenant:*', 'keys:delegate']::text[]");
    expect(migrationSql).toContain('ON CONFLICT ("role") DO UPDATE SET');
    expect(migrationSql).toContain('tenant_role_policies_fixed_ceiling_check');
  });

  test('the isolated auth index is hash-unique (indexed equality path)', () => {
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_key_hash_uq"');
    expect(migrationSql).toContain('ON "auth_credentials" ("key_hash")');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_tenant_lineage_uq"');
    expect(migrationSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "auth_credentials_platform_source_uq"');
  });
  test('same-tenant lineage and auth source bindings are database-enforced', () => {
    for (const constraint of [
      'tenant_key_lineage_parent_tenant_fk',
      'tenant_key_lineage_root_tenant_fk',
      'tenant_key_lineage_membership_principal_fk',
      'auth_credentials_tenant_lineage_fk',
      'auth_credentials_tenant_lineage_binding_fk',
      'auth_credentials_membership_principal_fk',
    ]) {
      expect(migrationSql).toContain(constraint);
    }
    expect(migrationSql).toContain('tenant_key_lineage_auth_binding_uq');
  });

  test('tenant-owned lineage never stores a secret hash', () => {
    const lineageTable = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "tenant_key_lineage"'),
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS "auth_credentials"'),
    );
    expect(lineageTable).not.toContain('"key_hash"');
    expect(lineageTable).toContain('"key_prefix"');
  });

  test('all new tables use timestamptz (no TZ-naive timestamps)', () => {
    expect(migrationSql).not.toMatch(/timestamp(?! with time zone)/);
  });

  test('database triggers reject UPDATE, DELETE, and TRUNCATE on both append-only audit stores', () => {
    expect(migrationSql).toContain('reject_audit_log_mutation');
    for (const table of ['tenant_audit_logs', 'platform_audit_logs']) {
      expect(migrationSql).toContain(`BEFORE UPDATE OR DELETE ON "${table}"`);
      expect(migrationSql).toContain(`BEFORE TRUNCATE ON "${table}"`);
    }
  });
});
