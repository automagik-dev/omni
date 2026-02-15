/**
 * Mock API Server for SDK + CLI Integration Tests
 *
 * Lightweight Bun.serve mock providing canned responses for all endpoints
 * that the SDK and CLI integration tests actually call.
 *
 * Uses zero external dependencies (just Bun.serve) so it can be imported
 * from any package in the monorepo.
 *
 * Shared between:
 *   - packages/sdk/src/__tests__/type-safety.test.ts
 *   - packages/sdk/src/__tests__/client.test.ts
 *   - packages/cli/src/__tests__/cli.test.ts
 */

export const MOCK_API_KEY = 'test-mock-api-key-12345';

/** Instances created during test run (mutable state for create/delete cycle) */
let dynamicInstances: Array<{
  id: string;
  name: string;
  channel: string;
  isActive: boolean;
  profileName: string | null;
  createdAt: string;
  updatedAt: string;
}> = [];

function makeInstance(id: string, name: string, channel: string) {
  return {
    id,
    name,
    channel,
    isActive: true,
    profileName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const SEED_INSTANCE_ID = '00000000-0000-0000-0000-000000000001';

function getAllInstances() {
  return [makeInstance(SEED_INSTANCE_ID, 'test-instance', 'whatsapp-baileys'), ...dynamicInstances];
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Canned response data ──

const HEALTH_RESPONSE = {
  status: 'healthy',
  version: '0.0.0-test',
  uptime: 12345,
  checks: { database: { status: 'healthy' }, nats: { status: 'healthy' } },
};

const AUTH_VALIDATE_RESPONSE = {
  data: { valid: true, keyPrefix: 'test-', keyName: 'test-key', scopes: ['*'] },
};

const EMPTY_LIST = { items: [], meta: { hasMore: false } };
const EMPTY_ITEMS = { items: [] };

// ── Route handlers ──

function handleHealth(): Response {
  return json(HEALTH_RESPONSE);
}

function handleAuthValidate(): Response {
  return json(AUTH_VALIDATE_RESPONSE);
}

function handleInstanceStatus(path: string): Response {
  const match = path.match(/^\/api\/v2\/instances\/([^/]+)\/status$/);
  const id = match?.[1] ?? 'unknown';
  return json({
    data: { state: 'connected', isConnected: true, profileName: 'Test Profile', instanceId: id },
  });
}

function handleListInstances(): Response {
  return json({ items: getAllInstances(), meta: { hasMore: false } });
}

async function handleCreateInstance(req: Request): Promise<Response> {
  const body = (await req.json()) as { name?: string; channel?: string };
  const id = crypto.randomUUID();
  const inst = makeInstance(id, body.name ?? 'unnamed', body.channel ?? 'whatsapp-baileys');
  dynamicInstances.push(inst);
  return json({ data: inst }, 201);
}

function handleGetInstance(path: string): Response {
  const match = path.match(/^\/api\/v2\/instances\/([^/]+)$/);
  const id = match?.[1] ?? '';
  const found = getAllInstances().find((i) => i.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Instance not found' } }, 404);
  return json({ data: found });
}

function handleDeleteInstance(path: string): Response {
  const match = path.match(/^\/api\/v2\/instances\/([^/]+)$/);
  const id = match?.[1] ?? '';
  dynamicInstances = dynamicInstances.filter((i) => i.id !== id);
  return json({ success: true });
}

// ── Auth middleware ──

function checkAuth(req: Request, path: string): Response | null {
  if (!path.startsWith('/api/v2') || path.endsWith('/health')) return null;
  const key = req.headers.get('x-api-key');
  if (key === MOCK_API_KEY) return null;
  return json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }, 401);
}

// ── Route dispatch ──

type RouteKey = string;

function routeKey(method: string, path: string): RouteKey {
  return `${method} ${path}`;
}

/** Static routes: exact path match */
const staticRoutes: Record<RouteKey, (req: Request) => Response | Promise<Response>> = {
  'GET /health': handleHealth,
  'GET /api/v2/health': handleHealth,
  'POST /api/v2/auth/validate': handleAuthValidate,
  'GET /api/v2/instances': handleListInstances,
  'POST /api/v2/instances': handleCreateInstance,
  'GET /api/v2/events': () => json(EMPTY_LIST),
  'POST /api/v2/events/search': () => json(EMPTY_LIST),
  'GET /api/v2/chats': () => json({ items: [], meta: { hasMore: false, cursor: null } }),
  'GET /api/v2/persons': () => json(EMPTY_ITEMS),
  'GET /api/v2/persons/search': () => json(EMPTY_ITEMS),
  'GET /api/v2/settings': () => json(EMPTY_ITEMS),
  'GET /api/v2/providers': () => json(EMPTY_ITEMS),
  'GET /api/v2/access/rules': () => json(EMPTY_ITEMS),
};

/** Pattern routes: regex-matched paths */
const patternRoutes: Array<{
  method: string;
  pattern: RegExp;
  handler: (req: Request, path: string) => Response | Promise<Response>;
}> = [
  {
    method: 'GET',
    pattern: /^\/api\/v2\/instances\/[^/]+\/status$/,
    handler: (_req, path) => handleInstanceStatus(path),
  },
  { method: 'GET', pattern: /^\/api\/v2\/instances\/[^/]+$/, handler: (_req, path) => handleGetInstance(path) },
  { method: 'DELETE', pattern: /^\/api\/v2\/instances\/[^/]+$/, handler: (_req, path) => handleDeleteInstance(path) },
];

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Auth check
  const authError = checkAuth(req, path);
  if (authError) return authError;

  // Static route lookup
  const staticHandler = staticRoutes[routeKey(method, path)];
  if (staticHandler) return staticHandler(req);

  // Pattern route lookup
  for (const route of patternRoutes) {
    if (route.method === method && route.pattern.test(path)) {
      return route.handler(req, path);
    }
  }

  return json({ error: { code: 'NOT_FOUND', message: `Mock: no handler for ${method} ${path}` } }, 404);
}

// ── Server lifecycle ──

interface MockApiHandle {
  url: string;
  port: number;
  close: () => void;
}

let handle: MockApiHandle | null = null;

/**
 * Start the mock API server on a random available port.
 * Returns the base URL and a close function.
 * Idempotent — calling multiple times returns the same server.
 */
export async function startMockApi(): Promise<MockApiHandle> {
  if (handle) return handle;

  // Reset state
  dynamicInstances = [];

  const server = Bun.serve({
    port: 0, // OS-assigned random port
    fetch: handleRequest,
  });

  const port = server.port ?? 0;

  const result: MockApiHandle = {
    url: `http://localhost:${port}`,
    port,
    close: () => {
      server.stop(true);
      handle = null;
      dynamicInstances = [];
    },
  };

  handle = result;
  return result;
}

/**
 * Stop the mock API server if running.
 */
export function stopMockApi(): void {
  if (handle) {
    handle.close();
  }
}
