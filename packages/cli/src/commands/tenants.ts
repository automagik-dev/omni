/**
 * Platform Tenant Control-Plane Commands (`omni tenants`)
 *
 * Tenant lifecycle (list/get/create/suspend/archive) and memberships
 * (list/add/disable/status/role) over the platform control plane
 * (issue #981; wish: omni-full-multitenancy, Group G1; ADR-0005).
 *
 * Every command carries an audited `--reason` and refuses to run without it —
 * the server enforces the same rule (reads validate the `x-platform-reason`
 * header, mutations validate body `reason`), but a local check turns a
 * validation 400 into an actionable message before any request is sent.
 *
 * The control plane is feature-flagged server-side: when
 * `OMNI_MULTITENANCY_ENABLED` is not `true` the whole surface 404s, and only
 * PLATFORM-class credentials are accepted. Both failure modes are rendered as
 * explanations, not raw HTTP dumps.
 *
 * The `keys issue-root` subcommand is intentionally absent — the route ships
 * separately (#979) and the subcommand follows it.
 */

import { OmniApiError, type OmniClient, type PlatformTenant, type PlatformTenantMembership } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

// ============================================================================
// TYPES
// ============================================================================

/** Mirrors `tenantRoles` in @omni/db — validated server-side as well */
const TENANT_ROLES = ['tenant-owner', 'tenant-admin', 'tenant-operator', 'tenant-viewer'] as const;
type TenantRoleFlag = (typeof TENANT_ROLES)[number];

const MEMBERSHIP_STATUSES = ['active', 'disabled'] as const;
type MembershipStatusFlag = (typeof MEMBERSHIP_STATUSES)[number];

interface ReasonOption {
  reason?: string;
}

interface CreateOptions extends ReasonOption {
  slug: string;
  name: string;
  maxKeyTtl: number;
  maxKeyRate: number;
  maxKeyBudget: number;
}

interface MembershipAddOptions extends ReasonOption {
  principal: string;
  role: string;
}

interface MembershipStatusOptions extends ReasonOption {
  status: string;
}

interface MembershipRoleOptions extends ReasonOption {
  role: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const REASON_REQUIRED_HINT =
  'Every platform control-plane call is audited; ' +
  'provide a justification of 3-500 characters, e.g. --reason "onboarding request OPS-1421".';

const CONTROL_PLANE_UNAVAILABLE =
  'the platform control plane is not available on this server. ' +
  'Either multitenancy is disabled (start the API with OMNI_MULTITENANCY_ENABLED=true) ' +
  'or the server predates the tenant control plane — upgrade it.';

const CREDENTIAL_REJECTED_401 =
  'the server rejected the credential (401). ' +
  'The platform control plane accepts only PLATFORM-class credentials — legacy admin/god keys and ' +
  'tenant data-plane keys are denied by design. Authenticate with a platform key: ' +
  'omni auth login --api-key <platform-key>.';

const CREDENTIAL_FORBIDDEN_403 =
  'the credential authenticated but is not allowed (403). ' +
  'A PLATFORM-class credential with the matching platform:* scope is required — tenant-class ' +
  'credentials can never reach the control plane, and platform keys act only within their scopes.';

/**
 * Enforce the audited `--reason` before any request is sent. The server
 * requires 3-500 characters; mirroring the bounds here keeps the refusal
 * local, immediate, and explained.
 */
function requireReason(reason: string | undefined, action: string): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 3 || trimmed.length > 500) {
    output.error(`--reason is required to ${action}. ${REASON_REQUIRED_HINT}`, undefined, 1);
  }
  return trimmed;
}

function parseRole(value: string): TenantRoleFlag {
  if (!(TENANT_ROLES as readonly string[]).includes(value)) {
    output.error(`Invalid --role "${value}". Valid roles: ${TENANT_ROLES.join(', ')}`, undefined, 1);
  }
  return value as TenantRoleFlag;
}

function parseStatus(value: string): MembershipStatusFlag {
  if (!(MEMBERSHIP_STATUSES as readonly string[]).includes(value)) {
    output.error(`Invalid --status "${value}". Valid statuses: ${MEMBERSHIP_STATUSES.join(', ')}`, undefined, 1);
  }
  return value as MembershipStatusFlag;
}

/**
 * Render a control-plane failure as an explanation, not a raw HTTP dump.
 *
 * - An "Endpoint not found" 404 means the surface is unmounted: multitenancy
 *   is disabled (`OMNI_MULTITENANCY_ENABLED`) or the server predates the
 *   control plane. Any other 404 is a genuine missing tenant/membership
 *   (the API is deliberately non-enumerating there).
 * - 401/403 mean the configured key is not a PLATFORM-class credential with
 *   the required scope — tenant and legacy data-plane keys are denied by
 *   design, so "log in harder" is not the fix; a platform credential is.
 */
function renderPlatformError(err: unknown, action: string): never {
  if (err instanceof OmniApiError) {
    if (err.status === 404 && err.message.startsWith('Endpoint not found')) {
      output.error(`Failed to ${action}: ${CONTROL_PLANE_UNAVAILABLE}`, undefined, 1);
    }
    if (err.status === 401) {
      output.error(`Failed to ${action}: ${CREDENTIAL_REJECTED_401}`, undefined, 1);
    }
    if (err.status === 403) {
      output.error(`Failed to ${action}: ${CREDENTIAL_FORBIDDEN_403}`, undefined, 1);
    }
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  output.error(`Failed to ${action}: ${message}`);
}

function formatTenantRow(tenant: PlatformTenant): Record<string, string | number> {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.displayName,
    status: tenant.status,
    keyTtl: tenant.maxKeyTtlSeconds,
    keyRate: tenant.maxKeyRateLimit,
    keyBudget: tenant.maxKeyBudget,
    created: new Date(tenant.createdAt).toLocaleDateString(),
  };
}

function formatMembershipRow(membership: PlatformTenantMembership): Record<string, string> {
  return {
    id: membership.id,
    principal: membership.principalId,
    role: membership.role,
    status: membership.status,
    invitedBy: membership.invitedByPrincipalId ?? '-',
    created: new Date(membership.createdAt).toLocaleDateString(),
  };
}

// ============================================================================
// HANDLERS — tenant lifecycle
// ============================================================================

async function handleList(client: OmniClient, options: ReasonOption): Promise<void> {
  const reason = requireReason(options.reason, 'list tenants');
  const result = await client.platform.tenants.list(reason);
  output.list(result.items.map(formatTenantRow), {
    emptyMessage: 'No tenants found.',
    rawData: result.items,
  });
}

async function handleGet(client: OmniClient, id: string, options: ReasonOption): Promise<void> {
  const reason = requireReason(options.reason, 'read a tenant');
  const tenant = await client.platform.tenants.get(id, reason);
  output.data(tenant);
}

async function handleCreate(client: OmniClient, options: CreateOptions): Promise<void> {
  const reason = requireReason(options.reason, 'create a tenant');
  const tenant = await client.platform.tenants.create({
    slug: options.slug,
    displayName: options.name,
    maxKeyTtlSeconds: options.maxKeyTtl,
    maxKeyRateLimit: options.maxKeyRate,
    maxKeyBudget: options.maxKeyBudget,
    reason,
  });
  output.success(`Tenant created: ${tenant.slug} (${tenant.id})`);
  output.data(tenant);
}

async function handleSuspend(client: OmniClient, id: string, options: ReasonOption): Promise<void> {
  const reason = requireReason(options.reason, 'suspend a tenant');
  const tenant = await client.platform.tenants.suspend(id, reason);
  output.success(`Tenant suspended: ${tenant.slug} (${tenant.id})`);
  output.info(`Reason: ${reason}`);
}

async function handleArchive(client: OmniClient, id: string, options: ReasonOption): Promise<void> {
  const reason = requireReason(options.reason, 'archive a tenant');
  const tenant = await client.platform.tenants.archive(id, reason);
  output.success(`Tenant archived: ${tenant.slug} (${tenant.id})`);
  output.warn('Archived is terminal — there is no un-archive and no hard delete.');
  output.info(`Reason: ${reason}`);
}

// ============================================================================
// HANDLERS — memberships
// ============================================================================

async function handleMembershipsList(client: OmniClient, tenantId: string, options: ReasonOption): Promise<void> {
  const reason = requireReason(options.reason, 'list memberships');
  const result = await client.platform.tenants.memberships.list(tenantId, reason);
  output.list(result.items.map(formatMembershipRow), {
    emptyMessage: 'No memberships found.',
    rawData: result.items,
  });
}

async function handleMembershipsAdd(
  client: OmniClient,
  tenantId: string,
  options: MembershipAddOptions,
): Promise<void> {
  const reason = requireReason(options.reason, 'attach a membership');
  const role = parseRole(options.role);
  const membership = await client.platform.tenants.memberships.attach(tenantId, {
    principalId: options.principal,
    role,
    reason,
  });
  output.success(`Membership attached: ${membership.principalId} as ${membership.role} (${membership.id})`);
}

async function handleMembershipsDisable(
  client: OmniClient,
  tenantId: string,
  membershipId: string,
  options: ReasonOption,
): Promise<void> {
  const reason = requireReason(options.reason, 'disable a membership');
  const membership = await client.platform.tenants.memberships.disable(tenantId, membershipId, reason);
  output.success(`Membership disabled: ${membership.id}`);
  output.info(`Reason: ${reason}`);
}

async function handleMembershipsStatus(
  client: OmniClient,
  tenantId: string,
  membershipId: string,
  options: MembershipStatusOptions,
): Promise<void> {
  const reason = requireReason(options.reason, 'set a membership status');
  const status = parseStatus(options.status);
  const membership = await client.platform.tenants.memberships.setStatus(tenantId, membershipId, status, reason);
  output.success(`Membership ${membership.id} status set to ${membership.status}`);
}

async function handleMembershipsRole(
  client: OmniClient,
  tenantId: string,
  membershipId: string,
  options: MembershipRoleOptions,
): Promise<void> {
  const reason = requireReason(options.reason, 'set a membership role');
  const role = parseRole(options.role);
  const membership = await client.platform.tenants.memberships.setRole(tenantId, membershipId, role, reason);
  output.success(`Membership ${membership.id} role set to ${membership.role}`);
}

// ============================================================================
// COMMAND
// ============================================================================

const REASON_HELP = 'Audited justification (required, 3-500 chars)';

export function createTenantsCommand(): Command {
  const tenants = new Command('tenants').description(
    'Platform tenant control plane (requires a PLATFORM-class credential and OMNI_MULTITENANCY_ENABLED=true)',
  );

  tenants
    .command('list')
    .description('List tenants, newest first (the read itself is audited)')
    .option('--reason <text>', REASON_HELP)
    .action(async (options: ReasonOption) => {
      const client = getClient();
      try {
        await handleList(client, options);
      } catch (err) {
        renderPlatformError(err, 'list tenants');
      }
    });

  tenants
    .command('get <id>')
    .description('Get one tenant by id')
    .option('--reason <text>', REASON_HELP)
    .action(async (id: string, options: ReasonOption) => {
      const client = getClient();
      try {
        await handleGet(client, id, options);
      } catch (err) {
        renderPlatformError(err, 'get the tenant');
      }
    });

  tenants
    .command('create')
    .description('Create a tenant with its mandatory credential ceilings')
    .requiredOption('--slug <slug>', 'Immutable lowercase DNS-like slug (e.g. acme)')
    .requiredOption('--name <name>', 'Human-readable tenant name')
    .requiredOption('--max-key-ttl <seconds>', 'Ceiling for credential TTL, in seconds', Number.parseInt)
    .requiredOption('--max-key-rate <n>', 'Ceiling for credential rate limit', Number.parseInt)
    .requiredOption('--max-key-budget <n>', 'Ceiling for credential budget', Number.parseInt)
    .option('--reason <text>', REASON_HELP)
    .action(async (options: CreateOptions) => {
      const client = getClient();
      try {
        await handleCreate(client, options);
      } catch (err) {
        renderPlatformError(err, 'create the tenant');
      }
    });

  tenants
    .command('suspend <id>')
    .description('Suspend a tenant (bumps its revocation epoch, invalidating tenant credentials)')
    .option('--reason <text>', REASON_HELP)
    .action(async (id: string, options: ReasonOption) => {
      const client = getClient();
      try {
        await handleSuspend(client, id, options);
      } catch (err) {
        renderPlatformError(err, 'suspend the tenant');
      }
    });

  tenants
    .command('archive <id>')
    .description('Archive a tenant (TERMINAL — no un-archive, no hard delete)')
    .option('--reason <text>', REASON_HELP)
    .action(async (id: string, options: ReasonOption) => {
      const client = getClient();
      try {
        await handleArchive(client, id, options);
      } catch (err) {
        renderPlatformError(err, 'archive the tenant');
      }
    });

  const memberships = new Command('memberships').description('Manage tenant memberships');

  memberships
    .command('list <tenant-id>')
    .description('List the memberships of one tenant (the read itself is audited)')
    .option('--reason <text>', REASON_HELP)
    .action(async (tenantId: string, options: ReasonOption) => {
      const client = getClient();
      try {
        await handleMembershipsList(client, tenantId, options);
      } catch (err) {
        renderPlatformError(err, 'list memberships');
      }
    });

  memberships
    .command('add <tenant-id>')
    .description('Grant a principal a role in the tenant')
    .requiredOption('--principal <uuid>', 'Principal to grant access to')
    .requiredOption('--role <role>', `Tenant role: ${TENANT_ROLES.join(' | ')}`)
    .option('--reason <text>', REASON_HELP)
    .action(async (tenantId: string, options: MembershipAddOptions) => {
      const client = getClient();
      try {
        await handleMembershipsAdd(client, tenantId, options);
      } catch (err) {
        renderPlatformError(err, 'attach the membership');
      }
    });

  memberships
    .command('disable <tenant-id> <membership-id>')
    .description('Disable a membership (memberships are never hard-deleted)')
    .option('--reason <text>', REASON_HELP)
    .action(async (tenantId: string, membershipId: string, options: ReasonOption) => {
      const client = getClient();
      try {
        await handleMembershipsDisable(client, tenantId, membershipId, options);
      } catch (err) {
        renderPlatformError(err, 'disable the membership');
      }
    });

  memberships
    .command('status <tenant-id> <membership-id>')
    .description('Activate or disable an existing membership')
    .requiredOption('--status <status>', `New status: ${MEMBERSHIP_STATUSES.join(' | ')}`)
    .option('--reason <text>', REASON_HELP)
    .action(async (tenantId: string, membershipId: string, options: MembershipStatusOptions) => {
      const client = getClient();
      try {
        await handleMembershipsStatus(client, tenantId, membershipId, options);
      } catch (err) {
        renderPlatformError(err, 'set the membership status');
      }
    });

  memberships
    .command('role <tenant-id> <membership-id>')
    .description('Change the role an existing membership acts under')
    .requiredOption('--role <role>', `New role: ${TENANT_ROLES.join(' | ')}`)
    .option('--reason <text>', REASON_HELP)
    .action(async (tenantId: string, membershipId: string, options: MembershipRoleOptions) => {
      const client = getClient();
      try {
        await handleMembershipsRole(client, tenantId, membershipId, options);
      } catch (err) {
        renderPlatformError(err, 'set the membership role');
      }
    });

  tenants.addCommand(memberships);

  return tenants;
}

/**
 * Exported for tests — lets us exercise reason enforcement, SDK-call mapping,
 * and control-plane error rendering without reaching into Commander internals.
 */
export const __testables = {
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
};
