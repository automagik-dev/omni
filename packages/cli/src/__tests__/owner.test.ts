/**
 * omni claim / omni approve / omni connect (commands/owner.ts): what they send to
 * /api/v2/owner and how they read the answers, against an injected fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectCommand } from '../commands/connect.js';
import { createApproveCommand, createClaimCommand, ownerRequest } from '../commands/owner.js';

let dir: string;
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.OMNI_CONFIG_DIR;
  dir = mkdtempSync(join(tmpdir(), 'omni-owner-test-'));
  process.env.OMNI_CONFIG_DIR = dir;
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ apiUrl: 'http://omni.test:8882', apiKey: 'omni_primary' }));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) Reflect.deleteProperty(process.env, 'OMNI_CONFIG_DIR');
  else process.env.OMNI_CONFIG_DIR = saved;
});

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe('ownerRequest', () => {
  test("posts to the configured Omni's /api/v2/owner route with this CLI's key", async () => {
    const { fetcher, calls } = fakeFetch(200, { data: { approved: true, client: 'the Omni plugin', claimed: true } });
    const reply = await ownerRequest('approve', { userCode: 'ABCD-EFGH' }, fetcher);
    expect(reply).toEqual({ ok: true, data: { approved: true, client: 'the Omni plugin', claimed: true } });
    expect(calls[0]?.url).toBe('http://omni.test:8882/api/v2/owner/approve');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>)['x-api-key']).toBe('omni_primary');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ userCode: 'ABCD-EFGH' });
  });

  test("names the missing scope, an Omni too old for these routes, and the server's own words", async () => {
    expect(await ownerRequest('claim', {}, fakeFetch(403, { error: { message: 'Forbidden' } }).fetcher)).toMatchObject({
      ok: false,
      message: expect.stringContaining('auth:admin'),
    });
    expect(
      await ownerRequest('connect', {}, fakeFetch(404, { error: { message: 'Not found' } }).fetcher),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('omni update'),
    });
    const unknown = fakeFetch(404, {
      error: { code: 'UNKNOWN_CODE', message: 'No device is waiting with that code.' },
    });
    expect(await ownerRequest('approve', { userCode: 'X' }, unknown.fetcher)).toMatchObject({
      ok: false,
      message: 'No device is waiting with that code.',
    });
  });
});

describe('the commands', () => {
  test('omni claim and omni approve <code> exist', () => {
    expect(createClaimCommand().name()).toBe('claim');
    const approve = createApproveCommand();
    expect(approve.name()).toBe('approve');
    expect(approve.registeredArguments.map((argument) => argument.required)).toEqual([true]);
  });

  test('omni connect takes no arguments for a device link, or both for the Genie wiring', () => {
    const connect = createConnectCommand();
    expect(connect.registeredArguments.map((argument) => argument.required)).toEqual([false, false]);
    expect(connect.options.some((option) => option.long === '--url')).toBe(true);
    expect(connect.options.some((option) => option.long === '--nats-url')).toBe(true);
  });
});
