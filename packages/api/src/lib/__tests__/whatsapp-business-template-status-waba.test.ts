/**
 * `message_template_status_update` is scoped to the webhook entry's WABA (#1664 review).
 *
 * Two WABAs can each hold an `order_update` / `en_US` template with different
 * Meta ids. Before the fix, the lookup matched `meta_id OR (name, language)`
 * across every WABA, so an update from WABA A rewrote B's row with A's Meta id
 * and notified B's instance.
 *
 * Lives in @omni/api because it renders the real Drizzle predicate with
 * `PgDialect` (drizzle-orm resolves here, not in the channel package) and
 * evaluates it against in-memory rows. No database is touched.
 */

import { describe, expect, mock, test } from 'bun:test';
import { handleTemplateStatusUpdate } from '@omni/channel-whatsapp-business';
import type { Database, WhatsappTemplate } from '@omni/db';
import { type SQLWrapper, isSQLWrapper } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

type Row = Record<string, unknown>;

/** Evaluate a rendered `whatsapp_templates` predicate (=, IN, AND, OR) against one row. */
function matches(condition: unknown, row: Row): boolean {
  if (!isSQLWrapper(condition)) throw new Error('Expected a Drizzle SQLWrapper');
  const { sql, params } = new PgDialect().sqlToQuery((condition as SQLWrapper).getSQL());
  const column = (name: string) => row[name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
  const param = (ref: string) => params[Number(ref.trim().slice(1)) - 1];
  let expr = sql
    .replace(/"whatsapp_templates"\."(\w+)" in \(([^)]*)\)/g, (_, col: string, list: string) =>
      list.split(',').map(param).includes(column(col)) ? 'T' : 'F',
    )
    .replace(/"whatsapp_templates"\."(\w+)" = (\$\d+)/g, (_, col: string, ref: string) =>
      column(col) === param(ref) ? 'T' : 'F',
    );
  for (let previous = ''; previous !== expr; ) {
    previous = expr;
    expr = expr
      .replace(/\(([TF])\)/g, '$1')
      .replace(/([TF]) and ([TF])/g, (_, a: string, b: string) => (a === 'T' && b === 'T' ? 'T' : 'F'))
      .replace(/([TF]) or ([TF])/g, (_, a: string, b: string) => (a === 'T' || b === 'T' ? 'T' : 'F'));
  }
  if (expr !== 'T' && expr !== 'F') throw new Error(`Unevaluated predicate: ${sql}`);
  return expr === 'T';
}

/** Rows plus the select / update / transaction surface the service uses. */
function rowsDb(rows: Row[]): Database {
  const db = {
    select: () => ({
      from: () => ({
        where: async (condition: unknown) => rows.filter((r) => matches(condition, r)).map((r) => ({ ...r })),
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        where: async (condition: unknown) => {
          for (const row of rows) if (matches(condition, row)) Object.assign(row, patch);
        },
      }),
    }),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db as unknown as Database;
}

function template(id: string, instanceId: string, wabaId: string, metaId: string): Row {
  return {
    id,
    instanceId,
    wabaId,
    metaId,
    name: 'order_update',
    language: 'en_US',
    status: 'PENDING',
    rejectionReason: null,
  } satisfies Partial<WhatsappTemplate>;
}

describe('handleTemplateStatusUpdate is scoped to the webhook WABA', () => {
  test("an update from WABA A leaves WABA B's same-name template and instance untouched", async () => {
    const rowA = template('row-A', 'instance-A', 'waba-A', 'meta-A');
    const rowB = template('row-B', 'instance-B', 'waba-B', 'meta-B');
    const handleTemplateStatusChanged = mock(async () => undefined);
    const plugin = { handleTemplateStatusChanged } as unknown as Parameters<typeof handleTemplateStatusUpdate>[2];

    await handleTemplateStatusUpdate(
      rowsDb([rowA, rowB]),
      {
        message_template_id: 'meta-A',
        message_template_name: 'order_update',
        message_template_language: 'en_US',
        event: 'APPROVED',
      },
      plugin,
      'waba-A',
    );

    expect(rowA).toMatchObject({ metaId: 'meta-A', status: 'APPROVED' });
    expect(rowB).toMatchObject({ metaId: 'meta-B', status: 'PENDING' });
    expect(handleTemplateStatusChanged.mock.calls.map((call) => (call as unknown[])[0])).toEqual(['instance-A']);
  });

  test('every instance on the originating WABA is still updated and notified', async () => {
    const first = template('row-1', 'instance-1', 'waba-A', 'meta-A');
    const second: Row = { ...template('row-2', 'instance-2', 'waba-A', 'meta-A'), metaId: null };
    const handleTemplateStatusChanged = mock(async () => undefined);
    const plugin = { handleTemplateStatusChanged } as unknown as Parameters<typeof handleTemplateStatusUpdate>[2];

    await handleTemplateStatusUpdate(
      rowsDb([first, second]),
      {
        message_template_id: 'meta-A',
        message_template_name: 'order_update',
        message_template_language: 'en_US',
        event: 'REJECTED',
        reason: 'Invalid format',
      },
      plugin,
      'waba-A',
    );

    expect([first.status, second.status, second.metaId]).toEqual(['REJECTED', 'REJECTED', 'meta-A']);
    expect(handleTemplateStatusChanged.mock.calls.map((call) => (call as unknown[])[0]).sort()).toEqual([
      'instance-1',
      'instance-2',
    ]);
  });
});
