/**
 * Crash reports from a sandbox's API, with a positive control. The API process
 * gets exactly the env `sandboxChildSpecs` builds. Where that env names no
 * SENTRY_DSN the API reports to its hard-coded address (instrument.ts), so the
 * test plants a DSN of a local listener in that place: without --embedded the
 * listener receives the event, with --embedded (SENTRY_DSN="") it receives
 * nothing. NODE_ENV=test, which also turns Sentry off, is never relied on: the
 * sandbox runs the API with NODE_ENV=production.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SandboxState, sandboxChildSpecs, sandboxLayout } from '../sandbox.js';

const PROBE = join(import.meta.dir, '..', '..', '..', 'api', 'src', '__tests__', 'fixtures', 'sentry-probe.ts');

const state: SandboxState = {
  schemaVersion: 1,
  version: '1',
  packageSpec: '1',
  bun: process.execPath,
  ports: { api: 18882, pg: 15432, nats: 14222 },
  atLogin: false,
  createdAt: '',
  updatedAt: '',
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-sentry-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Envelopes a local Sentry stand-in receives while the probe runs in the API's env. */
async function envelopesFor(embedded: boolean): Promise<number> {
  let envelopes = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname.endsWith('/envelope/')) envelopes += 1;
      await request.arrayBuffer();
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  try {
    const parentEnv = { PATH: process.env.PATH, HOME: home };
    const api = sandboxChildSpecs(sandboxLayout(home), state, 'omni_sk_test', parentEnv, { embedded })[2];
    if (!api) throw new Error('no api child');
    expect(api.env.NODE_ENV).toBe('production');
    const planted = `http://public@127.0.0.1:${server.port}/1`;
    const probe = Bun.spawn([process.execPath, PROBE], {
      env: { SENTRY_DSN: planted, ...api.env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(await probe.exited).toBe(0);
  } finally {
    server.stop(true);
  }
  return envelopes;
}

describe('crash reports from a sandbox API', () => {
  test('positive control: without --embedded the planted DSN receives the event', async () => {
    expect(await envelopesFor(false)).toBeGreaterThan(0);
  }, 30_000);

  test('with --embedded nothing is sent, not even to an explicitly planted DSN', async () => {
    expect(await envelopesFor(true)).toBe(0);
  }, 30_000);
});
