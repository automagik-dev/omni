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
import { isLockActive } from '../../middleware/scope-enforcer';
import { optionalDateParam } from '../../schemas/date-query';
import { ApiKeyService } from '../../services/api-keys';
import type { TenantAuthContext } from '../../tenancy/auth-context';
import { scopeCovered } from '../../tenancy/delegation';
import { isTenantRole } from '../../tenancy/role-policies';
import type { ApiKeyData, AppVariables } from '../../types';

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
const KNOWN_API_KEY_PROFILES = new Set<string>(['admin', ...NON_ADMIN_PROFILES]);

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
    // Tenant delegation only (wish: omni-full-multitenancy, Group G4). Both are
    // ignored on the legacy paths, which destructure the fields they use rather
    // than spreading the body, so adding them changes no legacy behaviour.
    role: z.string().optional().describe('Tenant role for a delegated child key; may only narrow the parent role'),
    reason: z.string().optional().describe('Audit reason recorded on a delegated child key'),
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

    // Which service handles this is decided by the CREDENTIAL, not the body
    // (wish: omni-full-multitenancy, Group G4). A tenant credential delegates a
    // bounded child of its own lineage; anything else keeps the legacy path
    // byte-for-byte, because a legacy caller has no tenant context at all.
    const context = c.get('authContext');
    if (context) {
      return handleTenantChildCreate(c, data, services, context);
    }

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

/** `null` is unrestricted; an empty Set is an active deny-all restriction. */
interface InstanceAuthorityInput {
  instanceIds: readonly string[] | null;
  profile: Exclude<ApiKeyData['profile'], undefined>;
  instanceAllowlist: readonly string[];
}

type InstanceAuthority = ReadonlySet<string> | null;

interface DerivedInstanceAuthorities {
  /** Authority on routes guarded only by the route-specific legacy guard. */
  legacy: InstanceAuthority;
  /** Authority on historical legacy routes that skip checks for an empty list. */
  legacyEmptyInactive: InstanceAuthority;
  /** Authority on routes where both legacy and profile-aware guards apply. */
  effective: InstanceAuthority;
  /** Authority on routes guarded only by the global profile-aware enforcer. */
  profileAware: InstanceAuthority;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeInstanceIds(values: readonly string[]): ReadonlySet<string> {
  // PostgreSQL uuid/uuid[] values are case-insensitive and persist in canonical
  // lowercase form. Compare the same canonical representation before writing.
  return new Set(values.map((value) => value.toLowerCase()));
}

function intersectAuthorities(left: InstanceAuthority, right: InstanceAuthority): InstanceAuthority {
  if (left === null) return right;
  if (right === null) return left;
  return new Set([...left].filter((instanceId) => right.has(instanceId)));
}

function deriveInstanceAuthorities(input: InstanceAuthorityInput): DerivedInstanceAuthorities | null {
  // Context is runtime data despite its TypeScript type. Any missing or
  // malformed field is invalid rather than unrestricted, so writes fail closed.
  if (input.instanceIds !== null && !isStringArray(input.instanceIds)) return null;
  if (!isStringArray(input.instanceAllowlist)) return null;
  if (input.profile !== null && (typeof input.profile !== 'string' || !KNOWN_API_KEY_PROFILES.has(input.profile))) {
    return null;
  }

  const legacy = input.instanceIds === null ? null : normalizeInstanceIds(input.instanceIds);
  const legacyEmptyInactive = input.instanceIds === null || input.instanceIds.length === 0 ? null : legacy;
  const profileAware = isLockActive(input.profile, 'instanceAllowlist', input.instanceAllowlist)
    ? normalizeInstanceIds(input.instanceAllowlist)
    : null;

  return {
    legacy,
    legacyEmptyInactive,
    effective: intersectAuthorities(legacy, profileAware),
    profileAware,
  };
}

function isAuthoritySubset(requested: InstanceAuthority, allowed: InstanceAuthority): boolean {
  if (allowed === null) return true;
  if (requested === null) return false;
  return [...requested].every((instanceId) => allowed.has(instanceId));
}

interface ProfileAllowlistAuthorityInput {
  profile: Exclude<ApiKeyData['profile'], undefined>;
  chatAllowlist: readonly string[];
  outboundRecipientAllowlist: readonly string[];
}

interface ProfileAllowlistAuthorities {
  chat: InstanceAuthority;
  outboundRecipient: InstanceAuthority;
}

function deriveProfileAllowlistAuthorities(input: ProfileAllowlistAuthorityInput): ProfileAllowlistAuthorities | null {
  if (!isStringArray(input.chatAllowlist) || !isStringArray(input.outboundRecipientAllowlist)) return null;
  if (input.profile !== null && (typeof input.profile !== 'string' || !KNOWN_API_KEY_PROFILES.has(input.profile))) {
    return null;
  }

  return {
    chat: isLockActive(input.profile, 'chatAllowlist', input.chatAllowlist) ? new Set(input.chatAllowlist) : null,
    outboundRecipient: isLockActive(input.profile, 'outboundRecipientAllowlist', input.outboundRecipientAllowlist)
      ? new Set(input.outboundRecipientAllowlist)
      : null,
  };
}

/** Bound profile-aware chat and outbound-recipient reach on every key write. */
function enforceProfileAllowlistCeilings(
  c: Context<{ Variables: AppVariables }>,
  requestedAuthority: ProfileAllowlistAuthorityInput,
): Response | null {
  const apiKey = c.get('apiKey');
  if (
    !apiKey ||
    apiKey.profile === undefined ||
    !isStringArray(apiKey.chatAllowlist) ||
    !isStringArray(apiKey.outboundRecipientAllowlist)
  ) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: "Cannot grant chat or recipient access that exceeds the caller's own.",
        },
      },
      403,
    );
  }

  const callerAuthorities = deriveProfileAllowlistAuthorities({
    profile: apiKey.profile,
    chatAllowlist: apiKey.chatAllowlist,
    outboundRecipientAllowlist: apiKey.outboundRecipientAllowlist,
  });
  const childAuthorities = deriveProfileAllowlistAuthorities(requestedAuthority);
  const exceedsCaller =
    callerAuthorities === null ||
    childAuthorities === null ||
    !isAuthoritySubset(childAuthorities.chat, callerAuthorities.chat) ||
    !isAuthoritySubset(childAuthorities.outboundRecipient, callerAuthorities.outboundRecipient);

  if (!exceedsCaller) return null;
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: "Cannot grant chat or recipient access that exceeds the caller's own.",
      },
    },
    403,
  );
}

/**
 * Least-privilege ceiling for instance access on key-management writes.
 *
 * Legacy-only, profile-aware-only, and combined guard surfaces all exist. Some
 * historical legacy routes also skip checks for `instanceIds: []`, while the
 * canonical helper treats it as deny-all. A single intersection comparison is
 * therefore insufficient: bound every enforcement interpretation separately.
 */
function enforceInstanceCeiling(
  c: Context<{ Variables: AppVariables }>,
  requestedAuthority: InstanceAuthorityInput,
): Response | null {
  const apiKey = c.get('apiKey');
  if (!apiKey || apiKey.profile === undefined || !isStringArray(apiKey.instanceAllowlist)) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: "Cannot grant instance access that exceeds the caller's own.",
        },
      },
      403,
    );
  }
  const callerAuthorities = deriveInstanceAuthorities({
    instanceIds: apiKey.instanceIds,
    profile: apiKey.profile,
    instanceAllowlist: apiKey.instanceAllowlist,
  });
  const childAuthorities = deriveInstanceAuthorities(requestedAuthority);

  const exceedsCaller =
    callerAuthorities === null ||
    childAuthorities === null ||
    !isAuthoritySubset(childAuthorities.legacy, callerAuthorities.legacy) ||
    !isAuthoritySubset(childAuthorities.legacyEmptyInactive, callerAuthorities.legacyEmptyInactive) ||
    !isAuthoritySubset(childAuthorities.profileAware, callerAuthorities.profileAware) ||
    !isAuthoritySubset(childAuthorities.effective, callerAuthorities.effective);
  if (!exceedsCaller) return null;

  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: "Cannot grant instance access that exceeds the caller's own.",
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

    const instanceCeilingDenied = enforceInstanceCeiling(c, {
      instanceIds: data.instanceIds ?? null,
      profile: resolved.profile,
      instanceAllowlist: resolved.instanceAllowlist,
    });
    if (instanceCeilingDenied) return instanceCeilingDenied;

    const allowlistCeilingDenied = enforceProfileAllowlistCeilings(c, {
      profile: resolved.profile,
      chatAllowlist: resolved.chatAllowlist,
      outboundRecipientAllowlist: resolved.outboundRecipientAllowlist,
    });
    if (allowlistCeilingDenied) return allowlistCeilingDenied;

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

/**
 * Mint a bounded child of the caller's own tenant key lineage
 * (wish: omni-full-multitenancy, Group G4; ADR-0006).
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
 * -------------------------------------------
 * It does not read a tenant from anywhere. The actor is the frozen context the
 * edge constructed, the parent is that context's own lineage, and there is no
 * code path by which a body, header, or query value can name either. A
 * `tenantId` in the request body is simply never read.
 *
 * WHY PROFILES ARE REFUSED
 * ------------------------
 * A profile resolves to a legacy scope bundle with legacy allowlist semantics.
 * Feeding one into the delegation evaluator would have it check a ceiling
 * against scopes the tenant role policy never vetted — a bounded-looking key
 * shaped by the wrong rulebook. Tenant child keys are explicit-scope only.
 *
 * WHERE THE CEILING IS ENFORCED
 * -----------------------------
 * Twice, on purpose. `enforceScopeCeiling` refuses a scope the caller does not
 * hold before any transaction opens, which is the route-level enforcement the
 * WISH names and which makes a denial cost no database work.
 * `TenantKeyService.createChildKey` then re-derives EVERY ceiling — scope,
 * role, expiry, rate limit, budget, resource constraints, depth — from rows it
 * holds under `FOR UPDATE`, which is the boundary that actually decides. The
 * route check can only ever be narrower or equal; it is not trusted to be
 * sufficient.
 */
async function handleTenantChildCreate(
  c: Context<{ Variables: AppVariables }>,
  data: CreateKeyData,
  services: CreateServices,
  context: TenantAuthContext,
) {
  if (data.profile) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'profile-based keys are not available to a tenant credential — request explicit scopes',
        },
      },
      400,
    );
  }

  if (!data.scopes || data.scopes.length === 0) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'scopes is required' } }, 400);
  }

  if (data.role !== undefined && !isTenantRole(data.role)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'role is not a tenant role' } }, 400);
  }

  // The ceiling pre-check is done in the TENANT vocabulary, deliberately NOT
  // through `enforceScopeCeiling`. That helper authorizes against
  // `c.get('apiKey').scopes`, which for a tenant credential is the LEGACY
  // projection (`instances:read`, `messages:send`, …) that `scope-projection.ts`
  // built for the route enforcer. The scopes being delegated here are tenant
  // scopes (`tenant:read`, `keys:delegate`) — a different language. Feeding one
  // to the other rejects every well-formed delegation: an authorization bug in
  // the "denies everything" direction rather than "permits too much", which is
  // why it surfaced as a failing acceptance probe and not as a leak.
  //
  // `scopeCovered` is the SAME covering relation `evaluateDelegation` applies
  // inside the transaction, so this pre-check can only agree with the
  // authoritative one or be narrower. It is a cheap early denial, never the
  // decision.
  const exceeding = data.scopes.filter((scope) => !scopeCovered(context.scopes, scope));
  if (exceeding.length > 0) {
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

  // Only constraints the caller actually sent become part of the request. An
  // empty array is a REAL constraint ("nothing is allowed"), so it must not be
  // conflated with an absent one, which means "inherit the parent's".
  const resourceConstraints: Record<string, readonly string[]> = {};
  if (data.instanceAllowlist) resourceConstraints.instanceAllowlist = data.instanceAllowlist;
  if (data.chatAllowlist) resourceConstraints.chatAllowlist = data.chatAllowlist;
  if (data.outboundRecipientAllowlist) {
    resourceConstraints.outboundRecipientAllowlist = data.outboundRecipientAllowlist;
  }
  if (data.instanceIds) resourceConstraints.instanceIds = data.instanceIds;

  const result = await services.tenantKeys.createChildKey({
    actor: context,
    parentKeyId: context.tenantKeyLineageId,
    name: data.name,
    reason: data.reason ?? `child key delegated via POST /keys by ${context.actorRole}`,
    request: {
      scopes: data.scopes,
      ...(Object.keys(resourceConstraints).length > 0 ? { resourceConstraints } : {}),
      ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {}),
      ...(data.rateLimit !== undefined ? { rateLimit: data.rateLimit } : {}),
      ...(data.role ? { role: data.role } : {}),
    },
  });

  if (result.status === 'parent_not_found') {
    return c.json({ error: { code: 'NOT_FOUND', message: 'parent key not found' } }, 404);
  }
  if (result.status === 'denied') {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'delegation exceeds the parent key ceiling',
          details: { violations: result.violations },
        },
      },
      403,
    );
  }

  // An explicit projection, never the lineage row: the row carries `keyHash`,
  // and a spread would publish it the first time anyone forgot it was there.
  const { lineage, plainTextKey } = result.issued;
  return c.json(
    {
      data: {
        id: lineage.id,
        tenantId: lineage.tenantId,
        name: data.name,
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

  const instanceCeilingDenied = enforceInstanceCeiling(c, {
    instanceIds: data.instanceIds ?? null,
    profile: null,
    instanceAllowlist: [],
  });
  if (instanceCeilingDenied) return instanceCeilingDenied;

  const allowlistCeilingDenied = enforceProfileAllowlistCeilings(c, {
    profile: null,
    chatAllowlist: [],
    outboundRecipientAllowlist: [],
  });
  if (allowlistCeilingDenied) return allowlistCeilingDenied;

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

  const updateOptions = {
    ...data,
    expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
  };

  try {
    let authorityDenied: Response | null | undefined;
    const result = await services.apiKeys.updateWithAuthorityGuard(id, updateOptions, (_current, next) => {
      authorityDenied = enforceScopeCeiling(c, next.scopes);
      if (authorityDenied) return false;

      authorityDenied = enforceInstanceCeiling(c, {
        instanceIds: next.instanceIds,
        profile: next.profile,
        instanceAllowlist: next.instanceAllowlist,
      });
      if (authorityDenied) return false;

      authorityDenied = enforceProfileAllowlistCeilings(c, {
        profile: next.profile,
        chatAllowlist: next.chatAllowlist,
        outboundRecipientAllowlist: next.outboundRecipientAllowlist,
      });
      return authorityDenied == null;
    });

    if (result.status === 'denied') {
      return (
        authorityDenied ??
        c.json({ error: { code: 'FORBIDDEN', message: 'API key authority exceeds caller authority' } }, 403)
      );
    }
    if (result.status === 'not_found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404);
    }
    return c.json({ data: result.key });
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
