/**
 * PM2 Interaction Utilities
 *
 * Shared helpers for running PM2 commands across server, install, and update.
 */

import * as output from './output.js';

/** PM2 process names managed by omni */
export const PM2_PROCESSES = {
  api: 'omni-api',
  nats: 'omni-nats',
} as const;

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
