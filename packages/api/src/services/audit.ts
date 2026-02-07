/**
 * Audit service - logs API key usage for security monitoring
 *
 * Provides fire-and-forget logging of every authenticated request
 * and paginated retrieval for audit review.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type ApiKeyAuditLog, type NewApiKeyAuditLog, apiKeyAuditLogs } from '@omni/db';
import { and, count, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';

const log = createLogger('audit');

export interface AuditLogEntry {
  apiKeyId: string;
  method: string;
  path: string;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  responseTimeMs?: number;
}

export interface ListAuditLogsOptions {
  since?: Date;
  until?: Date;
  path?: string;
  statusCode?: number;
  limit?: number;
  cursor?: string;
}

export class AuditService {
  constructor(private db: Database) {}

  /**
   * Log an API request (fire-and-forget)
   */
  log(entry: AuditLogEntry): void {
    const data: NewApiKeyAuditLog = {
      apiKeyId: entry.apiKeyId,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      responseTimeMs: entry.responseTimeMs ?? null,
    };

    this.db
      .insert(apiKeyAuditLogs)
      .values(data)
      .then(() => {})
      .catch((err) => log.error('Failed to write audit log', { error: String(err) }));
  }

  /**
   * List audit logs for a specific API key with filtering and pagination
   */
  async listByKeyId(
    keyId: string,
    options: ListAuditLogsOptions = {},
  ): Promise<{
    items: ApiKeyAuditLog[];
    total: number;
    hasMore: boolean;
    cursor?: string;
  }> {
    const { since, until, path, statusCode, limit = 50, cursor } = options;

    const conditions = [eq(apiKeyAuditLogs.apiKeyId, keyId)];

    if (since) {
      conditions.push(gte(apiKeyAuditLogs.timestamp, since));
    }

    if (until) {
      conditions.push(lte(apiKeyAuditLogs.timestamp, until));
    }

    if (path) {
      conditions.push(ilike(apiKeyAuditLogs.path, `%${path}%`));
    }

    if (statusCode !== undefined) {
      conditions.push(eq(apiKeyAuditLogs.statusCode, statusCode));
    }

    if (cursor) {
      conditions.push(sql`${apiKeyAuditLogs.timestamp} < ${cursor}`);
    }

    const where = and(...conditions);

    const [items, [totalResult]] = await Promise.all([
      this.db
        .select()
        .from(apiKeyAuditLogs)
        .where(where)
        .orderBy(desc(apiKeyAuditLogs.timestamp))
        .limit(limit + 1),
      this.db.select({ count: count() }).from(apiKeyAuditLogs).where(where),
    ]);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      total: totalResult?.count ?? 0,
      hasMore,
      cursor: lastItem?.timestamp.toISOString(),
    };
  }
}
