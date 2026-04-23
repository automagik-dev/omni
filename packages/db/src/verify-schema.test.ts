import { describe, expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from './client';
import { type ColumnExpectation, formatDriftReport, verifyCriticalColumns } from './verify-schema';

function fakeDb(rows: Array<{ table_name: string; column_name: string }>, captured?: { query?: SQL }): Database {
  return {
    execute: async (query: SQL) => {
      if (captured) captured.query = query;
      return rows;
    },
  } as unknown as Database;
}

describe('verifyCriticalColumns', () => {
  const expectations: ColumnExpectation[] = [
    {
      table: 'instances',
      columns: ['gupshup_callback_url', 'gupshup_auth_token', 'gupshup_event_id'],
    },
  ];

  test('returns ok when every expected column is present', async () => {
    const db = fakeDb([
      { table_name: 'instances', column_name: 'gupshup_callback_url' },
      { table_name: 'instances', column_name: 'gupshup_auth_token' },
      { table_name: 'instances', column_name: 'gupshup_event_id' },
      { table_name: 'instances', column_name: 'unrelated_column' },
    ]);

    const report = await verifyCriticalColumns(db, expectations);

    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
  });

  test('reports missing columns when live DB lacks them', async () => {
    const db = fakeDb([
      { table_name: 'instances', column_name: 'gupshup_api_key' },
      { table_name: 'instances', column_name: 'gupshup_app_name' },
      { table_name: 'instances', column_name: 'gupshup_source_phone' },
    ]);

    const report = await verifyCriticalColumns(db, expectations);

    expect(report.ok).toBe(false);
    expect(report.drift).toHaveLength(1);
    expect(report.drift[0]?.table).toBe('instances');
    expect(report.drift[0]?.missing).toEqual(['gupshup_callback_url', 'gupshup_auth_token', 'gupshup_event_id']);
  });

  test('reports the table as fully missing when no rows returned', async () => {
    const db = fakeDb([]);

    const report = await verifyCriticalColumns(db, expectations);

    expect(report.ok).toBe(false);
    expect(report.drift[0]?.missing).toHaveLength(3);
  });

  test('short-circuits when expectations is empty', async () => {
    const db = fakeDb([]);
    const report = await verifyCriticalColumns(db, []);
    expect(report.ok).toBe(true);
    expect(report.drift).toEqual([]);
  });

  test('formatDriftReport returns human-readable text', () => {
    const text = formatDriftReport({
      ok: false,
      drift: [{ table: 'instances', missing: ['gupshup_callback_url'] }],
    });
    expect(text).toContain('instances');
    expect(text).toContain('gupshup_callback_url');
    expect(text).toContain('drift');
  });

  test('formatDriftReport says passed when ok', () => {
    expect(formatDriftReport({ ok: true, drift: [] })).toContain('passed');
  });

  test('binds each table name as its own parameter (regression: no array literal)', async () => {
    // Regression guard for the "malformed array literal" CI crash: passing
    // the raw JS array as a single placeholder made Postgres try to parse it
    // as an array literal ("instances") and fail. The fix uses sql.join so
    // each name becomes its own bound parameter — verify that with the same
    // PgDialect the production code path runs through.
    const captured: { query?: SQL } = {};
    const db = fakeDb([], captured);

    await verifyCriticalColumns(db, [
      { table: 'instances', columns: ['gupshup_callback_url'] },
      { table: 'agents', columns: ['id'] },
    ]);

    const query = captured.query;
    if (!query) throw new Error('execute was not called');
    const { sql: generatedSql, params } = new PgDialect().sqlToQuery(query);

    expect(generatedSql).toContain('IN ($1, $2)');
    expect(generatedSql).not.toContain('ANY');
    expect(params).toEqual(['instances', 'agents']);
    // No param should itself be an array — that was the original bug.
    for (const p of params) {
      expect(Array.isArray(p)).toBe(false);
    }
  });
});
