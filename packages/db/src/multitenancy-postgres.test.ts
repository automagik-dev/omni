/**
 * Real PostgreSQL execution contracts for the G1 control-plane migration.
 *
 * Set OMNI_G1_POSTGRES_URL to a disposable PostgreSQL database. Every run uses
 * and removes its own random schema; no application or production data is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const postgresUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = postgresUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';
const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(join(here, '..', 'drizzle', '0040_multitenancy_control_plane.sql'), 'utf-8');

interface SqlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runSql(script: string): SqlResult {
  const result = Bun.spawnSync({
    cmd: [psqlBin, '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', postgresUrl],
    stdin: new TextEncoder().encode(script),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function runSqlOrThrow(script: string): void {
  const result = runSql(script);
  if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
}

postgresDescribe('0040 migration — real PostgreSQL enforcement', () => {
  const schema = `omni_g1_${crypto.randomUUID().replaceAll('-', '')}`;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const principalOneId = '00000000-0000-4000-8000-000000000011';
  const principalTwoId = '00000000-0000-4000-8000-000000000012';
  const membershipOneId = '00000000-0000-4000-8000-000000000021';
  const membershipTwoId = '00000000-0000-4000-8000-000000000022';
  const lineageOneId = '00000000-0000-4000-8000-000000000031';

  function inSchema(script: string): string {
    return `SET search_path TO "${schema}";\n${script}`;
  }

  beforeAll(() => {
    runSqlOrThrow(`
      CREATE SCHEMA "${schema}";
      SET search_path TO "${schema}";
      ${migrationSql}

      INSERT INTO principals (id, type, subject, status)
      VALUES
        ('${principalOneId}', 'human', 'g1-principal-one', 'active'),
        ('${principalTwoId}', 'human', 'g1-principal-two', 'active');

      INSERT INTO tenants (
        id, slug, display_name, status, max_key_ttl_seconds, max_key_rate_limit, max_key_budget
      ) VALUES (
        '${tenantId}', 'g1-tenant', 'G1 Tenant', 'active', 3600, 100, 1000
      );

      INSERT INTO tenant_memberships (id, tenant_id, principal_id, role, status)
      VALUES
        ('${membershipOneId}', '${tenantId}', '${principalOneId}', 'tenant-admin', 'active'),
        ('${membershipTwoId}', '${tenantId}', '${principalTwoId}', 'tenant-viewer', 'active');

      INSERT INTO tenant_key_lineage (
        id, tenant_id, principal_id, membership_id, actor_role, name, key_prefix,
        scopes, status, root_key_id, depth, revocation_epoch
      ) VALUES (
        '${lineageOneId}', '${tenantId}', '${principalOneId}', '${membershipOneId}',
        'tenant-admin', 'root-one', 'rootone', ARRAY['tenant:read', 'keys:delegate'],
        'active', '${lineageOneId}', 0, 0
      );
    `);
  });

  afterAll(() => {
    runSqlOrThrow(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  test('rejects a tenant credential whose principal, membership, or role drifts from its lineage', () => {
    const result = runSql(
      inSchema(`
        INSERT INTO auth_credentials (
          credential_class, key_hash, key_prefix, tenant_id, principal_id, membership_id,
          actor_role, scopes, status, tenant_key_lineage_id,
          policy_snapshot_version, revocation_epoch_snapshot
        ) VALUES (
          'tenant', '${'a'.repeat(64)}', 'mismatch', '${tenantId}', '${principalTwoId}',
          '${membershipTwoId}', 'tenant-viewer', ARRAY['tenant:read'], 'active',
          '${lineageOneId}', 1, 0
        );
      `),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('auth_credentials_tenant_lineage_binding_fk');
  });

  test('rejects hard deletion even for an otherwise-unreferenced tenant', () => {
    const orphanTenantId = '00000000-0000-4000-8000-000000000099';
    runSqlOrThrow(
      inSchema(`
      INSERT INTO tenants (
        id, slug, display_name, status, max_key_ttl_seconds, max_key_rate_limit, max_key_budget
      ) VALUES (
        '${orphanTenantId}', 'g1-orphan', 'G1 Orphan', 'active', 3600, 100, 1000
      );
    `),
    );

    const result = runSql(inSchema(`DELETE FROM tenants WHERE id = '${orphanTenantId}'`));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('tenant hard delete is forbidden');
  });

  test('rejects UPDATE, DELETE, and TRUNCATE on both audit stores', () => {
    runSqlOrThrow(
      inSchema(`
      INSERT INTO tenant_audit_logs (
        tenant_id, actor_principal_id, actor_credential_id, action, request_id
      ) VALUES (
        '${tenantId}', '${principalOneId}', '00000000-0000-4000-8000-000000000041',
        'tenant_key.create_child', 'g1-tenant-audit'
      );

      INSERT INTO platform_audit_logs (
        actor_principal_id, actor_credential_id, action, target_tenant_id, reason, request_id
      ) VALUES (
        '${principalOneId}', '00000000-0000-4000-8000-000000000042',
        'tenant.read', '${tenantId}', 'G1 PostgreSQL enforcement test', 'g1-platform-audit'
      );
    `),
    );

    for (const table of ['tenant_audit_logs', 'platform_audit_logs']) {
      for (const operation of [
        `UPDATE "${table}" SET action = 'tampered'`,
        `DELETE FROM "${table}"`,
        `TRUNCATE TABLE "${table}"`,
      ]) {
        const result = runSql(inSchema(operation));
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('multitenancy audit logs are append-only');
      }
    }
  });
});
