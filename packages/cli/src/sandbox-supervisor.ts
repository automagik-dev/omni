/**
 * Sandbox supervisor: `omni sandbox run --home <dir>`.
 *
 * The one long-running process of a sandboxed Omni. It starts Postgres, waits
 * until it accepts connections and makes sure the `omni` database exists, then
 * starts NATS, then the API, and stops them in reverse order on SIGTERM or
 * SIGINT. A child that exits is restarted with backoff (1 s doubling to 30 s,
 * reset after a minute of uptime); a child that crashes
 * {@link MAX_FAST_CRASHES} times in a row stops everything, and the supervisor
 * exits 1 so launchd or systemd (or the person, from the status) take over.
 *
 * It writes `run/supervisor.pid` and `run/status.json`. Effects come from
 * {@link SupervisorDeps}, so tests drive it without real processes.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, fstatSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { readPgPasswordFile } from './autopg-runtime.js';
import { ensureOmniDatabaseExists, waitForCanonicalReady } from './lib/canonical-pgserve.js';
import {
  SANDBOX_EXIT,
  type SandboxChildName,
  type SandboxChildSpec,
  SandboxError,
  type SandboxLayout,
  type SandboxRunOptions,
  isLoopbackPortFree,
  processAlive,
  readPid,
  readSandboxApiKey,
  readSandboxState,
  sandboxChildSpecs,
  sandboxLayout,
  sweepSandboxLeftovers,
} from './sandbox.js';

const MAX_FAST_CRASHES = 5;
const STABLE_AFTER_MS = 60_000;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const READY_TIMEOUT_MS = { pg: 180_000, nats: 30_000, api: 180_000 } as const;
const CHILD_STOP_TIMEOUT_MS = 20_000;
const MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * A child's log, kept under a size cap: a write that would pass it first moves
 * the log to `<log>.1` (replacing the older one) and starts a new one. pgserve
 * runs Postgres with `log_statement=all`, so pg.log would otherwise grow with
 * every query the API makes.
 */
export class CappedLog {
  private fd: number;
  private size: number;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly maxBytes = MAX_LOG_BYTES,
  ) {
    this.fd = openSync(path, 'a', 0o600);
    this.size = fstatSync(this.fd).size;
  }

  write(chunk: Uint8Array): void {
    if (this.closed) return;
    try {
      if (this.size > 0 && this.size + chunk.length > this.maxBytes) this.rotate();
      writeSync(this.fd, chunk);
      this.size += chunk.length;
    } catch {
      // a full or vanished disk must not take the supervisor down with it
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }

  private rotate(): void {
    closeSync(this.fd);
    renameSync(this.path, `${this.path}.1`);
    this.fd = openSync(this.path, 'a', 0o600);
    this.size = 0;
  }
}

export interface ChildHandle {
  pid: number;
  exited: Promise<number>;
  kill(signal: NodeJS.Signals): void;
}

export interface SupervisorDeps {
  spawnChild(spec: SandboxChildSpec): ChildHandle;
  /** Resolves true once the child's loopback port answers. */
  waitReady(spec: SandboxChildSpec, timeoutMs: number): Promise<boolean>;
  /** Creates the `omni` database on the sandbox's Postgres if it is missing; `password` for a password-file cluster. */
  ensureDatabase(port: number, password?: string): Promise<boolean>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  pid: number;
  isAlive(pid: number): boolean;
  env: Record<string, string | undefined>;
  onSignal(handler: (signal: NodeJS.Signals) => void): void;
  /** Stops children an earlier supervisor left running; resolves with how many. */
  sweepLeftovers?(layout: SandboxLayout): Promise<number>;
}

type ChildState = {
  spec: SandboxChildSpec;
  handle: ChildHandle | null;
  restarts: number;
  fastCrashes: number;
  state: 'starting' | 'ready' | 'restarting' | 'stopped' | 'failed';
};

export function spawnChildProcess(spec: SandboxChildSpec): ChildHandle {
  const [file, ...args] = spec.cmd;
  if (!file) throw new Error(`empty command for ${spec.name}`);
  // Output goes through the supervisor, so it can keep the log under its cap.
  const log = new CappedLog(spec.logPath);
  let child: ChildProcess;
  try {
    child = spawn(file, args, { env: spec.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    log.close();
    throw error;
  }
  child.stdout?.on('data', (chunk: Buffer) => log.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => log.write(chunk));
  child.once('close', () => log.close());
  const exited = new Promise<number>((done) => {
    child.once('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
    child.once('error', () => done(127));
  });
  return { pid: child.pid ?? -1, exited, kill: (signal) => child.kill(signal) };
}

async function waitPortAnswers(spec: SandboxChildSpec, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isLoopbackPortFree(spec.readyPort))) return true;
    await Bun.sleep(500);
  }
  return false;
}

function defaultSupervisorDeps(): SupervisorDeps {
  return {
    spawnChild: spawnChildProcess,
    waitReady: waitPortAnswers,
    ensureDatabase: async (port, password) =>
      (await waitForCanonicalReady(port, 60, password)) && ensureOmniDatabaseExists(port, password),
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
    // biome-ignore lint/suspicious/noConsole: the supervisor's log is its stdout
    log: (line) => console.log(`[omni-sandbox] ${new Date().toISOString()} ${line}`),
    pid: process.pid,
    isAlive: processAlive,
    env: process.env,
    onSignal: (handler) => {
      process.on('SIGTERM', () => handler('SIGTERM'));
      process.on('SIGINT', () => handler('SIGINT'));
    },
    sweepLeftovers: (layout) => sweepSandboxLeftovers(layout, undefined, [process.pid]),
  };
}

export class SandboxSupervisor {
  private readonly children: ChildState[];
  private stopping = false;
  private stopped: Promise<number> | null = null;
  private resolveDone: (code: number) => void = () => {};
  readonly done: Promise<number>;

  constructor(
    private readonly layout: SandboxLayout,
    specs: SandboxChildSpec[],
    private readonly deps: SupervisorDeps,
  ) {
    this.children = specs.map((spec) => ({ spec, handle: null, restarts: 0, fastCrashes: 0, state: 'stopped' }));
    this.done = new Promise((done) => {
      this.resolveDone = done;
    });
  }

  /** Starts every child in order; resolves with the exit code once stopped. */
  async run(): Promise<number> {
    writeFileSync(this.layout.pidPath, `${this.deps.pid}\n`, { mode: 0o600 });
    this.deps.onSignal((signal) => {
      this.deps.log(`received ${signal}, stopping`);
      void this.stop(0);
    });
    for (const child of this.children) {
      if (this.stopping) break;
      if (!(await this.startChild(child))) {
        await this.stop(SANDBOX_EXIT.failed);
        break;
      }
    }
    return this.done;
  }

  private writeStatus(): void {
    const status = {
      pid: this.deps.pid,
      updatedAt: new Date(this.deps.now()).toISOString(),
      children: Object.fromEntries(
        this.children.map((child) => [
          child.spec.name,
          { pid: child.handle?.pid ?? null, state: child.state, restarts: child.restarts },
        ]),
      ),
    };
    try {
      writeFileSync(this.layout.statusPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // status is advisory
    }
  }

  private async startChild(child: ChildState): Promise<boolean> {
    const { spec } = child;
    child.state = 'starting';
    this.writeStatus();
    const startedAt = this.deps.now();
    const handle = this.deps.spawnChild(spec);
    child.handle = handle;
    this.deps.log(`${spec.name} started (pid ${handle.pid})`);
    void handle.exited.then((code) => this.onExit(child, handle, code, startedAt));
    const ready = await this.deps.waitReady(spec, READY_TIMEOUT_MS[spec.name]);
    if (!ready || child.handle !== handle) {
      this.deps.log(`${spec.name} did not become ready on 127.0.0.1:${spec.readyPort}`);
      child.state = 'failed';
      this.writeStatus();
      return false;
    }
    if (spec.name === 'pg' && !(await this.deps.ensureDatabase(spec.readyPort, spec.superuserPassword))) {
      this.deps.log('could not create the omni database');
      child.state = 'failed';
      this.writeStatus();
      return false;
    }
    child.state = 'ready';
    this.writeStatus();
    this.deps.log(`${spec.name} ready on 127.0.0.1:${spec.readyPort}`);
    return true;
  }

  private async onExit(child: ChildState, handle: ChildHandle, code: number, startedAt: number): Promise<void> {
    if (child.handle !== handle) return;
    child.handle = null;
    if (this.stopping) {
      child.state = 'stopped';
      this.writeStatus();
      return;
    }
    const uptime = this.deps.now() - startedAt;
    child.fastCrashes = uptime >= STABLE_AFTER_MS ? 1 : child.fastCrashes + 1;
    this.deps.log(`${child.spec.name} exited with ${code} after ${Math.round(uptime / 1000)}s`);
    if (child.fastCrashes >= MAX_FAST_CRASHES) {
      this.deps.log(`${child.spec.name} keeps crashing; stopping the sandbox`);
      child.state = 'failed';
      this.writeStatus();
      await this.stop(SANDBOX_EXIT.failed);
      return;
    }
    child.state = 'restarting';
    child.restarts += 1;
    this.writeStatus();
    await this.deps.sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (child.fastCrashes - 1)));
    if (this.stopping) return;
    if (!(await this.startChild(child))) await this.stop(SANDBOX_EXIT.failed);
  }

  /** Stops the API, NATS and Postgres in that order; idempotent. */
  stop(code: number): Promise<number> {
    if (this.stopped) return this.stopped;
    this.stopping = true;
    this.stopped = (async () => {
      for (const child of [...this.children].reverse()) {
        const handle = child.handle;
        if (!handle) continue;
        this.deps.log(`stopping ${child.spec.name}`);
        handle.kill('SIGTERM');
        const exited = await Promise.race([
          handle.exited.then(() => true),
          this.deps.sleep(CHILD_STOP_TIMEOUT_MS).then(() => false),
        ]);
        if (!exited) handle.kill('SIGKILL');
        child.handle = null;
        if (child.state !== 'failed') child.state = 'stopped';
      }
      this.writeStatus();
      rmSync(this.layout.pidPath, { force: true });
      this.resolveDone(code);
      return code;
    })();
    return this.stopped;
  }

  childState(name: SandboxChildName): ChildState['state'] | undefined {
    return this.children.find((child) => child.spec.name === name)?.state;
  }
}

/** Entry of `omni sandbox run` (`--embedded`: {@link SandboxRunOptions}). */
export async function runSandboxSupervisor(
  home: string,
  deps: SupervisorDeps = defaultSupervisorDeps(),
  options: SandboxRunOptions = {},
): Promise<number> {
  const layout = sandboxLayout(home);
  const state = readSandboxState(layout);
  const apiKey = readSandboxApiKey(layout);
  if (!state || !apiKey) throw new SandboxError(`No sandboxed Omni at ${home}`, SANDBOX_EXIT.notInstalled);
  const running = readPid(layout);
  if (running !== null && running !== deps.pid && deps.isAlive(running)) {
    throw new SandboxError(`The sandbox at ${home} is already running (pid ${running})`);
  }
  // A supervisor that died hard (SIGKILL, a crash) leaves its children holding the ports.
  const swept = (await deps.sweepLeftovers?.(layout)) ?? 0;
  if (swept > 0) deps.log(`stopped ${swept} process(es) an earlier run left behind`);
  // Read at every start, so a file that is no longer safe (a symlink, readable by others) stops it.
  const pgPassword = state.pgPasswordFile ? readPgPasswordFile(state.pgPasswordFile) : null;
  const specs = sandboxChildSpecs(layout, state, apiKey, deps.env, options, pgPassword);
  const supervisor = new SandboxSupervisor(layout, specs, deps);
  return supervisor.run();
}
