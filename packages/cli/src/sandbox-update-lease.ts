import { randomUUID } from 'node:crypto';
/** Linux maintenance leases identify a process incarnation, never just a reusable PID. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const SANDBOX_UPDATE_LEASE_MS = 30 * 60_000;
export const SANDBOX_UPDATE_BUSY = 'A supervisor-owned sandbox update is in progress.';
export const SANDBOX_UPDATE_LEASE_RECOVERY =
  'Sandbox update lease expired or cannot be verified; stop the system unit and recover its lease.';
const LeaseSchema = z
  .object({
    pid: z.number().int().positive(),
    identity: z.string().min(1).max(200),
    token: z.string().uuid(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
type SandboxUpdateLease = z.infer<typeof LeaseSchema>;
interface LeaseChecks {
  processIdentity(pid: number): string | null;
  isAlive(pid: number): boolean;
  now(): number;
}

export function sandboxProcessIdentity(pid: number): string | null {
  try {
    const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19]; // field 22, after comm
    return /^[0-9a-f-]{36}$/.test(boot) && start && /^\d+$/.test(start) ? `${boot}:${start}` : null;
  } catch {
    return null;
  } // EPERM is unverifiable, not evidence that this is the lease's process.
}

export function writeSandboxUpdateLease(path: string, pid: number, checks: LeaseChecks): SandboxUpdateLease {
  const identity = checks.processIdentity(pid);
  if (!identity) throw new Error(SANDBOX_UPDATE_LEASE_RECOVERY);
  const lease = { pid, identity, token: randomUUID(), expiresAt: checks.now() + SANDBOX_UPDATE_LEASE_MS };
  writeFileSync(path, JSON.stringify(lease), { mode: 0o600, flag: 'wx' });
  return lease;
}

function readSandboxUpdateLease(path: string): SandboxUpdateLease | null {
  try {
    return LeaseSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/** Expiry never grants permission to race a possibly live installer. Stop the unit before recovery. */
export function checkSandboxUpdateLease(path: string, checks: LeaseChecks): SandboxUpdateLease | null {
  if (!existsSync(path)) return null;
  const lease = readSandboxUpdateLease(path);
  if (!lease) throw new Error(SANDBOX_UPDATE_LEASE_RECOVERY);
  const actual = checks.processIdentity(lease.pid);
  if (actual !== null && actual !== lease.identity) return null; // PID reuse or a different boot
  if (actual === null && !checks.isAlive(lease.pid)) return null;
  if (checks.now() >= lease.expiresAt || actual === null) throw new Error(SANDBOX_UPDATE_LEASE_RECOVERY);
  return lease;
}
