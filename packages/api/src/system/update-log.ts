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
    // Shorter than when the update started: the log was replaced since, so all of it is newer.
    const start = Math.max(size < from ? 0 : from, size - TAIL_BYTES);
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

/** One short line for the owner: a known error in fixed words, anything else only where to look. */
export function updateFailureReason(error: string, logPath: string): string {
  const bun = BUN_MISMATCH.exec(error);
  if (bun) return `It needs Bun ${bun[1]}; this computer has ${bun[2]}.`;
  return `The install failed; see ${logPath} on the server.`;
}
