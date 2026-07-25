/**
 * Role-split and enforcement-startup contract tests
 * (wish: omni-full-multitenancy, Group G3; ADR-0003, ADR-0004).
 *
 * The live equivalents live in `rls-postgres.test.ts`. These cover the parts a
 * server cannot: that the DEFAULT mode is legacy, that the enforced mode
 * refuses to start on a missing or shared credential, and that the generated
 * privilege plan does not quietly hand the runtime role something it should
 * never have.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_ROLE_NAMES, RUNTIME_DENIED_TABLES } from './tenancy-rls';
import {
  AUTH_PLANE_TABLES,
  type RoleAttributes,
  roleAttributeViolations,
  roleProvisioningStatements,
} from './tenancy-roles';
import {
  DDL_URL_ENV_VAR,
  ENFORCEMENT_ENV_VAR,
  EnforcementStartupError,
  RUNTIME_URL_ENV_VAR,
  resolveEnforcedBootIdentities,
  resolveEnforcementMode,
} from './tenancy-startup';

const PASSWORDS = {
  ddl: 'aaaaaaaaaaaaaaaaaaaa',
  runtime: 'bbbbbbbbbbbbbbbbbbbb',
  authPlane: 'cccccccccccccccccccc',
};

const plan = roleProvisioningStatements(PASSWORDS).join('\n');

describe('enforcement mode default', () => {
  test('an empty environment is LEGACY — G3 changes nothing for an existing deployment', () => {
    expect(resolveEnforcementMode({})).toBe('legacy');
  });

  test('only the literal `on` activates enforcement', () => {
    for (const value of ['1', 'true', 'yes', 'ON', 'enabled', '']) {
      expect(resolveEnforcementMode({ [ENFORCEMENT_ENV_VAR]: value })).toBe('legacy');
    }
    expect(resolveEnforcementMode({ [ENFORCEMENT_ENV_VAR]: 'on' })).toBe('enforced');
  });
});

describe('enforced boot identities', () => {
  test('a missing runtime or DDL url fails closed', () => {
    expect(() => resolveEnforcedBootIdentities({})).toThrow(EnforcementStartupError);
    expect(() => resolveEnforcedBootIdentities({ [RUNTIME_URL_ENV_VAR]: 'postgres://r@h/d' })).toThrow(
      new RegExp(DDL_URL_ENV_VAR),
    );
    expect(() => resolveEnforcedBootIdentities({ [DDL_URL_ENV_VAR]: 'postgres://d@h/d' })).toThrow(
      new RegExp(RUNTIME_URL_ENV_VAR),
    );
  });

  test('one credential used for both migration and runtime is rejected', () => {
    expect(() =>
      resolveEnforcedBootIdentities({
        [RUNTIME_URL_ENV_VAR]: 'postgres://same@h/d',
        [DDL_URL_ENV_VAR]: 'postgres://same@h/d',
      }),
    ).toThrow(/must differ/);
  });

  test('DATABASE_URL is never consulted on the enforced path', () => {
    expect(() =>
      resolveEnforcedBootIdentities({ DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/omni' }),
    ).toThrow(EnforcementStartupError);
  });
});

describe('role attribute contract', () => {
  const base: RoleAttributes = {
    name: 'omni_runtime',
    superuser: false,
    bypassRls: false,
    createDb: false,
    createRole: false,
    replication: false,
    canLogin: true,
  };

  test('a correctly attributed role has no violations', () => {
    expect(roleAttributeViolations(base)).toEqual([]);
  });

  test('every forbidden attribute is reported', () => {
    expect(roleAttributeViolations({ ...base, superuser: true })).toContain('role is SUPERUSER');
    expect(roleAttributeViolations({ ...base, bypassRls: true })).toContain('role is BYPASSRLS');
    expect(roleAttributeViolations({ ...base, createDb: true })).toContain('role is CREATEDB');
    expect(roleAttributeViolations({ ...base, createRole: true })).toContain('role is CREATEROLE');
    expect(roleAttributeViolations({ ...base, replication: true })).toContain('role is REPLICATION');
  });
});

describe('provisioning plan', () => {
  test('all three login identities are NOSUPERUSER ... NOBYPASSRLS', () => {
    for (const role of [DEFAULT_ROLE_NAMES.ddl, DEFAULT_ROLE_NAMES.runtime, DEFAULT_ROLE_NAMES.authPlane]) {
      const create = plan.slice(plan.indexOf(`rolname = '${role}'`));
      expect(create.slice(0, 400)).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
    }
  });

  test('the DDL role owns the schema; the runtime role receives USAGE but never CREATE', () => {
    expect(plan).toContain(`ALTER SCHEMA public OWNER TO "${DEFAULT_ROLE_NAMES.ddl}";`);
    expect(plan).toContain(`GRANT USAGE ON SCHEMA public TO "${DEFAULT_ROLE_NAMES.runtime}";`);
    expect(plan).not.toContain(`GRANT USAGE, CREATE ON SCHEMA public TO "${DEFAULT_ROLE_NAMES.runtime}"`);
    expect(plan).toContain(`GRANT USAGE, CREATE ON SCHEMA public TO "${DEFAULT_ROLE_NAMES.ddl}";`);
  });

  test('the runtime role never receives CREATE on the database', () => {
    expect(plan).toContain(`GRANT CONNECT, TEMPORARY ON DATABASE "omni" TO "${DEFAULT_ROLE_NAMES.runtime}";`);
    expect(plan).not.toContain(`CREATE ON DATABASE "omni" TO "${DEFAULT_ROLE_NAMES.runtime}"`);
  });

  test('unsafe PUBLIC privileges are revoked', () => {
    expect(plan).toContain('REVOKE ALL ON SCHEMA public FROM PUBLIC;');
    expect(plan).toContain('REVOKE ALL ON DATABASE "omni" FROM PUBLIC;');
    expect(plan).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;');
    expect(plan).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;');
  });

  test('every control-plane table is revoked from the runtime role', () => {
    for (const table of RUNTIME_DENIED_TABLES) {
      expect(plan).toContain(`REVOKE ALL ON TABLE "${table}" FROM "${DEFAULT_ROLE_NAMES.runtime}";`);
    }
  });

  test('ledger history UPDATE/DELETE is revoked from the runtime role (G2 review carry-forward)', () => {
    expect(plan).toContain(
      `REVOKE UPDATE, DELETE ON TABLE "tenant_migration_ledger_history" FROM "${DEFAULT_ROLE_NAMES.runtime}";`,
    );
  });

  test('only the auth-plane role holds the marker, and it is SELECT-only', () => {
    expect(plan).toContain(`GRANT "${DEFAULT_ROLE_NAMES.authPlaneMarker}" TO "${DEFAULT_ROLE_NAMES.authPlane}";`);
    // Guarded revokes: the statement is emitted, wrapped in an existence check.
    for (const member of [DEFAULT_ROLE_NAMES.runtime, DEFAULT_ROLE_NAMES.ddl]) {
      expect(plan).toContain(`EXECUTE 'REVOKE "${DEFAULT_ROLE_NAMES.authPlaneMarker}" FROM "${member}"'`);
    }
    for (const table of AUTH_PLANE_TABLES) {
      expect(plan).toContain(`GRANT SELECT ON TABLE "${table}" TO "${DEFAULT_ROLE_NAMES.authPlane}";`);
      expect(plan).not.toContain(`GRANT INSERT ON TABLE "${table}" TO "${DEFAULT_ROLE_NAMES.authPlane}"`);
    }
  });

  test('the credential index is unreachable from the runtime role', () => {
    expect(RUNTIME_DENIED_TABLES).toContain('auth_credentials');
    expect(plan).toContain(`REVOKE ALL ON TABLE "auth_credentials" FROM "${DEFAULT_ROLE_NAMES.runtime}";`);
    expect(plan).toContain(`GRANT SELECT ON TABLE "auth_credentials" TO "${DEFAULT_ROLE_NAMES.authPlane}";`);
  });

  test('nothing in the plan grants BYPASSRLS or SUPERUSER to anyone', () => {
    expect(plan).not.toMatch(/(?<!NO)BYPASSRLS/);
    expect(plan).not.toMatch(/(?<!NO)SUPERUSER/);
  });

  test('the revoke of the control plane comes after the blanket grant', () => {
    // Order is load-bearing: `GRANT ... ON ALL TABLES` includes the control
    // plane, so a revoke placed before it would be undone.
    const statements = roleProvisioningStatements(PASSWORDS);
    const grantAll = statements.findIndex((s) => s.includes('ON ALL TABLES IN SCHEMA public TO'));
    const revoke = statements.findIndex((s) => s.includes('REVOKE ALL ON TABLE "auth_credentials"'));
    expect(grantAll).toBeGreaterThanOrEqual(0);
    expect(revoke).toBeGreaterThan(grantAll);
  });

  test('unsafe identifiers and passwords are rejected rather than interpolated', () => {
    expect(() =>
      roleProvisioningStatements(PASSWORDS, { ...DEFAULT_ROLE_NAMES, runtime: 'bad"; DROP DATABASE omni --' }),
    ).toThrow(/unsafe runtime identifier/);
    expect(() => roleProvisioningStatements({ ...PASSWORDS, runtime: "x'; DROP" })).toThrow(/base64url/);
  });
});
