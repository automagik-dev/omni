import { spawnSync } from 'bun';

/** Check only a fixture's exact PM2_HOME, even if teardown already removed its directory. */
export function assertNoLeakedTestDaemons(pm2Home: string, processList?: string): void {
  let output = processList;
  if (output === undefined) {
    const ps = spawnSync({ cmd: ['ps', '-ww', '-eo', 'pid,args'], stdout: 'pipe', stderr: 'pipe' });
    if (ps.exitCode !== 0) return; // Preserve the guard's best-effort behavior when ps is unavailable.
    output = new TextDecoder().decode(ps.stdout);
  }
  const leaked: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    // Anchor the entire process title: no grep/transcript matches or neighboring run prefixes.
    const match = trimmed.match(/^(\d+)\s+PM2\s+[^:]*:\s*God Daemon\s+\((.*)\)$/);
    if (match?.[2] === pm2Home) leaked.push(trimmed);
  }
  if (leaked.length > 0) {
    const pids = leaked.map((line) => line.match(/^\d+/)?.[0]).join(' ');
    throw new Error(
      `CLI fixture leak guard (#413): ${leaked.length} stale PM2 god daemon(s) detected:\n${leaked.join('\n')}\n\n` +
        `Stop this fixture's daemons before re-running:\n  kill ${pids}\n`,
    );
  }
}
