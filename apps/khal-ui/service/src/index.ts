import { existsSync, readFileSync } from 'node:fs';
import { type ConsoleAuth, createConsoleAuth } from './auth';
import { createBff } from './bff';
import { ConsoleKeyProvider } from './console-keys';

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

// ── Console auth enforcement (CONTRACT §4) ───────────────────────────────────
// OFF by default: `/omni/api/v2/*` stays a single-key proxy (no token required)
// so the current tokenless dev harness and deployment keep working. Flip ON only
// once Group 6 lands (the pack forwards `useKhalAuth().token`); enabling it
// against today's tokenless delivery would 401 every request (CONTRACT §4.0).
const authEnforce = /^(1|true)$/i.test(process.env.OMNI_ADMIN_AUTH_ENFORCE ?? '');
// Tenant binding — the ONLY thing scoping the HS256 token to this Omni (§4.1).
const orgAllowlist = (process.env.OMNI_KHAL_ORG_ALLOWLIST ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// HS256 signing secret; host/operator-provisioned (NOT platform-injected — §4.3).
// Absent ⇒ validateKhalSession returns null for every request ⇒ fail-closed 401.
const sessionSecret = process.env.KHAL_SESSION_SECRET || undefined;
// Minting credential. MUST hold a SUPERSET of the console scopes it mints (the
// primary `*` key, or a key with all console-admin scopes + keys:write) or every
// mint 403s on the ceiling. Falls back to OMNI_API_KEY (today's `*` god-key).
const mintKey = process.env.OMNI_MINT_KEY || apiKey;
const keyCacheTtlMs = Number(process.env.OMNI_KEY_CACHE_TTL_MS) || 0;

let consoleAuth: ConsoleAuth | undefined;
if (authEnforce) {
  if (!sessionSecret) {
    console.error(
      'WARN: OMNI_ADMIN_AUTH_ENFORCE is on but KHAL_SESSION_SECRET is unset — every /omni request will 401 (fail closed).',
    );
  }
  if (orgAllowlist.length === 0) {
    console.error(
      'WARN: OMNI_ADMIN_AUTH_ENFORCE is on but OMNI_KHAL_ORG_ALLOWLIST is empty — every /omni request will 401 (no org allowed).',
    );
  }
  if (!process.env.OMNI_MINT_KEY) {
    console.error(
      'WARN: OMNI_MINT_KEY is unset — minting per-user keys with OMNI_API_KEY. It must hold a superset of console-admin scopes + keys:write, or every mint 403s.',
    );
  }
  const keyProvider = new ConsoleKeyProvider({ baseUrl, mintKey, ttlMs: keyCacheTtlMs });
  consoleAuth = createConsoleAuth({ orgAllowlist, keyProvider, sessionSecret });
}

const bff = createBff({ apiKey, baseUrl, corsOrigins, publicDir, authEnforce, consoleAuth });

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
