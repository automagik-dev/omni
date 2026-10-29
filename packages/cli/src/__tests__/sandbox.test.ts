/**
 * Sandboxed local Omni — `omni install --sandbox` and `omni sandbox …`.
 *
 * No real process, port, download or network: every effect goes through fake
 * {@link SandboxDeps} / {@link SupervisorDeps}. Files are real, in temp dirs,
 * so the isolation claim (nothing written outside the sandbox home, nothing
 * read from the caller's shell) is checked on disk.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTOPG_PIN, type AutopgPin, autopgTarget } from '../autopg-runtime.js';
import { createInstallCommand } from '../commands/install.js';
import { createSandboxCommand } from '../commands/sandbox.js';
import {
  CappedLog,
  type ChildHandle,
  SandboxSupervisor,
  type SupervisorDeps,
  runSandboxSupervisor,
  spawnChildProcess,
} from '../sandbox-supervisor.js';
import {
  SANDBOX_PGSERVE_VERSION,
  SANDBOX_PREFERRED_PORTS,
  type SandboxChildSpec,
  type SandboxDeps,
  type SandboxState,
  buildLaunchdPlist,
  buildSystemdUserUnit,
  handOffSandboxUpdate,
  installSandbox,
  leftoverChildPids,
  readSandboxApiKey,
  readSandboxState,
  resolveSandboxHome,
  sandboxChildSpecs,
  sandboxLayout,
  sandboxStatus,
  sandboxUnitNames,
  sandboxUpdateCommand,
  startSandbox,
  stopSandbox,
  supervisorCommand,
  uninstallSandbox,
} from '../sandbox.js';

const BUN = '/opt/bun/bin/bun';
/** Variables a careless sandbox would pick up from the caller's shell. */
const LEAKY_ENV = {
  HOME: '/home/someone',
  PATH: '/usr/bin:/bin',
  DATABASE_URL: 'postgresql://wrong@db.example/prod',
  PGHOST: '/run/shared-pgserve',
  PM2_HOME: '/home/someone/.pm2',
  OMNI_CONFIG_DIR: '/home/someone/.omni',
  OMNI_API_KEY: 'shell-key',
};

let root: string;
let userHome: string;
let home: string;
let defaultHome: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'omni-sandbox-test-'));
  userHome = join(root, 'user');
  mkdirSync(userHome);
  defaultHome = join(userHome, '.omni', 'sandbox');
  home = join(root, 'sb');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type Call = { cmd: string[]; cwd?: string; env: Record<string, string> };

/** systemd-run, or launchctl bootstrap of the session job (its plist sits in the home's run dir). */
const startsSessionSupervisor = (cmd: string[]) =>
  cmd[0] === 'systemd-run' ||
  (cmd[0] === 'launchctl' && cmd[1] === 'bootstrap' && (cmd[3] ?? '').startsWith(join(home, 'run')));
const SERVICE_MANAGERS = new Set(['systemctl', 'systemd-run', 'launchctl']);
const asksIsActive = (cmd: string[]) => cmd[0] === 'systemctl' && cmd.includes('is-active');
/** A unit is active only where there is a service manager to run it. */
const isActiveAnswer = (serviceManager: boolean) => ({ code: serviceManager ? 0 : 3, stdout: '', stderr: '' });

/**
 * `serviceManager: false` (the default) is a computer whose user service
 * manager cannot start the session supervisor (no systemd user session, no
 * GUI launchd domain), so it falls back to a detached child.
 */
function fakeDeps(overrides: Partial<SandboxDeps> = {}, { serviceManager = false } = {}) {
  const runs: Call[] = [];
  const detached: Call[] = [];
  const kills: Array<[number, string]> = [];
  const alive = new Set<number>();
  const busyPorts = new Set<number>();
  let clock = 0;
  const deps: SandboxDeps = {
    // A platform autopg ships no build for (musl): Postgres comes from npm pgserve, as before.
    platform: 'linux',
    arch: 'x64',
    libc: 'musl',
    autopgPin: AUTOPG_PIN,
    download: async (url) => {
      throw new Error(`unexpected download of ${url}`);
    },
    uid: 501,
    userHome,
    bun: BUN,
    env: LEAKY_ENV,
    run: async (cmd, opts) => {
      runs.push({ cmd, cwd: opts.cwd, env: opts.env });
      if (asksIsActive(cmd)) return isActiveAnswer(serviceManager);
      if (startsSessionSupervisor(cmd)) {
        if (!serviceManager) return { code: 1, stdout: '', stderr: 'Failed to connect to bus: No medium found' };
        // The supervisor the service manager starts writes its own pid file.
        alive.add(4242);
        writeFileSync(sandboxLayout(home).pidPath, '4242\n');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (cmd[1] === 'install' && opts.cwd) {
        // What `bun install` would leave behind.
        const manifest = JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf-8'));
        const spec = manifest.dependencies['@automagik/omni'];
        for (const [name, version] of [
          ['@automagik/omni', spec.startsWith('file:') ? '9.9.9' : spec],
          ['pgserve', SANDBOX_PGSERVE_VERSION],
        ]) {
          const dir = join(opts.cwd, 'node_modules', name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
        }
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    spawnDetached: (cmd, opts) => {
      detached.push({ cmd, cwd: opts.cwd, env: opts.env });
      const pid = 4242;
      alive.add(pid);
      writeFileSync(sandboxLayout(home).pidPath, `${pid}\n`);
      return pid;
    },
    isPortFree: async (port) => !busyPorts.has(port),
    health: async () => alive.size > 0,
    // A binary already in place is the pinned one; the real installer decides that from its marker.
    installNats: async (target) => {
      if (existsSync(target)) return 'kept';
      writeFileSync(target, '#!/bin/sh\n');
      return 'installed';
    },
    isAlive: (pid) => alive.has(pid),
    kill: (pid, signal) => {
      kills.push([pid, signal]);
      alive.delete(pid);
    },
    now: () => new Date(Date.UTC(2026, 9, 23) + clock++),
    sleep: async () => {},
    ...overrides,
  };
  return { deps, runs, detached, kills, alive, busyPorts };
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String);
}

describe('resolveSandboxHome', () => {
  test('--home wins, then $OMNI_HOME/sandbox, then ~/.omni/sandbox', () => {
    expect(resolveSandboxHome('/x/y', { OMNI_HOME: '/desk' }, '/u')).toBe('/x/y');
    expect(resolveSandboxHome(undefined, { OMNI_HOME: '/Users/me/.omni/desktop' }, '/u')).toBe(
      '/Users/me/.omni/desktop/sandbox',
    );
    expect(resolveSandboxHome(undefined, {}, '/u')).toBe('/u/.omni/sandbox');
    expect(resolveSandboxHome('  ', {}, '/u')).toBe('/u/.omni/sandbox');
  });
});

describe('installSandbox', () => {
  test('installs the runtime, picks ports, writes a 0600 config and starts the supervisor', async () => {
    const { deps, runs, detached } = fakeDeps();
    const result = await installSandbox({ home, defaultHome, packageSpec: '2.261023.8' }, deps);

    expect(result).toMatchObject({
      ok: true,
      installed: true,
      home,
      version: '2.261023.8',
      apiUrl: `http://127.0.0.1:${SANDBOX_PREFERRED_PORTS.api}`,
      configPath: join(home, 'config', 'config.json'),
      running: true,
      healthy: true,
      atLogin: false,
      ports: { ...SANDBOX_PREFERRED_PORTS },
      pid: 4242,
    });

    const install = runs.find((call) => call.cmd[1] === 'install');
    expect(install?.cmd).toEqual([BUN, 'install', '--production']);
    expect(install?.cwd).toBe(join(home, 'runtime'));
    expect(install?.env.BUN_INSTALL_CACHE_DIR).toBe(join(home, 'cache'));
    expect(JSON.parse(readFileSync(join(home, 'runtime', 'package.json'), 'utf-8')).dependencies).toEqual({
      '@automagik/omni': '2.261023.8',
      pgserve: SANDBOX_PGSERVE_VERSION,
    });

    const layout = sandboxLayout(home);
    const apiKey = readSandboxApiKey(layout);
    expect(apiKey).toMatch(/^omni_sk_/);
    expect(statSync(layout.configPath).mode & 0o777).toBe(0o600);
    const config = JSON.parse(readFileSync(layout.configPath, 'utf-8'));
    expect(config.apiUrl).toBe(result.apiUrl);
    expect(config.server.dataDir).toBe(join(home, 'data'));

    // The supervisor runs from the runtime's own copy of the CLI.
    expect(detached).toHaveLength(1);
    expect(detached[0]?.cmd).toEqual([
      BUN,
      join(home, 'runtime', 'node_modules', '@automagik', 'omni', 'bin', 'omni'),
      'sandbox',
      'run',
      '--home',
      home,
    ]);
  });

  test('never prints the API key', async () => {
    const { deps } = fakeDeps();
    const result = await installSandbox({ home, defaultHome }, deps);
    const apiKey = readSandboxApiKey(sandboxLayout(home)) ?? 'missing';
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(readFileSync(sandboxLayout(home).statePath, 'utf-8')).not.toContain(apiKey);
  });

  test('writes nothing outside its home and reads nothing from the shell', async () => {
    const { deps, runs, detached } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    expect(filesUnder(userHome)).toEqual([]);
    // systemctl and friends get the caller's env to reach its session (see the at-login tests).
    for (const call of [...runs.filter((run) => !SERVICE_MANAGERS.has(run.cmd[0] ?? '')), ...detached]) {
      expect(call.env.OMNI_CONFIG_DIR).toBe(join(home, 'config'));
      expect(call.env.PM2_HOME).toBe(join(home, 'run', 'pm2'));
      expect(call.env.AUTOPG_CONFIG_DIR).toBe(join(home, 'pgserve'));
      expect(call.env.DATABASE_URL).toBeUndefined();
      expect(call.env.PGHOST).toBeUndefined();
      expect(call.env.OMNI_API_KEY).toBeUndefined();
      expect(call.env.HOME).toBe(LEAKY_ENV.HOME);
    }
  });

  test('takes the next free port when a preferred one is busy', async () => {
    const { deps, busyPorts } = fakeDeps();
    busyPorts.add(SANDBOX_PREFERRED_PORTS.api);
    busyPorts.add(SANDBOX_PREFERRED_PORTS.api + 1);
    busyPorts.add(SANDBOX_PREFERRED_PORTS.pg);
    const result = await installSandbox({ home, defaultHome, start: false }, deps);
    expect(result.ports).toEqual({
      api: SANDBOX_PREFERRED_PORTS.api + 2,
      pg: SANDBOX_PREFERRED_PORTS.pg + 1,
      nats: SANDBOX_PREFERRED_PORTS.nats,
    });
    expect(result.running).toBe(false);
  });

  test('a reinstall keeps ports, the API key and the data, and does not reinstall the runtime', async () => {
    const first = fakeDeps();
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.8', start: false }, first.deps);
    const layout = sandboxLayout(home);
    const apiKey = readSandboxApiKey(layout);
    const ports = readSandboxState(layout)?.ports;
    writeFileSync(join(layout.pgDataDir, 'PG_VERSION'), '18\n');

    const second = fakeDeps();
    second.busyPorts.add(SANDBOX_PREFERRED_PORTS.api);
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.8', start: false }, second.deps);
    expect(readSandboxApiKey(layout)).toBe(apiKey);
    expect(readSandboxState(layout)?.ports).toEqual(ports);
    expect(readFileSync(join(layout.pgDataDir, 'PG_VERSION'), 'utf-8')).toBe('18\n');
    expect(second.runs.filter((call) => call.cmd[1] === 'install')).toHaveLength(0);
  });

  test('a CLI of another version stops the running sandbox and moves the runtime to its version', async () => {
    const { deps, runs, kills } = fakeDeps();
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.7' }, deps);
    const result = await installSandbox({ home, defaultHome, packageSpec: '2.261023.8' }, deps);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(runs.filter((call) => call.cmd[1] === 'install')).toHaveLength(2);
    expect(result.version).toBe('2.261023.8');
    expect(result.running).toBe(true);
  });

  test('reports a failure when the API never answers', async () => {
    const { deps } = fakeDeps({ health: async () => false });
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(join(home, 'logs'));
  });
});

describe('at login', () => {
  test('linux: a systemd --user unit that runs the supervisor, started through systemctl', async () => {
    const { deps, runs, detached } = fakeDeps();
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    expect(names.systemdUnit).toMatch(/^omni-sandbox-[0-9a-f]{8}\.service$/);
    const unit = readFileSync(join(userHome, '.config', 'systemd', 'user', names.systemdUnit), 'utf-8');
    expect(unit).toContain(
      `ExecStart="${BUN}" "${join(home, 'runtime', 'node_modules', '@automagik', 'omni', 'bin', 'omni')}" "sandbox" "run" "--home" "${home}"`,
    );
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
    // systemd refuses a quoted WorkingDirectory= as "not absolute".
    expect(unit).toContain(`\nWorkingDirectory=${home}\n`);
    expect(unit).toContain(`Environment="OMNI_CONFIG_DIR=${join(home, 'config')}"`);
    expect(unit).not.toContain('DATABASE_URL');
    const commands = runs.map((call) => call.cmd.join(' '));
    expect(commands).toContain(`systemctl --user enable ${names.systemdUnit}`);
    expect(commands).toContain(`systemctl --user enable --now ${names.systemdUnit}`);
    expect(detached).toHaveLength(0);
  });

  test('linux: a sandbox already running on its own restarts under its unit', async () => {
    const { deps, runs, kills, detached } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    const commands = runs.map((call) => call.cmd.join(' '));
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(commands).toContain(`systemctl --user enable ${names.systemdUnit}`);
    expect(commands).toContain(`systemctl --user enable --now ${names.systemdUnit}`);
    expect(detached).toHaveLength(1); // only the first, unit-less start
  });

  test('macOS: a sandbox already running on its own restarts under launchd', async () => {
    const { deps, runs, kills, detached } = fakeDeps({ platform: 'darwin' });
    const run = deps.run;
    // Nothing is loaded in the GUI domain until the agent is bootstrapped.
    deps.run = async (cmd, opts) => {
      const result = await run(cmd, opts);
      return cmd[0] === 'launchctl' && cmd[1] === 'print' ? { ...result, code: 113 } : result;
    };
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    const plist = join(userHome, 'Library', 'LaunchAgents', `${names.label}.plist`);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(runs.map((call) => call.cmd.join(' '))).toContain(`launchctl bootstrap gui/501 ${plist}`);
    expect(detached).toHaveLength(1);
  });

  test('a reinstall that keeps at-login as it was leaves the running supervisor alone', async () => {
    const { deps, kills } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    await installSandbox({ home, defaultHome }, deps);
    expect(kills).toEqual([]);
  });

  test('linux: no systemd user session fails the install instead of claiming at-login', async () => {
    const { deps } = fakeDeps();
    const run = deps.run;
    deps.run = async (cmd, opts) =>
      cmd[0] === 'systemctl' && cmd[2] === 'enable'
        ? { code: 1, stdout: '', stderr: 'Failed to connect to bus' }
        : run(cmd, opts);
    await expect(installSandbox({ home, defaultHome, atLogin: true }, deps)).rejects.toThrow(
      'Failed to connect to bus',
    );
  });

  test('systemctl reaches the user session through the caller env; the unit keeps the sandbox env', async () => {
    const session = { XDG_RUNTIME_DIR: '/run/user/501', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/501/bus' };
    const { deps, runs } = fakeDeps({ env: { ...LEAKY_ENV, ...session } });
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const systemctl = runs.filter((call) => call.cmd[0] === 'systemctl');
    expect(systemctl.length).toBeGreaterThan(0);
    for (const call of systemctl) expect(call.env).toMatchObject(session);
    const unit = readFileSync(
      join(userHome, '.config', 'systemd', 'user', sandboxUnitNames(home, defaultHome).systemdUnit),
      'utf-8',
    );
    expect(unit).not.toContain('XDG_RUNTIME_DIR');
    expect(unit).not.toContain('PGHOST');
  });

  test('the unit PATH drops the node_modules/.bin dirs bun run adds', async () => {
    const { deps } = fakeDeps({ env: { PATH: '/x/node_modules/.bin:/usr/bin:/bin', HOME: userHome } });
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const unit = readFileSync(
      join(userHome, '.config', 'systemd', 'user', sandboxUnitNames(home, defaultHome).systemdUnit),
      'utf-8',
    );
    expect(unit).toContain('Environment="PATH=/usr/bin:/bin"');
  });

  test('macOS: a launchd agent with RunAtLoad and KeepAlive, bootstrapped into the GUI domain', async () => {
    const { deps, runs } = fakeDeps({ platform: 'darwin' });
    await installSandbox({ home: defaultHome, defaultHome, atLogin: true, start: false }, deps);
    const plistPath = join(userHome, 'Library', 'LaunchAgents', 'ai.namastex.omni.sandbox.plist');
    const plist = readFileSync(plistPath, 'utf-8');
    expect(plist).toContain('<string>ai.namastex.omni.sandbox</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).toContain('<key>SuccessfulExit</key>\n    <false/>');
    expect(plist).toContain(`<string>${join(defaultHome, 'logs', 'supervisor.log')}</string>`);
    expect(runs).toHaveLength(1); // only bun install; nothing started with --no-start
  });

  test('unit builders quote and escape what they are given', () => {
    const layout = sandboxLayout('/tmp/a & b');
    const plist = buildLaunchdPlist('l', ['/bin/x', '<y>'], layout, { A: '"q"' });
    expect(plist).toContain('<string>&lt;y&gt;</string>');
    expect(plist).toContain('<string>&quot;q&quot;</string>');
    const unit = buildSystemdUserUnit(['/bin/x', '50%$HOME'], layout, {});
    expect(unit).toContain('ExecStart="/bin/x" "50%%$$HOME"');
  });
});

describe('without at-login: the supervisor runs under the service manager for this login', () => {
  const supervisor = () => [
    BUN,
    join(home, 'runtime', 'node_modules', '@automagik', 'omni', 'bin', 'omni'),
    'sandbox',
    'run',
    '--home',
    home,
  ];

  test('linux: a transient systemd --user service, outside the scope of whatever ran the CLI', async () => {
    const { deps, runs, detached } = fakeDeps({}, { serviceManager: true });
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(result).toMatchObject({ ok: true, running: true, healthy: true, atLogin: false, pid: 4242 });
    expect(detached).toHaveLength(0);

    const names = sandboxUnitNames(home, defaultHome);
    expect(names.sessionUnit).toMatch(/^omni-sandbox-[0-9a-f]{8}-session\.service$/);
    expect(names.sessionUnit).not.toBe(names.systemdUnit);
    const run = runs.find((call) => call.cmd[0] === 'systemd-run');
    const args = run?.cmd ?? [];
    expect(args.slice(0, 5)).toEqual(['systemd-run', '--user', '--quiet', '--collect', `--unit=${names.sessionUnit}`]);
    expect(args).toContain('--expand-environment=no');
    expect(args).toContain(`--working-directory=${home}`);
    expect(args).toContain('--property=KillMode=mixed');
    expect(args).toContain(`--property=StandardOutput=append:${join(home, 'logs', 'supervisor.log')}`);
    expect(args).toContain(`--setenv=OMNI_CONFIG_DIR=${join(home, 'config')}`);
    expect(args.filter((arg) => /^--setenv=(DATABASE_URL|PGHOST|OMNI_API_KEY)=/.test(arg))).toEqual([]);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(supervisor());
    // Through the caller's session; a stale unit of the same name is stopped first.
    const commands = runs.map((call) => call.cmd.join(' '));
    expect(commands.indexOf(`systemctl --user stop ${names.sessionUnit}`)).toBeLessThan(
      commands.findIndex((command) => command.startsWith('systemd-run')),
    );
    expect(run?.env.XDG_RUNTIME_DIR).toBe('/run/user/501');
    // Nothing is enabled, and nothing is written outside the home.
    expect(commands.some((command) => command.includes('enable'))).toBe(false);
    expect(filesUnder(userHome)).toEqual([]);
  });

  test('session unit names follow the home alone, whatever the caller takes for the default', () => {
    const a = sandboxUnitNames('/a/sandbox', '/a/sandbox');
    expect(sandboxUnitNames('/a/sandbox', '/u/.omni/sandbox')).toMatchObject({
      sessionUnit: a.sessionUnit,
      sessionLabel: a.sessionLabel,
    });
    expect(sandboxUnitNames('/b/sandbox', '/b/sandbox').sessionUnit).not.toBe(a.sessionUnit);
    expect(a.sessionLabel).toMatch(/^ai\.namastex\.omni\.sandbox-[0-9a-f]{8}\.session$/);
  });

  test('linux: a systemd older than --expand-environment gets the same unit without it', async () => {
    const { deps, runs, detached } = fakeDeps({}, { serviceManager: true });
    const run = deps.run;
    deps.run = async (cmd, opts) =>
      cmd[0] === 'systemd-run' && cmd.includes('--expand-environment=no')
        ? { code: 1, stdout: '', stderr: "systemd-run: unrecognized option '--expand-environment=no'" }
        : run(cmd, opts);
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(result.running).toBe(true);
    expect(runs.filter((call) => call.cmd[0] === 'systemd-run')).toHaveLength(1);
    expect(detached).toHaveLength(0);
  });

  test('linux: no systemd user session falls back to a detached supervisor', async () => {
    const { deps, runs, detached } = fakeDeps();
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(runs.some((call) => call.cmd[0] === 'systemd-run')).toBe(true);
    expect(detached.map((call) => call.cmd)).toEqual([supervisor()]);
    expect(result).toMatchObject({ ok: true, running: true });
  });

  test('linux: stop stops the transient service, then makes sure the supervisor is gone', async () => {
    const { deps, runs, kills } = fakeDeps({}, { serviceManager: true });
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    const result = await stopSandbox({ home, defaultHome }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    expect(runs[0]?.cmd).toEqual(['systemctl', '--user', 'stop', names.sessionUnit]);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(result).toMatchObject({ running: false, pid: null });
  });

  test('macOS: a launchd job bootstrapped into the GUI domain, its plist in the run dir, not kept alive', async () => {
    const { deps, runs, detached } = fakeDeps({ platform: 'darwin' }, { serviceManager: true });
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(result).toMatchObject({ running: true, pid: 4242 });
    expect(detached).toHaveLength(0);
    const names = sandboxUnitNames(home, defaultHome);
    const plistPath = join(home, 'run', `${names.sessionLabel}.plist`);
    const plist = readFileSync(plistPath, 'utf-8');
    expect(plist).toContain(`<string>${names.sessionLabel}</string>`);
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).not.toContain('KeepAlive');
    expect(plist).toContain(`<string>${join(home, 'config')}</string>`);
    const commands = runs.map((call) => call.cmd.join(' '));
    expect(commands).toContain(`launchctl bootstrap gui/501 ${plistPath}`);
    // Never in LaunchAgents, so it does not come back at the next login.
    expect(filesUnder(userHome)).toEqual([]);

    runs.length = 0;
    await stopSandbox({ home, defaultHome }, deps);
    expect(runs[0]?.cmd).toEqual(['launchctl', 'bootout', `gui/501/${names.sessionLabel}`]);
    expect(existsSync(plistPath)).toBe(false);
  });

  test('macOS: no GUI domain (an ssh login) falls back to a detached supervisor', async () => {
    const { deps, detached } = fakeDeps({ platform: 'darwin' });
    const result = await installSandbox({ home, defaultHome }, deps);
    expect(detached.map((call) => call.cmd)).toEqual([supervisor()]);
    expect(result.running).toBe(true);
    expect(readdirSync(join(home, 'run')).filter((file) => file.endsWith('.plist'))).toEqual([]);
  });

  test('switching to at-login stops the session service and starts the at-login unit', async () => {
    const { deps, runs } = fakeDeps({}, { serviceManager: true });
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    const commands = runs.map((call) => call.cmd.join(' '));
    expect(commands[0]).toBe(`systemctl --user stop ${names.sessionUnit}`);
    expect(commands).toContain(`systemctl --user enable --now ${names.systemdUnit}`);
    expect(commands.some((command) => command.startsWith('systemd-run'))).toBe(false);
  });
});

describe('children a supervisor left behind', () => {
  const psOutput = (h: string) =>
    [
      `  101 /opt/bun/bin/bun ${h}/runtime/node_modules/pgserve/bin/postgres-server.js postmaster --port 15432`,
      `  102 ${h}/pgserve/bin/linux-x64/bin/postgres -D ${h}/data/pg -p 15432`,
      `  103 ${h}/bin/nats-server -js -sd ${h}/data/nats`,
      `  104 /opt/bun/bin/bun ${h}/runtime/node_modules/@automagik/omni/dist/server/index.js`,
      `  105 /opt/bun/bin/bun ${h}/runtime/node_modules/@automagik/omni/bin/omni sandbox run --home ${h}`,
      '  106 postgres: omni omni [local] idle',
      '  107 /usr/bin/postgres -D /var/lib/postgresql/data',
      `  108 /opt/bun/bin/bun ${h}-other/runtime/node_modules/@automagik/omni/dist/server/index.js`,
      `  109 tail -f ${h}/logs/api.log`,
    ].join('\n');

  test("autopg's own binary, from the pinned release, is one of its children", () => {
    const ps = `${psOutput(home)}\n  110 ${home}/autopg/3.3.0/autopg postmaster --port 15432`;
    expect(leftoverChildPids(ps, sandboxLayout(home))).toEqual([101, 102, 103, 104, 110]);
  });

  test('only this sandbox children are matched, not its supervisor or anything else', () => {
    expect(leftoverChildPids(psOutput(home), sandboxLayout(home))).toEqual([101, 102, 103, 104]);
    expect(leftoverChildPids(psOutput(home), sandboxLayout(home), [104])).toEqual([101, 102, 103]);
  });

  test('start stops leftovers before it starts a new supervisor, and stop reaches them too', async () => {
    const { deps, kills, detached } = fakeDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);
    const leftovers = new Set([101, 102, 103, 104]);
    const run = deps.run;
    deps.run = async (cmd, opts) =>
      cmd[0] === 'ps' ? { code: 0, stdout: psOutput(home), stderr: '' } : run(cmd, opts);
    const isAlive = deps.isAlive;
    deps.isAlive = (pid) => leftovers.has(pid) || isAlive(pid);
    const kill = deps.kill;
    deps.kill = (pid, signal) => {
      kill(pid, signal);
      leftovers.delete(pid);
    };
    await startSandbox({ home, defaultHome }, deps);
    expect(kills).toEqual([
      [101, 'SIGTERM'],
      [102, 'SIGTERM'],
      [103, 'SIGTERM'],
      [104, 'SIGTERM'],
    ]);
    expect(detached).toHaveLength(1);
    kills.length = 0;
    for (const pid of [101, 102, 103, 104]) leftovers.add(pid);
    await stopSandbox({ home, defaultHome }, deps);
    expect(kills.filter(([, signal]) => signal === 'SIGTERM').map(([pid]) => pid)).toEqual(
      expect.arrayContaining([101, 102, 103, 104]),
    );
  });
});

describe('stop, status, uninstall', () => {
  test('status of a home with no sandbox says so', async () => {
    const { deps } = fakeDeps();
    expect(await sandboxStatus({ home }, deps)).toMatchObject({ ok: true, installed: false, running: false });
  });

  test('stop sends SIGTERM to the supervisor and clears its pid file', async () => {
    const { deps, kills } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    const result = await stopSandbox({ home, defaultHome }, deps);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(result).toMatchObject({ running: false, healthy: false, pid: null });
    expect(existsSync(sandboxLayout(home).pidPath)).toBe(false);
  });

  test('stop of a missing sandbox exits "not installed"', async () => {
    const { deps } = fakeDeps();
    await expect(stopSandbox({ home, defaultHome }, deps)).rejects.toMatchObject({ exitCode: 3 });
  });

  test('uninstall keeps data and config, removes the runtime and the unit', async () => {
    const { deps } = fakeDeps();
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const layout = sandboxLayout(home);
    const apiKey = readSandboxApiKey(layout);
    const result = await uninstallSandbox({ home, defaultHome }, deps);
    expect(result.installed).toBe(false);
    expect(existsSync(layout.runtimeDir)).toBe(false);
    expect(existsSync(layout.dataDir)).toBe(true);
    expect(readSandboxApiKey(layout)).toBe(apiKey);
    expect(filesUnder(join(userHome, '.config', 'systemd', 'user'))).toEqual([]);
  });

  test('uninstall --purge deletes the home, and never the user home', async () => {
    const { deps } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    await uninstallSandbox({ home, defaultHome, purge: true }, deps);
    expect(existsSync(home)).toBe(false);

    const own = fakeDeps();
    await installSandbox({ home: userHome, defaultHome, start: false }, own.deps);
    await expect(uninstallSandbox({ home: userHome, defaultHome, purge: true }, own.deps)).rejects.toThrow(/Refusing/);
  });
});

describe('sandboxChildSpecs', () => {
  const state: SandboxState = {
    schemaVersion: 1,
    version: '2.261023.8',
    packageSpec: '2.261023.8',
    bun: BUN,
    ports: { api: 18882, pg: 15432, nats: 14222 },
    atLogin: false,
    createdAt: 'x',
    updatedAt: 'x',
  };

  test('Postgres, NATS and the API, in that order, all on loopback and inside the home', () => {
    const layout = sandboxLayout('/s');
    const [pg, nats, api] = sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV);
    expect(pg?.cmd).toEqual([
      BUN,
      '/s/runtime/node_modules/pgserve/bin/postgres-server.js',
      'postmaster',
      '--port',
      '15432',
      '--data',
      '/s/data/pg',
      '--socket-dir',
      '/s/run/pg',
    ]);
    expect(nats?.cmd).toEqual(['/s/bin/nats-server', '-js', '-sd', '/s/data/nats', '-a', '127.0.0.1', '-p', '14222']);
    expect(api?.cmd).toEqual([BUN, '/s/runtime/node_modules/@automagik/omni/dist/server/index.js']);
    expect(api?.env).toMatchObject({
      API_PORT: '18882',
      API_HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:15432/omni',
      PGHOST: '/s/run/pg',
      PGPORT: '15432',
      OMNI_API_KEY: 'omni_sk_test',
      NATS_URL: 'nats://127.0.0.1:14222',
      OMNI_CONFIG_DIR: '/s/config',
      MEDIA_STORAGE_PATH: '/s/data/media',
    });
    for (const spec of [pg, nats, api]) {
      expect(spec?.env.OMNI_CONFIG_DIR).toBe('/s/config');
      expect(spec?.env.PM2_HOME).toBe('/s/run/pm2');
      expect(spec?.env.AUTOPG_CONFIG_DIR).toBe('/s/pgserve');
      expect(spec?.logPath.startsWith('/s/logs/')).toBe(true);
    }
    expect(pg?.env.DATABASE_URL).toBeUndefined();
    expect(pg?.env.OMNI_API_KEY).toBeUndefined();
    expect(supervisorCommand(layout, state)[1]).toBe('/s/runtime/node_modules/@automagik/omni/bin/omni');
  });

  test("the API updates from the app: the app's yes confirms, and the runtime's CLI hands the update off", () => {
    const layout = sandboxLayout('/s');
    const api = sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV)[2];
    expect(api?.env).toMatchObject({
      API_HOST: '127.0.0.1',
      OMNI_UPDATE_CONFIRM: 'app',
      OMNI_UPDATE_STATE_DIR: '/s/data',
    });
    const command = [BUN, '/s/runtime/node_modules/@automagik/omni/bin/omni', 'sandbox', 'update', '--home', '/s'];
    expect(JSON.parse(api?.env.OMNI_UPDATE_COMMAND ?? '[]')).toEqual(command);
    expect(sandboxUpdateCommand(layout, state)).toEqual(command);
  });

  test('without --embedded: crash reports, updates and the database URL stay as they were', () => {
    const [pg, , api] = sandboxChildSpecs(sandboxLayout('/s'), state, 'omni_sk_test', LEAKY_ENV);
    expect(api?.env.SENTRY_DSN).toBeUndefined();
    expect(api?.env.OMNI_UPDATE_CHECK).toBeUndefined();
    expect(api?.env.OMNI_PLUGIN_LANE).toBeUndefined();
    expect(api?.env.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:15432/omni');
    expect(pg?.cmd.slice(-2)).toEqual(['--socket-dir', '/s/run/pg']);
  });

  test('--embedded: no crash reports, no update check, no plugin lane; the database URL is unchanged', () => {
    const layout = sandboxLayout('/s');
    const [pg, nats, api] = sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV, { embedded: true });
    expect(api?.env).toMatchObject({
      SENTRY_DSN: '',
      OMNI_UPDATE_CHECK: 'false',
      OMNI_PLUGIN_LANE: 'off',
      OMNI_UPDATE_STATE_DIR: '/s/data',
    });
    for (const key of ['OMNI_UPDATE_COMMAND', 'OMNI_UPDATE_CONFIRM']) expect(api?.env[key]).toBeUndefined();
    expect(api?.env.DATABASE_URL).toBe('postgresql://postgres:postgres@localhost:15432/omni');
    for (const spec of [pg, nats, api]) expect(spec?.env.OMNI_TELEMETRY).toBe('false');
  });
});

describe('a reinstall from anywhere keeps its units', () => {
  // A release the CLI under test never is: a spec equal to its own VERSION reinstalls nothing.
  const OTHER_RELEASE = '2.261023.8';
  test('the default home recorded at install names the units, whatever the caller thinks the default is', async () => {
    // Installed with OMNI_HOME pointing at this home: it is the default, so its unit has no suffix.
    const { deps, runs } = fakeDeps();
    await installSandbox({ home, defaultHome: home, atLogin: true }, deps);
    expect(readSandboxState(sandboxLayout(home))?.defaultHome).toBe(home);
    const unitDir = join(userHome, '.config', 'systemd', 'user');
    const plain = sandboxUnitNames(home, home).systemdUnit;
    expect(existsSync(join(unitDir, plain))).toBe(true);
    // An update the API hands off runs with no OMNI_HOME, so its default is ~/.omni/sandbox.
    runs.length = 0;
    await installSandbox({ home, defaultHome, packageSpec: OTHER_RELEASE }, deps);
    const hashed = sandboxUnitNames(home, defaultHome).systemdUnit;
    expect(hashed).not.toBe(plain);
    expect(existsSync(join(unitDir, hashed))).toBe(false);
    expect(runs.some((call) => call.cmd.includes(hashed))).toBe(false);
    expect(runs.some((call) => call.cmd.join(' ') === `systemctl --user enable --now ${plain}`)).toBe(true);
    expect(readSandboxState(sandboxLayout(home))?.defaultHome).toBe(home);
  });

  test('an install that fails after stopping the sandbox starts it again', async () => {
    const { deps, alive } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    expect(alive.has(4242)).toBe(true);
    const run = deps.run;
    deps.run = async (cmd, opts) =>
      cmd[1] === 'install' && opts.cwd ? { code: 1, stdout: '', stderr: 'registry unreachable' } : run(cmd, opts);
    await expect(installSandbox({ home, defaultHome, packageSpec: OTHER_RELEASE }, deps)).rejects.toThrow(
      'bun install failed',
    );
    expect(alive.has(4242)).toBe(true);
    // The next try installs for real: the failed one did not leave the new manifest behind.
    deps.run = run;
    await installSandbox({ home, defaultHome, packageSpec: OTHER_RELEASE }, deps);
    expect(readSandboxState(sandboxLayout(home))?.version).toBe(OTHER_RELEASE);
  });
});

describe('a nats-server that is not the pinned release', () => {
  /** The real installer replacing it: the verified binary is renamed over the old one. */
  const upgrades: SandboxDeps['installNats'] = async (target) => {
    writeFileSync(target, 'pinned nats-server\n');
    return 'installed';
  };

  test('is replaced, and only then the running sandbox restarts onto it, once', async () => {
    const { deps, kills, detached } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    const natsBinary = sandboxLayout(home).natsBinary;
    let killsBeforeUpgrade = -1;
    deps.installNats = async (target) => {
      killsBeforeUpgrade = kills.length;
      return upgrades(target);
    };

    const result = await installSandbox({ home, defaultHome }, deps);
    expect(killsBeforeUpgrade).toBe(0);
    expect(readFileSync(natsBinary, 'utf-8')).toBe('pinned nats-server\n');
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(detached).toHaveLength(2);
    expect(result.running).toBe(true);
  });

  test('a refused upgrade fails the install with the old binary in place and the sandbox still running', async () => {
    const { deps, kills, detached, alive } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    const natsBinary = sandboxLayout(home).natsBinary;
    const before = readFileSync(natsBinary);
    deps.installNats = async () => 'failed';

    await expect(installSandbox({ home, defaultHome }, deps)).rejects.toThrow(natsBinary);
    expect(readFileSync(natsBinary)).toEqual(before);
    expect(kills).toEqual([]);
    expect(alive.has(4242)).toBe(true);
    expect(detached).toHaveLength(1);
  });

  test('a refused upgrade with a new CLI version stops nothing and leaves the runtime on its version', async () => {
    const { deps, runs, kills } = fakeDeps();
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.7' }, deps);
    deps.installNats = async () => 'failed';

    await expect(installSandbox({ home, defaultHome, packageSpec: '2.261023.8' }, deps)).rejects.toThrow(
      'nats-server',
    );
    expect(kills).toEqual([]);
    expect(runs.filter((call) => call.cmd[1] === 'install')).toHaveLength(1);
    expect(readSandboxState(sandboxLayout(home))?.version).toBe('2.261023.7');
  });

  test('an upgrade together with a new CLI version restarts the sandbox once', async () => {
    const { deps, kills, detached } = fakeDeps();
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.7' }, deps);
    deps.installNats = upgrades;

    await installSandbox({ home, defaultHome, packageSpec: '2.261023.8' }, deps);
    expect(kills).toEqual([[4242, 'SIGTERM']]);
    expect(detached).toHaveLength(2);
  });

  test('a binary that is already the pin restarts nothing', async () => {
    const { deps, kills, detached } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    await installSandbox({ home, defaultHome }, deps);
    expect(kills).toEqual([]);
    expect(detached).toHaveLength(1);
  });
});

describe('updates from the app: omni sandbox update hands the install off', () => {
  const install = (version: string) => [
    BUN,
    'x',
    '--bun',
    `@automagik/omni@${version}`,
    'install',
    '--sandbox',
    '--home',
    home,
    '--json',
  ];

  test("linux: the install runs in a transient systemd --user service of its own, never the sandbox's", async () => {
    const { deps, runs, detached } = fakeDeps({}, { serviceManager: true });
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    const handed = await handOffSandboxUpdate({ home, defaultHome, version: '2.261026.1' }, deps);
    expect(handed).toEqual({ via: 'systemd', logPath: join(home, 'logs', 'update.log'), version: '2.261026.1' });
    const names = sandboxUnitNames(home, defaultHome);
    const run = runs.find((call) => call.cmd[0] === 'systemd-run');
    const args = run?.cmd ?? [];
    const unit = args.find((arg) => arg.startsWith('--unit='));
    expect(unit).toMatch(/^--unit=omni-sandbox-[0-9a-f]{8}-update-\d+\.service$/);
    expect(unit).not.toBe(`--unit=${names.sessionUnit}`);
    expect(unit).not.toBe(`--unit=${names.systemdUnit}`);
    expect(args).toContain(`--property=StandardOutput=append:${join(home, 'logs', 'update.log')}`);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(install('2.261026.1'));
    // Only the sandbox's own environment: nothing from the API's (its key, its database).
    expect(args.some((arg) => arg.startsWith('--setenv=DATABASE_URL'))).toBe(false);
    expect(args.some((arg) => arg.startsWith('--setenv=OMNI_API_KEY'))).toBe(false);
    expect(detached).toHaveLength(0);
  });

  test('without a service manager, or on macOS, a detached process of its own', async () => {
    const linux = fakeDeps();
    await installSandbox({ home, defaultHome }, linux.deps);
    linux.detached.length = 0;
    expect((await handOffSandboxUpdate({ home, defaultHome, version: '2.261026.1' }, linux.deps)).via).toBe('detached');
    expect(linux.detached.at(-1)?.cmd).toEqual(install('2.261026.1'));
    expect(linux.detached.at(-1)?.env.DATABASE_URL).toBeUndefined();

    const mac = fakeDeps({ platform: 'darwin' });
    const runsBefore = mac.runs.length;
    expect((await handOffSandboxUpdate({ home, defaultHome, version: '2.261026.1' }, mac.deps)).via).toBe('detached');
    expect(mac.runs.slice(runsBefore).some((call) => call.cmd[0] === 'launchctl')).toBe(false);
    expect(mac.detached.at(-1)?.cmd).toEqual(install('2.261026.1'));
  });

  test('linux: where systemd-run fails but a unit runs the sandbox, it refuses rather than be killed halfway', async () => {
    const { deps, runs, detached } = fakeDeps({}, { serviceManager: true });
    await installSandbox({ home, defaultHome }, deps);
    const run = deps.run;
    deps.run = async (cmd, opts) =>
      cmd[0] === 'systemd-run' && cmd.some((arg) => arg.includes('-update-'))
        ? { code: 1, stdout: '', stderr: 'Failed to start transient service unit' }
        : run(cmd, opts);
    detached.length = 0;
    await expect(handOffSandboxUpdate({ home, defaultHome, version: '2.261026.1' }, deps)).rejects.toThrow(
      'could not start the update outside',
    );
    expect(detached).toHaveLength(0);
    expect(runs.some((call) => call.cmd.includes('is-active'))).toBe(true);
  });

  test('takes only a release version, and only for a sandbox that exists', async () => {
    const { deps, runs, detached } = fakeDeps({}, { serviceManager: true });
    await expect(handOffSandboxUpdate({ home, defaultHome, version: '2.261026.1' }, deps)).rejects.toMatchObject({
      exitCode: 3,
    });
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    detached.length = 0;
    for (const version of ['', 'latest', '^2.261026.1', '2.261026.1 --evil', '2.261026']) {
      await expect(handOffSandboxUpdate({ home, defaultHome, version }, deps)).rejects.toThrow('Not a release version');
    }
    expect(runs).toHaveLength(0);
    expect(detached).toHaveLength(0);
  });
});

describe('SandboxSupervisor', () => {
  type FakeChild = ChildHandle & { name: string; exit(code: number): void; signals: string[] };

  function supervisorDeps(overrides: Partial<SupervisorDeps> = {}) {
    const events: string[] = [];
    const children: FakeChild[] = [];
    let pid = 100;
    let clock = 0;
    let signalHandler: (signal: NodeJS.Signals) => void = () => {};
    const deps: SupervisorDeps = {
      spawnChild: (spec: SandboxChildSpec) => {
        let exit: (code: number) => void = () => {};
        const exited = new Promise<number>((done) => {
          exit = done;
        });
        const child: FakeChild = {
          name: spec.name,
          pid: pid++,
          exited,
          signals: [],
          exit: (code) => exit(code),
          kill(signal) {
            this.signals.push(signal);
            events.push(`kill ${spec.name} ${signal}`);
            exit(0);
          },
        };
        children.push(child);
        events.push(`spawn ${spec.name}`);
        return child;
      },
      waitReady: async (spec) => {
        events.push(`ready ${spec.name}`);
        return true;
      },
      ensureDatabase: async () => {
        events.push('ensure db');
        return true;
      },
      autopgTarget: () => null,
      now: () => clock,
      sleep: async (ms) => {
        // The stop timeout races every child's exit; only backoff sleeps are recorded.
        if (ms < 20_000) events.push(`sleep ${ms}`);
      },
      log: () => {},
      pid: 99,
      isAlive: () => false,
      env: LEAKY_ENV,
      onSignal: (handler) => {
        signalHandler = handler;
      },
      ...overrides,
    };
    return {
      deps,
      events,
      children,
      signal: (s: NodeJS.Signals) => signalHandler(s),
      tick: (ms: number) => {
        clock += ms;
      },
    };
  }

  function setup() {
    const layout = sandboxLayout(home);
    mkdirSync(layout.runDir, { recursive: true });
    mkdirSync(layout.logsDir, { recursive: true });
    const state = readSandboxState(layout);
    return { layout, state };
  }

  const specsFor = (layout: ReturnType<typeof sandboxLayout>) =>
    sandboxChildSpecs(
      layout,
      {
        schemaVersion: 1,
        version: '1',
        packageSpec: '1',
        bun: BUN,
        ports: { api: 1, pg: 2, nats: 3 } as unknown as SandboxState['ports'],
        atLogin: false,
        createdAt: '',
        updatedAt: '',
      },
      'k',
      {},
    );

  test('starts Postgres, creates the database, then NATS, then the API; stops in reverse on SIGTERM', async () => {
    const { layout } = setup();
    const fake = supervisorDeps();
    const supervisor = new SandboxSupervisor(layout, specsFor(layout), fake.deps);
    const done = supervisor.run();
    await Bun.sleep(0);
    expect(readFileSync(layout.pidPath, 'utf-8').trim()).toBe('99');
    fake.signal('SIGTERM');
    expect(await done).toBe(0);
    expect(fake.events).toEqual([
      'spawn pg',
      'ready pg',
      'ensure db',
      'spawn nats',
      'ready nats',
      'spawn api',
      'ready api',
      'kill api SIGTERM',
      'kill nats SIGTERM',
      'kill pg SIGTERM',
    ]);
    expect(existsSync(layout.pidPath)).toBe(false);
    const status = JSON.parse(readFileSync(layout.statusPath, 'utf-8'));
    expect(status.children.api.state).toBe('stopped');
  });

  test('restarts a child that exits, with backoff', async () => {
    const { layout } = setup();
    const fake = supervisorDeps();
    const supervisor = new SandboxSupervisor(layout, specsFor(layout), fake.deps);
    const done = supervisor.run();
    await Bun.sleep(0);
    fake.children.find((child) => child.name === 'nats')?.exit(1);
    await Bun.sleep(0);
    await Bun.sleep(0);
    expect(fake.events).toContain('sleep 1000');
    expect(fake.events.filter((event) => event === 'spawn nats')).toHaveLength(2);
    expect(supervisor.childState('nats')).toBe('ready');
    fake.signal('SIGINT');
    expect(await done).toBe(0);
  });

  test('a child that keeps crashing stops the whole sandbox with exit 1', async () => {
    const { layout } = setup();
    const fake = supervisorDeps();
    const supervisor = new SandboxSupervisor(layout, specsFor(layout), fake.deps);
    const done = supervisor.run();
    await Bun.sleep(0);
    for (let i = 0; i < 5; i++) {
      const live = fake.children.filter((child) => child.name === 'api').at(-1);
      live?.exit(1);
      for (let j = 0; j < 4; j++) await Bun.sleep(0);
    }
    expect(await done).toBe(1);
    expect(supervisor.childState('api')).toBe('failed');
    expect(fake.events.filter((event) => event.startsWith('sleep'))).toEqual([
      'sleep 1000',
      'sleep 2000',
      'sleep 4000',
      'sleep 8000',
    ]);
  });

  test('a child that never gets ready stops what already started', async () => {
    const { layout } = setup();
    const fake = supervisorDeps({ waitReady: async (spec) => spec.name !== 'nats' });
    const supervisor = new SandboxSupervisor(layout, specsFor(layout), fake.deps);
    expect(await supervisor.run()).toBe(1);
    expect(fake.events).toContain('kill pg SIGTERM');
    expect(fake.events).not.toContain('spawn api');
  });

  test('omni sandbox run --embedded gives its children the embedded env', async () => {
    const { deps: installDeps } = fakeDeps();
    await installSandbox({ home, defaultHome, start: false }, installDeps);
    for (const embedded of [false, true]) {
      let apiSpawned: (spec: SandboxChildSpec) => void = () => {};
      const apiSpec = new Promise<SandboxChildSpec>((done) => {
        apiSpawned = done;
      });
      let next = 1000;
      const fake = supervisorDeps({
        spawnChild: (spec) => {
          if (spec.name === 'api') apiSpawned(spec);
          let exit: (code: number) => void = () => {};
          const exited = new Promise<number>((done) => {
            exit = done;
          });
          return { pid: next++, exited, kill: () => exit(0) };
        },
      });
      const done = runSandboxSupervisor(home, fake.deps, { embedded });
      const api = await apiSpec;
      fake.signal('SIGTERM');
      expect(await done).toBe(0);
      expect(api.env.SENTRY_DSN).toBe(embedded ? '' : undefined);
      expect(api.env.OMNI_UPDATE_COMMAND === undefined).toBe(embedded);
    }
  });
});

describe('CappedLog', () => {
  test('a write that would pass the cap moves the log to .1 and starts a new one', () => {
    const path = join(root, 'pg.log');
    writeFileSync(path, 'x'.repeat(60));
    const log = new CappedLog(path, 100);
    log.write(Buffer.from('a'.repeat(30)));
    expect(statSync(path).size).toBe(90);
    log.write(Buffer.from('b'.repeat(30)));
    log.write(Buffer.from('c'.repeat(30)));
    log.close();
    expect(readFileSync(`${path}.1`, 'utf8')).toBe(`${'x'.repeat(60)}${'a'.repeat(30)}`);
    expect(readFileSync(path, 'utf8')).toBe(`${'b'.repeat(30)}${'c'.repeat(30)}`);
  });

  test('a later rotation replaces the older .1, so at most two logs exist', () => {
    const path = join(root, 'api.log');
    const log = new CappedLog(path, 10);
    for (const letter of ['a', 'b', 'c']) log.write(Buffer.from(letter.repeat(8)));
    log.close();
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('b'.repeat(8));
    expect(readFileSync(path, 'utf8')).toBe('c'.repeat(8));
    expect(readdirSync(root).filter((name) => name.startsWith('api.log'))).toHaveLength(2);
  });

  test("a child's stdout and stderr reach its log through the supervisor", async () => {
    const logPath = join(root, 'child.log');
    const handle = spawnChildProcess({
      name: 'nats',
      cmd: [process.execPath, '-e', 'console.log("out line"); console.error("err line")'],
      env: { PATH: process.env.PATH ?? '' },
      readyPort: 1,
      logPath,
    });
    expect(await handle.exited).toBe(0);
    await Bun.sleep(50);
    const text = readFileSync(logPath, 'utf8');
    expect(text).toContain('out line');
    expect(text).toContain('err line');
  });

  test('writes after close are dropped, not thrown', () => {
    const path = join(root, 'nats.log');
    const log = new CappedLog(path, 100);
    log.close();
    log.close();
    expect(() => log.write(Buffer.from('late'))).not.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('');
  });
});

describe('autopg from its pinned release (darwin-arm64, linux-arm64, linux-x64-glibc)', () => {
  const RELEASE = 'https://github.com/automagik-dev/autopg/releases/download/v3.3.0';
  // Not a secret: a fixture of the length an embedding app's files have at least.
  const PG_PASSWORD = 'test-not-a-secret-pg-password';

  /** A tarball in the release layout, and a pin that matches it for linux-arm64. */
  function fixtureRelease(): { path: string; bytes: Uint8Array; pin: AutopgPin } {
    const stage = join(root, 'release');
    for (const file of ['autopg/autopg', 'autopg/postgres/bin/postgres', 'autopg/postgres/bin/initdb']) {
      mkdirSync(join(stage, file, '..'), { recursive: true });
      writeFileSync(join(stage, file), '#!/bin/sh\n', { mode: 0o755 });
    }
    mkdirSync(join(stage, 'autopg', 'postgres', 'lib'));
    mkdirSync(join(stage, 'autopg', 'postgres', 'share'));
    const path = join(root, 'autopg-3.3.0-linux-arm64.tar.gz');
    const tar = Bun.spawnSync({ cmd: ['tar', '-czf', path, '-C', stage, 'autopg'] });
    if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
    const bytes = new Uint8Array(readFileSync(path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      path,
      bytes,
      pin: {
        version: '3.3.0',
        pgRuntime: '18.3.0-beta.17',
        platforms: { 'linux-arm64': { sha256, size: bytes.length } },
      },
    };
  }

  /** linux-arm64 (glibc), with every download recorded; it serves the fixture release. */
  function pinnedDeps(release = fixtureRelease(), serve: Uint8Array = release.bytes) {
    const downloads: string[] = [];
    const fake = fakeDeps({
      arch: 'arm64',
      libc: 'glibc',
      autopgPin: release.pin,
      download: async (url) => {
        downloads.push(url);
        return serve;
      },
    });
    return { ...fake, downloads, release };
  }

  const runtimeDependencies = () =>
    JSON.parse(readFileSync(join(home, 'runtime', 'package.json'), 'utf-8')).dependencies as Record<string, string>;

  function writePasswordFile(mode = 0o600): string {
    const path = join(root, 'pg-password');
    writeFileSync(path, `${PG_PASSWORD}\n`, { mode });
    chmodSync(path, mode);
    return path;
  }

  test('runs autopg from the verified tarball; nothing for Postgres comes from an npm host', async () => {
    const { deps, downloads } = pinnedDeps();
    await installSandbox({ home, defaultHome, packageSpec: '2.261023.8', start: false }, deps);

    expect(downloads).toEqual([`${RELEASE}/autopg-3.3.0-linux-arm64.tar.gz`]);
    for (const url of downloads) expect(new URL(url).hostname).not.toMatch(/npm/);
    // No pgserve in the runtime: bun installs only this Omni.
    expect(runtimeDependencies()).toEqual({ '@automagik/omni': '2.261023.8' });
    // The binary cache autopg reads first (and keeps when .version is its PINNED_PG_VERSION), so it
    // never downloads @embedded-postgres from the npm registry.
    const seed = join(home, 'pgserve', 'bin', 'linux-arm64');
    expect(existsSync(join(seed, 'bin', 'initdb'))).toBe(true);
    expect(existsSync(join(seed, 'bin', 'postgres'))).toBe(true);
    expect(readFileSync(join(seed, '.version'), 'utf-8').trim()).toBe('18.3.0-beta.17');

    const layout = sandboxLayout(home);
    const state = readSandboxState(layout);
    expect(state?.autopg).toBe('3.3.0');
    expect(state?.pgPasswordFile).toBeUndefined();
    const [pg] = sandboxChildSpecs(layout, state as SandboxState, 'omni_sk_test', LEAKY_ENV);
    expect(pg?.cmd).toEqual([
      join(home, 'autopg', '3.3.0', 'autopg'),
      'postmaster',
      '--port',
      String(SANDBOX_PREFERRED_PORTS.pg),
      '--data',
      join(home, 'data', 'pg'),
      '--socket-dir',
      join(home, 'run', 'pg'),
    ]);
  });

  test('a tarball that is not the pinned one is refused, with no fallback to npm pgserve', async () => {
    const release = fixtureRelease();
    const flipped = new Uint8Array(release.bytes);
    flipped[100] = (flipped[100] ?? 0) ^ 1;
    const { deps, runs } = pinnedDeps(release, flipped);
    await expect(installSandbox({ home, defaultHome, start: false }, deps)).rejects.toThrow(/is not the pinned/);
    expect(runs.find((call) => call.cmd[1] === 'install')).toBeUndefined();
    expect(existsSync(join(home, 'runtime', 'package.json'))).toBe(false);
    expect(existsSync(join(home, 'autopg', '3.3.0'))).toBe(false);
    expect(existsSync(join(home, 'pgserve', 'bin', 'linux-arm64'))).toBe(false);
    expect(readSandboxState(sandboxLayout(home))).toBeNull();
  });

  test('a reinstall downloads nothing, and --autopg-tarball installs from a local file offline', async () => {
    const { deps, downloads, release } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);
    await installSandbox({ home, defaultHome, start: false }, deps);
    expect(downloads).toHaveLength(1);

    const offline = fakeDeps({ arch: 'arm64', libc: 'glibc', autopgPin: release.pin });
    const other = join(root, 'other');
    await installSandbox({ home: other, defaultHome, start: false, autopgTarball: release.path }, offline.deps);
    expect(readSandboxState(sandboxLayout(other))?.autopg).toBe('3.3.0');
  });

  test('darwin-x64, linux musl and other platforms keep npm pgserve, unchanged', async () => {
    for (const host of [
      { platform: 'darwin', arch: 'x64', libc: null },
      { platform: 'linux', arch: 'x64', libc: 'musl' },
      { platform: 'linux', arch: 'arm64', libc: 'musl' },
    ] as const) {
      const sandboxHome = join(root, `${host.platform}-${host.arch}-${host.libc}`);
      const { deps } = fakeDeps(host);
      await installSandbox({ home: sandboxHome, defaultHome, packageSpec: '2.261023.8', start: false }, deps);
      expect(JSON.parse(readFileSync(join(sandboxHome, 'runtime', 'package.json'), 'utf-8')).dependencies).toEqual({
        '@automagik/omni': '2.261023.8',
        pgserve: SANDBOX_PGSERVE_VERSION,
      });
      expect(readSandboxState(sandboxLayout(sandboxHome))?.autopg).toBeUndefined();
      expect(existsSync(join(sandboxHome, 'autopg'))).toBe(false);
    }
  });

  test('an existing cluster still starts as before when the password file is not asked for', async () => {
    const layout = sandboxLayout(home);
    mkdirSync(layout.pgDataDir, { recursive: true });
    writeFileSync(join(layout.pgDataDir, 'PG_VERSION'), '18\n');
    const { deps } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);

    const state = readSandboxState(layout) as SandboxState;
    const [pg, , api] = sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV);
    expect(pg?.cmd).not.toContain('--password-file');
    expect(api?.env.DATABASE_URL).toBe(`postgresql://postgres:postgres@localhost:${SANDBOX_PREFERRED_PORTS.pg}/omni`);
    expect(api?.env.PGHOST).toBe(layout.pgSocketDir);
    expect(readFileSync(join(layout.pgDataDir, 'PG_VERSION'), 'utf-8')).toBe('18\n');
  });

  test('opt-in password file: scram on 127.0.0.1, and the password only in the API env', async () => {
    const passwordFile = writePasswordFile();
    const { deps } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps);

    const layout = sandboxLayout(home);
    const state = readSandboxState(layout) as SandboxState;
    expect(state.pgPasswordFile).toBe(passwordFile);
    expect(readFileSync(layout.statePath, 'utf-8')).not.toContain(PG_PASSWORD);
    const config = readFileSync(layout.configPath, 'utf-8');
    expect(config).not.toContain(PG_PASSWORD);
    expect(JSON.parse(config).server.databaseUrl).toBe(`postgresql://postgres@127.0.0.1:${state.ports.pg}/omni`);

    const [pg, nats, api] = sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV, {}, PG_PASSWORD);
    expect(pg?.cmd.slice(0, 2)).toEqual([join(home, 'autopg', '3.3.0', 'autopg'), 'postmaster']);
    expect(pg?.cmd.slice(-2)).toEqual(['--password-file', passwordFile]);
    expect(pg?.superuserPassword).toBe(PG_PASSWORD);
    expect(api?.env.DATABASE_URL).toBe(`postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${state.ports.pg}/omni`);
    expect(api?.env.PGHOST).toBeUndefined();
    for (const spec of [pg, nats]) {
      expect(JSON.stringify(spec?.env)).not.toContain(PG_PASSWORD);
      expect(JSON.stringify(spec?.cmd)).not.toContain(PG_PASSWORD);
    }
    expect(() => sandboxChildSpecs(layout, state, 'omni_sk_test', LEAKY_ENV)).toThrow(/password/);
  });

  test('a reinstall (an update from the app) keeps the password file', async () => {
    const passwordFile = writePasswordFile();
    const { deps } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps);
    await installSandbox({ home, defaultHome, start: false }, deps);
    expect(readSandboxState(sandboxLayout(home))?.pgPasswordFile).toBe(passwordFile);
  });

  test('the password file is refused for a cluster made without one, and where autopg has no build', async () => {
    const passwordFile = writePasswordFile();
    const { deps } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);
    const layout = sandboxLayout(home);
    writeFileSync(join(layout.pgDataDir, 'PG_VERSION'), '18\n');
    await expect(
      installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps),
    ).rejects.toThrow(/made without a password file/);
    expect(readSandboxState(layout)?.pgPasswordFile).toBeUndefined();

    const unpinned = fakeDeps();
    await expect(
      installSandbox(
        { home: join(root, 'musl'), defaultHome, start: false, pgPasswordFile: passwordFile },
        unpinned.deps,
      ),
    ).rejects.toThrow(/no build for linux-x64/);
  });

  /** Supervisor fakes for a sandbox installed from `release` on linux-arm64. */
  function pinnedSupervisor(release: ReturnType<typeof fixtureRelease>) {
    const spawned: string[] = [];
    const passwords: Array<string | undefined> = [];
    let next = 2000;
    let apiSpawned: () => void = () => {};
    const apiStarted = new Promise<void>((done) => {
      apiSpawned = done;
    });
    let signal: (s: NodeJS.Signals) => void = () => {};
    const deps: SupervisorDeps = {
      spawnChild: (spec) => {
        spawned.push(spec.name);
        if (spec.name === 'api') apiSpawned();
        let exit: (code: number) => void = () => {};
        const exited = new Promise<number>((done) => {
          exit = done;
        });
        return { pid: next++, exited, kill: () => exit(0) };
      },
      waitReady: async () => true,
      ensureDatabase: async (_port, password) => {
        passwords.push(password);
        return true;
      },
      autopgTarget: () => autopgTarget(release.pin, { platform: 'linux', arch: 'arm64', libc: 'glibc' }),
      now: () => 0,
      sleep: async () => {},
      log: () => {},
      pid: 99,
      isAlive: () => false,
      env: LEAKY_ENV,
      onSignal: (handler) => {
        signal = handler;
      },
    };
    return { deps, spawned, passwords, apiStarted, stop: () => signal('SIGTERM') };
  }

  test('omni sandbox run reads the password file each start and creates the database with it', async () => {
    const passwordFile = writePasswordFile();
    const { deps, release } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps);
    const supervisor = pinnedSupervisor(release);
    const done = runSandboxSupervisor(home, supervisor.deps);
    await supervisor.apiStarted;
    supervisor.stop();
    expect(await done).toBe(0);
    expect(supervisor.passwords).toEqual([PG_PASSWORD]);

    chmodSync(passwordFile, 0o644);
    await expect(runSandboxSupervisor(home, supervisor.deps)).rejects.toThrow(/mode is 0644/);
  });

  test('omni sandbox run refuses a half-installed autopg runtime before anything starts', async () => {
    const { deps, release } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);
    // An install killed while it seeded autopg's binary cache: the release is there, the seed is not.
    const seed = join(home, 'pgserve', 'bin', 'linux-arm64');
    rmSync(join(seed, '.version'));
    rmSync(join(seed, 'lib'), { recursive: true });
    const supervisor = pinnedSupervisor(release);
    // A supervisor that got past the check would run until stopped; fail fast instead.
    supervisor.deps.spawnChild = (spec) => {
      supervisor.spawned.push(spec.name);
      throw new Error(`${spec.name} started on a half-installed runtime`);
    };
    await expect(runSandboxSupervisor(home, supervisor.deps)).rejects.toThrow(/not fully installed/);
    expect(supervisor.spawned).toEqual([]);
    expect(existsSync(join(seed, 'bin', 'postgres'))).toBe(true);
  });

  test('a pinned platform missing from the pin is refused, with no fallback to npm pgserve', async () => {
    const release = fixtureRelease();
    const { deps } = pinnedDeps({ ...release, pin: { ...release.pin, platforms: {} } });
    await expect(installSandbox({ home, defaultHome, start: false }, deps)).rejects.toThrow(
      /pin has no linux-arm64 entry/,
    );
    expect(existsSync(join(home, 'runtime', 'package.json'))).toBe(false);
    expect(readSandboxState(sandboxLayout(home))).toBeNull();
  });

  test('with no state, a data dir autopg never ran in password-file mode refuses the opt-in untouched', async () => {
    const passwordFile = writePasswordFile();
    const layout = sandboxLayout(home);
    // What uninstall leaves of a legacy sandbox: its cluster, without sandbox.json.
    mkdirSync(layout.pgDataDir, { recursive: true });
    writeFileSync(join(layout.pgDataDir, 'PG_VERSION'), '18\n');
    const hba = 'local all all trust\nhost all all 127.0.0.1/32 password\n';
    writeFileSync(join(layout.pgDataDir, 'pg_hba.conf'), hba);
    const { deps, downloads } = pinnedDeps();
    await expect(
      installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps),
    ).rejects.toThrow(/made without a password file/);
    expect(readFileSync(join(layout.pgDataDir, 'pg_hba.conf'), 'utf-8')).toBe(hba);
    expect(readSandboxState(layout)).toBeNull();
    expect(downloads).toEqual([]);

    // A cluster autopg already ran with a password file keeps it across uninstall and reinstall.
    writeFileSync(
      join(layout.pgDataDir, 'pg_hba.conf'),
      '# Written by pgserve at every start (--password-file).\nhost all all 127.0.0.1/32 scram-sha-256\n',
    );
    await installSandbox({ home, defaultHome, start: false, pgPasswordFile: passwordFile }, deps);
    expect(readSandboxState(layout)?.pgPasswordFile).toBe(passwordFile);
  });

  test('uninstall removes the autopg runtime with the rest of the runtime', async () => {
    const { deps } = pinnedDeps();
    await installSandbox({ home, defaultHome, start: false }, deps);
    await uninstallSandbox({ home, defaultHome }, deps);
    expect(existsSync(join(home, 'autopg'))).toBe(false);
    expect(existsSync(join(home, 'data'))).toBe(true);
  });
});

describe('command wiring', () => {
  test('omni install carries the sandbox flags', () => {
    const flags = createInstallCommand().options.map((option) => option.long);
    for (const flag of [
      '--sandbox',
      '--home',
      '--at-login',
      '--no-start',
      '--package',
      '--pg-password-file',
      '--autopg-tarball',
      '--json',
    ]) {
      expect(flags).toContain(flag);
    }
  });

  test('omni sandbox has status, start, stop, uninstall, update and run', () => {
    const names = createSandboxCommand().commands.map((command) => command.name());
    expect(names).toEqual(['status', 'start', 'stop', 'uninstall', 'update', 'run']);
  });

  test('omni sandbox run takes --home and --embedded', () => {
    const run = createSandboxCommand().commands.find((command) => command.name() === 'run');
    expect(run?.options.map((option) => option.long)).toEqual(['--home', '--embedded']);
  });
});
