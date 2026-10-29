/**
 * In-memory stand-in for the connector tables, shared by the connector route and
 * credential-surface proof suites.
 *
 * WHY NOT A MOCK PER CALL
 * -----------------------
 * The point of these suites is that a caller scoped to tenant B cannot see, read
 * or overwrite tenant A's connector. A DB stub that filters on the tenant the
 * TEST knows is the caller would pass even if the service stopped adding a
 * tenant predicate, because the stub would do the filtering for it.
 *
 * So this stand-in does what PostgreSQL does: it applies the WHERE clause the
 * service actually generated. The condition is rendered with drizzle's own
 * `PgDialect`, and the fake evaluates each `column = $n`, `column > $n` and
 * `column IS NULL` predicate over its rows. Every connector query is a simple
 * AND of those shapes; an unsupported predicate throws instead of passing.
 *
 * The fake also serves as the transaction handle (`db.transaction` calls the
 * callback with the same object), so `runInTenantScope` can establish a real
 * tenant scope in front of the real `ConnectorService` without a server.
 */

import type { Database } from '@omni/db';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type TenantAuthContext, freezeContext } from '../tenancy/auth-context';

export type ConnectorTestRow = Record<string, unknown>;

const dialect = new PgDialect();

function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function columnName(column: unknown): string {
  const name = (column as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') throw new Error('connector test db: expected a column in orderBy');
  return camel(name);
}

/**
 * Evaluate the drizzle condition the service built. Connector queries only use
 * `eq`, `isNull` and (for the list cursor) `gt`, joined with AND.
 */
function matchesWhere(condition: unknown, row: ConnectorTestRow): boolean {
  if (condition === null || condition === undefined) return true;
  const { sql, params } = dialect.sqlToQuery(condition as never);

  let matched = false;
  const comparison = /"([a-z0-9_]+)"\s*(=|>)\s*\$(\d+)/gi;
  for (let match = comparison.exec(sql); match !== null; match = comparison.exec(sql)) {
    matched = true;
    const key = camel(match[1] as string);
    const operator = match[2];
    const expected = params[Number(match[3]) - 1];
    if (operator === '=') {
      if (row[key] !== expected) return false;
    } else if (typeof row[key] !== 'string' || typeof expected !== 'string' || row[key] <= expected) {
      return false;
    }
  }

  const nullCheck = /"([a-z0-9_]+)"\s+is\s+null/gi;
  for (let match = nullCheck.exec(sql); match !== null; match = nullCheck.exec(sql)) {
    matched = true;
    const key = camel(match[1] as string);
    if (row[key] !== null && row[key] !== undefined) return false;
  }

  if (!matched) throw new Error(`connector test db: unsupported WHERE predicate: ${sql}`);
  return true;
}

function defaults(table: string, values: ConnectorTestRow): ConnectorTestRow {
  const now = new Date();
  switch (table) {
    case 'connectors':
      return {
        id: crypto.randomUUID(),
        provider: 'clickup',
        name: '',
        credentials: '',
        config: {},
        status: 'connected',
        lastValidatedAt: null,
        lastError: null,
        lastErrorCode: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        tenantId: null,
        ...values,
      };
    case 'connector_event_subscriptions':
      return {
        id: crypto.randomUUID(),
        connectorId: '',
        providerEventKey: '',
        filters: {},
        targetAutomationId: '',
        verificationSecret: '',
        status: 'active',
        lastDeliveryAt: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
        totalDeliveries: 0,
        totalDuplicates: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        tenantId: null,
        ...values,
      };
    default:
      return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...values };
  }
}

export interface ConnectorTestTables {
  connectors: ConnectorTestRow[];
  connector_event_subscriptions: ConnectorTestRow[];
  automations: ConnectorTestRow[];
  omni_events: ConnectorTestRow[];
  config_audit_logs: ConnectorTestRow[];
  [table: string]: ConnectorTestRow[];
}

export interface ConnectorTestDb {
  readonly db: Database;
  readonly tables: ConnectorTestTables;
}

function comparable(value: unknown): string | number {
  return value instanceof Date ? value.getTime() : String(value);
}

function compareRows(key: string, direction: 'asc' | 'desc') {
  return (a: ConnectorTestRow, b: ConnectorTestRow): number => {
    const left = comparable(a[key]);
    const right = comparable(b[key]);
    const order =
      typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
    return direction === 'desc' ? -order : order;
  };
}

export function createConnectorTestDb(seed: Partial<ConnectorTestTables> = {}): ConnectorTestDb {
  const tables: ConnectorTestTables = {
    connectors: [],
    connector_event_subscriptions: [],
    automations: [],
    omni_events: [],
    config_audit_logs: [],
    ...seed,
  };

  const rowsOf = (table: unknown): ConnectorTestRow[] => {
    const name = getTableName(table as never);
    tables[name] ??= [];
    return tables[name] as ConnectorTestRow[];
  };

  const select = () => {
    const state: { table?: string; where?: unknown; order?: { key: string; direction: 'asc' | 'desc' } } = {};
    const rowsNow = (): ConnectorTestRow[] => {
      const filtered = (tables[state.table ?? ''] ?? []).filter((row) => matchesWhere(state.where, row));
      const ordered = state.order ? [...filtered].sort(compareRows(state.order.key, state.order.direction)) : filtered;
      return ordered.map((row) => ({ ...row }));
    };
    const chain = {
      from(table: unknown) {
        state.table = getTableName(table as never);
        return chain;
      },
      where(condition: unknown) {
        state.where = condition;
        return chain;
      },
      /**
       * Drizzle returns a thenable builder: `.orderBy(...)` can be awaited
       * directly OR followed by `.limit(n)`. Mirror both on a real Promise so
       * no custom `then` (and no thenable) is needed.
       */
      orderBy(...args: unknown[]) {
        const first = args[0];
        const column = Array.isArray(first) ? first[0] : first;
        const rawDirection = Array.isArray(first) ? first[1] : args[1];
        state.order = { key: columnName(column), direction: rawDirection === 'desc' ? 'desc' : 'asc' };
        const ordered = rowsNow();
        return Object.assign(Promise.resolve(ordered), {
          limit: (count: number) => Promise.resolve(ordered.slice(0, count)),
        });
      },
      limit(count: number) {
        return Promise.resolve(rowsNow().slice(0, count));
      },
    };
    return chain;
  };

  const insert = (table: unknown) => {
    const name = getTableName(table as never);
    return {
      values(values: ConnectorTestRow | ConnectorTestRow[]) {
        const inserted = (Array.isArray(values) ? values : [values]).map((value) => {
          const row = defaults(name, value);
          rowsOf(table).push(row);
          return { ...row };
        });
        const result = Object.assign(Promise.resolve(inserted), {
          returning: () => Promise.resolve(inserted.map((row) => ({ ...row }))),
          onConflictDoNothing: () => result,
        });
        return result;
      },
    };
  };

  const update = (table: unknown) => {
    const state: { where?: unknown; patch?: ConnectorTestRow } = {};
    const chain = {
      set(patch: ConnectorTestRow) {
        state.patch = patch;
        return chain;
      },
      where(condition: unknown) {
        state.where = condition;
        return chain;
      },
      returning() {
        const rows = rowsOf(table).filter((row) => matchesWhere(state.where, row));
        for (const row of rows) Object.assign(row, state.patch);
        return Promise.resolve(rows.map((row) => ({ ...row })));
      },
    };
    return chain;
  };

  const remove = (table: unknown) => {
    const state: { where?: unknown } = {};
    const chain = {
      where(condition: unknown) {
        state.where = condition;
        return chain;
      },
      returning() {
        const rows = rowsOf(table);
        const removed = rows.filter((row) => matchesWhere(state.where, row));
        for (const row of removed) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve(removed.map((row) => ({ id: row.id })));
      },
    };
    return chain;
  };

  const db = {
    select,
    insert,
    update,
    delete: remove,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    execute: async () => [],
  };

  return { db: db as unknown as Database, tables };
}

/** A tenant-class auth context, as the edge would have resolved it. */
export function connectorTenantContext(tenantId: string): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-connector-test',
    principalId: '00000000-0000-4000-8000-000000000001',
    credentialId: '00000000-0000-4000-8000-000000000002',
    tenantId,
    tenantSlug: 'connector-test',
    actorRole: 'tenant-admin',
    scopes: ['connectors:read', 'connectors:write', 'connectors:invoke'],
    membershipId: '00000000-0000-4000-8000-000000000003',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: '00000000-0000-4000-8000-000000000004',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: '00000000-0000-4000-8000-000000000005',
  }) as TenantAuthContext;
}
