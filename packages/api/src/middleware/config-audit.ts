/**
 * Config-mutation audit middleware (issue #1152).
 *
 * Writes one `config_audit_logs` row per POST/PATCH/PUT/DELETE on a config
 * resource: actor (key name + X-Omni-Actor), request id, client IP, user
 * agent, target and before/after of the fields that changed. Secret-bearing
 * values are replaced by a stable `sha256:<prefix>` fingerprint, never stored.
 *
 * Reads are deliberately not logged here — polling GETs are the noise that
 * buried mutations in api_key_audit_logs.
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@omni/core';
import {
  type Database,
  agentProviders,
  agentRoutes,
  agents,
  apiKeys,
  automations,
  configAuditLogs,
  globalSettings,
  instances,
} from '@omni/db';
import { eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { createMiddleware } from 'hono/factory';
import { runDetachedFromTenantScope } from '../tenancy/tenant-scope';
import type { AppVariables } from '../types';

const log = createLogger('config-audit');

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SECRET_KEY = /token|secret|password|passwd|api_?key|key_?hash|private|credential|signing|webhook_?key|^auth/i;
const IGNORED_FIELDS = new Set(['updatedAt', 'lastUsedAt', 'lastSeenAt']);
const ACTOR_MAX = 255;

interface Resource {
  type: string;
  /** Matches the path after /api/v2. Group 1 = target id, group 2 = sub-action. */
  pattern: RegExp;
  table: PgTable;
  idColumn: AnyPgColumn;
}

// Order matters: routes live under /instances/:id/routes.
const RESOURCES: Resource[] = [
  {
    type: 'route',
    pattern: /^\/instances\/[^/]+\/routes(?:\/([^/]+))?(?:\/(.+))?$/,
    table: agentRoutes,
    idColumn: agentRoutes.id,
  },
  { type: 'instance', pattern: /^\/instances(?:\/([^/]+))?(?:\/(.+))?$/, table: instances, idColumn: instances.id },
  { type: 'agent', pattern: /^\/agents(?:\/([^/]+))?(?:\/(.+))?$/, table: agents, idColumn: agents.id },
  {
    type: 'provider',
    pattern: /^\/providers(?:\/([^/]+))?(?:\/(.+))?$/,
    table: agentProviders,
    idColumn: agentProviders.id,
  },
  {
    type: 'automation',
    pattern: /^\/automations(?:\/([^/]+))?(?:\/(.+))?$/,
    table: automations,
    idColumn: automations.id,
  },
  { type: 'api_key', pattern: /^\/keys(?:\/([^/]+))?(?:\/(.+))?$/, table: apiKeys, idColumn: apiKeys.id },
  {
    type: 'setting',
    pattern: /^\/settings(?:\/([^/]+))?(?:\/(.+))?$/,
    table: globalSettings,
    idColumn: globalSettings.key,
  },
];

export interface ResolvedTarget {
  resource: Resource;
  targetId?: string;
  action: string;
}

export function resolveTarget(method: string, path: string): ResolvedTarget | null {
  const rel = path.replace(/^\/api\/v2/, '').replace(/\/$/, '');
  for (const resource of RESOURCES) {
    const m = rel.match(resource.pattern);
    if (!m) continue;
    const [, targetId, sub] = m;
    const verb = { POST: targetId ? 'update' : 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' }[method];
    return { resource, targetId, action: `${resource.type}.${sub ? sub.replace(/\//g, '.') : verb}` };
  }
  return null;
}

/** Stable, non-reversible fingerprint so reuse of one secret across resources is visible. */
export function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)}`;
}

/** Deep-copy `value`, replacing every secret-named field's value with its fingerprint. */
export function redactSecrets(value: unknown, keyName = ''): unknown {
  if (value === null || value === undefined) return value;
  if (keyName && SECRET_KEY.test(keyName)) return fingerprint(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v, k)]));
  }
  return value;
}

/** Top-level field diff of two (already redacted) rows. */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const b = before?.[key] ?? null;
    const a = after?.[key] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) changes[key] = { before: b, after: a };
  }
  return changes;
}

/** Real client IP: first X-Forwarded-For hop, X-Real-IP, then the socket peer. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const real = c.req.header('x-real-ip');
  if (real) return real;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function loadRow(db: Database, resource: Resource, id: string): Promise<Record<string, unknown> | null> {
  // Non-uuid ids on uuid columns would throw in postgres; treat as "no row".
  if (resource.idColumn.columnType === 'PgUUID' && !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select().from(resource.table).where(eq(resource.idColumn, id)).limit(1);
  if (!row) return null;
  // global_settings flags secrets per row rather than by field name.
  const plain = row.isSecret === true && row.value != null ? { ...row, value: fingerprint(row.value) } : row;
  return redactSecrets(plain) as Record<string, unknown>;
}

async function createdId(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as { data?: { id?: unknown; key?: { id?: unknown } } };
    const id = body?.data?.id ?? body?.data?.key?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

export const configAuditMiddleware = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const target = MUTATING.has(c.req.method) ? resolveTarget(c.req.method, c.req.path) : null;
  const services = c.get('services');
  if (!target || !services?.db) return next();

  const db = services.db;
  // ponytail: rows are read on the global pool, detached from any tenant
  // transaction; under DB enforcement the runtime role may see no rows, which
  // yields an audit row with an empty diff rather than a failed request.
  const read = (id: string) => runDetachedFromTenantScope(() => loadRow(db, target.resource, id)).catch(() => null);
  const before = target.targetId ? await read(target.targetId) : null;

  await next();

  const apiKey = c.get('apiKey');
  const status = c.res.status;
  const targetId = target.targetId ?? (status < 400 ? await createdId(c.res) : undefined);
  const after = status < 400 && targetId && c.req.method !== 'DELETE' ? await read(targetId) : null;
  const changes = status < 400 ? diffRows(before, after) : {};

  void runDetachedFromTenantScope(() =>
    db.insert(configAuditLogs).values({
      apiKeyId: apiKey?.id ?? null,
      apiKeyName: apiKey?.name ?? null,
      actor: c.req.header('x-omni-actor')?.slice(0, ACTOR_MAX) ?? null,
      requestId: c.get('requestId') ?? null,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
      method: c.req.method,
      path: c.req.path.slice(0, 500),
      statusCode: status,
      action: target.action.slice(0, 100),
      targetType: target.resource.type,
      targetId: targetId ?? null,
      changedFields: Object.keys(changes),
      changes,
    }),
  ).catch((err) => log.error('Failed to write config audit log', { error: String(err) }));
});
