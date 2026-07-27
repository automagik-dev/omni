/**
 * OpenAPI schemas for the platform control plane
 * (wish: omni-full-multitenancy, Group G1; ADR-0005).
 *
 * WHY THESE ARE DOCUMENTED AT ALL
 * -------------------------------
 * The repository rule is "no REST endpoints without OpenAPI docs", and it has no
 * exception for flag-gated surfaces: `routes/v2/platform-tenants.ts` serves ten
 * real endpoints, so ten operations belong in the document. Gating changes WHEN
 * they answer, not WHETHER they exist. Every operation below therefore states
 * the flag gate in its description, so a reader of the document knows a 404
 * here means "flag off", not "wrong URL".
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * Nothing credential-class is documented, because nothing credential-class is
 * returned. The routes return `tenants` and `tenant_memberships` rows, which
 * hold policy/lifecycle metadata and principal references — no key material, no
 * digests, no auth-plane secrets. `__tests__/openapi-credential-exposure.test.ts`
 * pins the exposure contract on `POST /auth/validate`; the schemas here stay on
 * the safe side of it by construction, and the `platformApiKeyId` /
 * `principalId` values that appear are opaque identifiers the caller already
 * supplied or already owns.
 *
 * Paths are registered RELATIVE to the `/api/v2` server URL (the router is
 * mounted at `/api/v2/platform`), matching every other schema module — see the
 * note in `auth.ts` about double-prefixed paths defeating `annotateScopes`.
 *
 * There is intentionally no DELETE operation: hard tenant delete does not exist.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { MembershipStatus, TenantRole, TenantStatus } from '@omni/db';
import { membershipStatuses, tenantRoles, tenantStatuses } from '@omni/db';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const TAG = 'Platform';

/**
 * The role/status vocabularies come from `@omni/db`, not from a hand-copied
 * literal list. A hand-copied list is exactly how a document starts lying:
 * `tenant-owner` was missing from the first draft of this file, and nothing
 * would have caught it.
 */
const asTuple = <T extends string>(values: readonly T[]): [T, ...T[]] => values as unknown as [T, ...T[]];

/** Shared prose appended to every operation: the flag gate is part of the contract. */
const GATE_NOTE =
  'Platform control plane. Mounted only when `OMNI_MULTITENANCY_ENABLED=true`; when the flag is off the ' +
  'entire surface returns 404. Requires a PLATFORM-class credential with the listed scope — tenant and ' +
  'legacy data-plane keys are denied. Every state change requires a reason and writes an append-only ' +
  'platform audit row.';

const tenantRoleEnum = z.enum(asTuple<TenantRole>(tenantRoles)).openapi({ description: 'Tenant role' });
const tenantStatusEnum = z
  .enum(asTuple<TenantStatus>(tenantStatuses))
  .openapi({ description: 'Tenant lifecycle status' });
const membershipStatusEnum = z
  .enum(asTuple<MembershipStatus>(membershipStatuses))
  .openapi({ description: 'Membership status' });

/**
 * A tenant record, as returned by the control plane.
 *
 * Mirrors the `tenants` table. `policyVersion` / `revocationEpoch` are the
 * freshness epochs snapshotted into credentials; they are counters, not secrets.
 */
export const PlatformTenantSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Tenant id' }),
  slug: z.string().openapi({ description: 'Immutable lowercase DNS-like slug', example: 'acme' }),
  displayName: z.string().openapi({ description: 'Human-readable tenant name' }),
  status: tenantStatusEnum,
  policyVersion: z.number().int().openapi({ description: 'Policy epoch, bumped on policy change' }),
  revocationEpoch: z.number().int().openapi({ description: 'Revocation epoch, bumped on suspend/archive' }),
  maxKeyTtlSeconds: z.number().int().openapi({ description: 'Ceiling for credential TTL, in seconds' }),
  maxKeyRateLimit: z.number().int().openapi({ description: 'Ceiling for credential rate limit' }),
  maxKeyBudget: z.number().int().openapi({ description: 'Ceiling for credential budget' }),
  createdByPrincipalId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: 'Creator principal, or null for bootstrap/system tenants' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
  suspendedAt: z.string().datetime().nullable().openapi({ description: 'When the tenant was suspended, if ever' }),
  archivedAt: z.string().datetime().nullable().openapi({ description: 'When the tenant was archived, if ever' }),
});

/** A tenant membership record, as returned by the control plane. */
export const PlatformMembershipSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Membership id' }),
  tenantId: z.string().uuid().openapi({ description: 'Tenant the membership belongs to' }),
  principalId: z.string().uuid().openapi({ description: 'Principal granted access' }),
  role: tenantRoleEnum,
  status: membershipStatusEnum,
  invitedByPrincipalId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: 'Principal that granted the membership, when known' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
  disabledAt: z.string().datetime().nullable().openapi({ description: 'When the membership was disabled, if ever' }),
});

const reasonField = z
  .string()
  .min(3)
  .max(500)
  .openapi({ description: 'Audited justification for the change', example: 'onboarding request OPS-1421' });

export const CreateTenantRequestSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .openapi({ description: 'Immutable lowercase DNS-like slug', example: 'acme' }),
  displayName: z.string().min(1).max(255).openapi({ description: 'Human-readable tenant name' }),
  maxKeyTtlSeconds: z
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .openapi({ description: 'Ceiling for credential TTL, in seconds' }),
  maxKeyRateLimit: z.number().int().positive().openapi({ description: 'Ceiling for credential rate limit' }),
  maxKeyBudget: z.number().int().positive().openapi({ description: 'Ceiling for credential budget' }),
  reason: reasonField,
});

export const AttachMembershipRequestSchema = z.object({
  principalId: z.string().uuid().openapi({ description: 'Principal to grant access to' }),
  role: tenantRoleEnum,
  reason: reasonField,
});

export const MembershipStatusRequestSchema = z.object({
  status: membershipStatusEnum.openapi({ description: 'Target membership status' }),
  reason: reasonField,
});

export const MembershipRoleRequestSchema = z.object({ role: tenantRoleEnum, reason: reasonField });

const ReasonRequestSchema = z.object({ reason: reasonField });

/**
 * `x-platform-reason` is a REQUIRED header on the read operations.
 *
 * Reads are audited too — "who looked at the tenant list, and why" is part of
 * the platform audit trail — so the reason travels in a header rather than a
 * body the verb does not have.
 */
const reasonHeaderSchema = z.object({
  'x-platform-reason': reasonField.openapi({ description: 'Audited justification for the read' }),
});

const tenantIdParam = z.object({ id: z.string().uuid().openapi({ description: 'Tenant id' }) });
const membershipParams = z.object({
  tenantId: z.string().uuid().openapi({ description: 'Tenant id' }),
  id: z.string().uuid().openapi({ description: 'Membership id' }),
});

const unauthorized = {
  description: 'Missing, non-platform, or insufficiently scoped credential',
  content: { 'application/json': { schema: ErrorSchema } },
};
const notFound = {
  description: 'Not found. Non-enumerating: an unknown id yields a bare 404 with no metadata.',
  content: { 'application/json': { schema: ErrorSchema } },
};
const conflict = {
  description: 'Lifecycle conflict (e.g. duplicate slug, or a transition out of the terminal archived state)',
  content: { 'application/json': { schema: ErrorSchema } },
};

/**
 * Register platform control-plane schemas and paths with the given registry.
 */
export function registerPlatformTenantSchemas(registry: OpenAPIRegistry): void {
  registry.register('PlatformTenant', PlatformTenantSchema);
  registry.register('PlatformMembership', PlatformMembershipSchema);
  registry.register('CreateTenantRequest', CreateTenantRequestSchema);
  registry.register('AttachMembershipRequest', AttachMembershipRequestSchema);

  // ── Tenant lifecycle ──────────────────────────────────────────────────────

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants',
    operationId: 'createPlatformTenant',
    tags: [TAG],
    summary: 'Create a tenant',
    description: `Create a tenant with its mandatory credential ceilings. ${GATE_NOTE} Scope: \`platform:tenants:write\`.`,
    request: { body: { content: { 'application/json': { schema: CreateTenantRequestSchema } } } },
    responses: {
      201: {
        description: 'Tenant created',
        content: { 'application/json': { schema: z.object({ data: PlatformTenantSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/platform/tenants',
    operationId: 'listPlatformTenants',
    tags: [TAG],
    summary: 'List tenants',
    description: `List tenants, newest first. The read itself is audited. ${GATE_NOTE} Scope: \`platform:tenants:read\`.`,
    request: { headers: reasonHeaderSchema },
    responses: {
      200: {
        description: 'Tenants',
        content: { 'application/json': { schema: z.object({ items: z.array(PlatformTenantSchema) }) } },
      },
      401: unauthorized,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/platform/tenants/{id}',
    operationId: 'getPlatformTenant',
    tags: [TAG],
    summary: 'Get a tenant',
    description: `Fetch one tenant. The read itself is audited. ${GATE_NOTE} Scope: \`platform:tenants:read\`.`,
    request: { params: tenantIdParam, headers: reasonHeaderSchema },
    responses: {
      200: {
        description: 'Tenant',
        content: { 'application/json': { schema: z.object({ data: PlatformTenantSchema }) } },
      },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{id}/suspend',
    operationId: 'suspendPlatformTenant',
    tags: [TAG],
    summary: 'Suspend a tenant',
    description: `Suspend a tenant and bump its revocation epoch, which invalidates the tenant’s credentials on their next auth-bootstrap lookup. ${GATE_NOTE} Scope: \`platform:tenants:write\`.`,
    request: { params: tenantIdParam, body: { content: { 'application/json': { schema: ReasonRequestSchema } } } },
    responses: {
      200: {
        description: 'Tenant suspended',
        content: { 'application/json': { schema: z.object({ data: PlatformTenantSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{id}/archive',
    operationId: 'archivePlatformTenant',
    tags: [TAG],
    summary: 'Archive a tenant',
    description: `Archive a tenant. Archived is TERMINAL — there is no un-archive and no hard delete anywhere on this surface. ${GATE_NOTE} Scope: \`platform:tenants:write\`.`,
    request: { params: tenantIdParam, body: { content: { 'application/json': { schema: ReasonRequestSchema } } } },
    responses: {
      200: {
        description: 'Tenant archived',
        content: { 'application/json': { schema: z.object({ data: PlatformTenantSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  // ── Memberships ───────────────────────────────────────────────────────────

  registry.registerPath({
    method: 'get',
    path: '/platform/tenants/{id}/memberships',
    operationId: 'listPlatformMemberships',
    tags: [TAG],
    summary: 'List tenant memberships',
    description: `List the memberships of one tenant. The read itself is audited. ${GATE_NOTE} Scope: \`platform:tenants:read\`.`,
    request: { params: tenantIdParam, headers: reasonHeaderSchema },
    responses: {
      200: {
        description: 'Memberships',
        content: { 'application/json': { schema: z.object({ items: z.array(PlatformMembershipSchema) }) } },
      },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{id}/memberships',
    operationId: 'attachPlatformMembership',
    tags: [TAG],
    summary: 'Attach a membership',
    description: `Grant a principal a role in the tenant. ${GATE_NOTE} Scope: \`platform:memberships:write\`.`,
    request: {
      params: tenantIdParam,
      body: { content: { 'application/json': { schema: AttachMembershipRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Membership attached',
        content: { 'application/json': { schema: z.object({ data: PlatformMembershipSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{tenantId}/memberships/{id}/disable',
    operationId: 'disablePlatformMembership',
    tags: [TAG],
    summary: 'Disable a membership',
    description: `Detach a principal from the tenant by disabling the membership. Memberships are never hard-deleted. ${GATE_NOTE} Scope: \`platform:memberships:write\`.`,
    request: { params: membershipParams, body: { content: { 'application/json': { schema: ReasonRequestSchema } } } },
    responses: {
      200: {
        description: 'Membership disabled',
        content: { 'application/json': { schema: z.object({ data: PlatformMembershipSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{tenantId}/memberships/{id}/status',
    operationId: 'setPlatformMembershipStatus',
    tags: [TAG],
    summary: 'Set membership status',
    description: `Activate or disable an existing membership. ${GATE_NOTE} Scope: \`platform:memberships:write\`.`,
    request: {
      params: membershipParams,
      body: { content: { 'application/json': { schema: MembershipStatusRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Membership status updated',
        content: { 'application/json': { schema: z.object({ data: PlatformMembershipSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/platform/tenants/{tenantId}/memberships/{id}/role',
    operationId: 'setPlatformMembershipRole',
    tags: [TAG],
    summary: 'Set membership role',
    description: `Change the role an existing membership acts under. ${GATE_NOTE} Scope: \`platform:memberships:write\`.`,
    request: {
      params: membershipParams,
      body: { content: { 'application/json': { schema: MembershipRoleRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Membership role updated',
        content: { 'application/json': { schema: z.object({ data: PlatformMembershipSchema }) } },
      },
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  });
}
