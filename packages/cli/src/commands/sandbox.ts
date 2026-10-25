/**
 * Sandbox Command
 *
 * omni sandbox status    [--home <dir>] [--json]
 * omni sandbox start     [--home <dir>] [--json]
 * omni sandbox stop      [--home <dir>] [--json]
 * omni sandbox uninstall [--home <dir>] [--purge] [--json]
 * omni sandbox run       [--home <dir>]          (the supervisor; launchd/systemd run this)
 * omni sandbox update    [--home <dir>] [--to <version>] [--json]
 *                        (hands an update off; the sandbox's API runs this when the app asks)
 *
 * Manages the sandboxed Omni that `omni install --sandbox` creates (see
 * src/sandbox.ts). With `--json` every subcommand prints one
 * {@link SandboxReport} on stdout and exits 0 (ok), 1 (failed) or 3 (no sandbox
 * at that home). The API key never appears in the output; it stays in
 * `<home>/config/config.json`.
 */

import { Command } from 'commander';
import * as output from '../output.js';
import { runSandboxSupervisor } from '../sandbox-supervisor.js';
import {
  SANDBOX_EXIT,
  SandboxError,
  type SandboxInstallOptions,
  type SandboxReport,
  handOffSandboxUpdate,
  installSandbox,
  resolveSandboxHome,
  sandboxStatus,
  startSandbox,
  stopSandbox,
  uninstallSandbox,
} from '../sandbox.js';

interface SandboxCliOptions {
  home?: string;
  json?: boolean;
}

function homes(options: SandboxCliOptions): { home: string; defaultHome: string } {
  return { home: resolveSandboxHome(options.home), defaultHome: resolveSandboxHome(undefined) };
}

function printReport(report: SandboxReport, json: boolean | undefined, verb: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  if (!report.installed) {
    output.raw(`No sandboxed Omni at ${report.home}. Create one with: omni install --sandbox`);
    return;
  }
  const state = report.running ? (report.healthy ? 'running' : 'running, not answering yet') : 'stopped';
  output.raw(`Sandboxed Omni v${report.version} — ${state}${verb ? ` (${verb})` : ''}`);
  output.raw(`  API      ${report.apiUrl}`);
  output.raw(`  Home     ${report.home}`);
  output.raw(`  Config   ${report.configPath}   (use: OMNI_CONFIG_DIR=${report.home}/config omni status)`);
  output.raw(`  Logs     ${report.logsDir}`);
  output.raw(`  At login ${report.atLogin ? 'yes' : 'no'}`);
  if (report.error) output.warn(report.error);
}

// The CLI strips a global --json before Commander sees it and switches the output format.
const wantsJson = (options: SandboxCliOptions): boolean =>
  options.json === true || output.getCurrentFormat() === 'json';

/** Runs one operation and prints its report; exit code 0, 1 or 3. */
async function act(options: SandboxCliOptions, verb: string, operation: () => Promise<SandboxReport>): Promise<void> {
  const json = wantsJson(options);
  try {
    const report = await operation();
    printReport(report, json, verb);
    if (!report.ok) process.exit(SANDBOX_EXIT.failed);
  } catch (error) {
    const exitCode = error instanceof SandboxError ? error.exitCode : SANDBOX_EXIT.failed;
    const message = error instanceof Error ? error.message : String(error);
    const home = resolveSandboxHome(options.home);
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, installed: exitCode !== SANDBOX_EXIT.notInstalled, home, error: message })}\n`,
      );
      process.exit(exitCode);
    }
    output.error(message, undefined, exitCode);
  }
}

/** The flags `omni install` takes for `--sandbox`. */
export interface SandboxInstallFlags extends SandboxCliOptions {
  sandbox?: boolean;
  atLogin?: boolean;
  start?: boolean;
  package?: string;
}

/**
 * Adds the `--sandbox` flags to `omni install` and runs a sandbox install when
 * asked; otherwise hands the options to the plain install.
 */
export function withSandboxInstall<T extends object>(command: Command, plain: (options: T) => Promise<void>): Command {
  return command
    .option('--sandbox', 'Install a separate, isolated Omni (own Postgres, NATS, ports and config) instead')
    .option('--home <dir>', 'With --sandbox: its home (default: $OMNI_HOME/sandbox, else ~/.omni/sandbox)')
    .option('--at-login', 'With --sandbox: start it at login (launchd agent / systemd --user unit, no sudo)')
    .option('--no-start', 'With --sandbox: install without starting it')
    .option('--package <spec>', 'With --sandbox: @automagik/omni version or spec for its runtime (default: this CLI)')
    .option('--json', 'With --sandbox: print one JSON report')
    .action(async (options: T & SandboxInstallFlags) => {
      if (!(await runSandboxInstallIfAsked(options))) await plain(options);
    });
}

/**
 * `omni install` hands over here first: true when it was a `--sandbox` install
 * (done), false for a plain install. Sandbox-only flags without `--sandbox` are
 * refused rather than ignored.
 */
async function runSandboxInstallIfAsked(options: SandboxInstallFlags): Promise<boolean> {
  if (options.sandbox) {
    await runSandboxInstall(options);
    return true;
  }
  const stray = [options.home, options.atLogin, options.package, options.json].some((value) => value !== undefined);
  if (stray || options.start === false) {
    output.error('--home, --at-login, --no-start, --package and --json need --sandbox');
  }
  return false;
}

function runSandboxInstall(options: SandboxInstallFlags): Promise<void> {
  const { home, defaultHome } = homes(options);
  const install: SandboxInstallOptions = {
    home,
    defaultHome,
    packageSpec: options.package,
    atLogin: options.atLogin,
    start: options.start,
  };
  if (!wantsJson(options))
    output.raw(`Installing a sandboxed Omni at ${home} (first start downloads Postgres; give it a minute)…`);
  return act(options, 'installed', () => installSandbox(install));
}

const withHome = (command: Command): Command =>
  command
    .option('--home <dir>', 'Sandbox home (default: $OMNI_HOME/sandbox, else ~/.omni/sandbox)')
    .option('--json', 'Print one JSON report');

export function createSandboxCommand(): Command {
  const sandbox = new Command('sandbox').description(
    'Manage the sandboxed local Omni (own Postgres, NATS, ports and config; created by omni install --sandbox)',
  );

  withHome(
    sandbox.command('status').description('Show whether the sandbox is installed, running and answering'),
  ).action((options: SandboxCliOptions) => act(options, '', () => sandboxStatus(homes(options))));
  withHome(sandbox.command('start').description('Start the sandbox and wait until its API answers')).action(
    (options: SandboxCliOptions) => act(options, 'started', () => startSandbox(homes(options))),
  );
  withHome(sandbox.command('stop').description('Stop the API, NATS and Postgres of the sandbox')).action(
    (options: SandboxCliOptions) => act(options, 'stopped', () => stopSandbox(homes(options))),
  );
  withHome(
    sandbox
      .command('uninstall')
      .description('Stop the sandbox and remove its runtime and at-login unit; data and config stay')
      .option('--purge', 'Also delete its data and config (the whole sandbox home)'),
  ).action((options: SandboxCliOptions & { purge?: boolean }) =>
    act(options, 'uninstalled', () => uninstallSandbox({ ...homes(options), purge: options.purge === true })),
  );
  sandbox
    .command('update')
    .description('Update the sandbox to a published version from outside it (what its API runs when the app asks)')
    .option('--home <dir>', 'Sandbox home (default: $OMNI_HOME/sandbox, else ~/.omni/sandbox)')
    .option('--to <version>', 'The version to update to (default: $OMNI_UPDATE_VERSION, which the API sets)')
    .option('--json', 'Print one JSON line')
    .action(async (options: SandboxCliOptions & { to?: string }) => {
      const version = options.to?.trim() || process.env.OMNI_UPDATE_VERSION?.trim() || '';
      try {
        const handed = await handOffSandboxUpdate({ ...homes(options), version });
        if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, ...handed })}\n`);
        else output.raw(`Updating the sandbox to ${handed.version}; it restarts by itself. Log: ${handed.logPath}`);
        process.exit(SANDBOX_EXIT.ok);
      } catch (error) {
        const exitCode = error instanceof SandboxError ? error.exitCode : SANDBOX_EXIT.failed;
        output.error(error instanceof Error ? error.message : String(error), undefined, exitCode);
      }
    });
  sandbox
    .command('run')
    .description('Run the sandbox supervisor in the foreground (what launchd/systemd start)')
    .option('--home <dir>', 'Sandbox home (default: $OMNI_HOME/sandbox, else ~/.omni/sandbox)')
    .action(async (options: SandboxCliOptions) => {
      try {
        process.exit(await runSandboxSupervisor(resolveSandboxHome(options.home)));
      } catch (error) {
        const exitCode = error instanceof SandboxError ? error.exitCode : SANDBOX_EXIT.failed;
        output.error(error instanceof Error ? error.message : String(error), undefined, exitCode);
      }
    });
  return sandbox;
}
