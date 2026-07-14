/**
 * Omni Admin BFF — backend-for-frontend proxy.
 *
 * The browser never holds the Omni API key. This service sits between the UI
 * and the Omni backend, injecting `x-api-key` server-side (overriding whatever
 * the client sends) and forwarding requests under the `/omni` mount:
 *
 *   /omni/api/v2/<path>  →  ${OMNI_BASE_URL}/api/v2/<path>
 *
 * Only `/api/v2/*` paths are reachable (allowlist). Bodies stream through
 * unbuffered so Server-Sent-Events endpoints (`/logs/stream`,
 * `/agent-state/stream`) work; non-stream upstream calls get an abortable
 * timeout. BFF-origin failures return a normalized JSON error envelope that
 * never contains the key. `/diag` reports auth/version/latency for readiness.
 */

import { resolve, sep } from 'node:path';
import type { ConsoleAuth } from './auth';
import type { FetchLike } from './console-keys';

export type { FetchLike };

const ALLOW_PREFIX = '/api/v2/';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CORS_ORIGINS = ['http://localhost:5174'];
const HOP_BY_HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'];

export interface BffConfig {
  /** Omni API key. Injected as x-api-key; never echoed. */
  apiKey: string;
  /** Omni backend base URL, no trailing slash (e.g. http://192.168.139.2:8882). */
  baseUrl: string;
  /** Origins allowed to call the BFF directly (default http://localhost:5174). */
  corsOrigins?: string[];
  /** Upstream timeout for non-stream requests (default 30s). */
  timeoutMs?: number;
  /** Mount prefix the SDK/UI target (default /omni). */
  omniPrefix?: string;
  /**
   * Absolute path to the built SPA to serve on non-API routes (the container
   * image sets this via PUBLIC_DIR). Unset locally — the dev harness serves the
   * UI through Vite — so static serving stays inert until deployed.
   */
  publicDir?: string;
  /** Injectable fetch, for tests. */
  fetchImpl?: FetchLike;
  /**
   * Console auth enforcement (CONTRACT §4). Default `false` → the legacy
   * single-key path: `/omni/api/v2/*` requires no token and is proxied with
   * `apiKey`, so today's tokenless dev harness and deployment keep working.
   * When `true`, every `/omni/api/v2/*` request is token-gated fail-closed
   * (verify KHAL session → pin org → resolve role → mint a per-user key) and
   * proxied with that per-user key instead of `apiKey`.
   *
   * ⚠️ Flipping this ON is gated on Group 6 (real pack-in-host delivery that
   * attaches `useKhalAuth().token`). The current delivery vehicle ships no
   * token, so enabling enforcement against it = 100% 401 outage (CONTRACT §4.0).
   */
  authEnforce?: boolean;
  /** Console auth policy. REQUIRED when `authEnforce` is true; ignored otherwise. */
  consoleAuth?: ConsoleAuth;
}

interface ErrorEnvelope {
  error: { code: string; message: string; upstreamStatus?: number };
}

// fetch() needs `duplex: 'half'` to stream a request body; it is not yet in the
// DOM RequestInit lib type.
type StreamingRequestInit = RequestInit & { duplex?: 'half' };

export interface Bff {
  fetch: (req: Request) => Promise<Response>;
}

export function createBff(config: BffConfig): Bff {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const corsOrigins = config.corsOrigins ?? DEFAULT_CORS_ORIGINS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const omniPrefix = config.omniPrefix ?? '/omni';
  const publicDir = config.publicDir ? resolve(config.publicDir) : undefined;
  const doFetch = config.fetchImpl ?? fetch;
  const authEnforce = config.authEnforce ?? false;
  const consoleAuth = config.consoleAuth;
  if (authEnforce && !consoleAuth) {
    throw new Error('authEnforce is enabled but no consoleAuth policy was provided.');
  }

  function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('origin');
    if (!origin || !corsOrigins.includes(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-api-key,accept',
      Vary: 'Origin',
    };
  }

  function jsonError(req: Request, status: number, code: string, message: string, upstreamStatus?: number): Response {
    const body: ErrorEnvelope = { error: { code, message, ...(upstreamStatus ? { upstreamStatus } : {}) } };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...corsHeaders(req) },
    });
  }

  function upstreamHeaders(req: Request, apiKey: string): Headers {
    const headers = new Headers(req.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    // Strip any auth the browser sent — the BFF is the sole authority on the
    // upstream credential. Drop the KHAL bearer/cookie too so a per-user key
    // (or the god-key, flag OFF) is the ONLY thing omni-api sees.
    headers.delete('x-api-key');
    headers.delete('authorization');
    headers.delete('cookie');
    headers.set('x-api-key', apiKey);
    headers.set('accept-encoding', 'identity');
    return headers;
  }

  function isStreaming(req: Request, path: string): boolean {
    return path.endsWith('/stream') || (req.headers.get('accept') ?? '').includes('text/event-stream');
  }

  async function handleProxy(req: Request, url: URL): Promise<Response> {
    const rest = url.pathname.slice(omniPrefix.length);
    if (!rest.startsWith(ALLOW_PREFIX)) {
      return jsonError(req, 403, 'FORBIDDEN_PATH', `Only ${ALLOW_PREFIX}* is reachable through the BFF.`);
    }

    // Policy enforcement point (flag ON): verify the KHAL session, pin the org,
    // resolve the role, and mint/reuse a per-user key. Fail closed on anything
    // short of a fully authorized session — no god-key fallback. Reads only
    // headers, so `req.body` streams through untouched below. Flag OFF keeps the
    // legacy single-key behaviour (no token required).
    let injectedKey = config.apiKey;
    if (authEnforce && consoleAuth) {
      const auth = await consoleAuth.authenticate(req);
      if (!auth.ok) {
        return jsonError(req, auth.status, auth.code, auth.message, auth.upstreamStatus);
      }
      injectedKey = auth.apiKey;
    }

    const target = `${baseUrl}${rest}${url.search}`;
    const streaming = isStreaming(req, rest);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

    const controller = new AbortController();
    const timer = streaming ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    // Tear the upstream down if the client disconnects. Critical for SSE: without
    // this, a browser closing a `/logs/stream` tab leaves the backend streaming
    // into a dead socket. `req.signal` aborts when the client goes away.
    const onClientAbort = () => controller.abort();
    req.signal.addEventListener('abort', onClientAbort);

    const init: StreamingRequestInit = {
      method: req.method,
      headers: upstreamHeaders(req, injectedKey),
      redirect: 'manual',
      signal: controller.signal,
    };
    if (hasBody) {
      init.body = req.body;
      init.duplex = 'half';
    }

    let upstream: Response;
    try {
      upstream = await doFetch(target, init);
    } catch (err) {
      if (timer) clearTimeout(timer);
      req.signal.removeEventListener('abort', onClientAbort);
      const aborted = err instanceof Error && err.name === 'AbortError';
      // A timer-driven abort is a real upstream timeout; a client-driven abort
      // means the caller already went away, so distinguish the two.
      if (aborted && req.signal.aborted) {
        return jsonError(req, 499, 'CLIENT_CLOSED', 'Client closed the request before the backend responded.');
      }
      return aborted
        ? jsonError(req, 504, 'UPSTREAM_TIMEOUT', `Omni backend did not respond within ${timeoutMs}ms.`)
        : jsonError(req, 502, 'UPSTREAM_UNREACHABLE', 'Could not reach the Omni backend.');
    }
    if (timer) clearTimeout(timer);
    // Non-stream responses are fully read downstream; drop the abort link so a
    // late client-abort can't cancel an already-delivered body. SSE keeps it: the
    // stream lives on and must follow the client's lifetime.
    if (!streaming) req.signal.removeEventListener('abort', onClientAbort);

    const headers = new Headers(upstream.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
    // Stream the body straight through — no buffering (critical for SSE).
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  async function handleDiag(req: Request): Promise<Response> {
    const cors = corsHeaders(req);
    const json = (payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', ...cors } });

    if (!config.apiKey) {
      return json({ auth: 'error', reason: 'OMNI_API_KEY is not set', baseUrl });
    }

    const started = performance.now();
    try {
      const validateRes = await doFetch(`${baseUrl}/api/v2/auth/validate`, {
        method: 'POST',
        headers: { 'x-api-key': config.apiKey, 'accept-encoding': 'identity' },
      });
      const validateJson = (await validateRes.json().catch(() => ({}))) as {
        data?: { valid?: boolean; keyPrefix?: string; keyName?: string; scopes?: string[]; profile?: unknown };
      };
      const data = validateJson.data ?? {};
      const latencyMs = Math.round(performance.now() - started);

      if (!validateRes.ok || !data.valid) {
        return json({ auth: 'invalid', upstreamStatus: validateRes.status, latencyMs, baseUrl });
      }

      let version: string | null = null;
      try {
        const infoRes = await doFetch(`${baseUrl}/api/v2/info`, { headers: { 'x-api-key': config.apiKey } });
        const infoJson = (await infoRes.json().catch(() => ({}))) as {
          version?: string;
          data?: { version?: string };
        };
        version = infoJson.version ?? infoJson.data?.version ?? null;
      } catch {
        version = null;
      }

      return json({
        auth: 'ok',
        keyPrefix: data.keyPrefix ?? null,
        keyName: data.keyName ?? null,
        scopes: data.scopes ?? [],
        profile: data.profile ?? null,
        version,
        latencyMs,
        baseUrl,
      });
    } catch (err) {
      return json({ auth: 'error', message: err instanceof Error ? err.message : 'diag failed', baseUrl });
    }
  }

  /**
   * Serve the built SPA from `publicDir` on any route the API handlers above
   * did not claim. `/health`, `/diag`, and `/omni/*` are matched first, so API
   * routes always win. A request that resolves to a real file is streamed with
   * its content-type; a client-side route (extensionless, or an HTML
   * navigation) falls back to `index.html` so the SPA router resolves it; a
   * missing hashed asset 404s rather than masquerading as the app. Any path
   * that escapes `publicDir` is refused. Returns null when nothing matches, so
   * the caller emits the normalized 404 envelope. Inert unless `publicDir` is
   * set (the container image only).
   */
  async function handleStatic(req: Request, url: URL): Promise<Response | null> {
    if (!publicDir) return null;
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return null; // malformed %-encoding — let the caller 404
    }

    if (pathname !== '/') {
      const abs = resolve(publicDir, `.${pathname}`);
      // Refuse anything that resolves outside the served root (path traversal).
      if ((abs === publicDir || abs.startsWith(publicDir + sep)) && abs !== publicDir) {
        const file = Bun.file(abs);
        if (await file.exists()) {
          return new Response(file, { status: 200 });
        }
      }
    }

    const hasExtension = /\.[a-z0-9]+$/i.test(pathname);
    const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
    if (!hasExtension || wantsHtml) {
      const index = Bun.file(resolve(publicDir, 'index.html'));
      if (await index.exists()) {
        return new Response(index, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
        });
      }
    }
    return null;
  }

  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(req) });
      }
      if (url.pathname === '/health') {
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain', ...corsHeaders(req) } });
      }
      if (url.pathname === '/diag') {
        return handleDiag(req);
      }
      if (url.pathname === omniPrefix || url.pathname.startsWith(`${omniPrefix}/`)) {
        return handleProxy(req, url);
      }
      const staticRes = await handleStatic(req, url);
      if (staticRes) return staticRes;
      return jsonError(req, 404, 'NOT_FOUND', `No route for ${url.pathname}.`);
    },
  };
}
