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

  test('the pre-cutover legacy role keeps nothing once it is named', () => {
    const legacy = 'pgserve_omni_deadbeef1234_role';
    const statements = roleProvisioningStatements(PASSWORDS, DEFAULT_ROLE_NAMES, 'omni', [legacy]);
    const withLegacy = statements.join('\n');

    // Guarded: a deployment that never ran the CLI cutover must still apply.
    expect(withLegacy).toContain(`IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${legacy}')`);
    // The blanket grants role-cutover.ts hands it (GRANT ... ON ALL TABLES) —
    // ownership moves to the DDL role on its own, privilege does not.
    for (const fragment of [
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
      'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA drizzle FROM %I',
      'REVOKE ALL PRIVILEGES ON DATABASE "omni" FROM %I',
      // A default privilege survives an object-level REVOKE and would re-arm
      // the legacy role on the next table created. Both grantors are covered.
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
    ]) {
      expect(withLegacy).toContain(fragment);
    }
    expect(withLegacy).toContain(`format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', '${legacy}')`);
    // And it never becomes an auth-plane identity by inheritance.
    expect(withLegacy).toContain(`EXECUTE 'REVOKE "${DEFAULT_ROLE_NAMES.authPlaneMarker}" FROM "${legacy}"'`);
  });

  test('the legacy revoke lands after every grant, or the blanket grant would undo it', () => {
    const legacy = 'pgserve_omni_deadbeef1234_role';
    const statements = roleProvisioningStatements(PASSWORDS, DEFAULT_ROLE_NAMES, 'omni', [legacy]);
    const lastGrant = statements.reduce((acc, s, i) => (s.startsWith('GRANT ') ? i : acc), -1);
    const revoke = statements.findIndex((s) => s.includes(`rolname = '${legacy}'`));
    expect(lastGrant).toBeGreaterThanOrEqual(0);
    expect(revoke).toBeGreaterThan(lastGrant);
  });

  test('naming no legacy role changes nothing — the default plan is byte-identical', () => {
    expect(roleProvisioningStatements(PASSWORDS, DEFAULT_ROLE_NAMES, 'omni', []).join('\n')).toBe(plan);
  });

  test('a legacy name that collides with a provisioned identity is refused', () => {
    for (const name of Object.values(DEFAULT_ROLE_NAMES)) {
      expect(() => roleProvisioningStatements(PASSWORDS, DEFAULT_ROLE_NAMES, 'omni', [name])).toThrow(/collides/);
    }
    expect(() =>
      roleProvisioningStatements(PASSWORDS, DEFAULT_ROLE_NAMES, 'omni', ['bad"; DROP DATABASE omni --']),
    ).toThrow(/unsafe legacy role identifier/);
  });

  test('the auth-plane function grants name their schema', () => {
    // An unqualified GRANT EXECUTE resolves against the applier's search_path,
    // which is the same failure mode as an unqualified CREATE.
    expect(plan).toContain('GRANT EXECUTE ON FUNCTION public.omni_current_tenant_id()');
    expect(plan).toContain('GRANT EXECUTE ON FUNCTION public.omni_is_auth_plane(text)');
    expect(plan).toContain('GRANT EXECUTE ON FUNCTION public.omni_auth_plane_row_visible(uuid, text)');
  });

  test('unsafe identifiers and passwords are rejected rather than interpolated', () => {
    expect(() =>
      roleProvisioningStatements(PASSWORDS, { ...DEFAULT_ROLE_NAMES, runtime: 'bad"; DROP DATABASE omni --' }),
    ).toThrow(/unsafe runtime identifier/);
    expect(() => roleProvisioningStatements({ ...PASSWORDS, runtime: "x'; DROP" })).toThrow(/base64url/);
  });
});
