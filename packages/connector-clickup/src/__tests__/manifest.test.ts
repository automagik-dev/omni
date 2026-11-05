/**
 * ClickUp manifest tests.
 *
 * Every transport is injected: the fetch mock is the only way requests are
 * made, so no test touches the live ClickUp API. Covered here:
 *   - token validation hits GET /team with the RAW token (no Bearer prefix);
 *   - a 401 surfaces ClickUp's own err/ECODE and never the token;
 *   - a team id that is not in GET /team is refused by name;
 *   - the four actions hit the documented v2 URLs and bodies;
 *   - the webhook parser yields the event key and the stable history id;
 *   - the token never appears in a thrown error's JSON.
 */

import { describe, expect, test } from 'bun:test';
import { ClickUpApiError, ClickUpError } from '../errors';
import { clickupManifest } from '../manifest';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type FetchHandler = (request: CapturedRequest) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TOKEN = 'pk_test_secret_not_a_real_token';
const TEAMS = { teams: [{ id: '123', name: 'Acme' }] };

function validate(fetchImpl: typeof fetch, config: Record<string, unknown> = {}) {
  return clickupManifest.validate({ credentials: { token: TOKEN }, config, fetch: fetchImpl });
}

function action(key: string) {
  const found = clickupManifest.actions.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing action ${key}`);
  return found;
}

async function run(
  key: string,
  input: Record<string, unknown>,
  handler: FetchHandler,
  config: Record<string, unknown> = {},
) {
  const { fetchImpl, requests } = mockFetch(handler);
  const result = await action(key).run({
    credentials: { token: TOKEN },
    config,
    input,
    fetch: fetchImpl,
    timeoutMs: 5_000,
  });
  return { result, requests };
}

describe('ClickUp connect validation', () => {
  test('GET /team with the raw Authorization header and no token leak', async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(TEAMS));
    const result = await validate(fetchImpl);

    expect(result).toEqual({ ok: true, account: 'Acme' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.clickup.com/api/v2/team');
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.headers.Authorization).toBe(TOKEN);
    expect(requests[0]?.headers.Authorization ?? '').not.toContain('Bearer');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test('a 401 rejects with ClickUp err/ECODE, never the token', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ err: 'Authorization header required', ECODE: 'OAUTH_017' }, 401),
    );
    const result = await validate(fetchImpl);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AUTH_FAILED');
    expect(result.message).toContain('401');
    expect(result.message).toContain('Authorization header required');
    expect(result.message).toContain('OAUTH_017');
    expect(result.message).not.toContain(TOKEN);
  });

  test('a team id that is not visible is refused by id, without the token', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse(TEAMS));
    const result = await validate(fetchImpl, { teamId: '999' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TEAM_NOT_FOUND');
    expect(result.message).toContain('999');
    expect(result.message).not.toContain(TOKEN);
  });

  test('no token is refused before any request', async () => {
    const { fetchImpl, requests } = mockFetch(() => jsonResponse(TEAMS));
    const result = await clickupManifest.validate({ credentials: {}, config: {}, fetch: fetchImpl });
    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe('ClickUp actions', () => {
  test('add_comment posts exactly once to /task/{id}/comment with notify_all present', async () => {
    const { result, requests } = await run('add_comment', { taskId: 'task-1', comment: 'Looks good' }, () =>
      jsonResponse({ id: 'comment-1', text: 'Looks good' }),
    );

    expect(result).toEqual({ id: 'comment-1', text: 'Looks good' });
    const post = requests.find((request) => request.url.endsWith('/task/task-1/comment'));
    expect(post?.method).toBe('POST');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ comment_text: 'Looks good', notify_all: false });
    expect(requests).toHaveLength(1);
  });

  test('create_task posts to /list/{id}/task with the expected body and falls back to config.listId', async () => {
    const { result, requests } = await run(
      'create_task',
      { name: 'Task for Acme', description: 'Please follow up', assignees: [42], dueDate: '2026-11-01T12:00:00Z' },
      () =>
        jsonResponse({
          id: 'task-1',
          name: 'Task for Acme',
          url: 'https://app.clickup.com/t/task-1',
          status: { status: 'open' },
          list: { id: '999' },
        }),
      { listId: '999' },
    );

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('https://api.clickup.com/api/v2/list/999/task');
    expect(JSON.parse(post?.body ?? '{}')).toEqual({
      name: 'Task for Acme',
      description: 'Please follow up',
      assignees: [42],
      due_date: Date.parse('2026-11-01T12:00:00Z'),
    });
    expect(result).toMatchObject({ id: 'task-1', status: 'open', listId: '999' });
  });

  test('update_task uses PUT and moves status', async () => {
    const { result, requests } = await run('update_task', { taskId: 'task-1', status: 'done' }, () =>
      jsonResponse({ id: 'task-1', name: 'Task', status: { status: 'done' } }),
    );

    const update = requests.find((request) => request.url.endsWith('/task/task-1'));
    expect(update?.method).toBe('PUT');
    expect(JSON.parse(update?.body ?? '{}')).toEqual({ status: 'done' });
    expect(result).toMatchObject({ id: 'task-1', status: 'done' });
  });

  test('list_tasks GETs archived=false&subtasks=false', async () => {
    const { result, requests } = await run('list_tasks', { listId: '456' }, () =>
      jsonResponse({ tasks: [{ id: 'task-1', name: 'One', list: { id: '456' } }] }),
    );

    const get = requests.find((request) => request.url.includes('/list/456/task'));
    expect(get?.url).toBe('https://api.clickup.com/api/v2/list/456/task?archived=false&subtasks=false');
    expect(result).toEqual({ tasks: [{ id: 'task-1', name: 'One', listId: '456' }] });
  });

  test('a missing list explains both ways out', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({}));
    const error = await action('create_task')
      .run({
        credentials: { token: TOKEN },
        config: {},
        input: { name: 'No list' },
        fetch: fetchImpl,
        timeoutMs: 1_000,
      })
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ClickUpError);
    expect((error as Error).message).toContain('pass listId in the action input or set a default List ID');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test('a provider error is readable and token-free', async () => {
    const { fetchImpl } = mockFetch(() => jsonResponse({ err: 'Internal server error', ECODE: 'APP_500' }, 500));
    const error = await action('create_task')
      .run({
        credentials: { token: TOKEN },
        config: {},
        input: { listId: '456', name: 'Boom' },
        fetch: fetchImpl,
        timeoutMs: 1_000,
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as Error).message).toContain('Internal server error');
    expect((error as Error).message).toContain('APP_500');
    expect((error as Error).message).not.toContain(TOKEN);
    expect(JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack })).not.toContain(TOKEN);
  });
});

describe('ClickUp inbound delivery', () => {
  test('parses the event key and the stable history id', () => {
    const body = JSON.stringify({
      event: 'taskStatusUpdated',
      webhook_id: 'wh-1',
      task_id: 'task-1',
      history_items: [{ id: '280076313671714080001', date: 1_780_000_000_000, field: 'status' }],
    });
    const parsed = clickupManifest.parseDelivery?.(body, {});
    expect(parsed?.eventKey).toBe('taskStatusUpdated');
    expect(parsed?.providerEventId).toBe('280076313671714080001');
    expect(parsed?.occurredAt).toBe(new Date(1_780_000_000_000).toISOString());
    expect(parsed?.data).toMatchObject({ task_id: 'task-1' });
  });

  test('falls back to no provider id when ClickUp sends no history item', () => {
    const parsed = clickupManifest.parseDelivery?.(JSON.stringify({ event: 'taskDeleted', task_id: 'task-1' }), {});
    expect(parsed?.eventKey).toBe('taskDeleted');
    expect(parsed?.providerEventId).toBeUndefined();
  });

  test('declares the HMAC contract ClickUp uses', () => {
    expect(clickupManifest.verification).toEqual({ kind: 'hmac-sha256', header: 'X-Signature', encoding: 'hex' });
  });
});
