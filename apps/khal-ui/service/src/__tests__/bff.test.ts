import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BffConfig, createBff } from '../bff';

const KEY = 'omni_sk_testkey_do_not_leak_0000';
const BASE = 'http://omni.test';

function bffWith(fetchImpl: BffConfig['fetchImpl'], extra?: Partial<BffConfig>) {
  return createBff({ apiKey: KEY, baseUrl: BASE, corsOrigins: ['http://localhost:5174'], fetchImpl, ...extra });
}

describe('BFF proxy', () => {
  test('injects and overrides x-api-key, forwarding /omni/api/v2/* to the backend', async () => {
    let seenUrl: string | undefined;
    let seenKey: string | null | undefined;
    const bff = bffWith(async (input, init) => {
      seenUrl = String(input);
      seenKey = new Headers(init?.headers).get('x-api-key');
      return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
    });

    const res = await bff.fetch(
      new Request('http://localhost:8899/omni/api/v2/instances', { headers: { 'x-api-key': 'fake-client-key' } }),
    );

    expect(res.status).toBe(200);
    expect(seenUrl).toBe(`${BASE}/api/v2/instances`);
    expect(seenKey).toBe(KEY);
  });

  test('passes upstream error status through unchanged (does not wrap)', async () => {
    const bff = bffWith(async () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 }));
    const res = await bff.fetch(new Request('http://localhost:8899/omni/api/v2/instances/x'));
    expect(res.status).toBe(404);
  });

  test('rejects non /api/v2 paths with a 403 envelope and never calls upstream', async () => {
    let called = false;
    const bff = bffWith(async () => {
      called = true;
      return new Response('nope');
    });
    const res = await bff.fetch(new Request('http://localhost:8899/omni/etc/passwd'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN_PATH');
    expect(called).toBe(false);
  });

  test('returns a normalized envelope (no key) when the backend is unreachable', async () => {
    const bff = bffWith(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await bff.fetch(new Request('http://localhost:8899/omni/api/v2/instances'));
    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toContain(KEY);
    const body = JSON.parse(raw) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UPSTREAM_UNREACHABLE');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  test('times out a slow non-stream request with a 504 envelope', async () => {
    const bff = bffWith(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
      { timeoutMs: 20 },
    );
    const res = await bff.fetch(new Request('http://localhost:8899/omni/api/v2/instances'));
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  test('404s unknown BFF routes', async () => {
    const bff = bffWith(async () => new Response('x'));
    const res = await bff.fetch(new Request('http://localhost:8899/nope'));
    expect(res.status).toBe(404);
  });

  test('SSE: a client disconnect aborts the upstream fetch (closes the backend stream)', async () => {
    let upstreamSignal: AbortSignal | undefined;
    const bff = bffWith(async (_input, init) => {
      upstreamSignal = init?.signal ?? undefined;
      // A never-ending body, like a live SSE endpoint.
      const body = new ReadableStream<Uint8Array>({ start() {} });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const ac = new AbortController();
    const res = await bff.fetch(
      new Request('http://localhost:8899/omni/api/v2/logs/stream', {
        headers: { accept: 'text/event-stream' },
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    expect(upstreamSignal?.aborted).toBe(false);

    ac.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(upstreamSignal?.aborted).toBe(true);
  });

  test('a client that disconnects before the backend responds gets 499, not a false timeout', async () => {
    const bff = bffWith(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const ac = new AbortController();
    const promise = bff.fetch(new Request('http://localhost:8899/omni/api/v2/instances', { signal: ac.signal }));
    ac.abort();
    const res = await promise;
    expect(res.status).toBe(499);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CLIENT_CLOSED');
  });
});

describe('BFF diagnostics', () => {
  test('/health returns ok', async () => {
    const bff = bffWith(async () => new Response('x'));
    const res = await bff.fetch(new Request('http://localhost:8899/health'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('/diag reports auth ok + version + latency without leaking the key', async () => {
    const bff = bffWith(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/validate')) {
        return new Response(
          JSON.stringify({ data: { valid: true, keyPrefix: 'omni_sk_4ab3', keyName: 'test-key', scopes: ['*'] } }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/info')) {
        return new Response(JSON.stringify({ version: '2.260710.3' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}');
    });

    const res = await bff.fetch(new Request('http://localhost:8899/diag'));
    const raw = await res.text();
    expect(raw).toContain('"auth":"ok"');
    expect(raw).not.toContain(KEY);
    const body = JSON.parse(raw) as { version: string; keyPrefix: string; latencyMs: number };
    expect(body.version).toBe('2.260710.3');
    expect(body.keyPrefix).toBe('omni_sk_4ab3');
    expect(typeof body.latencyMs).toBe('number');
  });

  test('/diag reports invalid when the key is rejected upstream', async () => {
    const bff = bffWith(async (input) => {
      if (String(input).endsWith('/auth/validate')) {
        return new Response(JSON.stringify({ data: { valid: false } }), { status: 401 });
      }
      return new Response('{}');
    });
    const res = await bff.fetch(new Request('http://localhost:8899/diag'));
    const body = (await res.json()) as { auth: string; upstreamStatus: number };
    expect(body.auth).toBe('invalid');
    expect(body.upstreamStatus).toBe(401);
  });

  test('/diag reports error when no key is configured', async () => {
    const bff = createBff({ apiKey: '', baseUrl: BASE, fetchImpl: async () => new Response('x') });
    const res = await bff.fetch(new Request('http://localhost:8899/diag'));
    const raw = await res.text();
    const body = JSON.parse(raw) as { auth: string };
    expect(body.auth).toBe('error');
    expect(raw).not.toContain(KEY);
  });
});

describe('BFF CORS', () => {
  test('answers preflight from the allowed harness origin', async () => {
    const bff = bffWith(async () => new Response('x'));
    const res = await bff.fetch(
      new Request('http://localhost:8899/omni/api/v2/instances', {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5174' },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5174');
  });

  test('does not echo CORS for a disallowed origin', async () => {
    const bff = bffWith(async () => new Response('x'));
    const res = await bff.fetch(
      new Request('http://localhost:8899/health', { headers: { origin: 'http://evil.example' } }),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('BFF static SPA serving', () => {
  // A minimal built-SPA layout: index.html + one hashed asset + a sentinel one
  // directory up to prove traversal cannot escape the served root.
  let root: string;
  let publicDir: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'omni-bff-static-'));
    publicDir = join(root, 'pub');
    mkdirSync(join(publicDir, 'assets'), { recursive: true });
    writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>SPA_ROOT</title>');
    writeFileSync(join(publicDir, 'assets', 'app-abc123.js'), 'console.log("hashed-asset")');
    writeFileSync(join(root, 'secret.txt'), 'TOP_SECRET_OUTSIDE_ROOT');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function staticBff() {
    // Upstream must never be reached for a static route.
    return bffWith(
      async () => {
        throw new Error('upstream must not be called for static routes');
      },
      { publicDir },
    );
  }

  test('serves index.html at the SPA root', async () => {
    const res = await staticBff().fetch(new Request('http://localhost:8899/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('SPA_ROOT');
  });

  test('serves a real hashed asset with its own content-type', async () => {
    const res = await staticBff().fetch(new Request('http://localhost:8899/assets/app-abc123.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/javascript/);
    expect(await res.text()).toBe('console.log("hashed-asset")');
  });

  test('falls back to index.html for a client-side route (extensionless)', async () => {
    const res = await staticBff().fetch(new Request('http://localhost:8899/instances/abc'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('SPA_ROOT');
  });

  test('falls back to index.html for an HTML navigation even with an extension', async () => {
    const res = await staticBff().fetch(
      new Request('http://localhost:8899/some.page', { headers: { accept: 'text/html' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('SPA_ROOT');
  });

  test('404s a missing hashed asset instead of masquerading as the app', async () => {
    const res = await staticBff().fetch(new Request('http://localhost:8899/assets/missing-999.js'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  test('refuses path traversal outside the served root', async () => {
    // %2e%2e survives URL normalization; decoded to ../ it would escape root.
    const res = await staticBff().fetch(new Request('http://localhost:8899/%2e%2e/secret.txt'));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('TOP_SECRET');
  });

  test('API routes still win over static: /omni proxies, /diag and /health answer', async () => {
    let proxied = false;
    const bff = createBff({
      apiKey: KEY,
      baseUrl: BASE,
      corsOrigins: ['http://localhost:5174'],
      publicDir,
      fetchImpl: async (input) => {
        proxied = true;
        // /diag hits auth/validate; /omni hits the forwarded path.
        if (String(input).endsWith('/auth/validate')) {
          return new Response(JSON.stringify({ data: { valid: true } }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ items: [] }), { headers: { 'content-type': 'application/json' } });
      },
    });

    const health = await bff.fetch(new Request('http://localhost:8899/health'));
    expect(await health.text()).toBe('ok');

    const omni = await bff.fetch(new Request('http://localhost:8899/omni/api/v2/instances'));
    expect(omni.status).toBe(200);
    expect(proxied).toBe(true);

    const diag = await bff.fetch(new Request('http://localhost:8899/diag'));
    const diagBody = (await diag.json()) as { auth: string };
    expect(diagBody.auth).toBe('ok');
  });

  test('stays inert (404s non-API routes) when no publicDir is configured', async () => {
    const bff = bffWith(async () => new Response('x'));
    const res = await bff.fetch(new Request('http://localhost:8899/instances'));
    expect(res.status).toBe(404);
  });
});
