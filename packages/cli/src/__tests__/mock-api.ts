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

/** Providers created during test run (mutable state for create/delete/update cycle) */
let dynamicProviders: Array<{
  id: string;
  name: string;
  schema: string;
  baseUrl: string;
  apiKey: string | null;
  isActive: boolean;
  schemaConfig: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}> = [];

function makeProvider(
  id: string,
  name: string,
  schema: string,
  baseUrl: string,
  schemaConfig?: Record<string, unknown> | null,
  apiKey?: string | null,
) {
  return {
    id,
    name,
    schema,
    baseUrl,
    apiKey: apiKey ?? null,
    isActive: true,
    schemaConfig: schemaConfig ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function handleCreateProvider(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    name?: string;
    schema?: string;
    baseUrl?: string;
    apiKey?: string;
    schemaConfig?: Record<string, unknown>;
  };
  const id = crypto.randomUUID();
  const provider = makeProvider(
    id,
    body.name ?? 'unnamed',
    body.schema ?? 'nats-genie',
    body.baseUrl ?? '',
    body.schemaConfig,
    body.apiKey,
  );
  dynamicProviders.push(provider);
  return json({ data: provider }, 201);
}

function handleGetProvider(path: string): Response {
  const match = path.match(/^\/api\/v2\/providers\/([^/]+)$/);
  const id = match?.[1] ?? '';
  const found = dynamicProviders.find((p) => p.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);
  return json({ data: found });
}

async function handleUpdateProvider(req: Request, path: string): Promise<Response> {
  const match = path.match(/^\/api\/v2\/providers\/([^/]+)$/);
  const id = match?.[1] ?? '';
  const found = dynamicProviders.find((p) => p.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);
  const body = (await req.json()) as Record<string, unknown>;
  if (body.name !== undefined) found.name = body.name as string;
  if (body.baseUrl !== undefined) found.baseUrl = body.baseUrl as string;
  if (body.apiKey !== undefined) found.apiKey = body.apiKey as string | null;
  if (body.isActive !== undefined) found.isActive = body.isActive as boolean;
  if (body.schemaConfig !== undefined) found.schemaConfig = body.schemaConfig as Record<string, unknown> | null;
  found.updatedAt = new Date().toISOString();
  return json({ data: found });
}

function handleDeleteProvider(path: string): Response {
  const match = path.match(/^\/api\/v2\/providers\/([^/]+)$/);
  const id = match?.[1] ?? '';
  dynamicProviders = dynamicProviders.filter((p) => p.id !== id);
  return json({ success: true });
}

function handleProviderHealth(path: string): Response {
  const match = path.match(/^\/api\/v2\/providers\/([^/]+)\/health$/);
  const id = match?.[1] ?? '';
  const found = dynamicProviders.find((p) => p.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Provider not found' } }, 404);
  return json({ healthy: true, latency: 42, error: null });
}

/** Agents created during test run (mutable state for create/update/delete cycle) */
let dynamicAgents: Array<{
  id: string;
  name: string;
  provider: string;
  model: string | null;
  agentType: string;
  capabilities: string[];
  agentProviderId: string | null;
  configPath: string | null;
  isInternal: boolean;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}> = [];

function makeAgent(
  id: string,
  name: string,
  provider: string,
  opts?: {
    model?: string;
    agentType?: string;
    agentProviderId?: string | null;
    configPath?: string | null;
    isActive?: boolean;
    metadata?: Record<string, unknown> | null;
  },
) {
  return {
    id,
    name,
    provider,
    model: opts?.model ?? null,
    agentType: opts?.agentType ?? 'assistant',
    capabilities: [],
    agentProviderId: opts?.agentProviderId ?? null,
    configPath: opts?.configPath ?? null,
    isInternal: false,
    isActive: opts?.isActive ?? true,
    metadata: opts?.metadata ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function handleCreateAgent(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    name?: string;
    provider?: string;
    model?: string;
    agentType?: string;
    agentProviderId?: string;
    configPath?: string;
    isActive?: boolean;
    metadata?: Record<string, unknown>;
  };
  const id = crypto.randomUUID();
  const agent = makeAgent(id, body.name ?? 'unnamed', body.provider ?? 'claude', {
    model: body.model,
    agentType: body.agentType,
    agentProviderId: body.agentProviderId,
    configPath: body.configPath ?? null,
    isActive: body.isActive,
    metadata: body.metadata ?? null,
  });
  dynamicAgents.push(agent);
  return json({ data: agent }, 201);
}

function handleGetAgent(path: string): Response {
  const match = path.match(/^\/api\/v2\/agents\/([^/]+)$/);
  const id = match?.[1] ?? '';
  const found = dynamicAgents.find((a) => a.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  return json({ data: found });
}

async function handleUpdateAgent(req: Request, path: string): Promise<Response> {
  const match = path.match(/^\/api\/v2\/agents\/([^/]+)$/);
  const id = match?.[1] ?? '';
  const found = dynamicAgents.find((a) => a.id === id);
  if (!found) return json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  const body = (await req.json()) as Record<string, unknown>;
  if (body.name !== undefined) found.name = body.name as string;
  if (body.provider !== undefined) found.provider = body.provider as string;
  if (body.model !== undefined) found.model = body.model as string;
  if (body.agentType !== undefined) found.agentType = body.agentType as string;
  if (body.agentProviderId !== undefined) found.agentProviderId = body.agentProviderId as string | null;
  if (body.isActive !== undefined) found.isActive = body.isActive as boolean;
  if (body.configPath !== undefined) found.configPath = body.configPath as string | null;
  if (body.metadata !== undefined) found.metadata = body.metadata as Record<string, unknown> | null;
  found.updatedAt = new Date().toISOString();
  return json({ data: found });
}

function handleDeleteAgent(path: string): Response {
  const match = path.match(/^\/api\/v2\/agents\/([^/]+)$/);
  const id = match?.[1] ?? '';
  dynamicAgents = dynamicAgents.filter((a) => a.id !== id);
  return json({ success: true });
}

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

// ── Event fixtures ──

const SEED_EVENT_ID = '00000000-0000-0000-0000-0000000000e1';

function makeSeedEvent() {
  return {
    id: SEED_EVENT_ID,
    eventType: 'message.received',
    contentType: 'text',
    instanceId: SEED_INSTANCE_ID,
    personId: null,
    direction: 'inbound',
    textContent: 'hello from mock',
    transcription: null,
    imageDescription: null,
    chatUuid: null,
    agentId: null,
    conversationId: null,
    receivedAt: new Date().toISOString(),
    processedAt: null,
  };
}

function handleGetEvent(path: string): Response {
  const match = path.match(/^\/api\/v2\/events\/([^/]+)$/);
  const id = match?.[1] ?? '';
  if (id !== SEED_EVENT_ID) {
    return json({ error: { code: 'NOT_FOUND', message: 'Event not found' } }, 404);
  }
  return json({ data: makeSeedEvent() });
}

/**
 * In-memory event queue used by `omni events stream` integration tests.
 * Pushed via {@link seedStreamEvent} and drained by `GET /api/v2/events`
 * filtered by `since`. Kept separate from {@link makeSeedEvent} so the
 * `events get` happy path stays deterministic.
 */
interface StreamEventRow {
  id: string;
  eventType: string;
  contentType: string | null;
  instanceId: string;
  personId: string | null;
  direction: 'inbound' | 'outbound';
  textContent: string | null;
  transcription: string | null;
  imageDescription: string | null;
  chatUuid: string | null;
  agentId: string | null;
  conversationId: string | null;
  receivedAt: string;
  processedAt: string | null;
}

let streamedEvents: StreamEventRow[] = [];
let lastSendReactionBody: unknown = null;

export function seedStreamEvent(overrides: Partial<StreamEventRow> = {}): StreamEventRow {
  const now = new Date().toISOString();
  const ev: StreamEventRow = {
    id: crypto.randomUUID(),
    eventType: 'message.received',
    contentType: 'text',
    instanceId: SEED_INSTANCE_ID,
    personId: null,
    direction: 'inbound',
    textContent: 'streamed hello',
    transcription: null,
    imageDescription: null,
    chatUuid: null,
    agentId: null,
    conversationId: null,
    receivedAt: now,
    processedAt: null,
    ...overrides,
  };
  streamedEvents.push(ev);
  return ev;
}

export function clearStreamedEvents(): void {
  streamedEvents = [];
}

export function getLastSendReactionBody<T = unknown>(): T | null {
  return lastSendReactionBody as T | null;
}

export function clearLastSendReactionBody(): void {
  lastSendReactionBody = null;
}

async function handleSendReaction(req: Request): Promise<Response> {
  lastSendReactionBody = await req.json();
  return json({ data: { messageId: 'mock-reaction-msg', success: true } });
}

function handleListEvents(req: Request): Response {
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get('since');
  const since = sinceRaw ? new Date(sinceRaw).getTime() : 0;
  const instanceId = url.searchParams.get('instanceId');
  const eventType = url.searchParams.get('eventType');
  const matches = streamedEvents
    .filter((e) => new Date(e.receivedAt).getTime() >= since)
    .filter((e) => !instanceId || e.instanceId === instanceId)
    .filter((e) => !eventType || e.eventType === eventType)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return json({ items: matches, meta: { hasMore: false } });
}

// ── Log fixtures ──

/**
 * Seed log entries mirroring the shape the real /logs/recent route produces
 * after the G3 reshape: {time, level, module, msg, data?}. Includes one
 * error entry with a stack trace and agent/chat IDs in `data` so CLI tests
 * can assert the rich context survives serialization.
 */
function makeSeedLogs() {
  return [
    {
      time: Date.now() - 2000,
      level: 'info',
      module: 'api:startup',
      msg: 'Server listening on 0.0.0.0:8882',
    },
    {
      time: Date.now() - 1000,
      level: 'error',
      module: 'whatsapp:auth',
      msg: 'Failed to authenticate session',
      data: {
        agentId: '00000000-0000-0000-0000-0000000000a1',
        chatId: '00000000-0000-0000-0000-0000000000c1',
        stack:
          'Error: session expired\n    at authenticate (whatsapp/auth.ts:42:7)\n    at handleConnect (whatsapp/socket.ts:118:5)',
      },
    },
  ];
}

function handleRecentLogs(req: Request): Response {
  const url = new URL(req.url);
  const level = url.searchParams.get('level') ?? 'info';
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
  const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const minLevel = levels[level] ?? levels.info;
  const all = makeSeedLogs();
  const items = all.filter((e) => (levels[e.level] ?? 0) >= minLevel).slice(0, limit);
  return json({
    items,
    meta: { total: items.length, bufferSize: 1000, limit },
  });
}

// ── Trust / handshake fixtures ──

/**
 * Registered pubkeys, keyed by `${origin}|${pubkey}`.
 *
 * Mirrors the real route's idempotency: the same pubkey posted twice to one
 * server yields the same host id, and the SAME pubkey posted to a second
 * server registers there independently. Both properties are what the
 * multi-server binding tests assert against.
 */
const registeredHosts = new Map<string, { id: string; pubkey: string; hostname: string }>();

async function handleTrustHandshake(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const body = (await req.json()) as { pubkey?: string; hostname?: string };
  const pubkey = body.pubkey ?? '';
  const mapKey = `${origin}|${pubkey}`;
  const existing = registeredHosts.get(mapKey);
  if (existing) return json({ data: existing });
  const host = { id: crypto.randomUUID(), pubkey, hostname: body.hostname ?? 'unknown' };
  registeredHosts.set(mapKey, host);
  return json({ data: host }, 201);
}

// ── Request recording (signature assertions) ──

export interface RecordedRequest {
  origin: string;
  method: string;
  path: string;
  /** True when the request carried the X-Genie-* operator-signing headers. */
  signed: boolean;
  hostId: string | null;
}

let recordedRequests: RecordedRequest[] = [];

/** Requests seen since the last {@link clearRecordedRequests}, oldest first. */
export function getRecordedRequests(): RecordedRequest[] {
  return [...recordedRequests];
}

export function clearRecordedRequests(): void {
  recordedRequests = [];
}

function recordRequest(req: Request, path: string): void {
  const hostId = req.headers.get('x-genie-host-id');
  recordedRequests.push({
    origin: new URL(req.url).origin,
    method: req.method,
    path,
    signed: hostId !== null && req.headers.get('x-genie-signature') !== null,
    hostId,
  });
}

// ── Auth middleware ──

function checkAuth(req: Request, path: string): Response | null {
  if (!path.startsWith('/api/v2') || path.endsWith('/health')) return null;
  // Accept either header style: the SDK sends x-api-key, while the raw-fetch
  // trust command sends `Authorization: Bearer`.
  const key = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
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
  'GET /api/v2/events': handleListEvents,
  'POST /api/v2/events/search': () => json(EMPTY_LIST),
  'GET /api/v2/chats': () => json({ items: [], meta: { hasMore: false, cursor: null } }),
  'GET /api/v2/persons': () => json(EMPTY_ITEMS),
  'GET /api/v2/persons/search': () => json(EMPTY_ITEMS),
  'GET /api/v2/settings': () => json(EMPTY_ITEMS),
  'GET /api/v2/providers': () => json({ items: dynamicProviders }),
  'POST /api/v2/providers': handleCreateProvider,
  'GET /api/v2/access/rules': () => json(EMPTY_ITEMS),
  'GET /api/v2/context': () => json({ instanceId: null, chatId: null, messageId: null }),
  'POST /api/v2/messages/send': () => json({ data: { messageId: 'mock-msg-id' } }),
  'POST /api/v2/messages/send/reaction': handleSendReaction,
  'GET /api/v2/agents': () => json({ items: dynamicAgents }),
  'POST /api/v2/agents': handleCreateAgent,
  'GET /api/v2/logs/recent': handleRecentLogs,
  'POST /api/v2/trust/handshake': handleTrustHandshake,
  'GET /api/v2/trust/hosts': () => json(EMPTY_ITEMS),
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
  // Provider routes
  {
    method: 'GET',
    pattern: /^\/api\/v2\/providers\/[^/]+\/health$/,
    handler: (_req, path) => handleProviderHealth(path),
  },
  {
    method: 'POST',
    pattern: /^\/api\/v2\/providers\/[^/]+\/health$/,
    handler: (_req, path) => handleProviderHealth(path),
  },
  { method: 'GET', pattern: /^\/api\/v2\/providers\/[^/]+$/, handler: (_req, path) => handleGetProvider(path) },
  {
    method: 'PATCH',
    pattern: /^\/api\/v2\/providers\/[^/]+$/,
    handler: (req, path) => handleUpdateProvider(req, path),
  },
  { method: 'DELETE', pattern: /^\/api\/v2\/providers\/[^/]+$/, handler: (_req, path) => handleDeleteProvider(path) },
  // Agent routes
  { method: 'GET', pattern: /^\/api\/v2\/agents\/[^/]+$/, handler: (_req, path) => handleGetAgent(path) },
  { method: 'PATCH', pattern: /^\/api\/v2\/agents\/[^/]+$/, handler: (req, path) => handleUpdateAgent(req, path) },
  { method: 'DELETE', pattern: /^\/api\/v2\/agents\/[^/]+$/, handler: (_req, path) => handleDeleteAgent(path) },
  // Event routes (exclude reserved sub-paths handled by static or other patterns)
  {
    method: 'GET',
    pattern: /^\/api\/v2\/events\/(?!analytics$|search$|timeline\/|by-sender\/|trigger$)[^/]+$/,
    handler: (_req, path) => handleGetEvent(path),
  },
];

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  recordRequest(req, path);

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

export interface MockApiHandle {
  url: string;
  port: number;
  close: () => void;
}

let handle: MockApiHandle | null = null;

/**
 * Start an ADDITIONAL mock API on its own random port.
 *
 * Unlike {@link startMockApi} this is not a singleton and does not reset the
 * shared fixtures — multi-server tests need two live servers at once, and
 * resetting would clobber the suite that is already running against the
 * singleton. Callers must close the handle themselves.
 */
export function startMockApiInstance(): MockApiHandle {
  const server = Bun.serve({ port: 0, fetch: handleRequest });
  const port = server.port ?? 0;
  return {
    url: `http://localhost:${port}`,
    port,
    close: () => server.stop(true),
  };
}

/**
 * Start the mock API server on a random available port.
 * Returns the base URL and a close function.
 * Idempotent — calling multiple times returns the same server.
 */
export async function startMockApi(): Promise<MockApiHandle> {
  if (handle) return handle;

  // Reset state
  dynamicInstances = [];
  dynamicProviders = [];
  dynamicAgents = [];
  streamedEvents = [];

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
      dynamicProviders = [];
      dynamicAgents = [];
      streamedEvents = [];
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
