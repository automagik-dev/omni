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
import type { Chat } from '@omni/db';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { LockRequirement, ProfileName } from '../constants/profiles';
import { PROFILES } from '../constants/profiles';
import { SCOPE_MAP } from '../constants/scopes';
import {
  explicitChatInstance,
  getActiveInstanceId,
  isChatUuid,
  isJsonContentType,
  resolveChatRow,
} from '../lib/resolve-chat-id';
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
  /** The chat a forward copies from (`fromChatId` on `POST /messages/send/forward`); held to the chat lock too. */
  sourceChat: string | null;
}

/** Routes that deliver a message to an external recipient (outbound send). */
const OUTBOUND_SEND_PREFIXES = ['/messages/send'];

/** Forwards copy a message out of `fromChatId`, a second chat the request reaches. */
const FORWARD_ROUTE = '/messages/send/forward';

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

/** Decode a path segment the way Hono decodes `c.req.param()`, keeping it as-is when malformed. */
function decodeSegment(seg: string): string {
  if (!seg.includes('%')) return seg;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * The only route that takes its targets from the `x-omni-instance` /
 * `x-omni-chat` headers (`omni done` sends them). Everywhere else the headers
 * are not targets: they would let a caller authorize against its own chat
 * while the body names another.
 */
function isHeaderTargetRoute(method: string, cleanPath: string): boolean {
  return method === 'POST' && cleanPath === '/turns/close';
}

/**
 * `/chats/<segment>` routes that are not a chat id (`/chats/by-external`,
 * `/chats/sync-names`, ...), read off SCOPE_MAP so a new one is never resolved
 * as a chat.
 */
const STATIC_CHAT_SEGMENTS: ReadonlySet<string> = new Set(
  Object.keys(SCOPE_MAP)
    .map((pattern) => pattern.slice(pattern.indexOf(' ') + 1).split('/'))
    .filter((parts) => parts[1] === 'chats' && parts[2] !== undefined && !parts[2].startsWith(':'))
    .map((parts) => parts[2] as string),
);

/** The raw `:id` of a `/chats/:id/*` route, decoded as the route reads it, or null. */
function chatIdParam(cleanPath: string): string | null {
  const seg = firstPathSegment(cleanPath, '/chats/');
  if (!seg || STATIC_CHAT_SEGMENTS.has(seg)) return null;
  return decodeSegment(seg);
}

/**
 * Read common target fields from a parsed body. Accepts unknown so callers
 * can pass anything — missing fields become null.
 */
function readBodyTargets(body: unknown): {
  instanceId: string | null;
  to: string | null;
  chatId: string | null;
  fromChatId: string | null;
} {
  if (!body || typeof body !== 'object') return { instanceId: null, to: null, chatId: null, fromChatId: null };
  const b = body as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  return {
    instanceId: str(b.instanceId),
    to: str(b.to),
    chatId: str(b.chatId),
    fromChatId: str(b.fromChatId),
  };
}

/**
 * Targets carried in the `x-omni-instance` / `x-omni-chat` headers. They are
 * targets on `POST /turns/close` only (see `isHeaderTargetRoute`); on any
 * other route an `x-omni-instance` that differs from the request's own
 * instance is refused by the middleware.
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

/**
 * Merge path-param, header and body-derived target candidates into a single
 * `LockTargets`. Exported so tests can exercise extraction without HTTP.
 */
export function extractLockTargets(
  method: string,
  rawPath: string,
  body: unknown,
  headers?: HeaderLockTargets,
): LockTargets {
  const cleanPath = normalizePath(rawPath);
  const { instanceId, to, chatId, fromChatId } = readBodyTargets(body);

  // Path-param extraction: /instances/:id, /chats/:id, GET /media/:instanceId/*
  const pathInstance =
    PATH_INSTANCE_PREFIXES.map((p) => firstPathSegment(cleanPath, p)).find((v) => v != null) ??
    mediaPathInstance(method, cleanPath);
  const pathChatSeg = PATH_CHAT_PREFIXES.map((p) => firstPathSegment(cleanPath, p)).find((v) => v != null) ?? null;
  const pathChat = pathChatSeg === null ? null : decodeSegment(pathChatSeg);
  const headerRoute = isHeaderTargetRoute(method, cleanPath);
  const headerInstance = headerRoute && headers?.instance && headers.instance.length > 0 ? headers.instance : null;
  const headerChat = headerRoute && headers?.chat && headers.chat.length > 0 ? headers.chat : null;

  // Precedence: route-derived targets win over the request body, which is
  // caller-controllable: letting it override a path target would let a caller
  // authorize against one instance/chat while the operation runs against
  // another (e.g. PATCH /instances/:realId with body.instanceId set to an
  // allowlisted id). The x-omni-* headers rank between the two on
  // POST /turns/close only, which targets through them; anywhere else a header
  // naming its own chat must not open a send to another one.
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

  const sourceChat = method === 'POST' && cleanPath === FORWARD_ROUTE ? fromChatId : null;

  return { instance, chat, recipient, sourceChat };
}

/**
 * Safely parse a JSON request body. Returns null if the method has no body
 * or the body isn't JSON — enforcement then skips body-derived targets.
 */
async function safeReadJsonBody(c: Context<{ Variables: AppVariables }>): Promise<unknown | null> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS') return null;
  // The same test as the route's `zValidator('json')`, so every body a route
  // validates is a body the lock read.
  if (!isJsonContentType(c.req.header('content-type'))) return null;
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

function unreadBodyResponse(c: Context<{ Variables: AppVariables }>): Response {
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions. Lock instanceAllowlist cannot read the request body; send it as JSON.',
        lock: 'instanceAllowlist',
        attempted: '',
      },
    },
    403,
  );
}

function headerMismatchResponse(c: Context<{ Variables: AppVariables }>, header: string): Response {
  return c.json(
    {
      error: {
        code: 'FORBIDDEN',
        message: "Insufficient permissions. Header x-omni-instance names another instance than the request's own.",
        header: 'x-omni-instance',
        attempted: header,
      },
    },
    403,
  );
}

/**
 * On any route but `POST /turns/close`, an `x-omni-instance` that differs from
 * an instance the request names itself (path, body, or the chat row the lock
 * resolved) is refused. A request that names no instance of its own leaves the
 * header unused.
 */
function headerInstanceMismatch(
  c: Context<{ Variables: AppVariables }>,
  method: string,
  cleanPath: string,
  ownInstances: ReadonlyArray<string | null | undefined>,
): Response | null {
  if (isHeaderTargetRoute(method, cleanPath)) return null;
  const header = readHeaderTargets(c).instance;
  if (!header) return null;
  if (ownInstances.every((own) => !own || own === header)) return null;
  return headerMismatchResponse(c, header);
}

/** True when any name of the resolved chat (the raw `:id`, its UUID, its native id) is in the chat lock. */
function chatAllowedByAnyName(apiKey: ApiKeyData, raw: string, chat: Chat): boolean {
  return [raw, chat.id, chat.externalId].some((name) => enforceChatAllowlist(apiKey, name).allowed);
}

/** A chat row with no instance is never inside an instance lock. */
function chatInsideInstanceLock(apiKey: ApiKeyData, instanceId: string | null): boolean {
  if (!instanceId) return false;
  return (
    enforceInstanceAllowlist(apiKey, instanceId).allowed &&
    ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)
  );
}

/**
 * `/chats/:id/*` for a key with an instance lock: resolve `:id` as the route
 * does (lib/resolve-chat-id.ts), inside the lock, and hand the row to the
 * route. A native id is looked up on the route's explicit `instanceId`, else
 * the key's context or active instance, and that instance must be inside the
 * lock BEFORE the lookup; no row, or a row outside the lock, is refused. The
 * row's instance becomes the request's instance target.
 */
async function lockChatRoute(
  c: Context<{ Variables: AppVariables }>,
  apiKey: ApiKeyData,
  raw: string,
): Promise<{ deny: Response } | { chat: Chat }> {
  const refuseChat = () => ({
    deny: lockDenyResponse(c, 'chatAllowlist', { allowed: false, reason: 'not-in-allowlist', attempted: raw }),
  });
  const explicit = await explicitChatInstance(c);
  if (explicit) {
    const explicitResult = enforceInstanceAllowlist(apiKey, explicit);
    if (!explicitResult.allowed) return { deny: lockDenyResponse(c, 'instanceAllowlist', explicitResult) };
  }

  let lookupInstance: string | undefined;
  if (!isChatUuid(raw)) {
    const instanceId = explicit ?? (await getActiveInstanceId(c));
    if (!instanceId) return refuseChat();
    const instanceResult = enforceInstanceAllowlist(apiKey, instanceId);
    if (!instanceResult.allowed) return { deny: lockDenyResponse(c, 'instanceAllowlist', instanceResult) };
    lookupInstance = instanceId;
  }

  const chat = await resolveChatRow(c, raw, lookupInstance);
  // A UUID row on an instance outside the lock is refused exactly like a
  // missing row, so the answer never tells which instance a row lives on.
  if (!chat || !chatInsideInstanceLock(apiKey, chat.instanceId)) return refuseChat();
  if (!chatAllowedByAnyName(apiKey, raw, chat)) return refuseChat();

  c.set('resolvedChat', { raw, chat });
  return { chat };
}

/**
 * Routes that deliver nothing to anyone and that a chat key needs: its chat's
 * row, participants and history, closing its turn, and its context. A key
 * that is chat-locked as well as recipient-locked (a chat key) needs no
 * recipient on these, since the chat lock already holds it to its chat. Every
 * other route keeps the recipient lock, and one without a recipient stays
 * refused for it (`POST /messages/media/download` among them).
 */
const RECIPIENT_FREE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/chats/:id'],
  ['GET', '/chats/:id/participants'],
  ['GET', '/chats/:id/messages'],
  ['POST', '/turns/close'],
  ['POST', '/context'],
  ['DELETE', '/context'],
];

function isRecipientFreeRoute(method: string, cleanPath: string): boolean {
  // `/chats/by-external` and the other static `/chats/*` routes are not `/chats/:id`.
  if (cleanPath.startsWith('/chats/') && chatIdParam(cleanPath) === null) return false;
  return RECIPIENT_FREE_ROUTES.some(([m, pattern]) => m === method && matchesSegments(pattern, cleanPath));
}

function recipientLockApplies(apiKey: ApiKeyData, method: string, cleanPath: string): boolean {
  if (isOutboundSendRoute(cleanPath)) return true;
  if (!isLockActive(apiKey.profile ?? null, 'chatAllowlist', apiKey.chatAllowlist ?? [])) return true;
  return !isRecipientFreeRoute(method, cleanPath);
}

/**
 * True when the request carries a body the lock could not read as JSON (an
 * unknown content type, or JSON that does not parse to an object). On a chat
 * route an instance-locked key is refused then: the route might still act on
 * a target in it that the lock never checked.
 */
function hasUnreadBody(c: Context<{ Variables: AppVariables }>, method: string, body: unknown): boolean {
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD' || method === 'OPTIONS') return false;
  if (body !== null && typeof body === 'object') return false;
  return c.req.header('content-type') !== undefined || (c.req.header('content-length') ?? '0') !== '0';
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

/**
 * Lock targets for the request: the extracted ones, with the chat row the lock
 * resolved on `/chats/:id/*` for an instance-locked key (its instance becomes
 * the instance target). Returns the refusal, or the targets and every instance
 * the request names as its own.
 */
async function lockTargetsFor(
  c: Context<{ Variables: AppVariables }>,
  apiKey: ApiKeyData,
  method: string,
  path: string,
): Promise<{ deny: Response } | { targets: LockTargets; ownInstances: Array<string | null> }> {
  const body = await safeReadJsonBody(c);
  const targets = extractLockTargets(method, path, body, readHeaderTargets(c));
  const ownInstances: Array<string | null> = [targets.instance];

  const chatParam = chatIdParam(normalizePath(path));
  if (
    chatParam === null ||
    !isLockActive(apiKey.profile ?? null, 'instanceAllowlist', apiKey.instanceAllowlist ?? [])
  ) {
    return { targets, ownInstances };
  }
  if (hasUnreadBody(c, method, body)) {
    log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} lock=chatRoute body=unreadable`);
    return { deny: unreadBodyResponse(c) };
  }
  const locked = await lockChatRoute(c, apiKey, chatParam);
  if ('deny' in locked) {
    log.warn(`DENIED: key=${apiKey.id} route=${method} ${path} lock=chatRoute attempted=${chatParam}`);
    return locked;
  }
  targets.instance = targets.instance ?? locked.chat.instanceId;
  targets.chat =
    [chatParam, locked.chat.id, locked.chat.externalId].find((name) => enforceChatAllowlist(apiKey, name).allowed) ??
    chatParam;
  ownInstances.push(locked.chat.instanceId);
  return { targets, ownInstances };
}

/** Run one allowlist check; the 403 to return when it refuses, else null. */
function denyUnless(
  c: Context<{ Variables: AppVariables }>,
  apiKey: ApiKeyData,
  route: string,
  lock: LockName,
  result: EnforcementResult,
): Response | null {
  if (result.allowed) return null;
  log.warn(`DENIED: key=${apiKey.id} route=${route} lock=${lock} attempted=${result.attempted}`);
  return lockDenyResponse(c, lock, result);
}

/** The profile-aware allowlist locks; the refusal to return, or null when the request may proceed. */
async function enforceLocks(
  c: Context<{ Variables: AppVariables }>,
  apiKey: ApiKeyData,
  method: string,
  path: string,
): Promise<Response | null> {
  const route = `${method} ${path}`;
  const cleanPath = normalizePath(path);
  const resolved = await lockTargetsFor(c, apiKey, method, path);
  if ('deny' in resolved) return resolved.deny;
  const { targets, ownInstances } = resolved;

  const mismatch = headerInstanceMismatch(c, method, cleanPath, ownInstances);
  if (mismatch) {
    log.warn(`DENIED: key=${apiKey.id} route=${route} header=x-omni-instance mismatch`);
    return mismatch;
  }

  return (
    denyUnless(c, apiKey, route, 'instanceAllowlist', enforceInstanceAllowlist(apiKey, targets.instance)) ??
    denyUnless(c, apiKey, route, 'chatAllowlist', enforceChatAllowlist(apiKey, targets.chat)) ??
    (targets.sourceChat === null
      ? null
      : denyUnless(c, apiKey, route, 'chatAllowlist', enforceChatAllowlist(apiKey, targets.sourceChat))) ??
    (recipientLockApplies(apiKey, method, cleanPath)
      ? denyUnless(
          c,
          apiKey,
          route,
          'outboundRecipientAllowlist',
          enforceOutboundRecipientAllowlist(apiKey, targets.recipient),
        )
      : null)
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
  const denied = await enforceLocks(c, apiKey, method, path);
  return denied ?? next();
});
