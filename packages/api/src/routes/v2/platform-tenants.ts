/**
 * Platform control-plane routes — tenant lifecycle + memberships
 * (wish: omni-full-multitenancy, Group G1; ADR-0005).
 *
 * MOUNTED ONLY when `OMNI_MULTITENANCY_ENABLED === "true"`. When the flag is
 * off, this router is never mounted, so the whole surface 404s and legacy
 * behavior is untouched.
 *
 * Every route requires a PLATFORM-class credential with an explicit scope
 * (`platformAuthMiddleware`). Tenant credentials, legacy tenant-like headers/
 * body/path claims, and normal data-plane keys are denied. Every state change
 * requires a `reason` and writes an append-only platform audit row.
 *
 * There is intentionally NO DELETE route — hard tenant delete is unavailable.
 */

import { zValidator } from '@hono/zod-validator';
import type { TenantRole } from '@omni/db';
import { tenantRoles } from '@omni/db';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { platformAuthMiddleware } from '../../middleware/platform-auth';
import type { PlatformActor } from '../../services/tenant-control-plane';
import { type PlatformAuthContext, bindPlatformOperation } from '../../tenancy/auth-context';
import type { AppVariables } from '../../types';

const SCOPE_TENANTS_READ = 'platform:tenants:read';
const SCOPE_TENANTS_WRITE = 'platform:tenants:write';
const SCOPE_MEMBERSHIPS_WRITE = 'platform:memberships:write';
const SCOPE_TENANT_KEYS_WRITE = 'platform:tenant-keys:write';

const reason = z.string().trim().min(3).max(500);
const idParam = z.object({ id: z.string().uuid() });
const membershipParam = z.object({ tenantId: z.string().uuid(), id: z.string().uuid() });
const reasonHeader = z.object({ 'x-platform-reason': reason });
const roleEnum = z.enum(tenantRoles as unknown as [TenantRole, ...TenantRole[]]);

function actorFrom(platform: PlatformAuthContext): PlatformActor {
  if (!platform.platformAction) throw new Error('platform action was not bound by the route');
  const principalId = platform.principalId;
  if (!principalId) throw new Error('platform principal was not bound by auth bootstrap');
  return {
    credentialClass: platform.credentialClass,
    principalId,
    credentialId: platform.credentialId,
    scopes: platform.scopes,
    platformApiKeyId: platform.platformApiKeyId,
    requestId: platform.requestId,
    platformAction: platform.platformAction,
    targetTenantId: platform.targetTenantId,
  };
}

export const platformTenantRoutes = new Hono<{ Variables: AppVariables }>();

// ── Tenant lifecycle ────────────────────────────────────────────────────────

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase DNS-like'),
  displayName: z.string().min(1).max(255),
  maxKeyTtlSeconds: z.number().int().positive().max(31_536_000),
  maxKeyRateLimit: z.number().int().positive(),
  maxKeyBudget: z.number().int().positive(),
  reason,
});

platformTenantRoutes.post(
  '/tenants',
  platformAuthMiddleware(SCOPE_TENANTS_WRITE, 'tenant.create'),
  zValidator('json', createTenantSchema),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const body = c.req.valid('json');
    const result = await c.get('services').tenantControlPlane.createTenant(
      {
        slug: body.slug,
        displayName: body.displayName,
        maxKeyTtlSeconds: body.maxKeyTtlSeconds,
        maxKeyRateLimit: body.maxKeyRateLimit,
        maxKeyBudget: body.maxKeyBudget,
        createdByPrincipalId: platform.principalId,
      },
      actorFrom(platform),
      body.reason,
    );
    if (result.status === 'conflict') return c.json({ error: { code: 'CONFLICT', message: result.message } }, 409);
    if (result.status === 'not_found') return c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    return c.json({ data: result.value }, 201);
  },
);

platformTenantRoutes.get(
  '/tenants',
  platformAuthMiddleware(SCOPE_TENANTS_READ, 'tenant.list'),
  zValidator('header', reasonHeader),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const items = await c
      .get('services')
      .tenantControlPlane.listTenants(actorFrom(platform), c.req.valid('header')['x-platform-reason']);
    return c.json({ items });
  },
);

platformTenantRoutes.get(
  '/tenants/:id',
  platformAuthMiddleware(SCOPE_TENANTS_READ, 'tenant.read'),
  zValidator('param', idParam),
  zValidator('header', reasonHeader),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const operation = bindPlatformOperation(platform, 'tenant.read', id);
    const tenant = await c
      .get('services')
      .tenantControlPlane.getTenant(id, actorFrom(operation), c.req.valid('header')['x-platform-reason']);
    // Non-enumerating: unknown id yields a bare 404 with no metadata.
    if (!tenant) return c.json({ error: { code: 'NOT_FOUND', message: 'tenant not found' } }, 404);
    return c.json({ data: tenant });
  },
);

const reasonBody = z.object({ reason });

platformTenantRoutes.post(
  '/tenants/:id/suspend',
  platformAuthMiddleware(SCOPE_TENANTS_WRITE, 'tenant.suspend'),
  zValidator('param', idParam),
  zValidator('json', reasonBody),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const operation = bindPlatformOperation(platform, 'tenant.suspend', id);
    const result = await c
      .get('services')
      .tenantControlPlane.suspendTenant(id, c.req.valid('json').reason, actorFrom(operation));
    return lifecycleResponse(c, result);
  },
);

platformTenantRoutes.post(
  '/tenants/:id/archive',
  platformAuthMiddleware(SCOPE_TENANTS_WRITE, 'tenant.archive'),
  zValidator('param', idParam),
  zValidator('json', reasonBody),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const operation = bindPlatformOperation(platform, 'tenant.archive', id);
    const result = await c
      .get('services')
      .tenantControlPlane.archiveTenant(id, c.req.valid('json').reason, actorFrom(operation));
    return lifecycleResponse(c, result);
  },
);

// ── Memberships ─────────────────────────────────────────────────────────────

platformTenantRoutes.get(
  '/tenants/:id/memberships',
  platformAuthMiddleware(SCOPE_TENANTS_READ, 'membership.list'),
  zValidator('param', idParam),
  zValidator('header', reasonHeader),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const operation = bindPlatformOperation(platform, 'membership.list', id);
    const items = await c
      .get('services')
      .tenantControlPlane.listMemberships(id, actorFrom(operation), c.req.valid('header')['x-platform-reason']);
    return c.json({ items });
  },
);

const attachSchema = z.object({ principalId: z.string().uuid(), role: roleEnum, reason });

platformTenantRoutes.post(
  '/tenants/:id/memberships',
  platformAuthMiddleware(SCOPE_MEMBERSHIPS_WRITE, 'membership.attach'),
  zValidator('param', idParam),
  zValidator('json', attachSchema),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const operation = bindPlatformOperation(platform, 'membership.attach', id);
    const result = await c
      .get('services')
      .tenantControlPlane.attachMembership(
        { tenantId: id, principalId: body.principalId, role: body.role, invitedByPrincipalId: platform.principalId },
        actorFrom(operation),
        body.reason,
      );
    if (result.status === 'ok') return c.json({ data: result.value }, 201);
    return lifecycleResponse(c, result);
  },
);

platformTenantRoutes.post(
  '/tenants/:tenantId/memberships/:id/disable',
  platformAuthMiddleware(SCOPE_MEMBERSHIPS_WRITE, 'membership.detach'),
  zValidator('param', membershipParam),
  zValidator('json', reasonBody),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { tenantId, id } = c.req.valid('param');
    const operation = bindPlatformOperation(platform, 'membership.detach', tenantId);
    const result = await c
      .get('services')
      .tenantControlPlane.detachMembership(id, c.req.valid('json').reason, actorFrom(operation));
    return lifecycleResponse(c, result);
  },
);

const statusSchema = z.object({ status: z.enum(['active', 'disabled']), reason });

platformTenantRoutes.post(
  '/tenants/:tenantId/memberships/:id/status',
  platformAuthMiddleware(SCOPE_MEMBERSHIPS_WRITE, 'membership.status'),
  zValidator('param', membershipParam),
  zValidator('json', statusSchema),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { tenantId, id } = c.req.valid('param');
    const body = c.req.valid('json');
    const operation = bindPlatformOperation(platform, 'membership.status', tenantId);
    const result = await c
      .get('services')
      .tenantControlPlane.setMembershipStatus(id, body.status, body.reason, actorFrom(operation));
    return lifecycleResponse(c, result);
  },
);

const roleSchema = z.object({ role: roleEnum, reason });

platformTenantRoutes.post(
  '/tenants/:tenantId/memberships/:id/role',
  platformAuthMiddleware(SCOPE_MEMBERSHIPS_WRITE, 'membership.role'),
  zValidator('param', membershipParam),
  zValidator('json', roleSchema),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { tenantId, id } = c.req.valid('param');
    const body = c.req.valid('json');
    const operation = bindPlatformOperation(platform, 'membership.role', tenantId);
    const result = await c
      .get('services')
      .tenantControlPlane.setMembershipRole(id, body.role, body.reason, actorFrom(operation));
    return lifecycleResponse(c, result);
  },
);

// ── Root key issuance (#979) ────────────────────────────────────────────────

const issueRootKeySchema = z.object({
  principalId: z.string().uuid(),
  membershipId: z.string().uuid(),
  role: roleEnum,
  name: z.string().min(1).max(255),
  /** Explicit scopes only. `issueRootKey` refuses platform/wildcard authority. */
  scopes: z.array(z.string().min(1)).min(1),
  expiresAt: z.string().datetime({ offset: true }),
  rateLimit: z.number().int().positive(),
  budget: z.number().int().positive(),
  resourceConstraints: z.record(z.array(z.string())).optional(),
  reason,
});

/**
 * Issue the initial tenant ROOT key for a membership. Pure wiring over the
 * already-transactional `TenantKeyService.issueRootKey`, which enforces every
 * invariant under `FOR UPDATE`: actor freshness, tenant active + policy
 * ceilings, principal/membership/role subject binding, and the refusal of
 * platform/wildcard scopes. The route only shapes errors — non-enumerating —
 * and returns the plaintext exactly once. It never logs it.
 *
 * The route scope is `platform:tenant-keys:write`; the service additionally
 * requires the credential to carry `platform:tenants:write`, so issuance needs
 * both authorities.
 */
platformTenantRoutes.post(
  '/tenants/:id/keys/root',
  platformAuthMiddleware(SCOPE_TENANT_KEYS_WRITE, 'tenant_key.issue_root'),
  zValidator('param', idParam),
  zValidator('json', issueRootKeySchema),
  async (c) => {
    const platform = c.get('platformAuth');
    if (!platform) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Platform credential required' } }, 401);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const operation = bindPlatformOperation(platform, 'tenant_key.issue_root', id);
    try {
      const { lineage, plainTextKey } = await c.get('services').tenantKeys.issueRootKey({
        actor: operation,
        tenantId: id,
        actorRole: body.role,
        name: body.name,
        reason: body.reason,
        scopes: body.scopes,
        principalId: body.principalId,
        membershipId: body.membershipId,
        ...(body.resourceConstraints ? { resourceConstraints: body.resourceConstraints } : {}),
        expiresAt: new Date(body.expiresAt),
        rateLimit: body.rateLimit,
        budget: body.budget,
      });
      // An explicit projection, never the lineage row: the credential index row
      // carries hashes, and a spread would publish whatever lands there next.
      return c.json(
        {
          data: {
            id: lineage.id,
            tenantId: lineage.tenantId,
            principalId: lineage.principalId,
            membershipId: lineage.membershipId,
            name: lineage.name,
            role: lineage.actorRole,
            scopes: lineage.scopes,
            constraints: lineage.resourceConstraints ?? {},
            delegationDepth: lineage.depth,
            expiresAt: lineage.expiresAt,
            rateLimit: lineage.rateLimit,
            budget: lineage.budget,
            /** Returned ONCE. Never persisted or logged by the caller. */
            plainTextKey,
          },
        },
        201,
      );
    } catch (err) {
      const mapped = rootIssuanceFailureResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }
  },
);

/**
 * Map `issueRootKey` failures to non-enumerating 4xx responses.
 *
 * An unknown tenant and an ineligible subject (cross-tenant or inactive
 * principal/membership, role mismatch) collapse into the SAME bare 404 — the
 * service already makes cross-tenant membership indistinguishable from absence,
 * and this keeps the route from re-opening that oracle. Anything unrecognised
 * re-throws to the 500 handler rather than guessing a status.
 */
function rootIssuanceFailureResponse(c: Context<{ Variables: AppVariables }>, err: unknown): Response | null {
  if (!(err instanceof Error)) return null;
  const message = err.message;
  if (message === 'tenant not found' || message.startsWith('invalid root key subject:')) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
  }
  if (message.startsWith('tenant is ')) {
    return c.json({ error: { code: 'CONFLICT', message: 'tenant is not active' } }, 409);
  }
  if (message.startsWith('invalid root key request:')) {
    // Reflects only the caller's own input (scopes/expiry/limits), never state.
    return c.json({ error: { code: 'VALIDATION_ERROR', message } }, 400);
  }
  if (message.startsWith('root key exceeds tenant policy:')) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'root key exceeds tenant policy' } }, 403);
  }
  if (message.startsWith('unauthorized root key issuer:') || message.startsWith('root key issuance')) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Platform credential with required scope required' } }, 403);
  }
  return null;
}

function lifecycleResponse(
  c: Context<{ Variables: AppVariables }>,
  result: { status: string; value?: unknown; message?: string },
): Response {
  if (result.status === 'ok') return c.json({ data: result.value });
  if (result.status === 'not_found') return c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
  return c.json({ error: { code: 'CONFLICT', message: result.message ?? 'conflict' } }, 409);
}
