import { existsSync, readFileSync } from 'node:fs';
import { createBff } from './bff';

/**
 * Load the app-level `.env` (apps/khal-ui/.env) regardless of the working
 * directory the service was started from. Bun auto-loads `.env` from cwd; this
 * fallback keeps the BFF self-sufficient when launched from the service dir.
 * Existing process env always wins (never overwrite injected secrets).
 */
function loadAppEnv(): void {
  if (process.env.OMNI_API_KEY && process.env.OMNI_BASE_URL) return;
  const envPath = `${import.meta.dir}/../../.env`;
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadAppEnv();

const PORT = Number(process.env.PORT) || 8899;
// Default to loopback for local dev; the container image sets HOST=0.0.0.0 so
// the BFF is reachable inside the pod.
const HOST = process.env.HOST || '127.0.0.1';
const apiKey = process.env.OMNI_API_KEY ?? '';
const baseUrl = process.env.OMNI_BASE_URL ?? 'http://192.168.139.2:8882';
const corsOrigins = (process.env.BFF_CORS_ORIGINS ?? 'http://localhost:5174')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// When set (the container image points it at the built SPA), the BFF also
// serves the UI on non-API routes so one origin covers UI + `/omni`. Unset
// locally — the Vite dev harness serves the UI instead.
const publicDir = process.env.PUBLIC_DIR || undefined;

if (!apiKey) {
  console.error('WARN: OMNI_API_KEY is not set — /omni and /diag will report auth errors.');
}

const bff = createBff({ apiKey, baseUrl, corsOrigins, publicDir });

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 0, // never idle-close — SSE streams stay open
  fetch: bff.fetch,
});

console.log(
  `omni-admin-bff listening on http://${server.hostname}:${server.port} → ${baseUrl}${
    publicDir ? ` (serving UI from ${publicDir})` : ''
  }`,
);
