/**
 * Sandboxed local Omni — `omni install --sandbox` and `omni sandbox …`.
 *
 * No real process, port, download or network: every effect goes through fake
 * {@link SandboxDeps} / {@link SupervisorDeps}. Files are real, in temp dirs,
 * so the isolation claim (nothing written outside the sandbox home, nothing
 * read from the caller's shell) is checked on disk.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
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
import { createInstallCommand } from '../commands/install.js';
import { createSandboxCommand } from '../commands/sandbox.js';
import { type ChildHandle, SandboxSupervisor, type SupervisorDeps } from '../sandbox-supervisor.js';
import {
  SANDBOX_PGSERVE_VERSION,
  SANDBOX_PREFERRED_PORTS,
  type SandboxChildSpec,
  type SandboxDeps,
  type SandboxState,
  buildLaunchdPlist,
  buildSystemdUserUnit,
  installSandbox,
  leftoverChildPids,
  readSandboxApiKey,
  readSandboxState,
  resolveSandboxHome,
  sandboxChildSpecs,
  sandboxLayout,
  sandboxStatus,
  sandboxUnitNames,
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

function fakeDeps(overrides: Partial<SandboxDeps> = {}) {
  const runs: Call[] = [];
  const detached: Call[] = [];
  const kills: Array<[number, string]> = [];
  const alive = new Set<number>();
  const busyPorts = new Set<number>();
  let clock = 0;
  const deps: SandboxDeps = {
    platform: 'linux',
    uid: 501,
    userHome,
    bun: BUN,
    env: LEAKY_ENV,
    run: async (cmd, opts) => {
      runs.push({ cmd, cwd: opts.cwd, env: opts.env });
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
    installNats: async (target) => {
      writeFileSync(target, '#!/bin/sh\n');
      return true;
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
    for (const call of [...runs, ...detached]) {
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

  test('linux: a sandbox already running gets its unit enabled for the next login', async () => {
    const { deps, runs } = fakeDeps();
    await installSandbox({ home, defaultHome }, deps);
    runs.length = 0;
    await installSandbox({ home, defaultHome, atLogin: true }, deps);
    const names = sandboxUnitNames(home, defaultHome);
    expect(runs.map((call) => call.cmd.join(' '))).toContain(`systemctl --user enable ${names.systemdUnit}`);
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
});

describe('command wiring', () => {
  test('omni install carries the sandbox flags', () => {
    const flags = createInstallCommand().options.map((option) => option.long);
    for (const flag of ['--sandbox', '--home', '--at-login', '--no-start', '--package', '--json']) {
      expect(flags).toContain(flag);
    }
  });

  test('omni sandbox has status, start, stop, uninstall and run', () => {
    const names = createSandboxCommand().commands.map((command) => command.name());
    expect(names).toEqual(['status', 'start', 'stop', 'uninstall', 'run']);
  });
});
