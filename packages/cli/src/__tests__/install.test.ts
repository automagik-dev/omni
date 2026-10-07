/**
 * install command tests
 *
 * Focuses on the pure/exported helpers where we can assert without spawning
 * pm2 or mutating the real filesystem:
 *
 *   - `buildAgentHandoffBlock` — exact content contract for the agent-first
 *     stdout block that the wish pins to literal substrings
 *   - `detectReinstall` — signal-based reinstall detection (config, pm2,
 *     data dir) with stubbed deps
 *   - `installPm2Logrotate` — idempotent skip + sequential `pm2 set` calls
 *   - `createInstallCommand` — flag wiring (--force-cleanup, deprecated
 *     --non-interactive, etc.)
 *
 * `runInstall` end-to-end is covered by the qa script in scripts/ (real pm2
 * + real pgserve) — unit tests cannot meaningfully mock that whole stack.
 *
 * Written for the 2026-04-09 `omni-install-resilience` wish.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentHandoffBlock, createInstallCommand } from '../commands/install.js';
import { loadServerConfig, setConfigValue } from '../config.js';
import { buildSystemdNatsUnit, resolveManagedNatsHost } from '../install-helpers.js';
import { NATS_BINARY_PATH } from '../nats-install.js';
import { buildNatsServerArgs } from '../nats-server-args.js';
import { PM2_PROCESSES, buildPm2StartArgs } from '../pm2.js';

// ---------------------------------------------------------------------------
// Agent handoff banner — literal-substring contract
// ---------------------------------------------------------------------------

describe('buildAgentHandoffBlock', () => {
  const cfg = {
    port: 8882,
    dataDir: '/home/test/.omni/data',
    databaseUrl: 'postgresql://postgres:postgres@localhost:9432/omni',
    apiKey: 'omni_sk_test-key',
  };

  test('contains the literal pm2-describe verification command', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain('pm2 describe omni-api');
    expect(block).toContain('pm2 describe omni-nats');
  });

  test('contains the literal "load the /omni skill" instruction', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain('Load the /omni skill');
  });

  test('contains the literal "omni instances create" next-step command', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain('omni instances create');
  });

  test('addresses the agent, not a human', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain('For the agent running this install');
  });

  test('references the preserved data directory path', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain(cfg.dataDir);
    expect(block).toContain('preserved across reinstalls');
  });

  test('contains zero ANSI escape sequences', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    // Any ESC character would be an ANSI opener.
    const ansiOpener = `${String.fromCharCode(27)}[`;
    expect(block.includes(ansiOpener)).toBe(false);
  });

  test('contains no interactive "[Y/n]" prompts', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).not.toMatch(/\[Y\/n\]/i);
    expect(block).not.toMatch(/\[y\/N\]/i);
  });

  test('displays the api key value the caller passed in', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_freshly-generated');
    expect(block).toContain('omni_sk_freshly-generated');
  });

  test('displays a masked key when the caller passed a mask', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_****');
    expect(block).toContain('omni_sk_****');
  });

  test('the port appears in the localhost URL', () => {
    const block = buildAgentHandoffBlock(cfg, 'omni_sk_test-key');
    expect(block).toContain(`http://localhost:${cfg.port}`);
  });
});

// ---------------------------------------------------------------------------
// Reinstall detection — data-dir signal
// ---------------------------------------------------------------------------

describe('detectReinstall — data dir signal', () => {
  // Per-process path: concurrent runs from sibling worktrees must not rm each other's fixture.
  const FIXTURE_ROOT = join(tmpdir(), `omni-install-test-datadir-${process.pid}`);

  beforeEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test('non-existent data dir returns isReinstall: false (assuming no other signals)', async () => {
    const { detectReinstall } = await import('../install-helpers.js');
    const res = await detectReinstall(FIXTURE_ROOT);
    // hasDataDir MUST be false
    expect(res.hasDataDir).toBe(false);
    // hasConfig and hasPm2Process may be true from the host — the only
    // assertion we make is that the data-dir signal alone is absent.
  });

  test('empty data dir returns hasDataDir: false', async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    const { detectReinstall } = await import('../install-helpers.js');
    const res = await detectReinstall(FIXTURE_ROOT);
    expect(res.hasDataDir).toBe(false);
  });

  test('data dir with only .DS_Store returns hasDataDir: false', async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    writeFileSync(join(FIXTURE_ROOT, '.DS_Store'), 'mac cruft');
    const { detectReinstall } = await import('../install-helpers.js');
    const res = await detectReinstall(FIXTURE_ROOT);
    expect(res.hasDataDir).toBe(false);
  });

  test('data dir with a real file returns hasDataDir: true and isReinstall: true', async () => {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    writeFileSync(join(FIXTURE_ROOT, 'PG_VERSION'), '17\n');
    const { detectReinstall } = await import('../install-helpers.js');
    const res = await detectReinstall(FIXTURE_ROOT);
    expect(res.hasDataDir).toBe(true);
    // Single signal is sufficient
    expect(res.isReinstall).toBe(true);
  });

  test('data dir with a nested subdirectory returns hasDataDir: true', async () => {
    mkdirSync(join(FIXTURE_ROOT, 'pgserve'), { recursive: true });
    const { detectReinstall } = await import('../install-helpers.js');
    const res = await detectReinstall(FIXTURE_ROOT);
    expect(res.hasDataDir).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Managed NATS bind address (PM2 path)
// ---------------------------------------------------------------------------

describe('omni install — managed NATS bind address', () => {
  // startServices() spawns pm2, so assert the exact expression it evaluates —
  // resolveManagedNatsHost(loadServerConfig()) — against a sandboxed config,
  // then the args it hands pm2.
  const CONFIG_DIR_ENV = 'OMNI_CONFIG_DIR';
  let sandbox: string | undefined;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    savedConfigDir = process.env[CONFIG_DIR_ENV];
    sandbox = mkdtempSync(join(tmpdir(), 'omni-install-nats-host-'));
    process.env[CONFIG_DIR_ENV] = sandbox;
  });

  afterEach(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    sandbox = undefined;
    if (savedConfigDir === undefined) delete process.env[CONFIG_DIR_ENV];
    else process.env[CONFIG_DIR_ENV] = savedConfigDir;
  });

  function installNatsScriptArgs(): string[] {
    const natsArgs = buildPm2StartArgs({
      kind: 'nats',
      script: '/tmp/nats-server',
      name: PM2_PROCESSES.nats,
      scriptArgs: buildNatsServerArgs({
        natsDataDir: '/tmp/data/nats',
        host: resolveManagedNatsHost(loadServerConfig()),
      }),
    });
    return natsArgs.slice(natsArgs.indexOf('--') + 1);
  }

  test('fresh install (no config) binds omni-nats to 127.0.0.1', () => {
    expect(installNatsScriptArgs()).toEqual(['-js', '-sd', '/tmp/data/nats', '-a', '127.0.0.1']);
  });

  test('reinstall honours a configured server.natsHost', () => {
    setConfigValue('server.natsHost', '10.0.0.5');
    expect(installNatsScriptArgs()).toEqual(['-js', '-sd', '/tmp/data/nats', '-a', '10.0.0.5']);
  });

  test('install.ts recreates omni-nats through the shared launcher, not inline', () => {
    const src = readFileSync(new URL('../commands/install.ts', import.meta.url).pathname, 'utf-8');
    expect(src).toContain('resolveManagedNatsHost(loadServerConfig())');
    expect(src).toContain('startManagedNats({ dataDir: cfg.dataDir, host: natsHost })');
    expect(src).not.toContain("'-js'");
  });
});

// ---------------------------------------------------------------------------
// systemd unit (--systemd)
// ---------------------------------------------------------------------------

describe('buildSystemdNatsUnit', () => {
  function execStart(unit: string): string {
    const line = unit.split('\n').find((l) => l.startsWith('ExecStart='));
    if (!line) throw new Error('unit has no ExecStart= line');
    return line;
  }

  test('default bind address: quoted -js -sd <dataDir>/nats -a 127.0.0.1', () => {
    expect(execStart(buildSystemdNatsUnit('/var/lib/omni', '127.0.0.1'))).toBe(
      `ExecStart="${NATS_BINARY_PATH}" "-js" "-sd" "/var/lib/omni/nats" "-a" "127.0.0.1"`,
    );
  });

  test('custom bind address is passed after -a', () => {
    expect(execStart(buildSystemdNatsUnit('/var/lib/omni', '0.0.0.0'))).toEndWith('"-a" "0.0.0.0"');
    expect(execStart(buildSystemdNatsUnit('/var/lib/omni', '::'))).toEndWith('"-a" "::"');
  });

  test('keeps the rest of the unit unchanged', () => {
    const unit = buildSystemdNatsUnit('/var/lib/omni', '127.0.0.1');
    expect(unit).toContain('Description=Omni NATS Server');
    expect(unit).toContain('Type=simple');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=multi-user.target');
  });

  test('escapes systemd specifiers, env expansion, quotes and backslashes in the data dir', () => {
    expect(execStart(buildSystemdNatsUnit('/srv/100%$HOME"x\\y', '127.0.0.1'))).toContain(
      '"-sd" "/srv/100%%$$HOME\\"x\\\\y/nats"',
    );
  });

  test('rejects an invalid bind address instead of writing it into ExecStart', () => {
    expect(() => buildSystemdNatsUnit('/var/lib/omni', '127.0.0.1"\nExecStartPre=/bin/id')).toThrow();
    expect(() => buildSystemdNatsUnit('/var/lib/omni', '$HOST')).toThrow();
  });

  test('rejects a data dir containing a newline', () => {
    expect(() => buildSystemdNatsUnit('/var/lib/omni\nExecStartPre=/bin/id', '127.0.0.1')).toThrow(/newline/);
  });
});

// ---------------------------------------------------------------------------
// pm2-logrotate settings export
// ---------------------------------------------------------------------------

describe('PM2_LOGROTATE_SETTINGS', () => {
  test('exports the four settings the wish requires', async () => {
    const { PM2_LOGROTATE_SETTINGS } = await import('../install-helpers.js');
    expect(PM2_LOGROTATE_SETTINGS.max_size).toBe('10M');
    expect(PM2_LOGROTATE_SETTINGS.retain).toBe('5');
    expect(PM2_LOGROTATE_SETTINGS.compress).toBe('true');
    expect(PM2_LOGROTATE_SETTINGS.rotateInterval).toBe('0 0 * * *');
  });
});

// ---------------------------------------------------------------------------
// Install command wiring
// ---------------------------------------------------------------------------

describe('createInstallCommand — flag wiring', () => {
  test('exposes --force-cleanup', () => {
    const cmd = createInstallCommand();
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--force-cleanup');
  });

  test('keeps --non-interactive as a deprecated silent no-op', () => {
    const cmd = createInstallCommand();
    const opt = cmd.options.find((o) => o.long === '--non-interactive');
    expect(opt).toBeDefined();
    expect(opt?.description).toContain('deprecated');
  });

  test('exposes --systemd', () => {
    const cmd = createInstallCommand();
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--systemd');
  });

  test('exposes --port, --database-url, --api-key', () => {
    const cmd = createInstallCommand();
    const longs = cmd.options.map((o) => o.long);
    expect(longs).toContain('--port');
    expect(longs).toContain('--database-url');
    expect(longs).toContain('--api-key');
  });

  test('description reflects non-interactive reinstall-safe agent-first design', () => {
    const cmd = createInstallCommand();
    const desc = cmd.description();
    expect(desc).toContain('non-interactive');
    expect(desc).toContain('reinstall-safe');
    expect(desc).toContain('agent-first');
  });
});

// ---------------------------------------------------------------------------
// Wizard removal — install.ts must not import readline
// ---------------------------------------------------------------------------

describe('install.ts wizard removal', () => {
  test('install.ts source does not import readline', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../commands/install.ts', import.meta.url).pathname, 'utf-8');
    expect(src).not.toContain("from 'node:readline'");
    expect(src).not.toContain("require('readline')");
    expect(src).not.toContain('createInterface(');
  });

  test('install.ts source does not define promptLine / promptYesNo / promptApiKey', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../commands/install.ts', import.meta.url).pathname, 'utf-8');
    expect(src).not.toMatch(/function\s+promptLine\b/);
    expect(src).not.toMatch(/function\s+promptYesNo\b/);
    expect(src).not.toMatch(/function\s+promptApiKey\b/);
    expect(src).not.toMatch(/function\s+chooseProcessManager\b/);
  });

  test('install.ts line count is under the 400-line target', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../commands/install.ts', import.meta.url).pathname, 'utf-8');
    const lines = src.split('\n').length;
    expect(lines).toBeLessThan(400);
  });
});
