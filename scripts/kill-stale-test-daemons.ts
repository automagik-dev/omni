#!/usr/bin/env bun
/**
 * kill-stale-test-daemons — sweep up leaked PM2 god daemons spawned by CLI tests.
 *
 * The CLI test suite runs the real `omni` binary under an isolated PM2_HOME
 * (e.g. `/tmp/.omni-test-<timestamp>/.pm2`). If teardown is skipped or the
 * suite crashes before its afterAll hook, pm2 forks a god daemon that
 * re-parents to init once the test runner exits. The PM2_HOME directory is
 * then rm-rf'd, leaving an orphan process attached to a path that no longer
 * exists. See issue #413.
 *
 * This script:
 *   1. Scans `ps -eo pid,args` for processes matching
 *      `PM2 ... God Daemon (<path>)` where <path> contains `.omni-test`.
 *   2. For each match, checks whether <path> still exists on disk.
 *   3. If the path is gone → SIGTERM the process, wait 2s, SIGKILL if still alive.
 *      (If the path still exists, the daemon may be in-use by a running test
 *      and is left alone — use `--force` to kill those too.)
 *
 * Flags:
 *   --dry-run   List stale daemons without killing them.
 *   --force     Kill matching daemons even if their PM2_HOME still exists.
 *
 * Exit codes:
 *   0  Clean — no stale daemons, or all stale daemons killed successfully.
 *   1  At least one daemon could not be killed.
 */

import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { spawnSync } from 'bun';

interface StaleDaemon {
  pid: number;
  pm2Home: string;
  homeExists: boolean;
  command: string;
}

// Matches a pm2 god daemon title whose PM2_HOME path contains `.omni-test`.
// Anchored so it must be at the START of the process args, not embedded
// somewhere mid-string — otherwise any process whose cmdline happens to
// contain the literal text (e.g. this script's source, a grep command, a
// transcript buffer) would match and could be killed by mistake.
const DAEMON_PATTERN = /^PM2\s+[^:]*:\s*God Daemon\s+\((?<home>[^)]*\.omni-test[^)]*)\)/;

function parseDaemonLine(line: string): StaleDaemon | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const pidMatch = trimmed.match(/^(\d+)\s+(.*)$/);
  if (!pidMatch) return null;
  const pid = Number(pidMatch[1]);
  if (!Number.isFinite(pid)) return null;
  const args = pidMatch[2] ?? '';
  const match = args.match(DAEMON_PATTERN);
  if (!match?.groups?.home) return null;
  const pm2Home = match.groups.home;
  return {
    pid,
    pm2Home,
    homeExists: existsSync(pm2Home),
    command: args,
  };
}

function listStaleDaemons(): StaleDaemon[] {
  const result = spawnSync({
    cmd: ['ps', '-eo', 'pid,args'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(`ps failed with exit code ${result.exitCode}`);
  }
  const output = new TextDecoder().decode(result.stdout);
  const daemons: StaleDaemon[] = [];
  for (const line of output.split('\n')) {
    const parsed = parseDaemonLine(line);
    if (parsed) daemons.push(parsed);
  }
  return daemons;
}

/**
 * Re-reads /proc/<pid>/cmdline (or falls back to `ps -p <pid> -o args=`) at
 * kill time and verifies the daemon signature still matches. A pid can be
 * recycled between listing and killing; this recheck prevents us from
 * killing an unrelated process that happened to inherit the same pid.
 */
function verifyDaemonByPid(pid: number): boolean {
  const res = spawnSync({
    cmd: ['ps', '-p', String(pid), '-o', 'args='],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (res.exitCode !== 0) return false;
  const args = new TextDecoder().decode(res.stdout).trim();
  return DAEMON_PATTERN.test(args);
}

async function killProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    // ESRCH — already gone. That's a success.
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    return false;
  }
  // Wait up to 2s for graceful exit.
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
  }
  // Still alive — escalate.
  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    return false;
  }
  // Brief settle after SIGKILL.
  await Bun.sleep(100);
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const daemons = listStaleDaemons();
  if (daemons.length === 0) {
    console.log('No stale omni-test PM2 god daemons found.');
    return 0;
  }

  // Split by staleness. "Stale" = PM2_HOME gone from disk.
  const stale = daemons.filter((d) => !d.homeExists);
  const live = daemons.filter((d) => d.homeExists);

  for (const d of stale) {
    console.log(`stale   pid=${d.pid} pm2_home=${d.pm2Home} (home missing)`);
  }
  for (const d of live) {
    console.log(`live    pid=${d.pid} pm2_home=${d.pm2Home} (home exists — use --force to kill)`);
  }

  const targets = values.force ? daemons : stale;
  if (targets.length === 0) {
    return 0;
  }

  if (values['dry-run']) {
    console.log(`\n--dry-run: would kill ${targets.length} daemon(s).`);
    return 0;
  }

  let failures = 0;
  for (const d of targets) {
    // Re-verify the pid still belongs to a stale pm2 god daemon right
    // before killing it. Guards against pid recycling between list and kill.
    if (!verifyDaemonByPid(d.pid)) {
      console.log(`skip    pid=${d.pid} (no longer a pm2 god daemon)`);
      continue;
    }
    process.stdout.write(`killing pid=${d.pid} ... `);
    const ok = await killProcess(d.pid);
    console.log(ok ? 'ok' : 'FAILED');
    if (!ok) failures += 1;
  }

  return failures === 0 ? 0 : 1;
}

const code = await main();
process.exit(code);
