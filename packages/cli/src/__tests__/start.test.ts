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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManagedNatsHost, startManagedNats } from '../install-helpers.js';
import { buildNatsServerArgs } from '../nats-server-args.js';
import {
  PM2_HARDENED_DEFAULTS,
  PM2_PROCESSES,
  buildPm2StartArgs,
  getPm2AnchorCwd,
  getPm2LogDir,
  getPm2LogPaths,
} from '../pm2.js';

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

describe('getPm2AnchorCwd', () => {
  test('returns $HOME so pm2 chdir cannot ENOENT on a transient cwd', () => {
    // Regression: 2026-05-07 incident — `omni update --next` ran from a
    // shell whose cwd was `repos/pgserve` (later removed), and pm2 baked
    // that path as the omni-api entry's cwd. Subsequent pm2 restarts
    // failed with `Error: spawn bash ENOENT` because pm2 chdir'd into
    // the missing directory before exec. Anchoring to $HOME — which
    // exists for the lifetime of the user account — eliminates that
    // class of failure entirely.
    expect(getPm2AnchorCwd()).toBe(homedir());
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

  test('includes --cwd anchored to $HOME so pm2 chdir cannot ENOENT', () => {
    // Regression: pm2 inherits the calling shell's cwd unless `--cwd` is
    // passed explicitly. If the inherited cwd is later removed, every
    // restart fails silently with `Error: spawn bash ENOENT`. Pinning
    // to `$HOME` keeps pm2's chdir target stable for the life of the
    // user account.
    expect(apiArgs).toContain('--cwd');
    const idx = apiArgs.indexOf('--cwd');
    expect(apiArgs[idx + 1]).toBe(homedir());
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

  test('includes --cwd anchored to $HOME for nats too', () => {
    expect(natsArgs).toContain('--cwd');
    const idx = natsArgs.indexOf('--cwd');
    expect(natsArgs[idx + 1]).toBe(homedir());
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

describe('omni start — managed NATS bind address', () => {
  // runStart() spawns pm2, so assert the exact composition it performs:
  // resolveManagedNatsHost(serverConfig) -> buildNatsServerArgs -> buildPm2StartArgs.
  function natsScriptArgs(serverConfig: { natsHost?: string }): string[] {
    const natsArgs = buildPm2StartArgs({
      kind: 'nats',
      script: '/tmp/nats-server',
      name: PM2_PROCESSES.nats,
      scriptArgs: buildNatsServerArgs({
        natsDataDir: '/tmp/data/nats',
        host: resolveManagedNatsHost(serverConfig),
      }),
    });
    return natsArgs.slice(natsArgs.indexOf('--') + 1);
  }

  test('passes -a 127.0.0.1 by default (config without natsHost)', () => {
    expect(natsScriptArgs({})).toEqual(['-js', '-sd', '/tmp/data/nats', '-a', '127.0.0.1']);
  });

  test('passes the configured server.natsHost', () => {
    expect(natsScriptArgs({ natsHost: '0.0.0.0' })).toEqual(['-js', '-sd', '/tmp/data/nats', '-a', '0.0.0.0']);
    expect(natsScriptArgs({ natsHost: '::' })).toEqual(['-js', '-sd', '/tmp/data/nats', '-a', '::']);
  });

  test('startManagedNats deletes the old omni-nats, then starts it with -a <host>', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'omni-start-nats-'));
    const calls: string[][] = [];
    try {
      const code = await startManagedNats(
        { dataDir, host: '127.0.0.1', binaryPath: '/tmp/nats-server' },
        {
          runPm2: async (args) => {
            calls.push(args);
            return 0;
          },
        },
      );
      expect(code).toBe(0);
      expect(calls[0]).toEqual(['delete', PM2_PROCESSES.nats]);
      expect(calls[1]?.[0]).toBe('start');
      expect(calls[1]?.slice(calls[1].indexOf('--') + 1)).toEqual([
        '-js',
        '-sd',
        join(dataDir, 'nats'),
        '-a',
        '127.0.0.1',
      ]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('start.ts recreates omni-nats through the shared launcher, not inline', () => {
    const src = readFileSync(new URL('../commands/start.ts', import.meta.url).pathname, 'utf-8');
    expect(src).toContain('resolveManagedNatsHost(serverConfig)');
    expect(src).toContain('startManagedNats({ dataDir: serverConfig.dataDir, host: natsHost })');
    expect(src).not.toContain("'-js'");
  });
});
