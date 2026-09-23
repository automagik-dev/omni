import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebhookPollConfig } from '@omni/db';
import {
  executePoll,
  isPollAllowlistConfigured,
  isPollDue,
  nextDelaySeconds,
  resolveAllowedCommand,
} from '../poll-connector';

let dir: string;
const saved = process.env.OMNI_POLL_COMMAND_DIR;

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function config(command: string, overrides: Partial<WebhookPollConfig> = {}): WebhookPollConfig {
  return { command, intervalSeconds: 60, emitType: 'custom.test.item', dedupKeyTemplate: '{payload.id}', ...overrides };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'poll-connector-'));
  process.env.OMNI_POLL_COMMAND_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  if (saved === undefined) Reflect.deleteProperty(process.env, 'OMNI_POLL_COMMAND_DIR');
  else process.env.OMNI_POLL_COMMAND_DIR = saved;
});

describe('poll scheduling', () => {
  test('due when never scheduled or nextRunAt has passed', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    expect(isPollDue(config('x'), now)).toBe(true);
    expect(isPollDue(config('x', { nextRunAt: '2026-09-15T11:59:59Z' }), now)).toBe(true);
    expect(isPollDue(config('x', { nextRunAt: '2026-09-15T12:00:01Z' }), now)).toBe(false);
  });

  test('backoff doubles per consecutive failure and caps at an hour by default (#1240)', () => {
    expect(nextDelaySeconds(60, 0)).toBe(60);
    expect(nextDelaySeconds(60, 1)).toBe(120);
    expect(nextDelaySeconds(60, 3)).toBe(480);
    expect(nextDelaySeconds(900, 50)).toBe(3_600);
  });

  test('per-source maxBackoffSeconds overrides the ceiling, never below the interval', () => {
    expect(nextDelaySeconds(60, 50, 600)).toBe(600);
    expect(nextDelaySeconds(60, 50, 86_400)).toBe(86_400);
    expect(nextDelaySeconds(7_200, 0)).toBe(7_200);
    expect(nextDelaySeconds(7_200, 3)).toBe(7_200);
  });
});

describe('command allowlist', () => {
  test('disabled without OMNI_POLL_COMMAND_DIR', () => {
    expect(() => resolveAllowedCommand('/bin/sh', '')).toThrow(/disabled/);
  });

  test('isPollAllowlistConfigured needs an existing directory (#1239)', () => {
    expect(isPollAllowlistConfigured('')).toBe(false);
    expect(isPollAllowlistConfigured(join(dir, 'missing'))).toBe(false);
    expect(isPollAllowlistConfigured(dir)).toBe(true);
  });

  test('refuses commands outside the directory, including via ..', () => {
    expect(() => resolveAllowedCommand('/bin/sh', dir)).toThrow(/inside OMNI_POLL_COMMAND_DIR/);
    expect(() => resolveAllowedCommand(join(dir, '..', '..', 'bin', 'sh'), dir)).toThrow();
  });

  test('accepts a command inside the directory', () => {
    const path = script('ok.sh', 'true');
    expect(resolveAllowedCommand(path, dir)).toEndWith('ok.sh');
  });
});

describe('executePoll', () => {
  test('emits each JSON line, resets failures, schedules the next interval', async () => {
    const path = script('emit.sh', 'echo \'{"id":"a"}\'\necho\necho \'{"id":"b"}\'');
    const seen: unknown[] = [];
    const now = new Date('2026-09-15T12:00:00Z');
    const next = await executePoll(
      config(path, { consecutiveFailures: 3 }),
      async (p) => {
        seen.push(p);
        return true;
      },
      () => now,
    );
    expect(seen).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(next.consecutiveFailures).toBe(0);
    expect(next.nextRunAt).toBe('2026-09-15T12:01:00.000Z');
    expect(next.lastRun).toMatchObject({ exitCode: 0, eventsEmitted: 2 });
    expect(next.lastRun?.stdoutTail).toContain('"b"');
  });

  test('runs with PATH plus the stored env only', async () => {
    const path = script('env.sh', 'echo "{\\"id\\":\\"$TOKEN\\",\\"home\\":\\"$HOME\\"}"');
    let payload: unknown;
    await executePoll(config(path, { env: { TOKEN: 't1' } }), async (p) => {
      payload = p;
      return true;
    });
    expect(payload).toEqual({ id: 't1', home: '' });
  });

  test('non-zero exit backs off and emits nothing', async () => {
    const path = script('fail.sh', 'echo \'{"id":"a"}\'\nexit 3');
    const now = new Date('2026-09-15T12:00:00Z');
    let emitted = 0;
    const next = await executePoll(
      config(path, { consecutiveFailures: 1 }),
      async () => {
        emitted++;
        return true;
      },
      () => now,
    );
    expect(emitted).toBe(0);
    expect(next.consecutiveFailures).toBe(2);
    expect(next.nextRunAt).toBe('2026-09-15T12:04:00.000Z');
    expect(next.lastRun).toMatchObject({ exitCode: 3, eventsEmitted: 0 });
  });

  test('a non-JSON line is a failed run with the error recorded', async () => {
    const path = script('garbage.sh', 'echo nope');
    const next = await executePoll(config(path), async () => true);
    expect(next.consecutiveFailures).toBe(1);
    expect(next.lastRun?.error).toBeDefined();
  });

  test('a command outside the allowlist never runs and does not back off (#1240)', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const next = await executePoll(
      config('/bin/sh', { consecutiveFailures: 2 }),
      async () => true,
      () => now,
    );
    expect(next.lastRun).toMatchObject({ exitCode: null });
    expect(next.lastRun?.error).toMatch(/OMNI_POLL_COMMAND_DIR/);
    expect(next.consecutiveFailures).toBe(2);
    expect(next.nextRunAt).toBe('2026-09-15T12:01:00.000Z');
  });

  test('an unset allowlist retries at min(interval, 300s) without growing failures', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    process.env.OMNI_POLL_COMMAND_DIR = '';
    try {
      const next = await executePoll(
        config('x', { intervalSeconds: 1_800 }),
        async () => true,
        () => now,
      );
      expect(next.lastRun?.error).toMatch(/disabled/);
      expect(next.consecutiveFailures).toBe(0);
      expect(next.nextRunAt).toBe('2026-09-15T12:05:00.000Z');
    } finally {
      process.env.OMNI_POLL_COMMAND_DIR = dir;
    }
  });

  test('exit != 0 with empty stdout is a failure', async () => {
    const path = script('empty-fail.sh', 'exit 1');
    const next = await executePoll(config(path), async () => true);
    expect(next.consecutiveFailures).toBe(1);
    expect(next.lastRun).toMatchObject({ exitCode: 1, eventsEmitted: 0, stdoutTail: '' });
  });
});
