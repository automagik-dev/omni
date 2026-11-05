import {
  type ExecFileSyncOptions,
  type ExecFileSyncOptionsWithBufferEncoding,
  type ExecFileSyncOptionsWithStringEncoding,
  execFileSync,
} from 'node:child_process';

export class CommandTimeoutError extends Error {}

/** Bound each Git/archive command to 60 s, including network fetches, with headroom for CI load. */
export function boundedExec(file: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding): string;
export function boundedExec(file: string, args: string[], options: ExecFileSyncOptionsWithBufferEncoding): Buffer;
export function boundedExec(file: string, args: string[], options: ExecFileSyncOptions): string | Buffer {
  const timeout = options.timeout ?? 60_000;
  try {
    return execFileSync(file, args, { ...options, timeout });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ETIMEDOUT') {
      throw new CommandTimeoutError(`Command timed out after ${timeout} ms: ${[file, ...args].join(' ')}`, {
        cause: error,
      });
    }
    throw error;
  }
}
