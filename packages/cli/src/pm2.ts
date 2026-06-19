/**
 * PM2 Interaction Utilities
 *
 * Shared helpers for running PM2 commands across server, install, and update.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import * as output from './output.js';

/** PM2 process names managed by omni */
export const PM2_PROCESSES = {
  api: 'omni-api',
  nats: 'omni-nats',
} as const;

/**
 * Hardened PM2 launch flags for `omni-api` and `omni-nats`.
 *
 * Shared by install and start so both paths use identical restart/memory/log
 * throttling. This is the fix for the 2026-04-09 incident where a crash loop
 * grew `omni-api-error.log` to 283 GB because pm2 had no `--max-restarts` or
 * log rotation configured. See WISH: omni-install-resilience.
 *
 * `killTimeoutMs` was added by WISH: pm2-log-noise-and-bumps — the API has a
 * 15 s graceful shutdown (`packages/api/src/index.ts:327`) but pm2's default
 * `kill_timeout` is 1600 ms, so SIGKILL was firing before pgserve/NATS could
 * drain. We pad to 20 s = 15 s graceful + 5 s headroom for Sentry flush.
 */
export const PM2_HARDENED_DEFAULTS = {
  maxRestarts: 10,
  restartDelayMs: 5000,
  apiMaxMemory: '2G',
  natsMaxMemory: '1G',
  killTimeoutMs: 20000,
  logDateFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
} as const;

/** Directory where hardened pm2 logs are written. */
export function getPm2LogDir(): string {
  return join(homedir(), '.omni', 'logs');
}

/**
 * Stable cwd to anchor pm2-managed processes against. Defaults to `$HOME`,
 * which is guaranteed to exist for the lifetime of the user account.
 *
 * Without this anchor, `pm2 start` inherits the calling shell's `process.cwd()`
 * and bakes it into the pm2 entry. If that directory is later removed (e.g.
 * a transient build dir, a deleted submodule, a switched git branch) every
 * subsequent `pm2 restart` fails with `Error: spawn bash ENOENT` because pm2
 * tries to `chdir()` into the missing path before exec. The omni-api launcher
 * (`bin/omni-server`) does its own `cd "$(dirname "$0")/../dist/server"`, so
 * pm2's cwd does not need to point anywhere meaningful — it just needs to
 * point somewhere that exists.
 *
 * See: 2026-05-07 incident where `omni update --next` poisoned the omni-api
 * pm2 entry with `repos/pgserve` (a directory that no longer existed),
 * causing silent crash loops with no log output.
 */
export function getPm2AnchorCwd(): string {
  return homedir();
}

/** Hardened log path for a given pm2 process name. */
export function getPm2LogPaths(processName: string): { out: string; error: string } {
  const dir = getPm2LogDir();
  return {
    out: join(dir, `${processName}-out.log`),
    error: join(dir, `${processName}-error.log`),
  };
}

/**
 * Options for `buildPm2StartArgs`. Either an `api` or `nats` launch.
 */
export interface Pm2StartArgsOptions {
  /** Target process kind — controls memory limit and log paths. */
  kind: 'api' | 'nats';
  /** Script/binary to launch (e.g. the server launcher shell or the nats binary). */
  script: string;
  /** pm2 process name (`omni-api` or `omni-nats`). */
  name: string;
  /**
   * Optional `--interpreter <name>` value. API launches via `bash` to hit the
   * shell launcher; NATS runs as a native binary and should pass `'none'`.
   */
  interpreter?: string;
  /** Arguments forwarded after `--` to the spawned process. */
  scriptArgs?: string[];
}

/**
 * Build the full `pm2 start ...` argv for hardened launches. Both install and
 * start consume this so the restart/memory/log flags live in exactly one
 * place.
 */
export function buildPm2StartArgs(options: Pm2StartArgsOptions): string[] {
  const { kind, script, name, interpreter, scriptArgs } = options;
  const logs = getPm2LogPaths(name);
  const maxMemory = kind === 'api' ? PM2_HARDENED_DEFAULTS.apiMaxMemory : PM2_HARDENED_DEFAULTS.natsMaxMemory;

  const args: string[] = [
    'start',
    script,
    '--name',
    name,
    '--cwd',
    getPm2AnchorCwd(),
    '--max-restarts',
    String(PM2_HARDENED_DEFAULTS.maxRestarts),
    '--restart-delay',
    String(PM2_HARDENED_DEFAULTS.restartDelayMs),
    '--max-memory-restart',
    maxMemory,
    '--kill-timeout',
    String(PM2_HARDENED_DEFAULTS.killTimeoutMs),
    '--log-date-format',
    PM2_HARDENED_DEFAULTS.logDateFormat,
    '--output',
    logs.out,
    '--error',
    logs.error,
  ];

  if (interpreter) {
    args.push('--interpreter', interpreter);
  }

  if (scriptArgs && scriptArgs.length > 0) {
    args.push('--', ...scriptArgs);
  }

  return args;
}

/** Map CLI service arg to PM2 process name */
export function resolveProcessName(service: string): string {
  if (service === 'api') return PM2_PROCESSES.api;
  if (service === 'nats') return PM2_PROCESSES.nats;
  return service;
}

/** Check if PM2 is available in PATH */
export async function isPm2Available(): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ['pm2', '--version'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Run a PM2 command with inherited stdio; returns exit code */
export async function runPm2(args: string[], envOverrides?: Record<string, string>): Promise<number> {
  const proc = Bun.spawn({
    cmd: ['pm2', ...args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...envOverrides },
  });
  return proc.exited;
}

/** Run a PM2 command and capture stdout */
export async function capturePm2(...args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn({
    cmd: ['pm2', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

/** Abort with a human-readable PM2 install message */
export function pm2NotFoundError(): never {
  output.error('PM2 not found in PATH.\n  Install it with: bun add -g pm2\n  Then retry: omni start', undefined, 1);
}
