/**
 * API Key Management Routes
 *
 * CRUD operations for API keys with scope-based authorization.
 * Keys are used to authenticate agents and services with specific permissions.
 */

import { zValidator } from '@hono/zod-validator';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { ProfileResolutionError, type ResolveProfileInput, resolveProfile } from '../../lib/resolve-profile';
import { readSignedHostScopeContext } from '../../lib/signed-host-scope-context';
import { optionalDateParam } from '../../schemas/date-query';
import { ApiKeyService } from '../../services/api-keys';
import type { AppVariables } from '../../types';

export const keysRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * Non-admin profiles — `admin` is explicitly excluded at the route layer so
 * HTTP callers can never mint a god-key regardless of scope grants. Admin
 * keys are only mintable via the CLI's TTY-gated path.
 *
 * The three `console-*` profiles ARE HTTP-mintable by a `keys:write` caller:
 * the khal-ui BFF mints a per-user console key on every session, so minting
 * must work over HTTP. They are safe to mint because none of them carries the
 * `*` wildcard — each resolves to an explicit scope set bounded by SCOPE_MAP
 * (see `constants/profiles.ts`), unlike `admin` which is unbounded.
 */
const NON_ADMIN_PROFILES = [
  'cs',
  'personal',
  'scout',
  'coworker',
  'console-viewer',
  'console-operator',
  'console-admin',
] as const;
type NonAdminProfile = (typeof NON_ADMIN_PROFILES)[number];

// ============================================================================
// SCHEMAS
// ============================================================================

const profileOverridesSchema = z
  .object({
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
    denylistPresetKey: z.string().nullable().optional(),
    denylistExtras: z.array(z.string()).optional(),
  })
  .strict();

const createKeySchema = z
  .object({
    name: z.string().min(1).max(255).describe('Human-readable key name'),
    description: z.string().optional().describe('Key description'),
    scopes: z
      .array(z.string())
      .min(1)
      .optional()
      .describe('Permission scopes (ignored when a profile is supplied — scopes derive from the profile)'),
    instanceIds: z.array(z.string().uuid()).optional().describe('Restrict key to specific instance IDs'),
    rateLimit: z.number().int().positive().optional().describe('Rate limit in requests per minute'),
    expiresAt: z.string().datetime().optional().describe('Expiration timestamp (ISO 8601)'),
    // Profile-based key creation. `admin` is rejected unconditionally below.
    profile: z
      .enum(NON_ADMIN_PROFILES)
      .optional()
      .describe(
        'Profile template: cs, personal, scout, coworker, console-viewer, console-operator, console-admin. ' +
          'admin is CLI-only and rejected here.',
      ),
    overrides: profileOverridesSchema.optional().describe('Tenant overrides merged on top of the profile template'),
    chatAllowlist: z.array(z.string()).optional().describe('Chats this key may target (profile-aware semantics)'),
    instanceAllowlist: z.array(z.string().uuid()).optional().describe('Instances this key may target'),
    outboundRecipientAllowlist: z.array(z.string()).optional().describe('Outbound recipients this key may send to'),
    owner: z.string().optional().describe('Scout owner JID — forced into outboundRecipientAllowlist'),
    denylistPresetKey: z.string().optional().describe('Denylist preset key override for coworker'),
  })
  .passthrough();

const updateKeySchema = z.object({
  name: z.string().min(1).max(255).optional().describe('Human-readable key name'),
  description: z.string().nullable().optional().describe('Key description'),
  scopes: z.array(z.string()).min(1).optional().describe('Permission scopes'),
  instanceIds: z.array(z.string().uuid()).nullable().optional().describe('Instance ID restrictions (null = all)'),
  rateLimit: z.number().int().positive().nullable().optional().describe('Rate limit (null = default)'),
  expiresAt: z.string().datetime().nullable().optional().describe('Expiration timestamp (null = never)'),
});

const revokeKeySchema = z.object({
  reason: z.string().optional().describe('Reason for revocation'),
  revokedBy: z.string().optional().describe('Who revoked the key'),
});

const listQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'expired']).optional().describe('Filter by status'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Max results'),
});

const auditQuerySchema = z.object({
  since: optionalDateParam('since').describe('Filter logs from this timestamp'),
  until: optionalDateParam('until').describe('Filter logs until this timestamp'),
  path: z.string().optional().describe('Filter by request path (partial match)'),
  statusCode: z.coerce.number().int().optional().describe('Filter by HTTP status code'),
  limit: z.coerce.number().int().min(1).max(100).default(50).describe('Max results'),
  cursor: z.string().optional().describe('Pagination cursor'),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /keys - Create a new API key
 *
 * Admin-profile guard (runs BEFORE zod validation): rejects any body whose
 * `profile` is literally `"admin"` with 403 — regardless of `keys:write`
 * scope, regardless of any `operator_confirmed`-style bypass field.
 * Admin-key minting is CLI-only and human-gated; this route must never
 * mint one even for a fully privileged caller.
 */
keysRoutes.post(
  '/',
  async (c, next) => {
    // Intentionally peek the body before zod so `profile: "admin"` is refused
    // even if other fields would fail validation (e.g. missing name). Use the
    // Hono-cached `c.req.json()` (not `c.req.raw.clone().json()`): the
    // scope-enforcer middleware runs first in production and already consumed
    // the raw body stream, so cloning the raw request yields an unusable body
    // and the guard would silently fall through to zod. `c.req.json()` returns
    // the cached parse and fires reliably regardless of upstream reads.
    const raw = await c.req.json().catch(() => null);
    if (raw && typeof raw === 'object' && (raw as { profile?: unknown }).profile === 'admin') {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'admin keys cannot be created via HTTP — use the omni CLI on a TTY',
          },
        },
        403,
      );
    }
    await next();
  },
  zValidator('json', createKeySchema),
  async (c) => {
    const data = c.req.valid('json');
    const services = c.get('services');

    if (data.profile) {
      return handleProfileCreate(c, data, services);
    }
    return handleLegacyCreate(c, data, services);
  },
);

type CreateKeyData = z.infer<typeof createKeySchema>;
type CreateServices = AppVariables['services'];

function normalizeOverrides(overrides: CreateKeyData['overrides']): ResolveProfileInput['overrides'] {
  if (!overrides) return undefined;
  return {
    ...overrides,
    denylistPresetKey: overrides.denylistPresetKey === null ? undefined : overrides.denylistPresetKey,
  };
}

/** Return the common fail-closed response for malformed signed-host context. */
function invalidSignedHostScopeContextResponse(c: Context<{ Variables: AppVariables }>, hostId: string): Response {
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: 'Signing host scope context is missing.',
        host: hostId,
      },
    },
    403,
  );
}

/**
 * Least-privilege scope ceiling for key-management writes.
 *
 * A caller may only create or update a key whose scopes are a SUBSET of its
 * OWN scopes. Signed requests are authorized by the intersection of the bearer
 * and signing-host scopes, so the requested grant must be covered by BOTH.
 * `ApiKeyService.scopeAllows(authorizerScopes, requested)` is exactly the
 * covering relation we need:
 *   - a `*` authorizer (the real god-key / `admin` profile) covers every
 *     requested scope, so god-key minting and internal agent-provisioning keep
 *     working unchanged;
 *   - a concrete-scoped authorizer (e.g. `console-admin` or a narrowed signing
 *     host) covers a requested scope it holds — or one under a `ns:*` it holds
 *     — but does NOT cover `*` or a `ns:*` super-scope it lacks. So a bounded
 *     authority can never escalate to a god key or a whole-namespace grant.
 *
 * Returns a 403 `Response` listing the disallowed scopes, or `null` when every
 * requested scope is within every active authorizer's ceiling.
 */
function enforceScopeCeiling(c: Context<{ Variables: AppVariables }>, requestedScopes: string[]): Response | null {
  const authorizerScopeSets: string[][] = [c.get('apiKey')?.scopes ?? []];
  const signedHost = readSignedHostScopeContext(c);
  if (signedHost.kind === 'invalid') return invalidSignedHostScopeContextResponse(c, signedHost.hostId);
  if (signedHost.kind === 'valid') authorizerScopeSets.push(signedHost.scopes);
  const exceeding = requestedScopes.filter((scope) =>
    authorizerScopeSets.some((authorizerScopes) => !ApiKeyService.scopeAllows(authorizerScopes, scope)),
  );
  if (exceeding.length === 0) return null;
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: `Cannot grant scopes that exceed the caller's own. Disallowed: ${exceeding.join(', ')}`,
      },
    },
    403,
  );
}

async function handleProfileCreate(
  c: Context<{ Variables: AppVariables }>,
  data: CreateKeyData,
  services: CreateServices,
) {
  try {
    const resolved = resolveProfile({
      profile: data.profile as NonAdminProfile,
      chatAllowlist: data.chatAllowlist,
      instanceAllowlist: data.instanceAllowlist,
      outboundRecipientAllowlist: data.outboundRecipientAllowlist,
      owner: data.owner,
      overrides: normalizeOverrides(data.overrides),
      denylistPresetKey: data.denylistPresetKey,
    });

    // Enforce the mint ceiling on the RESOLVED profile scopes so a bounded
    // caller can't escalate by requesting a broader profile than it holds.
    const ceilingDenied = enforceScopeCeiling(c, resolved.scopes);
    if (ceilingDenied) return ceilingDenied;

    const result = await services.apiKeys.create({
      name: data.name,
      description: data.description,
      scopes: resolved.scopes,
      instanceIds: data.instanceIds,
      rateLimit: data.rateLimit,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      createdBy: c.get('apiKey')?.name,
      profile: resolved.profile,
      profileOverrides: resolved.profileOverrides,
      chatAllowlist: resolved.chatAllowlist,
      instanceAllowlist: resolved.instanceAllowlist,
      outboundRecipientAllowlist: resolved.outboundRecipientAllowlist,
    });

    return c.json({ data: { ...result.key, plainTextKey: result.plainTextKey } }, 201);
  } catch (err) {
    if (err instanceof ProfileResolutionError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.lock ? { details: { lock: err.lock } } : {}),
          },
        },
        400,
      );
    }
    throw err;
  }
}

async function handleLegacyCreate(
  c: Context<{ Variables: AppVariables }>,
  data: CreateKeyData,
  services: CreateServices,
) {
  if (!data.scopes || data.scopes.length === 0) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'scopes is required when no profile is supplied' } },
      400,
    );
  }

  // Enforce the mint ceiling: the requested scopes must be a subset of the
  // caller's own. Blocks a `console-admin` (or any concrete-scoped) caller from
  // minting `['*']` / a `ns:*` super-scope and using it as a one-hop god key.
  const ceilingDenied = enforceScopeCeiling(c, data.scopes);
  if (ceilingDenied) return ceilingDenied;

  const result = await services.apiKeys.create({
    name: data.name,
    description: data.description,
    scopes: data.scopes,
    instanceIds: data.instanceIds,
    rateLimit: data.rateLimit,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    createdBy: c.get('apiKey')?.name,
  });

  return c.json({ data: { ...result.key, plainTextKey: result.plainTextKey } }, 201);
}

/**
 * GET /keys - List all API keys
 */
keysRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { status, limit } = c.req.valid('query');
  const services = c.get('services');

  let items = await services.apiKeys.list();

  if (status) {
    items = items.filter((k) => k.status === status);
  }

  items = items.slice(0, limit);

  return c.json({
    items,
    meta: {
      total: items.length,
    },
  });
});

/**
 * GET /keys/:id - Get a single API key
 */
keysRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const key = await services.apiKeys.getById(id);
  if (!key) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  return c.json({ data: key });
});

/**
 * PATCH /keys/:id - Update an API key
 */
keysRoutes.patch('/:id', zValidator('json', updateKeySchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  // Updating an existing key is another scope-grant path. Apply the same
  // least-privilege ceiling as creation so a bounded keys:write caller cannot
  // PATCH its own (or another) key into a wildcard or broader namespace grant.
  if (data.scopes) {
    const ceilingDenied = enforceScopeCeiling(c, data.scopes);
    if (ceilingDenied) return ceilingDenied;
  }

  try {
    const updated = await services.apiKeys.update(id, {
      ...data,
      expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
    });

    if (!updated) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }

    return c.json({ data: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Cannot rename primary')) {
      return c.json({ error: { code: 'FORBIDDEN', message } }, 403);
    }
    throw error;
  }
});

/**
 * POST /keys/:id/revoke - Revoke an API key
 */
keysRoutes.post('/:id/revoke', zValidator('json', revokeKeySchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const revoked = await services.apiKeys.revoke(id, data.reason, data.revokedBy ?? c.get('apiKey')?.name);

  if (!revoked) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  return c.json({ data: revoked });
});

/**
 * DELETE /keys/:id - Permanently delete an API key
 */
keysRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  try {
    const deleted = await services.apiKeys.delete(id);
    if (!deleted) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }
    return c.json({ data: { deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('Cannot delete primary')) {
      return c.json({ error: { code: 'FORBIDDEN', message } }, 403);
    }
    throw error;
  }
});

/**
 * GET /keys/:id/audit - Get audit logs for an API key
 */
keysRoutes.get('/:id/audit', zValidator('query', auditQuerySchema), async (c) => {
  const id = c.req.param('id');
  const { since, until, path, statusCode, limit, cursor } = c.req.valid('query');
  const services = c.get('services');

  // Verify key exists
  const key = await services.apiKeys.getById(id);
  if (!key) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
  }

  const result = await services.audit.listByKeyId(id, {
    since,
    until,
    path,
    statusCode,
    limit,
    cursor,
  });

  return c.json({
    items: result.items,
    meta: {
      total: result.total,
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});
