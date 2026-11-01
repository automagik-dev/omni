/** Real JetStream proof in a child, isolated from other suites' module mocks. */
import { expect, test } from 'bun:test';
import { z } from 'zod';
import { TYPED_EVENT } from './fixtures/events-only-connector';

test('real NATS publishes legacy and typed bodies once; oversized provider payload returns 413 and releases its claim', async () => {
  const child = Bun.spawn(['bun', `${import.meta.dir}/fixtures/connector-hooks-nats-run.ts`], {
    env: { ...process.env, LOG_LEVEL: 'silent' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`connector hooks child exited ${code}: ${stderr}`);
  const result = z
    .object({
      delivered: z.array(z.object({ type: z.string(), bytes: z.number() })),
      maxPayload: z.number(),
      bodyBytes: z.number(),
      oversizedStatus: z.number(),
      oversizedRows: z.number(),
    })
    .parse(JSON.parse(stdout.trim().split('\n').pop() ?? ''));
  expect(result.delivered.map((event) => event.type).sort()).toEqual(['connector.event', TYPED_EVENT].sort());
  expect(result.oversizedStatus).toBe(413);
  expect(result.oversizedRows).toBe(0);
  expect(result.bodyBytes).toBeGreaterThan(result.maxPayload / 2);
  expect(result.delivered.every((event) => event.bytes < result.maxPayload)).toBe(true);
}, 25_000);
