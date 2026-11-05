/** Rollback boundary for a quiescent sandbox. The data directory is never copied or replaced. */
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

const COMPONENTS = ['runtime', 'autopg', 'pgserve', 'bin', 'config', 'sandbox.json'] as const;
export const SANDBOX_EXTERNAL_UPDATE_REFUSAL =
  'Sandbox external service update is unavailable; use a compatible supervisor and a supported Restart=always system unit.';
export const SANDBOX_UPDATE_ROLLED_BACK = 'Sandbox install failed; the previous runtime was restored.';
export const SANDBOX_UPDATE_UNHEALTHY = 'Sandbox update did not become healthy; the rollback backup was kept.';
const ManifestSchema = z.object({
  from: z.string(),
  to: z.string(),
  phase: z.enum(['backing-up', 'installing', 'installed']),
  present: z.array(z.enum(COMPONENTS)),
});
const backupPath = (home: string) => join(home, '.update-backup');

/** A backup must not follow links into the working install or an unprotected directory. */
export function assertSandboxRollbackSafe(home: string): void {
  if (existsSync(backupPath(home))) throw new Error(SANDBOX_EXTERNAL_UPDATE_REFUSAL);
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(path);
      const local = relative(home, resolve(path, '..', target));
      if (isAbsolute(target) || !COMPONENTS.some((part) => local === part || local.startsWith(`${part}/`))) {
        throw new Error(SANDBOX_EXTERNAL_UPDATE_REFUSAL);
      }
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(join(path, entry));
    }
  };
  for (const part of COMPONENTS) if (existsSync(join(home, part))) visit(join(home, part));
}

/** Independent backup copies do not share Bun cache hardlinks with the working install. */
export function beginSandboxUpdateTransaction(home: string, from: string, to: string) {
  assertSandboxRollbackSafe(home);
  const backup = backupPath(home);
  mkdirSync(backup, { mode: 0o700 });
  const present = COMPONENTS.filter((part) => existsSync(join(home, part)));
  const manifest = { from, to, phase: 'backing-up', present };
  const writeManifest = () => {
    const temp = join(backup, 'manifest.tmp');
    writeFileSync(temp, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    renameSync(temp, join(backup, 'manifest.json'));
  };
  const rollback = () => {
    for (const part of COMPONENTS) {
      if (present.includes(part)) {
        rmSync(join(home, part), { recursive: true, force: true });
        renameSync(join(backup, part), join(home, part));
      } else rmSync(join(home, part), { recursive: true, force: true });
    }
    rmSync(backup, { recursive: true });
  };
  try {
    writeManifest();
    for (const part of present) {
      cpSync(join(home, part), join(backup, part), { recursive: true, verbatimSymlinks: true });
    }
    manifest.phase = 'installing';
    writeManifest();
  } catch (error) {
    // Nothing in the working install has changed while the snapshot is being copied.
    rmSync(backup, { recursive: true, force: true });
    throw error;
  }
  return {
    rollback,
    commit: () => {
      manifest.phase = 'installed';
      writeManifest();
    },
  };
}

/** Only the API's first successful health check on the target version retires the old install. */
export function finishSandboxUpdateTransaction(home: string, version: string): void {
  try {
    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(backupPath(home), 'manifest.json'), 'utf8')));
    if (manifest.phase === 'installed' && manifest.to === version) rmSync(backupPath(home), { recursive: true });
  } catch {
    // No pending backup, or one that needs an operator; never guess that it is safe to delete.
  }
}

export function hasPendingSandboxUpdate(home: string): boolean {
  return existsSync(backupPath(home));
}

/** An interrupted install is not a bootable transaction; keep its originals for recovery. */
export function sandboxUpdateNeedsRecovery(home: string, version: string): boolean {
  if (!hasPendingSandboxUpdate(home)) return false;
  try {
    const path = join(backupPath(home), 'manifest.json');
    if (!existsSync(path)) {
      rmSync(backupPath(home), { recursive: true });
      return false;
    }
    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (manifest.phase === 'backing-up') {
      rmSync(backupPath(home), { recursive: true });
      return false;
    }
    return manifest.phase !== 'installed' || manifest.to !== version;
  } catch {
    return true;
  }
}

export const SANDBOX_UPDATE_DRAIN_FAILED =
  'Sandbox update stopped before installation; the previous install was left unchanged.';
export const SANDBOX_UPDATE_COPY_INTERRUPTED =
  'Sandbox backup was interrupted; the previous install was left unchanged.';
export const SANDBOX_UPDATE_TIMED_OUT = 'Sandbox install timed out; the previous runtime was restored.';

/** Suppress the identical terminal line on every refused Restart=always boot. */
export function appendSandboxUpdateFailure(path: string, error: string, deduplicate = false): void {
  const line = JSON.stringify({ ok: false, error });
  if (!deduplicate) {
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
    return;
  }
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 4096));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    if (tail.toString('utf8').trimEnd().endsWith(line)) return;
  } catch {
    /* first result */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
}
