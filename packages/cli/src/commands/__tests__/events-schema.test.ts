/**
 * CLI `omni events schema register|list|get` — round-trip over HTTP (issue #959).
 *
 * The schema commands go through the API like every other CLI surface (the
 * CLI never queries the DB directly). This suite round-trips the exact
 * request helper the commands use against an in-process server speaking the
 * API contract, plus the artifact-loading rules (--file XOR --schema).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __testables } from '../events';

const { schemaApiRequest, loadSchemaArtifact, summarizeSchemaRow } = __testables;

// The round-trip talks to a REAL in-process server, so it needs the REAL
// fetch. `bun test` runs every package's files in ONE process, and a file
// that stubbed `globalThis.fetch` without restoring it makes these requests
// resolve against the leftover stub instead of the registry server — observed
// on CI (dev and PR #963): `registered.data` undefined from a leaked
// `{items:[...]}`-shaped stub response, and a "JSON Parse error: Unexpected
// identifier undefined" where a 404 was expected. The leak is
// order-dependent (Linux readdir order differs from macOS), so it never
// reproduces locally. Pin the native fetch for the duration of each test and
// restore whatever was there afterwards — same precedent as
// core's webhook-envelope suite; tracked repo-wide in #967.
let priorFetch: typeof globalThis.fetch;
beforeEach(() => {
  priorFetch = globalThis.fetch;
  globalThis.fetch = Bun.fetch as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = priorFetch;
});

interface StoredSchema {
  id: string;
  eventType: string;
  version: number;
  schema: Record<string, unknown>;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** In-memory registry speaking the /api/v2/events/schemas contract. */
function startRegistryServer() {
  const rows = new Map<string, StoredSchema>();

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const prefix = '/api/v2/events/schemas';
      if (!url.pathname.startsWith(prefix)) {
        return Response.json({ error: { code: 'NOT_FOUND', message: 'unknown route' } }, { status: 404 });
      }
      const rest = decodeURIComponent(url.pathname.slice(prefix.length).replace(/^\//, ''));

      if (req.method === 'POST' && rest === '') {
        const body = (await req.json()) as { eventType: string; schema: Record<string, unknown>; description?: string };
        const existing = rows.get(body.eventType);
        const row: StoredSchema = {
          id: '22222222-2222-4222-8222-222222222222',
          eventType: body.eventType,
          version: existing ? existing.version + 1 : 1,
          schema: body.schema,
          description: body.description ?? null,
          enabled: true,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        rows.set(body.eventType, row);
        return Response.json({ data: row }, { status: 201 });
      }
      if (req.method === 'GET' && rest === '') {
        return Response.json({ items: [...rows.values()] });
      }
      if (req.method === 'GET' && rest.length > 0) {
        const row = rows.get(rest);
        return row
          ? Response.json({ data: row })
          : Response.json({ error: { code: 'NOT_FOUND', message: `EventSchema not found: ${rest}` } }, { status: 404 });
      }
      return Response.json({ error: { code: 'NOT_FOUND', message: 'unknown route' } }, { status: 404 });
    },
  });

  return { server, rows };
}

describe('omni events schema round-trip', () => {
  const { server, rows } = startRegistryServer();
  const configDir = mkdtempSync(join(tmpdir(), 'omni-cli-events-schema-'));
  const hostConfigDir = process.env.OMNI_CONFIG_DIR;

  beforeAll(() => {
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ apiUrl: `http://127.0.0.1:${server.port}` }));
    process.env.OMNI_CONFIG_DIR = configDir;
  });

  afterAll(() => {
    if (hostConfigDir === undefined) Reflect.deleteProperty(process.env, 'OMNI_CONFIG_DIR');
    else process.env.OMNI_CONFIG_DIR = hostConfigDir;
    server.stop(true);
    rmSync(configDir, { recursive: true, force: true });
  });

  test('register → list → get round-trips through the API', async () => {
    const artifact = { type: 'object', required: ['ref'] };

    const registered = await schemaApiRequest<{ data: StoredSchema }>('', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'custom.github.push', schema: artifact, description: 'push contract' }),
    });
    expect(registered.data.eventType).toBe('custom.github.push');
    expect(registered.data.version).toBe(1);
    expect(rows.get('custom.github.push')?.schema).toEqual(artifact);

    const listed = await schemaApiRequest<{ items: StoredSchema[] }>('');
    expect(listed.items.map(summarizeSchemaRow)).toEqual([
      {
        eventType: 'custom.github.push',
        version: 1,
        enabled: true,
        description: 'push contract',
        updatedAt: registered.data.updatedAt,
      },
    ]);

    const fetched = await schemaApiRequest<{ data: StoredSchema }>(`/${encodeURIComponent('custom.github.push')}`);
    expect(fetched.data.schema).toEqual(artifact);
  });

  test('a non-2xx response surfaces the API status and body', async () => {
    await expect(schemaApiRequest('/custom.not.registered')).rejects.toThrow(/API returned 404/);
  });
});

describe('loadSchemaArtifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-cli-schema-artifact-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads the artifact from --file', () => {
    const file = join(dir, 'schema.json');
    writeFileSync(file, JSON.stringify({ type: 'object' }));
    expect(loadSchemaArtifact({ file })).toEqual({ type: 'object' });
  });

  test('reads the artifact from inline --schema', () => {
    expect(loadSchemaArtifact({ schema: '{"type":"object"}' })).toEqual({ type: 'object' });
  });

  test('requires exactly one source', () => {
    expect(() => loadSchemaArtifact({})).toThrow(/exactly one/);
    expect(() => loadSchemaArtifact({ file: 'x.json', schema: '{}' })).toThrow(/exactly one/);
  });

  test('refuses a non-object artifact', () => {
    expect(() => loadSchemaArtifact({ schema: '[1,2]' })).toThrow(/JSON object/);
    expect(() => loadSchemaArtifact({ schema: '"str"' })).toThrow(/JSON object/);
  });
});
