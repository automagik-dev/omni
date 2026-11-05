/**
 * Why an update did not complete, from the log its command writes: OMNI_UPDATE_LOG, which a
 * sandbox sets to <home>/logs/update.log (packages/cli/src/sandbox.ts). The install it hands
 * off ends with one JSON result line (`omni install --sandbox --json`). Only fixed text built
 * from fields parsed out of that line reaches the owner's chat or the event: never the log's
 * own words, which can hold paths and anything an install printed.
 */

import { open, stat } from 'node:fs/promises';
import { z } from 'zod';

/** The log grows with every update; only its end is read. */
const TAIL_BYTES = 64 * 1024;
const ResultSchema = z.object({ ok: z.boolean(), error: z.string().optional() });
const BUN_MISMATCH = /^Sandbox install requires Bun (\d+\.\d+\.\d+); .+ runs (\d+\.\d+\.\d+)\.(?:\s|$)/;

/** Where the log ends now. An update records it as it starts, so an older result is never read as its own. */
export async function updateLogSize(path: string): Promise<number> {
  return (await stat(path).catch(() => null))?.size ?? 0;
}

function resultOf(line: string): z.infer<typeof ResultSchema> | null {
  if (!line.startsWith('{')) return null;
  try {
    const parsed = ResultSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The error of the last result line written at or after byte `from`, or null when there is none or it succeeded. */
export async function lastUpdateError(path: string, from: number): Promise<string | null> {
  const handle = await open(path, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    // Shorter than when the update started: the log was cut or replaced, and what is left may be
    // older than this update. Nothing in it can be shown to be this update's result.
    if (size < from) return null;
    const start = Math.max(from, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      const result = resultOf(line.trim());
      if (result) return result.ok ? null : (result.error ?? '');
    }
    return null;
  } finally {
    await handle.close();
  }
}

/** A Bun version longer than this is not one, and a mapped line longer than this is not short. */
const MAX_VERSION_LENGTH = 20;
const MAX_REASON_LENGTH = 80;

/** One short line for the owner: a known error in fixed words, anything else only where to look. */
export function updateFailureReason(error: string, logPath: string): string {
  const generic = `The install failed; see ${logPath} on the server.`;
  const sandboxReasons: Record<string, string> = {
    'Sandbox external service update is unavailable; use a compatible supervisor and a supported Restart=always system unit.':
      'In-app update is unavailable for this system service; update it manually first.',
    'A supervisor-owned sandbox update is in progress.': 'A sandbox update is already in progress.',
    'Sandbox update lease expired or cannot be verified; stop the system unit and recover its lease.':
      'The update lease needs recovery; stop the system unit and recover its lease.',
    'Sandbox backup was interrupted; the previous install was left unchanged.':
      'The backup was interrupted; the previous install was left unchanged.',
    'Sandbox update stopped before installation; the previous install was left unchanged.':
      'The update stopped before installation; the previous install is unchanged.',
    'Sandbox install timed out; the previous runtime was restored.':
      'The install timed out; the previous runtime was restored.',
    'Sandbox install failed; the previous runtime was restored.':
      'The install failed; the previous runtime was restored.',
    'Sandbox update did not become healthy; the rollback backup was kept.':
      'The new sandbox did not become healthy; its rollback backup was kept.',
  };
  if (Object.hasOwn(sandboxReasons, error)) return sandboxReasons[error] ?? generic;
  const restored =
    /^Sandbox install failed; the previous runtime was restored\. Requires Bun (\d{1,6}\.\d{1,6}\.\d{1,6}); running Bun (\d{1,6}\.\d{1,6}\.\d{1,6})\.$/.exec(
      error,
    );
  if (restored) {
    const reason = `Restored previous runtime. Needs Bun ${restored[1]}; running ${restored[2]}.`;
    return reason.length <= MAX_REASON_LENGTH
      ? reason
      : (sandboxReasons['Sandbox install failed; the previous runtime was restored.'] ?? generic);
  }
  const bun = BUN_MISMATCH.exec(error);
  const [needs, has] = [bun?.[1] ?? '', bun?.[2] ?? ''];
  if (!bun || needs.length > MAX_VERSION_LENGTH || has.length > MAX_VERSION_LENGTH) return generic;
  const reason = `It needs Bun ${needs}; this computer has ${has}.`;
  return reason.length <= MAX_REASON_LENGTH ? reason : generic;
}
