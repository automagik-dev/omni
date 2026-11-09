import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxInstallerStillRunningError, runSandboxInstallCommand } from '../sandbox-install-command.js';
import {
  SANDBOX_UPDATE_LEASE_RECOVERY,
  checkSandboxUpdateLease,
  writeSandboxUpdateLease,
} from '../sandbox-update-lease.js';
import { appendSandboxUpdateFailure } from '../sandbox-update-transaction.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'omni-update-safety-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function installer() {
  const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter() });
  const callbacks: Array<() => void> = [];
  const signals: unknown[] = [];
  const opts: unknown[] = [];
  const effects = {
    spawn: (_cmd: string[], options: unknown) => {
      opts.push(options);
      return child as unknown as ChildProcess;
    },
    kill: (pid: number, signal: NodeJS.Signals) => {
      signals.push([pid, signal]);
    },
    timer: (callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length as unknown as ReturnType<typeof setTimeout>;
    },
    clear: () => {},
  };
  return { child, callbacks, signals, opts, effects };
}

test('installer timeout kills the process group and waits for close before permitting rollback', async () => {
  const fake = installer();
  let finished = false;
  const result = runSandboxInstallCommand(['bun', 'x', 'fixture'], { env: {}, timeoutMs: 600000 }, fake.effects).then(
    (value) => {
      finished = true;
      return value;
    },
  );
  expect(fake.opts).toEqual([{ cwd: undefined, env: {}, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }]);
  fake.child.stdout.emit('data', Buffer.from('captured output'));
  fake.callbacks[0]?.();
  expect(fake.signals).toEqual([[-123, 'SIGKILL']]);
  await Promise.resolve();
  expect(finished).toBe(false);
  fake.child.emit('close', null);
  expect(await result).toEqual({ code: 124, stdout: 'captured output', stderr: '', timedOut: true });
});

test('an installer that cannot be confirmed stopped fails closed instead of permitting rollback', async () => {
  const fake = installer();
  const result = runSandboxInstallCommand(['bun'], { env: {}, timeoutMs: 1 }, fake.effects);
  fake.callbacks[0]?.();
  fake.callbacks[1]?.();
  await expect(result).rejects.toBeInstanceOf(SandboxInstallerStillRunningError);
});

test('a process group that cannot be signalled fails closed', async () => {
  const fake = installer();
  fake.effects.kill = () => {
    throw new Error('EPERM');
  };
  const result = runSandboxInstallCommand(['bun'], { env: {}, timeoutMs: 1 }, fake.effects);
  fake.callbacks[0]?.();
  await expect(result).rejects.toBeInstanceOf(SandboxInstallerStillRunningError);
});

test('valid lease is bound to identity, expires, and cannot be confused with a reused PID', () => {
  const path = join(home, 'owner.json');
  const checks = { processIdentity: () => 'boot:start', now: () => 100, isAlive: () => true };
  const lease = writeSandboxUpdateLease(path, 99, checks);
  expect(checkSandboxUpdateLease(path, checks)).toEqual(lease);
  expect(checkSandboxUpdateLease(path, { ...checks, processIdentity: () => 'new-boot:start' })).toBeNull();
  expect(() => checkSandboxUpdateLease(path, { ...checks, now: () => lease.expiresAt })).toThrow(
    SANDBOX_UPDATE_LEASE_RECOVERY,
  );
  expect(() => checkSandboxUpdateLease(path, { ...checks, processIdentity: () => null })).toThrow(
    SANDBOX_UPDATE_LEASE_RECOVERY,
  );
  expect(checkSandboxUpdateLease(path, { ...checks, processIdentity: () => null, isAlive: () => false })).toBeNull();
});

test('legacy PID-only and malformed leases require deliberate recovery', () => {
  const path = join(home, 'owner.json');
  const checks = { processIdentity: () => 'boot:start', now: () => 100, isAlive: () => true };
  for (const bytes of ['{"pid":99}', 'broken']) {
    writeFileSync(path, bytes);
    expect(() => checkSandboxUpdateLease(path, checks)).toThrow(SANDBOX_UPDATE_LEASE_RECOVERY);
  }
});

test('new failed attempts always append a result; only repeated refused boots deduplicate', () => {
  const path = join(home, 'update.log');
  appendSandboxUpdateFailure(path, 'fixed failure');
  appendSandboxUpdateFailure(path, 'fixed failure');
  appendSandboxUpdateFailure(path, 'fixed failure', true);
  expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(2);
});
