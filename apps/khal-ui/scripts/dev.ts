#!/usr/bin/env bun
/**
 * Dev orchestrator — runs the BFF and the Vite harness together.
 *
 * The BFF is spawned with cwd = apps/khal-ui so Bun auto-loads `.env`
 * (OMNI_API_KEY, OMNI_BASE_URL). The harness (Vite, port 5174) proxies `/omni`
 * to the BFF (127.0.0.1:8899). Ctrl-C tears both down.
 */

const appRoot = `${import.meta.dir}/..`;

const bff = Bun.spawn(['bun', 'run', '--watch', 'service/src/index.ts'], {
  cwd: appRoot,
  stdio: ['inherit', 'inherit', 'inherit'],
});

const harness = Bun.spawn(['bun', 'run', 'dev'], {
  cwd: `${appRoot}/dev`,
  stdio: ['inherit', 'inherit', 'inherit'],
});

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  bff.kill();
  harness.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await Promise.race([bff.exited, harness.exited]);
shutdown(1);
