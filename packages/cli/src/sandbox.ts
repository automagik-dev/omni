/**
 * Sandboxed local Omni
 *
 * `omni install --sandbox` / `omni sandbox <status|start|stop|uninstall|run>`.
 *
 * A complete Omni on this computer that shares nothing with an existing
 * install: everything lives under one home (default `$OMNI_HOME/sandbox`, else
 * `~/.omni/sandbox`), and nothing reads or writes `~/.omni/config.json`, the
 * user's PM2, the shared autopg/pgserve on 5432 or its socket directory.
 *
 *   <home>/sandbox.json        ports, version, runtime (no secrets)
 *   <home>/config/config.json  CLI config for this Omni (API key, mode 0600)
 *   <home>/runtime/            @automagik/omni (+ pgserve off the autopg platforms), installed with bun
 *   <home>/autopg/<version>/   autopg's pinned release, where it has a build (autopg-runtime.ts)
 *   <home>/cache/              bun's package cache for that install
 *   <home>/bin/nats-server     its own NATS binary (nats-server.pin: the release it was verified as)
 *   <home>/data/{pg,nats,media,packages}
 *   <home>/pgserve/            autopg/pgserve's config dir and Postgres binaries
 *   <home>/run/                supervisor pid, status, Postgres socket dir
 *   <home>/logs/               one log per process
 *
 * One supervisor (`omni sandbox run`) owns Postgres (pgserve's postmaster on
 * its own cluster), NATS and the API, all on loopback, started in that order
 * and restarted with backoff. It is the first concrete step of the omnid
 * design (.genie/brainstorms/omni-local-daemon): same shape, scoped to a
 * sandbox. `--at-login` adds a per-user launchd agent or systemd --user unit
 * (no sudo) that runs the supervisor; those unit files are the only writes
 * outside the home. Without it the supervisor still runs under the user's
 * service manager, for this login only (a transient systemd --user service, a
 * launchd job whose plist stays in <home>/run), so it outlives whatever ran
 * the CLI; a detached child is the fallback where there is none.
 *
 * Every function that touches processes, ports, the network or the clock
 * takes its effects from {@link SandboxDeps}, so tests run none of them.
 */

import { type SpawnOptions, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  AUTOPG_PIN,
  type AutopgPaths,
  type AutopgPin,
  type AutopgTarget,
  autopgBinary,
  autopgRuntimeReady,
  autopgTarget,
  clusterRanWithPasswordFile,
  detectLibc,
  downloadRelease,
  installAutopgRuntime,
} from './autopg-runtime.js';
import { quoteSystemdArg } from './install-helpers.js';
import { type NatsInstall, installNatsBinary } from './nats-install.js';
import { buildNatsServerArgs } from './nats-server-args.js';
import { generateApiKey } from './utils/keys.js';
import { VERSION } from './version.js';

/**
 * pgserve release whose `postmaster` runs the sandbox's own Postgres cluster, on the platforms
 * autopg's pinned release has no build for (autopg-runtime.ts).
 */
export const SANDBOX_PGSERVE_VERSION = '2.6.10';
/** Ports tried first; the next free one up is taken when a port is in use. */
export const SANDBOX_PREFERRED_PORTS = { api: 18882, pg: 15432, nats: 14222 } as const;
const PORT_SEARCH_SPAN = 200;
/** First boot downloads the Postgres binaries, so the API can take a while. */
const SANDBOX_HEALTH_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 30_000;
const LAUNCHD_LABEL = 'ai.namastex.omni.sandbox';
const SYSTEMD_UNIT = 'omni-sandbox';
const SYSTEMD_RUN_LITERAL_ARGV = '--expand-environment=no';

/** Exit codes of the sandbox commands. */
export const SANDBOX_EXIT = { ok: 0, failed: 1, notInstalled: 3 } as const;

// ----------------------------------------------------------------------------
// Layout and state
// ----------------------------------------------------------------------------

export interface SandboxLayout {
  home: string;
  statePath: string;
  configDir: string;
  configPath: string;
  runtimeDir: string;
  cacheDir: string;
  natsBinary: string;
  dataDir: string;
  pgDataDir: string;
  natsDataDir: string;
  pgserveConfigDir: string;
  autopgDir: string;
  runDir: string;
  pgSocketDir: string;
  pidPath: string;
  statusPath: string;
  logsDir: string;
}

/** Where the sandbox lives: `--home`, else `$OMNI_HOME/sandbox`, else `~/.omni/sandbox`. */
export function resolveSandboxHome(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
  userHome: string = homedir(),
): string {
  if (flag && flag.trim().length > 0) return resolve(flag.trim());
  const omniHome = env.OMNI_HOME?.trim();
  if (omniHome) return join(resolve(omniHome), 'sandbox');
  return join(userHome, '.omni', 'sandbox');
}

export function sandboxLayout(home: string): SandboxLayout {
  const dataDir = join(home, 'data');
  const runDir = join(home, 'run');
  return {
    home,
    statePath: join(home, 'sandbox.json'),
    configDir: join(home, 'config'),
    configPath: join(home, 'config', 'config.json'),
    runtimeDir: join(home, 'runtime'),
    cacheDir: join(home, 'cache'),
    natsBinary: join(home, 'bin', 'nats-server'),
    dataDir,
    pgDataDir: join(dataDir, 'pg'),
    natsDataDir: join(dataDir, 'nats'),
    pgserveConfigDir: join(home, 'pgserve'),
    autopgDir: join(home, 'autopg'),
    runDir,
    pgSocketDir: join(runDir, 'pg'),
    pidPath: join(runDir, 'supervisor.pid'),
    statusPath: join(runDir, 'status.json'),
    logsDir: join(home, 'logs'),
  };
}

const PortSchema = z.number().int().min(1024).max(65535);

export const SandboxStateSchema = z.object({
  schemaVersion: z.literal(1),
  /** @automagik/omni version the runtime carries. */
  version: z.string().min(1),
  /** Dependency spec installed into the runtime (a version, or file:/npm: spec). */
  packageSpec: z.string().min(1),
  /** Absolute path of the bun that runs every process. */
  bun: z.string().min(1),
  ports: z.object({ api: PortSchema, pg: PortSchema, nats: PortSchema }),
  atLogin: z.boolean(),
  /**
   * The default home when it was installed, which names its at-login unit (sandboxUnitNames).
   * Kept so that a reinstall from anywhere names it the same: an update the API hands off runs
   * without the OMNI_HOME of whoever installed it. Absent in sandboxes from before it was kept.
   */
  defaultHome: z.string().min(1).optional(),
  /** autopg release whose binary runs Postgres; absent where npm pgserve does. */
  autopg: z.string().min(1).optional(),
  /**
   * Opt-in (`--pg-password-file`): the superuser password file of a password-file cluster, which
   * takes scram logins on 127.0.0.1 only. Absent: the `postgres`/`postgres` login, as before.
   */
  pgPasswordFile: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SandboxState = z.infer<typeof SandboxStateSchema>;

/** The default home that names this sandbox's units: the one recorded at install, else the caller's. */
const unitDefaultHome = (state: SandboxState | null, callerDefault: string): string =>
  state?.defaultHome ?? callerDefault;

export function readSandboxState(layout: SandboxLayout): SandboxState | null {
  if (!existsSync(layout.statePath)) return null;
  try {
    const parsed = SandboxStateSchema.safeParse(JSON.parse(readFileSync(layout.statePath, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeSandboxState(layout: SandboxLayout, state: SandboxState): void {
  writeFileSync(layout.statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

const SandboxConfigSchema = z.object({ apiKey: z.string().min(1) }).passthrough();

/** The sandbox's API key, from its own config file. */
export function readSandboxApiKey(layout: SandboxLayout): string | null {
  if (!existsSync(layout.configPath)) return null;
  try {
    const parsed = SandboxConfigSchema.safeParse(JSON.parse(readFileSync(layout.configPath, 'utf-8')));
    return parsed.success ? parsed.data.apiKey : null;
  } catch {
    return null;
  }
}

/**
 * The CLI config of the sandbox, in the shape `omni` reads with
 * `OMNI_CONFIG_DIR=<home>/config`, so `omni status` and friends work against it.
 */
function buildSandboxConfig(layout: SandboxLayout, state: SandboxState, apiKey: string): Record<string, unknown> {
  return {
    apiUrl: sandboxApiUrl(state),
    apiKey,
    format: 'human',
    server: {
      port: state.ports.api,
      databaseUrl: sandboxDatabaseUrl(state),
      dataDir: layout.dataDir,
      logLevel: 'info',
      nodeEnv: 'production',
      natsHost: '127.0.0.1',
    },
  };
}

function writeSandboxConfig(layout: SandboxLayout, state: SandboxState, apiKey: string): void {
  mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
  writeFileSync(layout.configPath, `${JSON.stringify(buildSandboxConfig(layout, state, apiKey), null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(layout.configPath, 0o600);
}

const sandboxApiUrl = (state: SandboxState): string => `http://127.0.0.1:${state.ports.api}`;
/**
 * A password-file cluster takes 127.0.0.1 only (`localhost` can resolve to ::1), and its password
 * goes only into the API's env: config.json gets the URL without it.
 */
function sandboxDatabaseUrl(state: SandboxState, password: string | null = null): string {
  if (!state.pgPasswordFile) return `postgresql://postgres:postgres@localhost:${state.ports.pg}/omni`;
  const login = password === null ? 'postgres' : `postgres:${encodeURIComponent(password)}`;
  return `postgresql://${login}@127.0.0.1:${state.ports.pg}/omni`;
}

// ----------------------------------------------------------------------------
// Processes
// ----------------------------------------------------------------------------

/** Variables a child may inherit; everything else comes from the sandbox. */
const INHERITED_ENV = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ'] as const;

/**
 * Base environment of every sandbox process. It starts empty and takes only
 * {@link INHERITED_ENV} from the caller, so a DATABASE_URL, PGHOST, PM2_HOME or
 * OMNI_CONFIG_DIR exported in the user's shell never reaches the sandbox.
 */
function sandboxBaseEnv(
  layout: SandboxLayout,
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = parentEnv[key];
    if (value !== undefined) env[key] = value;
  }
  // `bun run` and `bun x` put their own node_modules/.bin dirs first; a unit keeps the PATH for good.
  if (env.PATH) {
    env.PATH = env.PATH.split(':')
      .filter((dir) => dir.length > 0 && !dir.endsWith('/node_modules/.bin'))
      .join(':');
  }
  env.OMNI_CONFIG_DIR = layout.configDir;
  env.OMNI_SANDBOX_HOME = layout.home;
  env.AUTOPG_CONFIG_DIR = layout.pgserveConfigDir;
  env.PGSERVE_CONFIG_DIR = layout.pgserveConfigDir;
  env.PM2_HOME = join(layout.runDir, 'pm2');
  env.BUN_INSTALL_CACHE_DIR = layout.cacheDir;
  env.OMNI_TELEMETRY = 'false';
  return env;
}

export type SandboxChildName = 'pg' | 'nats' | 'api';

export interface SandboxChildSpec {
  name: SandboxChildName;
  cmd: string[];
  env: Record<string, string>;
  /** Loopback TCP port that answers once the child is ready. */
  readyPort: number;
  logPath: string;
  /** pg of a password-file cluster: the superuser password, to create the `omni` database. */
  superuserPassword?: string;
}

export interface SandboxRunOptions {
  /**
   * Run for an app that embeds this Omni (`omni sandbox run --embedded`): the API sends no crash
   * reports, checks for no updates and reads no plugin lane. The app ships Omni's updates itself.
   */
  embedded?: boolean;
}

/** What the API of an embedded sandbox gets in place of the update settings. */
const EMBEDDED_API_ENV = {
  // instrument.ts falls back to its hard-coded DSN when SENTRY_DSN is unset; empty turns it off.
  SENTRY_DSN: '',
  OMNI_UPDATE_CHECK: 'false',
  OMNI_PLUGIN_LANE: 'off',
} as const;

/**
 * autopg's (or pgserve's) postmaster: a plain Postgres cluster with its own data dir and socket
 * dir. The socket dir must be ours: the default is the shared `$XDG_RUNTIME_DIR/pgserve`, where it
 * would overwrite runtime.json. A password-file cluster makes no socket at all.
 */
function pgCommand(layout: SandboxLayout, state: SandboxState): string[] {
  const args = ['postmaster', '--port', String(state.ports.pg), '--data', layout.pgDataDir];
  args.push('--socket-dir', layout.pgSocketDir);
  if (!state.autopg) {
    return [state.bun, join(layout.runtimeDir, 'node_modules', 'pgserve', 'bin', 'postgres-server.js'), ...args];
  }
  if (state.pgPasswordFile) args.push('--password-file', state.pgPasswordFile);
  return [autopgBinary(layout.autopgDir, state.autopg), ...args];
}

/**
 * The three children, in start order. A password-file sandbox needs `pgPassword`, read from its
 * file (readPgPasswordFile) by the supervisor.
 */
export function sandboxChildSpecs(
  layout: SandboxLayout,
  state: SandboxState,
  apiKey: string,
  parentEnv: Record<string, string | undefined> = process.env,
  options: SandboxRunOptions = {},
  pgPassword: string | null = null,
): SandboxChildSpec[] {
  if (state.pgPasswordFile && pgPassword === null) {
    throw new SandboxError(`The sandbox at ${layout.home} needs the password in ${state.pgPasswordFile}`);
  }
  const base = sandboxBaseEnv(layout, parentEnv);
  const modules = join(layout.runtimeDir, 'node_modules');
  const embedded = options.embedded === true;
  return [
    {
      name: 'pg',
      cmd: pgCommand(layout, state),
      env: base,
      readyPort: state.ports.pg,
      logPath: join(layout.logsDir, 'pg.log'),
      ...(pgPassword === null ? {} : { superuserPassword: pgPassword }),
    },
    {
      name: 'nats',
      cmd: [
        layout.natsBinary,
        ...buildNatsServerArgs({ natsDataDir: layout.natsDataDir, host: '127.0.0.1' }),
        '-p',
        String(state.ports.nats),
      ],
      env: base,
      readyPort: state.ports.nats,
      logPath: join(layout.logsDir, 'nats.log'),
    },
    {
      name: 'api',
      cmd: [state.bun, join(modules, '@automagik', 'omni', 'dist', 'server', 'index.js')],
      env: {
        ...base,
        API_PORT: String(state.ports.api),
        API_HOST: '127.0.0.1',
        DATABASE_URL: sandboxDatabaseUrl(state, pgPassword),
        // For libpq tools only: postgres.js takes the URL's `localhost` over PGHOST and dials TCP.
        // A password-file cluster has no socket.
        ...(state.pgPasswordFile ? {} : { PGHOST: layout.pgSocketDir }),
        PGPORT: String(state.ports.pg),
        OMNI_API_KEY: apiKey,
        MEDIA_STORAGE_PATH: join(layout.dataDir, 'media'),
        OMNI_PACKAGES_DIR: join(layout.dataDir, 'packages'),
        PGSERVE_EMBEDDED: 'false',
        PGSERVE_DATA: layout.pgDataDir,
        PGSERVE_PORT: String(state.ports.pg),
        NATS_URL: `nats://127.0.0.1:${state.ports.nats}`,
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        // Where the API keeps update and plugin-lane state, embedded or not (else ./data of its cwd).
        OMNI_UPDATE_STATE_DIR: layout.dataDir,
        ...(embedded
          ? EMBEDDED_API_ENV
          : {
              // Updates from the app (packages/api/src/system/update.ts): this API listens on
              // loopback only, so the app's own yes confirms them, and the runtime's CLI hands
              // the update off.
              OMNI_UPDATE_COMMAND: JSON.stringify(sandboxUpdateCommand(layout, state)),
              OMNI_UPDATE_CONFIRM: 'app',
            }),
      },
      readyPort: state.ports.api,
      logPath: join(layout.logsDir, 'api.log'),
    },
  ];
}

/** The command that runs the supervisor, from the runtime's own copy of the CLI. */
export function supervisorCommand(layout: SandboxLayout, state: SandboxState): string[] {
  return [
    state.bun,
    join(layout.runtimeDir, 'node_modules', '@automagik', 'omni', 'bin', 'omni'),
    'sandbox',
    'run',
    '--home',
    layout.home,
  ];
}

/** What the API runs to update this sandbox: the runtime's own CLI, `omni sandbox update`. */
export function sandboxUpdateCommand(layout: SandboxLayout, state: SandboxState): string[] {
  const [bun, cli] = supervisorCommand(layout, state);
  return [bun as string, cli as string, 'sandbox', 'update', '--home', layout.home];
}

// ----------------------------------------------------------------------------
// At-login units
// ----------------------------------------------------------------------------

export interface SandboxUnitNames {
  /** launchd label of the at-login agent. */
  label: string;
  /** systemd --user unit of the at-login service. */
  systemdUnit: string;
  /** launchd label of the job that runs the supervisor for this login only. */
  sessionLabel: string;
  /** Transient systemd --user unit that runs the supervisor for this login only. */
  sessionUnit: string;
}

/**
 * Unit names. An at-login unit outside the default home gets a suffix of its
 * own. A session unit always carries its home's: which home is the default
 * depends on the caller's $OMNI_HOME (an app sets its own), so two sandboxes
 * could both be "the default" and one start would stop the other's unit.
 */
export function sandboxUnitNames(home: string, defaultHome: string): SandboxUnitNames {
  const hash = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 8);
  const suffix = resolve(home) === resolve(defaultHome) ? '' : `-${hash(home)}`;
  const own = `-${hash(resolve(home))}`;
  return {
    label: `${LAUNCHD_LABEL}${suffix}`,
    systemdUnit: `${SYSTEMD_UNIT}${suffix}.service`,
    sessionLabel: `${LAUNCHD_LABEL}${own}.session`,
    sessionUnit: `${SYSTEMD_UNIT}${own}-session.service`,
  };
}

const xmlEscape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A launchd job that runs the supervisor. The at-login agent (in LaunchAgents)
 * is kept alive; the session job (`keepAlive: false`, its plist in the run
 * dir) runs once when bootstrapped and is gone at logout.
 */
export function buildLaunchdPlist(
  label: string,
  cmd: string[],
  layout: SandboxLayout,
  env: Record<string, string>,
  opts: { keepAlive?: boolean } = {},
): string {
  const args = cmd.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n');
  const vars = Object.entries(env)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n');
  const log = xmlEscape(join(layout.logsDir, 'supervisor.log'));
  const keepAlive =
    opts.keepAlive === false
      ? ''
      : `  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${vars}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(layout.home)}</string>
  <key>RunAtLoad</key>
  <true/>
${keepAlive}  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`;
}

export function buildSystemdUserUnit(cmd: string[], layout: SandboxLayout, env: Record<string, string>): string {
  const environment = Object.entries(env)
    .map(([key, value]) => `Environment=${quoteSystemdArg(`${key}=${value}`)}`)
    .join('\n');
  // WorkingDirectory= takes the path as it is: systemd refuses a quoted one as "not absolute".
  if (/[\r\n]/.test(layout.home)) throw new Error(`sandbox home must not contain a newline: ${layout.home}`);
  return `[Unit]
Description=Omni (sandbox at ${layout.home})

[Service]
Type=simple
ExecStart=${cmd.map(quoteSystemdArg).join(' ')}
WorkingDirectory=${layout.home.replace(/%/g, '%%')}
${environment}
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

/**
 * `systemd-run --user` that starts the supervisor as a transient service of
 * the user's systemd: a cgroup of its own, outside whatever started the CLI
 * (a terminal's scope that is killed whole when the terminal ends, say), gone
 * once it stops (`--collect`) and never started at login. KillMode=mixed lets
 * `systemctl stop` reach the supervisor first, which stops its children in order.
 * `literalArgv` (systemd 254+) keeps a `$` in a path from being expanded.
 */
function buildSystemdRunCommand(
  unit: string,
  cmd: string[],
  layout: SandboxLayout,
  env: Record<string, string>,
  literalArgv: boolean,
  job: { description: string; log: string } = {
    description: `Omni (sandbox at ${layout.home})`,
    log: join(layout.logsDir, 'supervisor.log'),
  },
): string[] {
  if (/[\r\n]/.test(layout.home)) throw new Error(`sandbox home must not contain a newline: ${layout.home}`);
  const log = job.log;
  return [
    'systemd-run',
    '--user',
    '--quiet',
    '--collect',
    `--unit=${unit}`,
    `--description=${job.description}`,
    ...(literalArgv ? [SYSTEMD_RUN_LITERAL_ARGV] : []),
    `--working-directory=${layout.home}`,
    '--property=Type=simple',
    '--property=KillMode=mixed',
    '--property=KillSignal=SIGTERM',
    `--property=TimeoutStopSec=${STOP_TIMEOUT_MS / 1000}`,
    `--property=StandardOutput=append:${log}`,
    `--property=StandardError=append:${log}`,
    ...Object.entries(env).map(([key, value]) => `--setenv=${key}=${value}`),
    '--',
    ...cmd,
  ];
}

// ----------------------------------------------------------------------------
// Effects
// ----------------------------------------------------------------------------

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SandboxDeps {
  platform: NodeJS.Platform;
  arch: string;
  /** The C library on Linux (autopg builds against glibc only); null elsewhere. */
  libc: 'glibc' | 'musl' | null;
  /** The autopg release Postgres comes from where it has a build (autopg-pin.json). */
  autopgPin: AutopgPin;
  /** Fetches a release asset: the autopg tarball. */
  download(url: string): Promise<Uint8Array>;
  uid: number;
  /** The user's home, where launchd agents and systemd user units live. */
  userHome: string;
  /** Absolute path of the bun running this CLI. */
  bun: string;
  env: Record<string, string | undefined>;
  run(cmd: string[], opts: { cwd?: string; env: Record<string, string> }): Promise<RunResult>;
  spawnDetached(cmd: string[], opts: { cwd: string; env: Record<string, string>; logPath: string }): number;
  isPortFree(port: number): Promise<boolean>;
  health(apiUrl: string, timeoutMs: number): Promise<boolean>;
  /** Installs the pinned nats-server at `target`, or keeps the one there when it is the pin. */
  installNats(target: string): Promise<NatsInstall>;
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

async function runCommand(cmd: string[], opts: { cwd?: string; env: Record<string, string> }): Promise<RunResult> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn({ cmd, cwd: opts.cwd, env: opts.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  } catch (error) {
    // Not installed here (no systemd-run on a non-systemd Linux, say): a failed run, not a crash.
    return { code: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function spawnDetachedProcess(
  cmd: string[],
  opts: { cwd: string; env: Record<string, string>; logPath: string },
): number {
  const [file, ...args] = cmd;
  if (!file) throw new Error('empty command');
  const log = openSync(opts.logPath, 'a', 0o600);
  try {
    const options: SpawnOptions = { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['ignore', log, log] };
    const child = spawn(file, args, options);
    child.unref();
    if (child.pid === undefined) throw new Error(`could not start ${file}`);
    return child.pid;
  } finally {
    closeSync(log);
  }
}

/** True when nothing answers on 127.0.0.1:<port>. */
export function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (free: boolean) => {
      socket.destroy();
      done(free);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'));
  });
}

async function pollHealth(apiUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetch(`${apiUrl}/api/v2/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    if (Date.now() + 1000 > deadline) break;
    await Bun.sleep(1000);
  } while (Date.now() < deadline);
  return false;
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function defaultSandboxDeps(): SandboxDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    libc: detectLibc(),
    autopgPin: AUTOPG_PIN,
    download: downloadRelease,
    uid: process.getuid?.() ?? 0,
    userHome: homedir(),
    bun: process.execPath,
    env: process.env,
    run: runCommand,
    spawnDetached: spawnDetachedProcess,
    isPortFree: isLoopbackPortFree,
    health: pollHealth,
    installNats: installNatsBinary,
    isAlive: processAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    now: () => new Date(),
    sleep: (ms) => Bun.sleep(ms),
  };
}

// ----------------------------------------------------------------------------
// Reports
// ----------------------------------------------------------------------------

/** What every sandbox command prints with `--json`. Never carries the API key. */
export interface SandboxReport {
  ok: boolean;
  installed: boolean;
  home: string;
  version: string | null;
  apiUrl: string | null;
  configPath: string;
  running: boolean;
  healthy: boolean;
  atLogin: boolean;
  ports: { api: number; pg: number; nats: number } | null;
  pid: number | null;
  logsDir: string;
  error?: string;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = SANDBOX_EXIT.failed,
  ) {
    super(message);
  }
}

export function readPid(layout: SandboxLayout): number | null {
  try {
    const pid = Number.parseInt(readFileSync(layout.pidPath, 'utf-8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function livePid(layout: SandboxLayout, deps: SandboxDeps): number | null {
  const pid = readPid(layout);
  return pid !== null && deps.isAlive(pid) ? pid : null;
}

async function report(layout: SandboxLayout, deps: SandboxDeps, checkHealthFor = 2000): Promise<SandboxReport> {
  const state = readSandboxState(layout);
  if (!state) {
    return {
      ok: true,
      installed: false,
      home: layout.home,
      version: null,
      apiUrl: null,
      configPath: layout.configPath,
      running: false,
      healthy: false,
      atLogin: false,
      ports: null,
      pid: null,
      logsDir: layout.logsDir,
    };
  }
  const pid = livePid(layout, deps);
  const apiUrl = sandboxApiUrl(state);
  const healthy = pid !== null ? await deps.health(apiUrl, checkHealthFor) : false;
  return {
    ok: true,
    installed: true,
    home: layout.home,
    version: state.version,
    apiUrl,
    configPath: layout.configPath,
    running: pid !== null,
    healthy,
    atLogin: state.atLogin,
    ports: { ...state.ports },
    pid,
    logsDir: layout.logsDir,
  };
}

// ----------------------------------------------------------------------------
// Operations
// ----------------------------------------------------------------------------

export interface SandboxInstallOptions {
  home: string;
  defaultHome: string;
  /** Dependency spec for @automagik/omni in the runtime; defaults to this CLI's version. */
  packageSpec?: string;
  atLogin?: boolean;
  start?: boolean;
  healthTimeoutMs?: number;
  /** Opt-in: run a password-file cluster with the password in this file (kept on reinstall). */
  pgPasswordFile?: string;
  /** The pinned autopg tarball as a local file, for an install without the network. */
  autopgTarball?: string;
}

async function pickPort(preferred: number, taken: Set<number>, deps: SandboxDeps): Promise<number> {
  for (let port = preferred; port < preferred + PORT_SEARCH_SPAN; port++) {
    if (taken.has(port)) continue;
    if (await deps.isPortFree(port)) return port;
  }
  throw new SandboxError(`No free port on 127.0.0.1 between ${preferred} and ${preferred + PORT_SEARCH_SPAN - 1}`);
}

async function pickPorts(deps: SandboxDeps): Promise<SandboxState['ports']> {
  const taken = new Set<number>();
  const api = await pickPort(SANDBOX_PREFERRED_PORTS.api, taken, deps);
  taken.add(api);
  const pg = await pickPort(SANDBOX_PREFERRED_PORTS.pg, taken, deps);
  taken.add(pg);
  const nats = await pickPort(SANDBOX_PREFERRED_PORTS.nats, taken, deps);
  return { api, pg, nats };
}

function ensureLayout(layout: SandboxLayout): void {
  for (const dir of [
    layout.home,
    layout.configDir,
    layout.runtimeDir,
    layout.cacheDir,
    join(layout.home, 'bin'),
    layout.dataDir,
    layout.pgDataDir,
    layout.natsDataDir,
    join(layout.dataDir, 'media'),
    join(layout.dataDir, 'packages'),
    layout.pgserveConfigDir,
    layout.runDir,
    layout.pgSocketDir,
    layout.logsDir,
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** The runtime's package.json: this Omni, and the pgserve that runs its Postgres where autopg does not. */
function buildRuntimeManifest(packageSpec: string, withPgserve: boolean): string {
  const dependencies: Record<string, string> = { '@automagik/omni': packageSpec };
  if (withPgserve) dependencies.pgserve = SANDBOX_PGSERVE_VERSION;
  return `${JSON.stringify(
    {
      name: 'omni-sandbox-runtime',
      private: true,
      dependencies,
    },
    null,
    2,
  )}\n`;
}

function installedVersion(layout: SandboxLayout, name: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(layout.runtimeDir, 'node_modules', name, 'package.json'), 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Installs the runtime with bun, unless it already carries exactly this manifest. */
async function ensureRuntime(
  layout: SandboxLayout,
  packageSpec: string,
  withPgserve: boolean,
  deps: SandboxDeps,
): Promise<string> {
  const manifestPath = join(layout.runtimeDir, 'package.json');
  const manifest = buildRuntimeManifest(packageSpec, withPgserve);
  const current = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : null;
  const omniVersion = installedVersion(layout, '@automagik/omni');
  const pgserveReady = !withPgserve || installedVersion(layout, 'pgserve') === SANDBOX_PGSERVE_VERSION;
  if (current === manifest && omniVersion && pgserveReady) {
    return omniVersion;
  }
  writeFileSync(manifestPath, manifest, { mode: 0o600 });
  const result = await deps.run([deps.bun, 'install', '--production'], {
    cwd: layout.runtimeDir,
    env: sandboxBaseEnv(layout, deps.env),
  });
  if (result.code !== 0) {
    // Put the manifest back: left naming the new version over the old modules, the next try
    // would read as already installed and never install it.
    if (current === null) rmSync(manifestPath, { force: true });
    else writeFileSync(manifestPath, current, { mode: 0o600 });
    throw new SandboxError(
      `bun install failed in ${layout.runtimeDir}: ${result.stderr.trim().split('\n').slice(-3).join(' ')}`,
    );
  }
  const installed = installedVersion(layout, '@automagik/omni');
  if (!installed) throw new SandboxError(`@automagik/omni is missing from ${layout.runtimeDir} after bun install`);
  return installed;
}

function unitPaths(names: { label: string; systemdUnit: string }, deps: SandboxDeps) {
  return {
    plist: join(deps.userHome, 'Library', 'LaunchAgents', `${names.label}.plist`),
    unit: join(deps.userHome, '.config', 'systemd', 'user', names.systemdUnit),
  };
}

/**
 * Environment for systemctl --user and launchctl. They talk to the user's own
 * session (its bus and XDG_RUNTIME_DIR), so they get the caller's environment,
 * not the sandbox's stripped one; the processes they start still get only the
 * sandbox environment written into their unit.
 */
function serviceManagerEnv(deps: Pick<SandboxDeps, 'env' | 'platform' | 'uid'>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(deps.env)) if (value !== undefined) env[key] = value;
  // A caller started outside a login shell (an app's terminal, say) may lack it; systemd's is fixed.
  if (deps.platform === 'linux' && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${deps.uid}`;
  return env;
}

function atLoginSupported(deps: SandboxDeps): boolean {
  return deps.platform === 'darwin' || deps.platform === 'linux';
}

async function writeAtLoginUnit(
  layout: SandboxLayout,
  state: SandboxState,
  opts: SandboxInstallOptions,
  deps: SandboxDeps,
) {
  if (!atLoginSupported(deps)) throw new SandboxError(`--at-login is not supported on ${deps.platform}`);
  const names = sandboxUnitNames(layout.home, opts.defaultHome);
  const paths = unitPaths(names, deps);
  const cmd = supervisorCommand(layout, state);
  const env = sandboxBaseEnv(layout, deps.env);
  if (deps.platform === 'darwin') {
    mkdirSync(join(deps.userHome, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(paths.plist, buildLaunchdPlist(names.label, cmd, layout, env), { mode: 0o600 });
  } else {
    mkdirSync(join(deps.userHome, '.config', 'systemd', 'user'), { recursive: true });
    writeFileSync(paths.unit, buildSystemdUserUnit(cmd, layout, env), { mode: 0o600 });
    const host = { env: serviceManagerEnv(deps) };
    await deps.run(['systemctl', '--user', 'daemon-reload'], host);
    // Enabled now, so the next login starts it even when the supervisor already runs on its own.
    const enabled = await deps.run(['systemctl', '--user', 'enable', names.systemdUnit], host);
    if (enabled.code !== 0) {
      throw new SandboxError(
        `systemctl --user could not enable ${names.systemdUnit} (is there a systemd user session?): ${enabled.stderr.trim()}`,
      );
    }
  }
}

async function removeAtLoginUnit(layout: SandboxLayout, defaultHome: string, deps: SandboxDeps): Promise<void> {
  const names = sandboxUnitNames(layout.home, defaultHome);
  const paths = unitPaths(names, deps);
  const env = serviceManagerEnv(deps);
  if (deps.platform === 'darwin') {
    await deps.run(['launchctl', 'bootout', `gui/${deps.uid}/${names.label}`], { env });
    if (existsSync(paths.plist)) unlinkSync(paths.plist);
  } else if (deps.platform === 'linux') {
    await deps.run(['systemctl', '--user', 'disable', '--now', names.systemdUnit], { env });
    if (existsSync(paths.unit)) unlinkSync(paths.unit);
    await deps.run(['systemctl', '--user', 'daemon-reload'], { env });
  }
}

/**
 * Command-line fragments that mark a process as one of this sandbox's children:
 * autopg's binary or pgserve's postmaster wrapper, the postgres it runs, NATS and the API. Every
 * one is a path inside the home, so nothing else on the machine matches.
 */
function sandboxChildMarkers(layout: SandboxLayout): string[] {
  const modules = join(layout.runtimeDir, 'node_modules');
  return [
    join(modules, 'pgserve', 'bin', 'postgres-server.js'),
    `${layout.autopgDir}/`,
    `${join(layout.pgserveConfigDir, 'bin')}/`,
    layout.natsBinary,
    join(modules, '@automagik', 'omni', 'dist', 'server', 'index.js'),
  ];
}

/** Pids in `ps -axo pid=,args=` output whose command line carries a child marker. */
export function leftoverChildPids(psOutput: string, layout: SandboxLayout, exclude: number[] = []): number[] {
  const markers = sandboxChildMarkers(layout);
  const pids: number[] = [];
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const pid = Number.parseInt(match[1], 10);
    if (exclude.includes(pid)) continue;
    const args = match[2];
    if (markers.some((marker) => args.includes(marker))) pids.push(pid);
  }
  return pids;
}

/**
 * Stops children an earlier supervisor left behind. A supervisor killed with
 * SIGKILL (or a crash) cannot stop its children, and they keep the sandbox's
 * ports, so a new one would restart-loop against them and `stop` could not
 * reach them. Returns how many it stopped.
 */
export async function sweepSandboxLeftovers(
  layout: SandboxLayout,
  deps: Pick<SandboxDeps, 'run' | 'kill' | 'isAlive' | 'sleep' | 'now' | 'env'> = defaultSandboxDeps(),
  exclude: number[] = [process.pid],
): Promise<number> {
  const ps = await deps.run(['ps', '-axo', 'pid=,args='], { env: sandboxBaseEnv(layout, deps.env) });
  if (ps.code !== 0) return 0;
  const pids = leftoverChildPids(ps.stdout, layout, exclude);
  for (const pid of pids) {
    try {
      deps.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  const deadline = deps.now().getTime() + STOP_TIMEOUT_MS;
  while (pids.some((pid) => deps.isAlive(pid)) && deps.now().getTime() < deadline) await deps.sleep(250);
  for (const pid of pids.filter((pid) => deps.isAlive(pid))) {
    try {
      deps.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return pids.length;
}

const sessionPlistPath = (layout: SandboxLayout, names: SandboxUnitNames): string =>
  join(layout.runDir, `${names.sessionLabel}.plist`);

/**
 * Starts the supervisor for this login only (no at-login unit). It goes to the
 * user's service manager, a transient systemd --user service or a launchd job
 * in the GUI domain, so it belongs to neither the CLI nor whatever ran the CLI:
 * an app that runs the install in a terminal and then ends that terminal's
 * whole process range (a systemd scope, a process tree) leaves it running. A
 * detached child is the fallback where there is no service manager to ask.
 */
async function startSessionSupervisor(
  layout: SandboxLayout,
  state: SandboxState,
  defaultHome: string,
  deps: SandboxDeps,
): Promise<void> {
  const cmd = supervisorCommand(layout, state);
  const env = sandboxBaseEnv(layout, deps.env);
  const names = sandboxUnitNames(layout.home, defaultHome);
  const host = { env: serviceManagerEnv(deps) };
  if (deps.platform === 'linux') {
    // A unit of an earlier run that is still loaded would make systemd-run refuse the name.
    await deps.run(['systemctl', '--user', 'stop', names.sessionUnit], host);
    let started = await deps.run(buildSystemdRunCommand(names.sessionUnit, cmd, layout, env, true), host);
    if (started.code !== 0 && /unrecognized option.*expand-environment/.test(started.stderr)) {
      started = await deps.run(buildSystemdRunCommand(names.sessionUnit, cmd, layout, env, false), host);
    }
    if (started.code === 0) return;
  } else if (deps.platform === 'darwin') {
    const plist = sessionPlistPath(layout, names);
    writeFileSync(plist, buildLaunchdPlist(names.sessionLabel, cmd, layout, env, { keepAlive: false }), {
      mode: 0o600,
    });
    // A job of an earlier run stays loaded after its supervisor exits; bootstrap refuses a loaded label.
    await deps.run(['launchctl', 'bootout', `gui/${deps.uid}/${names.sessionLabel}`], host);
    const started = await deps.run(['launchctl', 'bootstrap', `gui/${deps.uid}`, plist], host);
    if (started.code === 0) return;
    rmSync(plist, { force: true });
  }
  deps.spawnDetached(cmd, { cwd: layout.home, env, logPath: join(layout.logsDir, 'supervisor.log') });
}

/** Stops the session unit or job, if the supervisor runs under one; a no-op otherwise. */
async function stopSessionSupervisor(layout: SandboxLayout, names: SandboxUnitNames, deps: SandboxDeps) {
  const host = { env: serviceManagerEnv(deps) };
  if (deps.platform === 'linux') {
    await deps.run(['systemctl', '--user', 'stop', names.sessionUnit], host);
  } else if (deps.platform === 'darwin') {
    const plist = sessionPlistPath(layout, names);
    if (!existsSync(plist)) return;
    await deps.run(['launchctl', 'bootout', `gui/${deps.uid}/${names.sessionLabel}`], host);
    rmSync(plist, { force: true });
  }
}

function requireState(layout: SandboxLayout): SandboxState {
  const state = readSandboxState(layout);
  if (!state) throw new SandboxError(`No sandboxed Omni at ${layout.home}`, SANDBOX_EXIT.notInstalled);
  return state;
}

/** Starts the supervisor (through its unit when it has one) and waits for the API. */
export async function startSandbox(
  opts: { home: string; defaultHome: string; healthTimeoutMs?: number },
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<SandboxReport> {
  const layout = sandboxLayout(opts.home);
  const state = requireState(layout);
  const defaultHome = unitDefaultHome(state, opts.defaultHome);
  if (livePid(layout, deps) === null) {
    // Children of a supervisor that died hard still hold the ports (and would answer the health check).
    await sweepSandboxLeftovers(layout, deps);
    const env = serviceManagerEnv(deps);
    if (state.atLogin && deps.platform === 'darwin') {
      const names = sandboxUnitNames(layout.home, defaultHome);
      const plist = unitPaths(names, deps).plist;
      const loaded = await deps.run(['launchctl', 'print', `gui/${deps.uid}/${names.label}`], { env });
      const result =
        loaded.code === 0
          ? await deps.run(['launchctl', 'kickstart', `gui/${deps.uid}/${names.label}`], { env })
          : await deps.run(['launchctl', 'bootstrap', `gui/${deps.uid}`, plist], { env });
      if (result.code !== 0)
        throw new SandboxError(`launchctl could not start ${names.label}: ${result.stderr.trim()}`);
    } else if (state.atLogin && deps.platform === 'linux') {
      const names = sandboxUnitNames(layout.home, defaultHome);
      const result = await deps.run(['systemctl', '--user', 'enable', '--now', names.systemdUnit], { env });
      if (result.code !== 0)
        throw new SandboxError(`systemctl could not start ${names.systemdUnit}: ${result.stderr.trim()}`);
    } else {
      await startSessionSupervisor(layout, state, defaultHome, deps);
    }
  }
  const healthy = await deps.health(sandboxApiUrl(state), opts.healthTimeoutMs ?? SANDBOX_HEALTH_TIMEOUT_MS);
  const result = await report(layout, deps, 2000);
  if (!healthy) {
    return { ...result, ok: false, error: `Omni did not answer at ${sandboxApiUrl(state)}; see ${layout.logsDir}` };
  }
  return { ...result, healthy: true };
}

/** Stops the supervisor, which stops the API, NATS and Postgres in that order. */
export async function stopSandbox(
  opts: { home: string; defaultHome: string },
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<SandboxReport> {
  const layout = sandboxLayout(opts.home);
  const state = requireState(layout);
  const env = serviceManagerEnv(deps);
  const names = sandboxUnitNames(layout.home, unitDefaultHome(state, opts.defaultHome));
  // A unit would bring a killed supervisor straight back, so stop the unit itself.
  if (state.atLogin && deps.platform === 'darwin') {
    await deps.run(['launchctl', 'bootout', `gui/${deps.uid}/${names.label}`], { env });
  } else if (state.atLogin && deps.platform === 'linux') {
    await deps.run(['systemctl', '--user', 'stop', names.systemdUnit], { env });
  } else {
    await stopSessionSupervisor(layout, names, deps);
  }
  const pid = livePid(layout, deps);
  if (pid !== null) {
    deps.kill(pid, 'SIGTERM');
    const deadline = deps.now().getTime() + STOP_TIMEOUT_MS;
    while (deps.isAlive(pid) && deps.now().getTime() < deadline) await deps.sleep(250);
    if (deps.isAlive(pid)) deps.kill(pid, 'SIGKILL');
  }
  // Whatever a supervisor that died hard left behind; normally nothing.
  await sweepSandboxLeftovers(layout, deps);
  if (existsSync(layout.pidPath)) rmSync(layout.pidPath, { force: true });
  return report(layout, deps, 0);
}

export async function sandboxStatus(
  opts: { home: string },
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<SandboxReport> {
  return report(sandboxLayout(opts.home), deps);
}

/** What runs the sandbox's Postgres: autopg's pinned release where it has a build, else npm pgserve. */
interface SandboxPg {
  target: AutopgTarget | null;
  /** The opt-in password file: asked for now, else the one the sandbox already has. */
  pgPasswordFile: string | undefined;
}

const autopgPaths = (layout: SandboxLayout): AutopgPaths => ({
  dir: layout.autopgDir,
  configDir: layout.pgserveConfigDir,
});

function resolveSandboxPg(
  layout: SandboxLayout,
  previous: SandboxState | null,
  opts: SandboxInstallOptions,
  deps: SandboxDeps,
): SandboxPg {
  const target = autopgTarget(deps.autopgPin, deps);
  const asked = opts.pgPasswordFile?.trim();
  const pgPasswordFile = asked ? resolve(asked) : previous?.pgPasswordFile;
  if (!target && (pgPasswordFile || opts.autopgTarball)) {
    const host = `${deps.platform}-${deps.arch}${deps.libc === 'musl' ? ' (musl)' : ''}`;
    throw new SandboxError(
      `--pg-password-file and --autopg-tarball need autopg ${deps.autopgPin.version}, which has no build for ${host}`,
    );
  }
  // autopg cannot adopt a cluster initdb made without the file, and its start would rewrite that
  // cluster's pg_hba.conf before it refuses: refuse here, before anything is written. With no state
  // (uninstall keeps the data), the cluster's own pg_hba.conf says whether autopg ran it with one.
  const legacyCluster = previous ? !previous.pgPasswordFile : !clusterRanWithPasswordFile(layout.pgDataDir);
  if (pgPasswordFile && legacyCluster && existsSync(join(layout.pgDataDir, 'PG_VERSION'))) {
    throw new SandboxError(
      `${layout.pgDataDir} holds a cluster made without a password file, which cannot take one; use a new --home`,
    );
  }
  return { target, pgPasswordFile };
}

/**
 * True unless the sandbox runs autopg and its pinned release is not fully in place (an install
 * killed while it seeded autopg's binary cache, say). autopg would then fetch Postgres itself,
 * moving a `~/.pgserve` binary cache in first, so the supervisor refuses to start it.
 */
export function sandboxAutopgReady(layout: SandboxLayout, state: SandboxState, target: AutopgTarget | null): boolean {
  if (!state.autopg) return true;
  if (!target || target.version !== state.autopg) return false;
  return autopgRuntimeReady(autopgPaths(layout), target);
}

/** A change to what runs Postgres, which must not happen under a running cluster. */
function pgChanged(layout: SandboxLayout, previous: SandboxState, pg: SandboxPg): boolean {
  if (previous.pgPasswordFile !== pg.pgPasswordFile) return true;
  if (!pg.target) return previous.autopg !== undefined;
  return previous.autopg !== pg.target.version || !autopgRuntimeReady(autopgPaths(layout), pg.target);
}

/**
 * Install or reinstall. Ports, the API key and all data survive a reinstall;
 * a CLI of another version moves the runtime to its own version.
 */
export async function installSandbox(
  opts: SandboxInstallOptions,
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<SandboxReport> {
  const layout = sandboxLayout(opts.home);
  const previous = readSandboxState(layout);
  const packageSpec = opts.packageSpec?.trim() || VERSION;
  const atLogin = opts.atLogin ?? previous?.atLogin ?? false;
  const defaultHome = unitDefaultHome(previous, opts.defaultHome);
  const pg = resolveSandboxPg(layout, previous, opts, deps);
  ensureLayout(layout);
  // Before anything stops: a nats-server that is not the pinned one is replaced only by a verified
  // binary, renamed over it, and a refused one fails the install with the sandbox untouched.
  const nats = await deps.installNats(layout.natsBinary);
  if (nats === 'failed') throw new SandboxError(`Could not install the pinned nats-server at ${layout.natsBinary}`);
  const running = livePid(layout, deps) !== null;
  // A supervisor runs either on its own or under its launchd/systemd unit. Switching
  // at-login restarts it under the other, or launchd/systemd would not bring it back.
  const restart =
    previous &&
    (previous.packageSpec !== packageSpec ||
      previous.bun !== deps.bun ||
      previous.atLogin !== atLogin ||
      nats === 'installed' ||
      pgChanged(layout, previous, pg));
  const stopped = Boolean(running && restart);
  if (stopped) await stopSandbox({ home: opts.home, defaultHome }, deps);

  let version: string;
  try {
    // Before the runtime: a tarball that is not the pinned one is refused with nothing changed.
    if (pg.target) {
      await installAutopgRuntime(autopgPaths(layout), pg.target, {
        tarball: opts.autopgTarball,
        download: deps.download,
      });
    }
    version = await ensureRuntime(layout, packageSpec, pg.target === null, deps);
  } catch (error) {
    // Nobody may be watching (an update from the app): bring back the sandbox that was running.
    if (stopped) await startSandbox({ home: opts.home, defaultHome }, deps).catch(() => undefined);
    throw error;
  }

  const now = deps.now().toISOString();
  const state: SandboxState = {
    schemaVersion: 1,
    version,
    packageSpec,
    bun: deps.bun,
    ports: previous?.ports ?? (await pickPorts(deps)),
    atLogin,
    defaultHome,
    autopg: pg.target?.version,
    pgPasswordFile: pg.pgPasswordFile,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  writeSandboxState(layout, state);
  writeSandboxConfig(layout, state, readSandboxApiKey(layout) ?? generateApiKey());

  if (state.atLogin) await writeAtLoginUnit(layout, state, { ...opts, defaultHome }, deps);
  else if (previous?.atLogin) await removeAtLoginUnit(layout, defaultHome, deps);

  if (opts.start === false) return report(layout, deps, 0);
  return startSandbox({ home: opts.home, defaultHome, healthTimeoutMs: opts.healthTimeoutMs }, deps);
}

/**
 * Stops the sandbox, removes its units and its runtime. The data and the
 * config (with its API key) stay, so a later install picks them up again;
 * `purge` deletes the whole home.
 */
export async function uninstallSandbox(
  opts: { home: string; defaultHome: string; purge?: boolean },
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<SandboxReport> {
  const layout = sandboxLayout(opts.home);
  const state = requireState(layout);
  await stopSandbox(opts, deps);
  await removeAtLoginUnit(layout, unitDefaultHome(state, opts.defaultHome), deps);
  if (opts.purge) {
    const home = resolve(layout.home);
    if (home === '/' || home === resolve(deps.userHome)) throw new SandboxError(`Refusing to delete ${home}`);
    rmSync(home, { recursive: true, force: true });
  } else {
    for (const path of [layout.statePath, layout.runtimeDir, layout.autopgDir, layout.cacheDir, layout.runDir]) {
      rmSync(path, { recursive: true, force: true });
    }
  }
  return report(layout, deps, 0);
}

/** A version `omni sandbox update` takes: what npm publishes, never a range or a tag. */
const SANDBOX_UPDATE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Updates the sandbox to `version` from outside it. The sandbox's own API runs this when the
 * app asks (OMNI_UPDATE_COMMAND, packages/api/src/system/update.ts), from inside the unit the
 * update has to stop, so the install itself (`omni install --sandbox` of that version, which
 * keeps the ports, the key, the data and the at-login choice) is handed to a transient
 * systemd --user service of its own, or else to a detached process (a session of its own,
 * which stopping the sandbox's launchd job does not reach). It returns once handed off: the
 * API learns how it went when it comes back on the new version (its reconcile).
 */
export async function handOffSandboxUpdate(
  opts: { home: string; defaultHome: string; version: string },
  deps: SandboxDeps = defaultSandboxDeps(),
): Promise<{ via: 'systemd' | 'detached'; logPath: string; version: string }> {
  if (!SANDBOX_UPDATE_VERSION.test(opts.version)) {
    throw new SandboxError(`Not a release version: '${opts.version}'`);
  }
  const layout = sandboxLayout(opts.home);
  const state = requireState(layout);
  const cmd = [
    state.bun,
    'x',
    '--bun',
    `@automagik/omni@${opts.version}`,
    'install',
    '--sandbox',
    '--home',
    layout.home,
    '--json',
  ];
  const env = sandboxBaseEnv(layout, deps.env);
  const logPath = join(layout.logsDir, 'update.log');
  if (deps.platform === 'linux') {
    const names = sandboxUnitNames(layout.home, unitDefaultHome(state, opts.defaultHome));
    const unit = names.sessionUnit.replace(/-session\.service$/, `-update-${deps.now().getTime()}.service`);
    const job = { description: `Omni sandbox update to ${opts.version} (${layout.home})`, log: logPath };
    const host = { env: serviceManagerEnv(deps) };
    let started = await deps.run(buildSystemdRunCommand(unit, cmd, layout, env, true, job), host);
    if (started.code !== 0 && /unrecognized option.*expand-environment/.test(started.stderr)) {
      started = await deps.run(buildSystemdRunCommand(unit, cmd, layout, env, false, job), host);
    }
    if (started.code === 0) return { via: 'systemd', logPath, version: opts.version };
    // A detached process stays in the unit that runs the sandbox, which the install stops:
    // it would be killed halfway, leaving the sandbox down. Refuse; the API says it failed.
    const own = state.atLogin ? names.systemdUnit : names.sessionUnit;
    if ((await deps.run(['systemctl', '--user', 'is-active', '--quiet', own], host)).code === 0) {
      throw new SandboxError(`systemd-run could not start the update outside ${own}: ${started.stderr.trim()}`);
    }
  }
  deps.spawnDetached(cmd, { cwd: layout.home, env, logPath });
  return { via: 'detached', logPath, version: opts.version };
}
