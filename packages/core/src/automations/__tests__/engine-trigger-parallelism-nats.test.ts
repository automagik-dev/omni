/**
 * Trigger deliveries run in parallel over REAL JetStream (#1206).
 *
 * The sibling test drives the subscription wrapper with a fake consumer; this
 * one spawns a throwaway nats-server (random port, temp store) so the real
 * `consume()` pull loop, consumer config and ack path are exercised end to end.
 * Four concurrent custom events with a 300ms action must overlap under
 * maxConcurrency 4 and stay strictly serial under maxConcurrency 1.
 *
 * The burst runs in a child process (fixtures/nats-trigger-burst.ts) because
 * other suites mock the `nats` module process-wide.
 *
 * Binary: $NATS_SERVER_BIN, else repo `bin/nats-server` (scripts/ensure-nats.sh,
 * which CI runs), else `~/.omni/nats-server`. Missing binary fails — no skip.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

const ACTION_MS = 300;
const BURST = join(import.meta.dir, 'fixtures/nats-trigger-burst.ts');

function findNatsServer(): string {
  const candidates = [
    process.env.NATS_SERVER_BIN,
    join(import.meta.dir, '../../../../../bin/nats-server'),
    join(homedir(), '.omni/nats-server'),
  ];
  const found = candidates.find((c): c is string => !!c && existsSync(c));
  if (!found) throw new Error('nats-server not found: run scripts/ensure-nats.sh or set NATS_SERVER_BIN');
  return found;
}

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
  const port = probe.port as number;
  probe.stop(true);
  return port;
}

let server: Subprocess;
let storeDir: string;
let url: string;

beforeAll(() => {
  const port = freePort();
  storeDir = mkdtempSync(join(tmpdir(), 'omni-nats-1206-'));
  server = Bun.spawn([findNatsServer(), '-js', '-a', '127.0.0.1', '-p', String(port), '-sd', storeDir], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  url = `nats://127.0.0.1:${port}`;
});

afterAll(async () => {
  server?.kill();
  await server?.exited;
  rmSync(storeDir, { recursive: true, force: true });
});

async function runBurst(
  maxConcurrency: number,
  eventType: string,
): Promise<{ elapsedMs: number; starts: number[]; queueWaits: Array<number | null> }> {
  const child = Bun.spawn(['bun', BURST, url, String(maxConcurrency), eventType, String(ACTION_MS)], {
    env: { ...process.env, LOG_LEVEL: 'silent' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`burst exited ${code}: ${stderr}`);
  const last = stdout.trim().split('\n').pop() ?? '';
  return JSON.parse(last);
}

describe('AutomationEngine over real JetStream — trigger parallelism (#1206)', () => {
  test('maxConcurrency 4: four concurrent deliveries overlap', async () => {
    const { elapsedMs, queueWaits } = await runBurst(4, 'custom.parallel.four');
    expect(elapsedMs).toBeLessThan(ACTION_MS * 2);
    expect(queueWaits).toEqual([0, 0, 0, 0]);
  }, 20_000);

  test('maxConcurrency 1: the same burst runs strictly serially', async () => {
    const { elapsedMs, starts, queueWaits } = await runBurst(1, 'custom.parallel.one');
    expect(elapsedMs).toBeGreaterThanOrEqual(ACTION_MS * 4 - 20);
    for (let i = 1; i < starts.length; i++) {
      expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(ACTION_MS - 20);
    }
    // Recorded on the log row (#1206): the first run did not wait, the rest queued.
    expect(queueWaits[0]).toBe(0);
    expect(queueWaits.slice(1).every((w) => (w ?? 0) >= ACTION_MS - 20)).toBe(true);
  }, 20_000);
});
