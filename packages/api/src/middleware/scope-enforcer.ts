/**
 * Scope enforcement middleware — deny-by-default authorization for all v2 routes.
 *
 * Runs AFTER authMiddleware (which sets c.get("apiKey")).
 * Matches METHOD + path against SCOPE_MAP, checks key scopes via ApiKeyService.scopeAllows().
 * Keys with "*" scope bypass the scope-map check. Unmapped routes get 403.
 *
 * In addition to scope checks this middleware applies three enforcement
 * primitives derived from the key's profile + allowlist columns:
 *   - chatAllowlist               — target chat/JID must appear in the list
 *   - instanceAllowlist           — target instance must appear in the list
 *   - outboundRecipientAllowlist  — outbound send recipient must appear in the list
 *
 * Empty-array semantics are profile-aware (see `isLockActive`):
 *   - profile === null                          → empty [] means "no lock" (legacy keys)
 *   - profile !== null and lock ∈ requiresLocks → empty [] means "deny all"
 *   - profile !== null and lock ∉ requiresLocks → empty [] means "no lock"
 *
 * 403 responses include the `lock` name and the `attempted` value to aid operator debugging.
 */

import { createLogger } from '@omni/core';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { LockRequirement, ProfileName } from '../constants/profiles';
import { PROFILES } from '../constants/profiles';
import { SCOPE_MAP } from '../constants/scopes';
import { readSignedHostScopeContext } from '../lib/signed-host-scope-context';
import { ApiKeyService } from '../services/api-keys';
import type { ApiKeyData, AppVariables } from '../types';

const log = createLogger('api:scope-enforcer');

type LockName = LockRequirement;

/** Result of an enforcement primitive. */
export interface EnforcementResult {
  allowed: boolean;
  reason?: 'not-in-allowlist' | 'deny-all-profile-requires-lock';
  attempted?: string;
}

/**
 * Build a regex that matches the static segments of a pattern path,
 * replacing :param segments with a non-slash matcher.
 */
function buildSegmentRegex(patternPath: string): RegExp {
  const escaped = patternPath
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

/** Check if a wildcard pattern (ending in /*) matches the path. */
function matchesWildcard(patternPath: string, cleanPath: string): boolean {
  const prefix = patternPath.slice(0, -2); // remove /*
  const prefixRegex = buildSegmentRegex(prefix);
  return prefixRegex.test(cleanPath) || new RegExp(`^${prefixRegex.source.slice(0, -1)}/.+$`).test(cleanPath);
}

/** Check if a parameterized pattern matches the path segment-by-segment. */
function matchesSegments(patternPath: string, cleanPath: string): boolean {
  const patternSegments = patternPath.split('/');
  const pathSegments = cleanPath.split('/');

  if (patternSegments.length !== pathSegments.length) return false;

  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i]?.startsWith(':')) continue;
    if (patternSegments[i] !== pathSegments[i]) return false;
  }
  return true;
}

/** Strip /api/v2 prefix and trailing slash from a request path. */
function normalizePath(path: string): string {
  const stripped = path.replace(/^\/api\/v2/, '');
  return stripped.endsWith('/') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
}

/**
 * Find the required scope for a given HTTP method + path by matching against SCOPE_MAP.
 */
function findRequiredScope(method: string, path: string): string | undefined {
  const cleanPath = normalizePath(path);

  // Fast path: exact match
  const exactKey = `${method} ${cleanPath}`;
  if (SCOPE_MAP[exactKey]) return SCOPE_MAP[exactKey];

  // Pattern matching against SCOPE_MAP entries
  for (const [pattern, scope] of Object.entries(SCOPE_MAP)) {
    const spaceIdx = pattern.indexOf(' ');
    const patternMethod = pattern.slice(0, spaceIdx);
    if (patternMethod !== method) continue;

    const patternPath = pattern.slice(spaceIdx + 1);

    if (patternPath.endsWith('/*')) {
      if (matchesWildcard(patternPath, cleanPath)) return scope;
      continue;
    }

    if (matchesSegments(patternPath, cleanPath)) return scope;
  }

  return undefined;
}

// ============================================================================
// Profile-aware lock semantics
// ============================================================================

/**
 * Decide whether a lock is "active" for a given key.
 *
 * - A non-empty allowlist is always active (check membership).
 * - An empty allowlist is active (deny-all) when the profile declares the
 *   lock in its `requiresLocks`. This closes the hole where a cleared
 *   allowlist on a profile key silently becomes "no lock".
 * - An empty allowlist on a legacy (profile=null) key is inactive — the
 *   enforcer skips the check, preserving backward compat.
 */
export function isLockActive(
  profile: ProfileName | null | undefined,
  lock: LockName,
  allowlist: readonly string[],
): boolean {
  if (allowlist.length > 0) return true;
  if (!profile) return false;
  const template = PROFILES[profile as ProfileName];
  if (!template) return false;
  return template.requiresLocks.includes(lock);
}

/**
 * Run a single allowlist check. Returns allowed=true either when the lock is
 * inactive (legacy/empty no-lock semantics) or when the target is present in
 * the allowlist. Returns allowed=false with `reason` and `attempted` otherwise.
 */
export function enforceAllowlist(
  profile: ProfileName | null | undefined,
  lock: LockName,
  allowlist: readonly string[],
  target: string | null | undefined,
): EnforcementResult {
  if (!isLockActive(profile, lock, allowlist)) return { allowed: true };

  // Lock is active (either non-empty list or profile requires it).
  if (allowlist.length === 0) {
    return {
      allowed: false,
      reason: 'deny-all-profile-requires-lock',
      attempted: target ?? '',
    };
  }
  // Non-empty list: the target must be provided AND present.
  if (!target) {
    return {
      allowed: false,
      reason: 'not-in-allowlist',
      attempted: '',
    };
  }
  if (allowlist.includes(target)) return { allowed: true };
  return { allowed: false, reason: 'not-in-allowlist', attempted: target };
}

export function enforceChatAllowlist(apiKey: ApiKeyData, target: string | null | undefined): EnforcementResult {
  return enforceAllowlist(apiKey.profile ?? null, 'chatAllowlist', apiKey.chatAllowlist ?? [], target);
}

export function enforceInstanceAllowlist(apiKey: ApiKeyData, target: string | null | undefined): EnforcementResult {
  return enforceAllowlist(apiKey.profile ?? null, 'instanceAllowlist', apiKey.instanceAllowlist ?? [], target);
}

export function enforceOutboundRecipientAllowlist(
  apiKey: ApiKeyData,
  target: string | null | undefined,
): EnforcementResult {
  return enforceAllowlist(
    apiKey.profile ?? null,
    'outboundRecipientAllowlist',
    apiKey.outboundRecipientAllowlist ?? [],
    target,
  );
}

// ============================================================================
// Route-target extraction
// ============================================================================

/**
 * Extracted lock targets for the current request. Any field may be null if the
 * route does not carry that kind of target.
 */
export interface LockTargets {
  instance: string | null;
  chat: string | null;
  recipient: string | null;
}

/** Routes that deliver a message to an external recipient (outbound send). */
const OUTBOUND_SEND_PREFIXES = ['/messages/send'];

/** Path-param extractors for categories that embed the target in the URL. */
const PATH_INSTANCE_PREFIXES = ['/instances/'];
const PATH_CHAT_PREFIXES = ['/chats/'];

/**
 * `GET /media/:instanceId/*` embeds the instance as the first path segment.
 * GET-only on purpose: the POST verbs under /media (tts, stt, imagine, vision,
 * film, music) put an action name in that segment, not an instance — treating
 * "tts" as an instance target would deny every allowlisted key those verbs.
 * Without this extraction the media path is invisible to instanceAllowlist:
 * broad keys can read ANY instance's media while allowlisted keys are denied
 * even their own (target=null against a non-empty list).
 */
const PATH_MEDIA_INSTANCE_PREFIX = '/media/';

function mediaPathInstance(method: string, cleanPath: string): string | null {
  if (method !== 'GET') return null;
  return firstPathSegment(cleanPath, PATH_MEDIA_INSTANCE_PREFIX);
}

function firstPathSegment(cleanPath: string, prefix: string): string | null {
  if (!cleanPath.startsWith(prefix)) return null;
  const rest = cleanPath.slice(prefix.length);
  const idx = rest.indexOf('/');
  const seg = idx === -1 ? rest : rest.slice(0, idx);
  return seg.length > 0 ? seg : null;
}

function isOutboundSendRoute(cleanPath: string): boolean {
  return OUTBOUND_SEND_PREFIXES.some((p) => cleanPath === p || cleanPath.startsWith(`${p}/`));
}

/**
 * Read common target fields from a parsed body. Accepts unknown so callers
 * can pass anything — missing fields become null.
 */
function readBodyTargets(body: unknown): { instanceId: string | null; to: string | null; chatId: string | null } {
  if (!body || typeof body !== 'object') return { instanceId: null, to: null, chatId: null };
  const b = body as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    instanceId: str(b.instanceId),
    to: str(b.to),
    chatId: str(b.chatId),
  };
}

/**
 * Merge path-param and body-derived target candidates into a single
 * `LockTargets`. Exported so tests can exercise extraction without HTTP.
 */
/**
 * Route-derived targets carried in `x-omni-instance` / `x-omni-chat` headers.
 * These are trusted like path params (set by the platform / API-key context),
 * not like the caller-controllable JSON body.
 */
export interface HeaderLockTargets {
  instance?: string | null;
  chat?: string | null;
}

/** Read the `x-omni-*` target headers off a request context. */
export function readHeaderTargets(c: Context<{ Variables: AppVariables }>): HeaderLockTargets {
  const norm = (v: string | undefined): string | null => (v && v.length > 0 ? v : null);
  return {
    instance: norm(c.req.header('x-omni-instance')),
    chat: norm(c.req.header('x-omni-chat')),
  };
}

export function extractLockTargets(
  method: string,
  rawPath: string,
  body: unknown,
  headers?: HeaderLockTargets,
): LockTargets {
  const cleanPath = normalizePath(rawPath);
  const { instanceId, to, chatId } = readBodyTargets(body);

  // Path-param extraction: /instances/:id, /chats/:id, GET /media/:instanceId/*
  const pathInstance =
    PATH_INSTANCE_PREFIXES.map((p) => firstPathSegment(cleanPath, p)).find((v) => v != null) ??
    mediaPathInstance(method, cleanPath);
  const pathChat = PATH_CHAT_PREFIXES.map((p) => firstPathSegment(cleanPath, p)).find((v) => v != null) ?? null;
  const headerInstance = headers?.instance && headers.instance.length > 0 ? headers.instance : null;
  const headerChat = headers?.chat && headers.chat.length > 0 ? headers.chat : null;

  // Precedence: route-derived targets (path param first, then x-omni-* header)
  // win over the request body. The body is caller-controllable, so:
  //   • Letting it override a path/header target would let a caller authorize
  //     against one instance/chat while the operation runs against another
  //     (scope bypass — e.g. PATCH /instances/:realId with body.instanceId set
  //     to an allowlisted id).
  //   • Ignoring header targets entirely makes header-scoped routes (e.g.
  //     POST /turns/close, which targets via x-omni-instance / x-omni-chat)
  //     invisible to allowlist + signature enforcement.
  // Body fields are used only when neither path nor header supplies the target
  // (outbound sends, explicit-body turn close, etc.).
  const instance = pathInstance ?? headerInstance ?? instanceId;
  let chat = pathChat ?? headerChat ?? chatId;
  let recipient: string | null = null;

  if (isOutboundSendRoute(cleanPath)) {
    // `to` is the outbound recipient. It is ALSO the chat target for DM sends
    // so the chat lock can be evaluated against it.
    recipient = to;
    if (!chat) chat = to;
  } else if (to && method !== 'GET' && method !== 'DELETE') {
    // Non-send routes that still carry a `to` field (rare) — treat as chat target.
    if (!chat) chat = to;
  }

  return { instance, chat, recipient };
}

/**
 * Safely parse a JSON request body. Returns null if the method has no body
 * or the body isn't JSON — enforcement then skips body-derived targets.
 */
async function safeReadJsonBody(c: Context<{ Variables: AppVariables }>): Promise<unknown | null> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS') return null;
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return null;
  try {
    // Hono caches parsed JSON on the request, so downstream handlers can call
    // c.req.json() again without paying a second parse.
    return await c.req.json();
  } catch {
    return null;
  }
}

function lockDenyResponse(c: Context<{ Variables: AppVariables }>, lock: LockName, result: EnforcementResult) {
  const denyAll = result.reason === 'deny-all-profile-requires-lock';
  const message = denyAll
    ? `Insufficient permissions. Lock ${lock} (deny-all: profile requires lock).`
    : `Insufficient permissions. Lock ${lock} does not include attempted target.`;
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message,
        lock,
        attempted: result.attempted ?? '',
      },
    },
    403,
  );
}

function invalidSignedHostScopeContextResponse(c: Context<{ Variables: AppVariables }>, hostId: string): Response {
  log.warn(`DENIED: signedBy=${hostId} route=${c.req.method.toUpperCase()} ${c.req.path} host-scopes=INVALID`);
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

export const scopeEnforcerMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const apiKey = c.get('apiKey');

  // authMiddleware should have set this — if missing, deny
  if (!apiKey) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401,
    );
  }

  const method = c.req.method.toUpperCase();
  const path = c.req.path;

  // A verified signing identity without its authorization context is an
  // invalid state. Never degrade to bearer-only permissions: a wildcard
  // bearer would otherwise bypass per-host narrowing if upstream context
  // population drifts or is reordered.
  const signedHost = readSignedHostScopeContext(c);
  if (signedHost.kind === 'invalid') return invalidSignedHostScopeContextResponse(c, signedHost.hostId);

  const wildcard = ApiKeyService.scopeAllows(apiKey.scopes, '*');

  // Resolve the required scope ONCE so we can apply both bearer and host
  // checks against the same policy entry. Locked behind !wildcard for the
  // bearer dimension to preserve fast-path behavior; the host dimension
  // (Group 5) re-uses it when needed.
  let requiredScope: string | undefined;

  if (!wildcard) {
    requiredScope = findRequiredScope(method, path);

    // Deny-by-default: no mapping means forbidden
    if (!requiredScope) {
      log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} required=UNMAPPED`);
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions. Route not mapped in scope policy.',
          },
        },
        403,
      );
    }

    // Check if the key's scopes include the required scope
    if (!ApiKeyService.scopeAllows(apiKey.scopes, requiredScope)) {
      log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} required=${requiredScope}`);
      return c.json(
        {
          error: {
            code: 'FORBIDDEN',
            message: `Insufficient permissions. Required scope: ${requiredScope}`,
          },
        },
        403,
      );
    }
  }

  // Per-host scope check (Group 5: omni-host-fingerprint-trust).
  //
  // When a request is signed by a registered genie host, the EFFECTIVE
  // permissions are the intersection of the bearer's scopes AND the host's
  // scopes. This lets operators narrow a single shared bearer key on a
  // per-machine basis without minting a new key per host.
  //
  // Backward compat: hosts default to `['*']` on first handshake, so this
  // check is a no-op until an operator explicitly narrows via
  // `omni trust update <id> --scopes <...>`.
  //
  // The bearer's wildcard does NOT bypass this — wildcard means "the bearer
  // is unrestricted", but the signing host may still be locked down.
  if (signedHost.kind === 'valid') {
    const { hostId: signedBy, scopes: hostScopes } = signedHost;
    const hostWildcard = ApiKeyService.scopeAllows(hostScopes, '*');
    if (!hostWildcard) {
      // Resolve the route's required scope if we haven't already (wildcard
      // bearer skipped that step above).
      const needed = requiredScope ?? findRequiredScope(method, path);

      // Same deny-by-default semantics as the bearer path: if the route is
      // unmapped, even a host with explicit non-wildcard scopes can't reach
      // it. (Wildcard host scopes are already handled by the early return.)
      if (!needed) {
        log.warn(`DENIED: signedBy=${signedBy} route=${method} ${path} required=UNMAPPED`);
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Insufficient permissions. Route not mapped in scope policy.',
            },
          },
          403,
        );
      }

      if (!ApiKeyService.scopeAllows(hostScopes, needed)) {
        log.warn(
          `DENIED: signedBy=${signedBy} route=${method} ${path} required=${needed} host-scopes=${hostScopes.join(',')}`,
        );
        return c.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: `Insufficient permissions for signing host. Required scope: ${needed}`,
              host: signedBy,
            },
          },
          403,
        );
      }
    }
  }

  // Scope check passed (or wildcard). Apply profile-aware allowlist locks.
  // Admin (wildcard) keys still pass through locks because a profile key MAY
  // have been granted '*' via overrides; rely on the lock columns to decide.
  const body = await safeReadJsonBody(c);
  const targets = extractLockTargets(method, path, body, readHeaderTargets(c));

  const instanceResult = enforceInstanceAllowlist(apiKey, targets.instance);
  if (!instanceResult.allowed) {
    log.warn(
      `DENIED: key=${apiKey.id} route=${method} ${path} lock=instanceAllowlist attempted=${instanceResult.attempted}`,
    );
    return lockDenyResponse(c, 'instanceAllowlist', instanceResult);
  }

  const chatResult = enforceChatAllowlist(apiKey, targets.chat);
  if (!chatResult.allowed) {
    log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} lock=chatAllowlist attempted=${chatResult.attempted}`);
    return lockDenyResponse(c, 'chatAllowlist', chatResult);
  }

  const recipientResult = enforceOutboundRecipientAllowlist(apiKey, targets.recipient);
  if (!recipientResult.allowed) {
    log.warn(
      `DENIED: key=${apiKey.id} route=${method} ${path} lock=outboundRecipientAllowlist attempted=${recipientResult.attempted}`,
    );
    return lockDenyResponse(c, 'outboundRecipientAllowlist', recipientResult);
  }

  return next();
});
