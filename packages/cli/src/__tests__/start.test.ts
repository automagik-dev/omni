/**
 * start command tests
 *
 * `runStart()` itself spawns pm2 — not practical to unit-test without a real
 * pm2 daemon. This file focuses on the pure `buildPm2StartArgs()` helper
 * that both `start` and `install` consume, plus a couple of sanity checks
 * on the exported constants.
 *
 * The hardened flags are the whole point of the 2026-04-09
 * `omni-install-resilience` wish — a crash loop with `max_restarts: 0`
 * grew `omni-api-error.log` to 283 GB. Every assertion here is load-bearing.
 */

import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PM2_HARDENED_DEFAULTS, PM2_PROCESSES, buildPm2StartArgs, getPm2LogDir, getPm2LogPaths } from '../pm2.js';

describe('PM2_HARDENED_DEFAULTS', () => {
  test('maxRestarts is in the hardened range', () => {
    expect(PM2_HARDENED_DEFAULTS.maxRestarts).toBeGreaterThanOrEqual(5);
    expect(PM2_HARDENED_DEFAULTS.maxRestarts).toBeLessThanOrEqual(50);
  });

  test('restartDelayMs is non-trivial', () => {
    expect(PM2_HARDENED_DEFAULTS.restartDelayMs).toBeGreaterThanOrEqual(1000);
  });

  test('api memory limit is set', () => {
    expect(PM2_HARDENED_DEFAULTS.apiMaxMemory).toMatch(/^\d+[MG]$/);
  });

  test('nats memory limit is set', () => {
    expect(PM2_HARDENED_DEFAULTS.natsMaxMemory).toMatch(/^\d+[MG]$/);
  });

  test('killTimeoutMs covers the 15 s graceful shutdown', () => {
    // The api graceful-shutdown handler has a 15 000 ms forceExitTimer
    // (packages/api/src/index.ts:327). pm2 must wait at least that long
    // before SIGKILL or it kills the process mid-drain.
    expect(PM2_HARDENED_DEFAULTS.killTimeoutMs).toBeGreaterThanOrEqual(15000);
  });
});

describe('getPm2LogDir / getPm2LogPaths', () => {
  test('log dir is under ~/.omni/logs', () => {
    expect(getPm2LogDir()).toBe(join(homedir(), '.omni', 'logs'));
  });

  test('log paths for omni-api are named after the process', () => {
    const paths = getPm2LogPaths('omni-api');
    expect(paths.out).toBe(join(homedir(), '.omni', 'logs', 'omni-api-out.log'));
    expect(paths.error).toBe(join(homedir(), '.omni', 'logs', 'omni-api-error.log'));
  });

  test('log paths for omni-nats are named after the process', () => {
    const paths = getPm2LogPaths('omni-nats');
    expect(paths.out).toContain('omni-nats-out.log');
    expect(paths.error).toContain('omni-nats-error.log');
  });
});

describe('buildPm2StartArgs — api launch', () => {
  const apiArgs = buildPm2StartArgs({
    kind: 'api',
    script: '/tmp/omni-api-launcher.sh',
    name: PM2_PROCESSES.api,
    interpreter: 'bash',
  });

  test('starts with "start <script>"', () => {
    expect(apiArgs[0]).toBe('start');
    expect(apiArgs[1]).toBe('/tmp/omni-api-launcher.sh');
  });

  test('includes --name omni-api', () => {
    expect(apiArgs).toContain('--name');
    const idx = apiArgs.indexOf('--name');
    expect(apiArgs[idx + 1]).toBe('omni-api');
  });

  test('includes --max-restarts 10', () => {
    expect(apiArgs).toContain('--max-restarts');
    const idx = apiArgs.indexOf('--max-restarts');
    expect(apiArgs[idx + 1]).toBe('10');
  });

  test('includes --restart-delay 5000', () => {
    expect(apiArgs).toContain('--restart-delay');
    const idx = apiArgs.indexOf('--restart-delay');
    expect(apiArgs[idx + 1]).toBe('5000');
  });

  test('includes --max-memory-restart 2G for api kind', () => {
    expect(apiArgs).toContain('--max-memory-restart');
    const idx = apiArgs.indexOf('--max-memory-restart');
    expect(apiArgs[idx + 1]).toBe('2G');
  });

  test('includes --log-date-format', () => {
    expect(apiArgs).toContain('--log-date-format');
  });

  test('includes --output and --error with hardened log paths', () => {
    expect(apiArgs).toContain('--output');
    expect(apiArgs).toContain('--error');
    const outIdx = apiArgs.indexOf('--output');
    const errIdx = apiArgs.indexOf('--error');
    expect(apiArgs[outIdx + 1]).toContain('omni-api-out.log');
    expect(apiArgs[errIdx + 1]).toContain('omni-api-error.log');
  });

  test('includes --kill-timeout 20000', () => {
    expect(apiArgs).toContain('--kill-timeout');
    const idx = apiArgs.indexOf('--kill-timeout');
    expect(apiArgs[idx + 1]).toBe('20000');
  });

  test('includes --interpreter bash when provided', () => {
    expect(apiArgs).toContain('--interpreter');
    const idx = apiArgs.indexOf('--interpreter');
    expect(apiArgs[idx + 1]).toBe('bash');
  });

  test('does not leak a trailing "--" when no scriptArgs are passed', () => {
    expect(apiArgs).not.toContain('--');
  });
});

describe('buildPm2StartArgs — nats launch', () => {
  const natsArgs = buildPm2StartArgs({
    kind: 'nats',
    script: '/tmp/nats-server',
    name: PM2_PROCESSES.nats,
    scriptArgs: ['-js', '-sd', '/tmp/nats-data'],
  });

  test('includes --max-memory-restart 1G for nats kind', () => {
    const idx = natsArgs.indexOf('--max-memory-restart');
    expect(natsArgs[idx + 1]).toBe('1G');
  });

  test('includes the hardened restart flags', () => {
    expect(natsArgs).toContain('--max-restarts');
    expect(natsArgs).toContain('--restart-delay');
  });

  test('includes --kill-timeout 20000 for nats too', () => {
    expect(natsArgs).toContain('--kill-timeout');
    const idx = natsArgs.indexOf('--kill-timeout');
    expect(natsArgs[idx + 1]).toBe('20000');
  });

  test('forwards scriptArgs after a "--" separator', () => {
    const dashIdx = natsArgs.indexOf('--');
    expect(dashIdx).toBeGreaterThan(-1);
    expect(natsArgs.slice(dashIdx + 1)).toEqual(['-js', '-sd', '/tmp/nats-data']);
  });

  test('does not include --interpreter when not provided', () => {
    expect(natsArgs).not.toContain('--interpreter');
  });

  test('log paths are named after the nats process', () => {
    const outIdx = natsArgs.indexOf('--output');
    const errIdx = natsArgs.indexOf('--error');
    expect(natsArgs[outIdx + 1]).toContain('omni-nats-out.log');
    expect(natsArgs[errIdx + 1]).toContain('omni-nats-error.log');
  });
});

describe('buildPm2StartArgs — shared-flag invariant', () => {
  test('install and start produce identical hardened flags for omni-api', () => {
    // Different call sites (install.ts, start.ts) build the same shape —
    // simulate both and diff them. The only legitimate difference should be
    // the script path; all flag pairs must match.
    const a = buildPm2StartArgs({
      kind: 'api',
      script: '/install/path/launcher.sh',
      name: PM2_PROCESSES.api,
      interpreter: 'bash',
    });
    const b = buildPm2StartArgs({
      kind: 'api',
      script: '/start/path/launcher.sh',
      name: PM2_PROCESSES.api,
      interpreter: 'bash',
    });
    // Everything except the script path (index 1) must be identical.
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (i === 1) continue;
      expect(a[i]).toBe(b[i]);
    }
  });
});
