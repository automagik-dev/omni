import { describe, expect, test } from 'bun:test';
import type { Database } from './client';
import { type ColumnExpectation, formatDriftReport, verifyCriticalColumns } from './verify-schema';

function fakeDb(rows: Array<{ table_name: string; column_name: string }>): Database {
  return {
    execute: async () => rows,
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
});
