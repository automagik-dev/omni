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

const ALLOW_PREFIX = '/api/v2/';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CORS_ORIGINS = ['http://localhost:5174'];
const HOP_BY_HOP = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'];

/** Minimal fetch call signature — avoids `typeof fetch`'s `preconnect` member so tests can inject a plain function. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  /** Injectable fetch, for tests. */
  fetchImpl?: FetchLike;
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
  const doFetch = config.fetchImpl ?? fetch;

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

  function upstreamHeaders(req: Request): Headers {
    const headers = new Headers(req.headers);
    for (const h of HOP_BY_HOP) headers.delete(h);
    headers.delete('x-api-key');
    headers.set('x-api-key', config.apiKey);
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

    const target = `${baseUrl}${rest}${url.search}`;
    const streaming = isStreaming(req, rest);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

    const controller = new AbortController();
    const timer = streaming ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    const init: StreamingRequestInit = {
      method: req.method,
      headers: upstreamHeaders(req),
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
      const aborted = err instanceof Error && err.name === 'AbortError';
      return aborted
        ? jsonError(req, 504, 'UPSTREAM_TIMEOUT', `Omni backend did not respond within ${timeoutMs}ms.`)
        : jsonError(req, 502, 'UPSTREAM_UNREACHABLE', 'Could not reach the Omni backend.');
    }
    if (timer) clearTimeout(timer);

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
      return jsonError(req, 404, 'NOT_FOUND', `No route for ${url.pathname}.`);
    },
  };
}
