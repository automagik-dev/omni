/**
 * ClickUpChannelPlugin unit tests (issue #1413).
 *
 * Every transport is injected: the fetch mock is the only way requests are
 * made, so no test touches the live ClickUp API. Covered here:
 *   - token validation hits GET /team with the RAW token (no Bearer prefix);
 *   - lifecycle events/status never carry the token;
 *   - a 401 surfaces ClickUp's own err/ECODE and leaves the instance disconnected;
 *   - a team id that is not in GET /team is refused by name;
 *   - create/update/comment/list hit the documented v2 URLs and bodies, with
 *     the persisted default list as fallback;
 *   - non-2xx responses keep ClickUp's error text;
 *   - sendMessage refuses (not a messaging channel) without emitting anything.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { ClickUpApiError, ClickUpError } from '../errors';
import { ClickUpChannelPlugin } from '../plugin';

// ─── Mock context (channel-harness precedent) ────────────────

interface LogCall {
  level: string;
  message: string;
  data?: unknown;
}

function createMockLogger() {
  const calls: LogCall[] = [];
  const logger = {
    debug: mock((message: string, data?: unknown) => {
      calls.push({ level: 'debug', message, data });
    }),
    info: mock((message: string, data?: unknown) => {
      calls.push({ level: 'info', message, data });
    }),
    warn: mock((message: string, data?: unknown) => {
      calls.push({ level: 'warn', message, data });
    }),
    error: mock((message: string, data?: unknown) => {
      calls.push({ level: 'error', message, data });
    }),
    child: mock(function (this: unknown) {
      return logger;
    }),
  };
  return { logger, calls };
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: Record<string, unknown>; metadata: unknown }> = [];
  return {
    calls,
    connect: mock(async () => {}),
    publish: mock(async (type: string, payload: Record<string, unknown>, metadata: unknown) => {
      calls.push({ type, payload, metadata });
      return { seq: 1 };
    }),
    publishGeneric: mock(async () => ({ seq: 1 })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeMany: mock(async () => ({ unsubscribe: async () => {} })),
    subscribeAll: mock(async () => ({ unsubscribe: async () => {} })),
    unsubscribe: mock(async () => {}),
    drain: mock(async () => {}),
  };
}

function createMockContext(eventBus = createMockEventBus()) {
  const { logger, calls: logCalls } = createMockLogger();
  const context: PluginContext = {
    eventBus: eventBus as unknown as PluginContext['eventBus'],
    logger: logger as unknown as PluginContext['logger'],
    storage: {
      get: mock(async () => null),
      set: mock(async () => {}),
      delete: mock(async () => true),
      has: mock(async () => false),
      keys: mock(async () => []),
    },
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000',
      mediaStorage: { type: 'local', basePath: '/tmp' },
    },
    db: {
      execute: mock(async () => []),
      getDrizzle: mock(() => null),
    },
  };
  return { context, logCalls };
}

// ─── Fetch mock ──────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type FetchHandler = (request: CapturedRequest) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(request);
    return handler(request);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INSTANCE = 'clickup-inst-1';
const TOKEN = 'pk_test_secret_not_a_real_token';

const TEAMS = {
  teams: [
    { id: '123', name: 'Acme' },
    { id: '456', name: 'Other' },
  ],
};

function connectOptions(overrides: Record<string, unknown> = {}) {
  return { token: TOKEN, ...overrides };
}

function taskBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    name: 'Task',
    url: 'https://app.clickup.com/t/task-1',
    status: { status: 'open' },
    list: { id: '456' },
    ...overrides,
  };
}

describe('ClickUpChannelPlugin', () => {
  let plugin: ClickUpChannelPlugin;

  beforeEach(() => {
    plugin = new ClickUpChannelPlugin();
  });

  async function connected(handler: FetchHandler, options: Record<string, unknown> = {}) {
    const { fetchImpl, requests } = mockFetch((request) =>
      request.url.endsWith('/team') ? jsonResponse(TEAMS) : handler(request),
    );
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context, logCalls } = createMockContext();
    const eventBus = context.eventBus as unknown as ReturnType<typeof createMockEventBus>;
    await plugin.initialize(context);
    await plugin.connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions(options) });
    return { requests, eventBus, logCalls };
  }

  it('validates the token against GET /team with the raw Authorization header and no token leak', async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(TEAMS));
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context, logCalls } = createMockContext();
    const eventBus = context.eventBus as unknown as ReturnType<typeof createMockEventBus>;
    await plugin.initialize(context);

    await plugin.connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions() });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.clickup.com/api/v2/team');
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.headers.Authorization).toBe(TOKEN);
    expect(requests[0]?.headers.Authorization ?? '').not.toContain('Bearer');
    expect(requests[0]?.headers['Content-Type']).toBe('application/json');

    const status = await plugin.getStatus(INSTANCE);
    expect(status.state).toBe('connected');
    expect(status.message).toBe('Connected to Acme');

    const connectedEvent = eventBus.calls.find((call) => call.type === 'instance.connected');
    expect(connectedEvent?.payload).toMatchObject({
      instanceId: INSTANCE,
      channelType: 'clickup',
      profileName: 'Acme',
      ownerIdentifier: '123',
      teamId: '123',
    });

    // The token must not appear in anything a caller/operator can observe.
    const observed = JSON.stringify({ status, events: eventBus.calls, logs: logCalls });
    expect(observed).not.toContain(TOKEN);
  });

  it('a 401 rejects with ClickUp err/ECODE, never the token, and leaves the instance disconnected', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ err: 'Authorization header required', ECODE: 'OAUTH_017' }, 401),
    );
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context } = createMockContext();
    await plugin.initialize(context);

    const error = await plugin
      .connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions() })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ClickUpApiError);
    const message = (error as Error).message;
    expect(message).toContain('401');
    expect(message).toContain('Authorization header required');
    expect(message).toContain('OAUTH_017');
    expect(message).not.toContain(TOKEN);

    const status = await plugin.getStatus(INSTANCE);
    expect(status.state).toBe('disconnected');
    expect(status.message).toContain('Authorization header required');
  });

  it('refuses a team id that is not in GET /team, by id and without the token', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(TEAMS));
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context } = createMockContext();
    await plugin.initialize(context);

    const error = await plugin
      .connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions({ teamId: '999' }) })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ClickUpError);
    expect((error as Error).message).toContain('999');
    expect((error as Error).message).not.toContain(TOKEN);
    expect((await plugin.getStatus(INSTANCE)).state).toBe('disconnected');
  });

  it('has no teams to choose from when the token reaches none', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ teams: [] }));
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context } = createMockContext();
    await plugin.initialize(context);

    await expect(
      plugin.connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions() }),
    ).rejects.toThrow(/no teams/);
  });

  it('create_task posts to /list/{id}/task with the expected body and returns a normalized task', async () => {
    const { requests } = await connected(() => jsonResponse(taskBody()));

    const result = await plugin.execute(INSTANCE, {
      operation: 'create_task',
      listId: '456',
      name: 'Task for Acme',
      description: 'Please follow up',
      assignees: [42],
      dueDate: '2026-11-01T12:00:00Z',
    });

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('https://api.clickup.com/api/v2/list/456/task');
    expect(post?.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      name: 'Task for Acme',
      description: 'Please follow up',
      assignees: [42],
      due_date: Date.parse('2026-11-01T12:00:00Z'),
    });
    expect(result).toEqual({
      id: 'task-1',
      name: 'Task',
      url: 'https://app.clickup.com/t/task-1',
      status: 'open',
      listId: '456',
    });
  });

  it('falls back to the persisted default list, and explains the fix when neither list exists', async () => {
    const { requests } = await connected(() => jsonResponse(taskBody()), { listId: '999' });

    await plugin.execute(INSTANCE, { operation: 'create_task', name: 'No explicit list' });
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('https://api.clickup.com/api/v2/list/999/task');

    const noList = new ClickUpChannelPlugin({
      fetch: mockFetch((request) => (request.url.endsWith('/team') ? jsonResponse(TEAMS) : jsonResponse(taskBody())))
        .fetchImpl,
    });
    const { context } = createMockContext();
    await noList.initialize(context);
    await noList.connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions() });

    await expect(noList.execute(INSTANCE, { operation: 'create_task', name: 'Missing list' })).rejects.toThrow(
      /needs a list id: pass listId or set a default List ID/,
    );
  });

  it('update_status and add_comment hit the documented URLs and bodies', async () => {
    const { requests } = await connected((request) => {
      if (request.url.endsWith('/comment')) return jsonResponse({ id: 'comment-1', text: 'Looks good' });
      return jsonResponse(taskBody({ status: { status: 'done' } }));
    });

    const updated = await plugin.execute(INSTANCE, {
      operation: 'update_status',
      taskId: 'task-1',
      status: 'done',
    });
    expect(updated).toMatchObject({ id: 'task-1', status: 'done' });

    const comment = await plugin.execute(INSTANCE, {
      operation: 'add_comment',
      taskId: 'task-1',
      comment: 'Looks good',
      notifyAll: true,
    });
    expect(comment).toEqual({ id: 'comment-1', text: 'Looks good' });

    const update = requests.find((request) => request.url.endsWith('/task/task-1'));
    expect(update?.method).toBe('POST');
    expect(JSON.parse(update?.body ?? '{}')).toEqual({ status: 'done' });

    const added = requests.find((request) => request.url.endsWith('/task/task-1/comment'));
    expect(added?.method).toBe('POST');
    expect(JSON.parse(added?.body ?? '{}')).toEqual({ comment_text: 'Looks good', notify_all: true });
  });

  it('list_tasks GETs the list with archived=false and subtasks=false', async () => {
    const { requests } = await connected(() => jsonResponse({ tasks: [taskBody(), taskBody({ id: 'task-2' })] }));

    const result = await plugin.execute(INSTANCE, { operation: 'list_tasks', listId: '456' });

    const get = requests.find((request) => request.method === 'GET' && request.url.includes('/list/456/task'));
    expect(get?.url).toBe('https://api.clickup.com/api/v2/list/456/task?archived=false&subtasks=false');
    expect(result).toEqual({
      tasks: [
        {
          id: 'task-1',
          name: 'Task',
          url: 'https://app.clickup.com/t/task-1',
          status: 'open',
          listId: '456',
        },
        { id: 'task-2', name: 'Task', url: 'https://app.clickup.com/t/task-1', status: 'open', listId: '456' },
      ],
    });
  });

  it('surfaces a non-2xx ClickUp error body in the thrown message', async () => {
    await connected(() => jsonResponse({ err: 'Internal server error', ECODE: 'APP_500' }, 500));

    const error = await plugin
      .execute(INSTANCE, { operation: 'create_task', listId: '456', name: 'Boom' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(500);
    expect((error as Error).message).toContain('Internal server error');
    expect((error as Error).message).toContain('APP_500');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('refuses to send chat messages and emits nothing', async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(TEAMS));
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context } = createMockContext();
    const eventBus = context.eventBus as unknown as ReturnType<typeof createMockEventBus>;
    await plugin.initialize(context);

    const result = await plugin.sendMessage(INSTANCE, {
      to: 'some-chat',
      content: { type: 'text', text: 'hello' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ClickUp is not a messaging channel');
    expect(requests).toHaveLength(0);
    expect(eventBus.calls.some((call) => call.type === 'message.sent')).toBe(false);
    expect(eventBus.calls.some((call) => call.type === 'message.failed')).toBe(false);
  });

  it('never includes the token in JSON.stringify of thrown errors', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ err: 'bad token', ECODE: 'OAUTH_001' }, 401));
    plugin = new ClickUpChannelPlugin({ fetch: fetchImpl });
    const { context } = createMockContext();
    await plugin.initialize(context);

    const errors: unknown[] = [];
    errors.push(
      await plugin
        .connect(INSTANCE, { instanceId: INSTANCE, credentials: {}, options: connectOptions() })
        .catch((thrown: unknown) => thrown),
    );

    const serialized = JSON.stringify(
      errors.map((error) =>
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack, ...(error as unknown as object) }
          : error,
      ),
    );
    expect(serialized).not.toContain(TOKEN);
  });
});
