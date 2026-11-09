/** A supervised installer owns a process group; timeout must stop writers before rollback. */
import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
export const SUPERVISED_INSTALL_TIMEOUT_MS = 10 * 60_000;
export class SandboxInstallerStillRunningError extends Error {}
interface InstallEffects {
  spawn(cmd: string[], opts: SpawnOptions): ChildProcess;
  kill(pid: number, signal: NodeJS.Signals): void;
  timer(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout>): void;
}
const effects: InstallEffects = {
  spawn: (cmd, opts) => {
    const [file, ...args] = cmd;
    if (!file) throw new Error('empty installer command');
    return spawn(file, args, opts);
  },
  kill: (pid, signal) => {
    process.kill(pid, signal);
  },
  timer: setTimeout,
  clear: clearTimeout,
};
export function runSandboxInstallCommand(
  cmd: string[],
  opts: { cwd?: string; env: Record<string, string>; timeoutMs: number },
  fx: InstallEffects = effects,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = fx.spawn(cmd, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const finish = (code: number) => {
      if (finished) return;
      finished = true;
      fx.clear(timer);
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timedOut });
    };
    child.once('error', () => finish(127));
    child.once('close', (code) => finish(code ?? 1));
    timer = fx.timer(() => {
      timedOut = true;
      try {
        if (!child.pid) throw new Error('missing installer PID');
        fx.kill(-child.pid, 'SIGKILL'); // Includes bun x, bun install and their inherited children.
        if (finished) return;
        timer = fx.timer(() => {
          if (finished) return;
          finished = true;
          reject(new SandboxInstallerStillRunningError('Installer did not close after SIGKILL'));
        }, 5000);
      } catch {
        finished = true;
        reject(new SandboxInstallerStillRunningError('Installer process group could not be stopped'));
      }
    }, opts.timeoutMs);
  });
}
