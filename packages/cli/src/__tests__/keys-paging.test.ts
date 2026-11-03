/**
 * `omni keys list` and `omni keys revoke <prefix>` past one page of keys.
 *
 * `GET /keys` answers newest first and pages with `offset` (max 100 a page). The fake server
 * here keeps that contract, so these tests pin the CLI side: the default list shows the newest
 * key, and the key resolver reads every page before it matches a prefix or a name. The CLI runs
 * as a subprocess with a temp HOME, so the real ~/.omni is never read.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';

const CLI_PATH = join(import.meta.dir, '../index.ts');
const API_KEY = 'omni_sk_keys_paging_test';
const HOME = mkdtempSync(join(tmpdir(), '.omni-keys-paging-'));

interface FakeKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  instanceIds: null;
  status: 'active' | 'revoked';
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 120 keys, oldest first. Ids are `NNNNNNNN-0000-4000-8000-00000000NNNN`, so prefixes are unique. */
const TOTAL = 120;
const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
const keyAt = (i: number, id = `${hex(0x10000000 + i, 8)}-0000-4000-8000-${hex(i, 12)}`): FakeKey => ({
  id,
  name: `key-${i}`,
  keyPrefix: 'omni_sk_',
  scopes: ['*'],
  instanceIds: null,
  status: 'active',
  usageCount: 0,
  createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
});

let keys: FakeKey[] = [];
let listCalls: URLSearchParams[] = [];
let revoked: string[] = [];
/** Serve page 1 for every offset, like an API from before `offset` existed. */
let ignoreOffset = false;

function resetKeys(): void {
  keys = Array.from({ length: TOTAL }, (_, i) => keyAt(i));
  listCalls = [];
  revoked = [];
  ignoreOffset = false;
}

/** The API's `GET /keys` contract: newest first, `limit` 1..100 (default 50), `offset` >= 0. */
function listKeys(url: URL): Response {
  listCalls.push(url.searchParams);
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = ignoreOffset ? 0 : Number(url.searchParams.get('offset') ?? 0);
  if (!(limit >= 1 && limit <= 100) || !(offset >= 0)) return Response.json({ error: 'bad query' }, { status: 400 });
  const status = url.searchParams.get('status');
  const newestFirst = [...keys]
    .filter((k) => !status || k.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const items = newestFirst.slice(offset, offset + limit);
  return Response.json({ items, meta: { total: items.length } });
}

function revokeKey(id: string): Response {
  const key = keys.find((k) => k.id === id);
  if (!key) return Response.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, { status: 404 });
  revoked.push(id);
  key.status = 'revoked';
  return Response.json({ data: key });
}

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/api/v2/keys') return listKeys(url);
    const revoke = url.pathname.match(/^\/api\/v2\/keys\/([^/]+)\/revoke$/);
    if (req.method === 'POST' && revoke) return revokeKey(decodeURIComponent(revoke[1]));
    return Response.json({ error: { code: 'NOT_FOUND', message: 'not faked' } }, { status: 404 });
  },
});

async function omni(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn({
    cmd: ['bun', CLI_PATH, ...args],
    env: { ...process.env, HOME, PM2_HOME: join(HOME, '.pm2'), OMNI_FORMAT: 'json' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeAll(() => {
  mkdirSync(join(HOME, '.omni'), { recursive: true });
  writeFileSync(
    join(HOME, '.omni', 'config.json'),
    JSON.stringify({ apiUrl: `http://localhost:${server.port}`, apiKey: API_KEY, format: 'json' }),
  );
});

afterAll(() => {
  server.stop(true);
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(resetKeys);

const newest = () => keys[TOTAL - 1];
const oldest = () => keys[0];

describe('omni keys list past 50 keys', () => {
  test('the default list includes the newest key', async () => {
    const result = await omni(['keys', 'list']);
    expect(result.exitCode).toBe(0);
    const rows = JSON.parse(result.stdout) as { id: string }[];
    expect(rows).toHaveLength(50);
    expect(rows[0].id).toBe(newest().id.slice(0, 8));
  });
});

describe('omni keys revoke <prefix> past 100 keys', () => {
  test('an 8-character prefix of the newest key revokes exactly that key', async () => {
    const result = await omni(['keys', 'revoke', newest().id.slice(0, 8)]);
    expect(result.exitCode).toBe(0);
    expect(revoked).toEqual([newest().id]);
  });

  test('an 8-character prefix of a key past the first page revokes exactly that key', async () => {
    const result = await omni(['keys', 'revoke', oldest().id.slice(0, 8)]);
    expect(result.exitCode).toBe(0);
    expect(revoked).toEqual([oldest().id]);
    expect(listCalls.map((q) => q.get('offset') ?? '0')).toEqual(['0', '100']);
  });

  test('a prefix shared by keys on different pages exits 1 and revokes nothing', async () => {
    // The newest key (page 1) and the oldest key (page 2) share the 8-character prefix.
    keys[0] = keyAt(0, `${newest().id.slice(0, 8)}-ffff-4000-8000-000000000000`);
    const result = await omni(['keys', 'revoke', newest().id.slice(0, 8)]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr + result.stdout).toContain('matches 2 keys');
    expect(revoked).toEqual([]);
  });

  test('a prefix shared by keys on the same page still exits 1 and revokes nothing', async () => {
    keys[TOTAL - 2] = keyAt(TOTAL - 2, `${newest().id.slice(0, 8)}-ffff-4000-8000-000000000000`);
    const result = await omni(['keys', 'revoke', newest().id.slice(0, 8)]);
    expect(result.exitCode).toBe(1);
    expect(revoked).toEqual([]);
  });

  test('a full id revokes that key without listing', async () => {
    const result = await omni(['keys', 'revoke', oldest().id]);
    expect(result.exitCode).toBe(0);
    expect(revoked).toEqual([oldest().id]);
    expect(listCalls).toEqual([]);
  });

  test('an exact name revokes that key, on the first page or past it', async () => {
    expect((await omni(['keys', 'revoke', newest().name])).exitCode).toBe(0);
    expect((await omni(['keys', 'revoke', oldest().name])).exitCode).toBe(0);
    expect(revoked).toEqual([newest().id, oldest().id]);
  });

  test('a duplicate exact name still resolves to the oldest key, as before', async () => {
    keys[TOTAL - 1] = { ...newest(), name: keys[TOTAL - 2].name };
    const result = await omni(['keys', 'revoke', keys[TOTAL - 2].name]);
    expect(result.exitCode).toBe(0);
    expect(revoked).toEqual([keys[TOTAL - 2].id]);
  });
});

describe('omni keys revoke against an API without offset', () => {
  test('the page walk stops when a page brings no new key', async () => {
    ignoreOffset = true;
    const result = await omni(['keys', 'revoke', newest().id.slice(0, 8)]);
    expect(result.exitCode).toBe(0);
    expect(revoked).toEqual([newest().id]);
    expect(listCalls).toHaveLength(2);
  });
});
