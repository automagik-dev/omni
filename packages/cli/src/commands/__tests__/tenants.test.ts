/**
 * CLI `omni tenants` — command → SDK mapping, reason enforcement, and
 * control-plane failure UX (issue #981).
 *
 * Covers:
 *   - every handler calls the matching `client.platform.tenants.*` method with
 *     the audited reason in the position the SDK expects (arg or body field)
 *   - every handler refuses to run without `--reason` BEFORE any SDK call
 *   - 404 on an unmounted control plane explains OMNI_MULTITENANCY_ENABLED /
 *     server-too-old instead of dumping the raw error
 *   - 401/403 explain that a PLATFORM-class credential is required (the
 *     legacy-credential dual-world contract — messages pinned verbatim)
 */

import { describe, expect, mock, test } from 'bun:test';
import { OmniApiError, type OmniClient } from '@omni/sdk';

// `error` throws (instead of printing + process.exit) so tests can assert the
// exact operator-facing message. Same precedent as history.test.ts.
mock.module('../../output.js', () => ({
  error: (msg: string): never => {
    throw new Error(msg);
  },
  success: mock(),
  info: mock(),
  warn: mock(),
  raw: mock(),
  data: mock(),
  list: mock(),
  keyValue: mock(),
  header: mock(),
  dim: mock(),
  tip: mock(),
  disableColors: mock(),
  areColorsEnabled: () => true,
  setMaxCellWidth: mock(),
  getCurrentFormat: () => 'human',
  flushStdout: () => Promise.resolve(),
}));

const { __testables } = await import('../tenants');
const {
  requireReason,
  renderPlatformError,
  handleList,
  handleGet,
  handleCreate,
  handleSuspend,
  handleArchive,
  handleMembershipsList,
  handleMembershipsAdd,
  handleMembershipsDisable,
  handleMembershipsStatus,
  handleMembershipsRole,
} = __testables;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL_ID = '33333333-3333-4333-8333-333333333333';

const tenant = {
  id: TENANT_ID,
  slug: 'acme',
  displayName: 'Acme Corp',
  status: 'active',
  maxKeyTtlSeconds: 3600,
  maxKeyRateLimit: 100,
  maxKeyBudget: 1000,
  createdAt: new Date().toISOString(),
};

const membership = {
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  principalId: PRINCIPAL_ID,
  role: 'tenant-operator',
  status: 'active',
  invitedByPrincipalId: null,
  createdAt: new Date().toISOString(),
};

interface CapturedCall {
  method: string;
  args: unknown[];
}

function makeFakeClient(): { client: OmniClient; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };

  const client = {
    platform: {
      tenants: {
        list: record('tenants.list', { items: [tenant] }),
        get: record('tenants.get', tenant),
        create: record('tenants.create', tenant),
        suspend: record('tenants.suspend', tenant),
        archive: record('tenants.archive', tenant),
        memberships: {
          list: record('memberships.list', { items: [membership] }),
          attach: record('memberships.attach', membership),
          disable: record('memberships.disable', membership),
          setStatus: record('memberships.setStatus', { ...membership, status: 'disabled' }),
          setRole: record('memberships.setRole', { ...membership, role: 'tenant-admin' }),
        },
      },
    },
  } as unknown as OmniClient;

  return { client, calls };
}

// ---------------------------------------------------------------------------

describe('requireReason', () => {
  test('accepts and trims a valid reason', () => {
    expect(requireReason('  audit Q3  ', 'list tenants')).toBe('audit Q3');
  });

  test('refuses a missing reason with an actionable message', () => {
    expect(() => requireReason(undefined, 'list tenants')).toThrow(
      '--reason is required to list tenants. Every platform control-plane call is audited; ' +
        'provide a justification of 3-500 characters, e.g. --reason "onboarding request OPS-1421".',
    );
  });

  test('refuses a too-short reason', () => {
    expect(() => requireReason('ok', 'suspend a tenant')).toThrow('--reason is required to suspend a tenant');
  });

  test('refuses a too-long reason', () => {
    expect(() => requireReason('x'.repeat(501), 'archive a tenant')).toThrow('--reason is required');
  });
});

// ---------------------------------------------------------------------------

describe('command → SDK mapping (reason included where each route expects it)', () => {
  test('list → platform.tenants.list(reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleList(client, { reason: 'quarterly audit' });
    expect(calls).toEqual([{ method: 'tenants.list', args: ['quarterly audit'] }]);
  });

  test('get → platform.tenants.get(id, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleGet(client, TENANT_ID, { reason: 'support ticket 42' });
    expect(calls).toEqual([{ method: 'tenants.get', args: [TENANT_ID, 'support ticket 42'] }]);
  });

  test('create → platform.tenants.create(body with reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleCreate(client, {
      slug: 'acme',
      name: 'Acme Corp',
      maxKeyTtl: 3600,
      maxKeyRate: 100,
      maxKeyBudget: 1000,
      reason: 'onboarding request OPS-1421',
    });
    expect(calls).toEqual([
      {
        method: 'tenants.create',
        args: [
          {
            slug: 'acme',
            displayName: 'Acme Corp',
            maxKeyTtlSeconds: 3600,
            maxKeyRateLimit: 100,
            maxKeyBudget: 1000,
            reason: 'onboarding request OPS-1421',
          },
        ],
      },
    ]);
  });

  test('suspend → platform.tenants.suspend(id, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleSuspend(client, TENANT_ID, { reason: 'billing overdue' });
    expect(calls).toEqual([{ method: 'tenants.suspend', args: [TENANT_ID, 'billing overdue'] }]);
  });

  test('archive → platform.tenants.archive(id, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleArchive(client, TENANT_ID, { reason: 'contract ended' });
    expect(calls).toEqual([{ method: 'tenants.archive', args: [TENANT_ID, 'contract ended'] }]);
  });

  test('memberships list → platform.tenants.memberships.list(tenantId, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleMembershipsList(client, TENANT_ID, { reason: 'access review' });
    expect(calls).toEqual([{ method: 'memberships.list', args: [TENANT_ID, 'access review'] }]);
  });

  test('memberships add → platform.tenants.memberships.attach(tenantId, body with reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleMembershipsAdd(client, TENANT_ID, {
      principal: PRINCIPAL_ID,
      role: 'tenant-operator',
      reason: 'new hire',
    });
    expect(calls).toEqual([
      {
        method: 'memberships.attach',
        args: [TENANT_ID, { principalId: PRINCIPAL_ID, role: 'tenant-operator', reason: 'new hire' }],
      },
    ]);
  });

  test('memberships disable → platform.tenants.memberships.disable(tenantId, membershipId, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleMembershipsDisable(client, TENANT_ID, MEMBERSHIP_ID, { reason: 'offboarding' });
    expect(calls).toEqual([{ method: 'memberships.disable', args: [TENANT_ID, MEMBERSHIP_ID, 'offboarding'] }]);
  });

  test('memberships status → platform.tenants.memberships.setStatus(..., status, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleMembershipsStatus(client, TENANT_ID, MEMBERSHIP_ID, { status: 'disabled', reason: 'security hold' });
    expect(calls).toEqual([
      { method: 'memberships.setStatus', args: [TENANT_ID, MEMBERSHIP_ID, 'disabled', 'security hold'] },
    ]);
  });

  test('memberships role → platform.tenants.memberships.setRole(..., role, reason)', async () => {
    const { client, calls } = makeFakeClient();
    await handleMembershipsRole(client, TENANT_ID, MEMBERSHIP_ID, { role: 'tenant-admin', reason: 'promotion' });
    expect(calls).toEqual([
      { method: 'memberships.setRole', args: [TENANT_ID, MEMBERSHIP_ID, 'tenant-admin', 'promotion'] },
    ]);
  });

  test('invalid --role is refused locally with the valid roles listed', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      handleMembershipsAdd(client, TENANT_ID, { principal: PRINCIPAL_ID, role: 'superuser', reason: 'new hire' }),
    ).rejects.toThrow(
      'Invalid --role "superuser". Valid roles: tenant-owner, tenant-admin, tenant-operator, tenant-viewer',
    );
    expect(calls).toEqual([]);
  });

  test('invalid --status is refused locally with the valid statuses listed', async () => {
    const { client, calls } = makeFakeClient();
    await expect(
      handleMembershipsStatus(client, TENANT_ID, MEMBERSHIP_ID, { status: 'paused', reason: 'security hold' }),
    ).rejects.toThrow('Invalid --status "paused". Valid statuses: active, disabled');
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('every command refuses to run without --reason', () => {
  const cases: Array<[string, (client: OmniClient) => Promise<void>]> = [
    ['list', (c) => handleList(c, {})],
    ['get', (c) => handleGet(c, TENANT_ID, {})],
    [
      'create',
      (c) => handleCreate(c, { slug: 'acme', name: 'Acme Corp', maxKeyTtl: 3600, maxKeyRate: 100, maxKeyBudget: 1000 }),
    ],
    ['suspend', (c) => handleSuspend(c, TENANT_ID, {})],
    ['archive', (c) => handleArchive(c, TENANT_ID, {})],
    ['memberships list', (c) => handleMembershipsList(c, TENANT_ID, {})],
    ['memberships add', (c) => handleMembershipsAdd(c, TENANT_ID, { principal: PRINCIPAL_ID, role: 'tenant-viewer' })],
    ['memberships disable', (c) => handleMembershipsDisable(c, TENANT_ID, MEMBERSHIP_ID, {})],
    ['memberships status', (c) => handleMembershipsStatus(c, TENANT_ID, MEMBERSHIP_ID, { status: 'active' })],
    ['memberships role', (c) => handleMembershipsRole(c, TENANT_ID, MEMBERSHIP_ID, { role: 'tenant-viewer' })],
  ];

  for (const [name, run] of cases) {
    test(`${name} refuses without --reason and never calls the SDK`, async () => {
      const { client, calls } = makeFakeClient();
      await expect(run(client)).rejects.toThrow('--reason is required');
      expect(calls).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------

describe('control-plane failure UX', () => {
  test('an unmounted control plane (endpoint 404) explains the multitenancy flag', () => {
    const err = new OmniApiError('Endpoint not found: GET /api/v2/platform/tenants', 'NOT_FOUND', undefined, 404);
    // Message pinned verbatim — this is the operator-facing explanation.
    expect(() => renderPlatformError(err, 'list tenants')).toThrow(
      'Failed to list tenants: the platform control plane is not available on this server. ' +
        'Either multitenancy is disabled (start the API with OMNI_MULTITENANCY_ENABLED=true) ' +
        'or the server predates the tenant control plane — upgrade it.',
    );
  });

  test('a genuine tenant 404 stays a plain not-found, not a flag explanation', () => {
    const err = new OmniApiError('tenant not found', 'NOT_FOUND', undefined, 404);
    expect(() => renderPlatformError(err, 'get the tenant')).toThrow('Failed to get the tenant: tenant not found');
  });

  test('401 explains that only PLATFORM-class credentials are accepted (pinned verbatim)', () => {
    const err = new OmniApiError('Platform credential required', 'UNAUTHORIZED', undefined, 401);
    expect(() => renderPlatformError(err, 'list tenants')).toThrow(
      'Failed to list tenants: the server rejected the credential (401). ' +
        'The platform control plane accepts only PLATFORM-class credentials — legacy admin/god keys and ' +
        'tenant data-plane keys are denied by design. Authenticate with a platform key: ' +
        'omni auth login --api-key <platform-key>.',
    );
  });

  test('403 explains the scope requirement for an authenticated non-platform key (pinned verbatim)', () => {
    const err = new OmniApiError('Forbidden', 'FORBIDDEN', undefined, 403);
    expect(() => renderPlatformError(err, 'create the tenant')).toThrow(
      'Failed to create the tenant: the credential authenticated but is not allowed (403). ' +
        'A PLATFORM-class credential with the matching platform:* scope is required — tenant-class ' +
        'credentials can never reach the control plane, and platform keys act only within their scopes.',
    );
  });

  test('other errors render as a plain failure with the original message', () => {
    expect(() => renderPlatformError(new Error('connection refused'), 'list tenants')).toThrow(
      'Failed to list tenants: connection refused',
    );
  });
});
