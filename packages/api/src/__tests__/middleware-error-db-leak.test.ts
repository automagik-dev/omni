/**
 * Regression for #1069: database errors must not echo SQL text or bound
 * parameters (notably the api_keys lookup's key_hash) to API clients.
 */

import { describe, expect, test } from 'bun:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error';
import type { AppVariables } from '../types';

const KEY_HASH = 'a'.repeat(64);
const SQL =
  'select "id", "name", "key_hash", "scopes" from "api_keys" where ("api_keys"."key_hash" = $1 and "api_keys"."status" = $2)';

function pgError(message: string, code: string): Error {
  const err = new Error(message);
  err.name = 'PostgresError';
  Object.assign(err, { code });
  return err;
}

function appThrowing(error: unknown): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.get('/events', () => {
    throw error;
  });
  return app;
}

describe('error boundary — database error leakage (#1069)', () => {
  test('drizzle query failure returns DB_QUERY_FAILED with no SQL or params', async () => {
    const error = new DrizzleQueryError(SQL, [KEY_HASH, 'active'], pgError('connection is closed', 'XX000'));
    const res = await appThrowing(error).request('/events');
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: 'DB_QUERY_FAILED', message: 'Database query failed', retryable: true },
    });
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain('api_keys');
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('params');
  });

  test('connection-level failure maps to 503 DB_CONNECTION_FAILED', async () => {
    const error = new DrizzleQueryError(SQL, [KEY_HASH], pgError('write CONNECT_TIMEOUT db:5432', 'CONNECT_TIMEOUT'));
    const res = await appThrowing(error).request('/events');
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text).error.code).toBe('DB_CONNECTION_FAILED');
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain('db:5432');
  });

  test('unknown errors never echo their message, regardless of NODE_ENV', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = await appThrowing(new Error(`secret detail ${KEY_HASH}`)).request('/events');
      const text = await res.text();
      expect(res.status).toBe(500);
      expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR');
      expect(text).not.toContain(KEY_HASH);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('unique violations still map to 409 CONFLICT through the wrapper', async () => {
    const driver = Object.assign(pgError('duplicate key', '23505'), { detail: 'Key (name)=(foo) already exists.' });
    const res = await appThrowing(new DrizzleQueryError('insert into x', ['foo'], driver)).request('/events');
    expect(res.status).toBe(409);
  });
});
