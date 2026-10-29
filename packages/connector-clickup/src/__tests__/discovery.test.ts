/**
 * ClickUp discovery-action tests.
 *
 * Same harness as `manifest.test.ts`: every transport is an injected fetch, so
 * no test touches ClickUp. Covered here:
 *   - the manifest declares exactly seven actions and each discovery schema
 *     accepts/rejects the right inputs;
 *   - list_spaces resolves teamId from the input, the connector config, or
 *     GET /team (all reachable Workspaces);
 *   - list_folders and list_lists hit the documented v2 URLs, including the
 *     folder/space fork in list_lists;
 *   - success, empty list, 401 and 404 for each action, plus 403's wording;
 *   - the normalized node shape is stable and provider payloads/tokens never
 *     appear in an error.
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
const BASE = 'https://api.clickup.com/api/v2';

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

async function runError(key: string, input: Record<string, unknown>, handler: FetchHandler, config = {}) {
  return run(key, input, handler, config)
    .then(() => null)
    .catch((thrown: unknown) => thrown);
}

function errorResponse(body: unknown, status: number): FetchHandler {
  return () => jsonResponse(body, status);
}

describe('ClickUp discovery manifest', () => {
  test('declares exactly the seven actions, in a stable order', () => {
    expect(clickupManifest.actions).toHaveLength(7);
    expect(clickupManifest.actions.map((candidate) => candidate.key)).toEqual([
      'create_task',
      'update_task',
      'add_comment',
      'list_tasks',
      'list_spaces',
      'list_folders',
      'list_lists',
    ]);
  });

  test('list_spaces accepts an optional teamId and nothing else', () => {
    const schema = action('list_spaces').inputSchema;
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ teamId: '123' }).success).toBe(true);
    expect(schema.safeParse({ teamId: '' }).success).toBe(false);
    expect(schema.safeParse({ teamId: 'x'.repeat(65) }).success).toBe(false);
    expect(schema.safeParse({ spaceId: '789' }).success).toBe(false);
  });

  test('list_folders requires spaceId', () => {
    const schema = action('list_folders').inputSchema;
    expect(schema.safeParse({ spaceId: '789' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ spaceId: '' }).success).toBe(false);
    expect(schema.safeParse({ spaceId: 789 }).success).toBe(false);
    expect(schema.safeParse({ spaceId: '789', folderId: '456' }).success).toBe(false);
  });

  test('list_lists requires spaceId and takes an optional folderId', () => {
    const schema = action('list_lists').inputSchema;
    expect(schema.safeParse({ spaceId: '789' }).success).toBe(true);
    expect(schema.safeParse({ spaceId: '789', folderId: '456' }).success).toBe(true);
    expect(schema.safeParse({ folderId: '456' }).success).toBe(false);
    expect(schema.safeParse({ spaceId: '789', teamId: '123' }).success).toBe(false);
  });
});

describe('list_spaces', () => {
  const SPACES = {
    spaces: [
      { id: '789', name: 'Product', archived: false },
      { id: '790', name: 'Marketing', archived: true },
    ],
  };

  test('uses the input teamId and normalizes spaces with teamId', async () => {
    const { result, requests } = await run('list_spaces', { teamId: '123' }, () => jsonResponse(SPACES));

    expect(result).toEqual({
      spaces: [
        { id: '789', name: 'Product', archived: false, teamId: '123' },
        { id: '790', name: 'Marketing', archived: true, teamId: '123' },
      ],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`${BASE}/team/123/space?archived=false`);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.headers.Authorization).toBe(TOKEN);
  });

  test('falls back to the connector config teamId', async () => {
    const { requests } = await run('list_spaces', {}, () => jsonResponse(SPACES), { teamId: '123' });
    expect(requests.map((request) => request.url)).toEqual([`${BASE}/team/123/space?archived=false`]);
  });

  test('with no teamId it walks every team GET /team returns, tagged per space', async () => {
    const { result, requests } = await run('list_spaces', {}, (request) => {
      if (request.url === `${BASE}/team`) {
        return jsonResponse({
          teams: [
            { id: '123', name: 'Acme' },
            { id: '456', name: 'Beta' },
          ],
        });
      }
      if (request.url === `${BASE}/team/123/space?archived=false`) {
        return jsonResponse({ spaces: [{ id: '789', name: 'Product' }] });
      }
      return jsonResponse({ spaces: [{ id: '790', name: 'Beta space' }] });
    });

    expect(requests.map((request) => request.url)).toEqual([
      `${BASE}/team`,
      `${BASE}/team/123/space?archived=false`,
      `${BASE}/team/456/space?archived=false`,
    ]);
    expect(result).toEqual({
      spaces: [
        { id: '789', name: 'Product', archived: false, teamId: '123' },
        { id: '790', name: 'Beta space', archived: false, teamId: '456' },
      ],
    });
  });

  test('returns an empty list unchanged', async () => {
    const { result } = await run('list_spaces', { teamId: '123' }, () => jsonResponse({ spaces: [] }));
    expect(result).toEqual({ spaces: [] });
  });

  test('no team and no reachable Workspace is a clear, non-HTTP failure', async () => {
    const error = await runError('list_spaces', {}, () => jsonResponse({ teams: [] }));
    expect(error).toBeInstanceOf(ClickUpError);
    expect((error as ClickUpError).code).toBe('TEAM_NOT_FOUND');
    expect((error as Error).message).toContain('no teams');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test('401 says the token is invalid or expired and never echoes ClickUp text', async () => {
    const error = await runError(
      'list_spaces',
      { teamId: '123' },
      errorResponse({ err: 'provider raw detail that must not leak', ECODE: 'OAUTH_017' }, 401),
    );
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(401);
    expect((error as Error).message).toContain('invalid or expired');
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('provider raw detail');
  });

  test('404 names the team id as wrong or nonexistent in that scope', async () => {
    const error = await runError(
      'list_spaces',
      { teamId: '999' },
      errorResponse({ err: 'Team not found', ECODE: 'TEAM_404' }, 404),
    );
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(404);
    expect((error as Error).message).toContain('team 999');
    expect((error as Error).message).toContain('404');
    expect((error as Error).message).toContain('wrong or does not exist in that scope');
    expect((error as Error).message).not.toContain('Team not found');
  });
});

describe('list_folders', () => {
  const FOLDERS = {
    folders: [
      { id: '456', name: 'Engineering', archived: false, space: { id: '789', name: 'Product' }, lists: [] },
      { id: '457', name: 'Platform', archived: true, space: { id: '789', name: 'Product' }, parent_folder: '456' },
    ],
  };

  test('GETs the space folders and tags each folder with spaceId', async () => {
    const { result, requests } = await run('list_folders', { spaceId: '789' }, () => jsonResponse(FOLDERS));

    expect(requests.map((request) => request.url)).toEqual([`${BASE}/space/789/folder?archived=false`]);
    expect(result).toEqual({
      folders: [
        { id: '456', name: 'Engineering', archived: false, spaceId: '789' },
        { id: '457', name: 'Platform', archived: true, spaceId: '789', parentFolderId: '456' },
      ],
    });
  });

  test('returns an empty list unchanged', async () => {
    const { result } = await run('list_folders', { spaceId: '789' }, () => jsonResponse({ folders: [] }));
    expect(result).toEqual({ folders: [] });
  });

  test('401 says the token is invalid or expired', async () => {
    const error = await runError('list_folders', { spaceId: '789' }, errorResponse({ err: 'nope' }, 401));
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(401);
    expect((error as Error).message).toContain('invalid or expired');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test('404 names the space id', async () => {
    const error = await runError('list_folders', { spaceId: '999' }, errorResponse({ err: 'not found' }, 404));
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(404);
    expect((error as Error).message).toContain('space 999');
    expect((error as Error).message).toContain('wrong or does not exist in that scope');
  });

  test('403 says the token is missing permission for the space', async () => {
    const error = await runError('list_folders', { spaceId: '789' }, errorResponse({ err: 'forbidden' }, 403));
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(403);
    expect((error as Error).message).toContain('missing permission');
    expect((error as Error).message).toContain('space 789');
  });
});

describe('list_lists', () => {
  const FOLDER_LISTS = {
    lists: [
      { id: '124', name: 'Backlog', archived: false, folder: { id: '456' }, space: { id: '789' } },
      { id: '125', name: 'Done', space: { id: '789' } },
    ],
  };

  test('with folderId GETs the folder lists and carries spaceId + folderId', async () => {
    const { result, requests } = await run('list_lists', { spaceId: '789', folderId: '456' }, () =>
      jsonResponse(FOLDER_LISTS),
    );

    expect(requests.map((request) => request.url)).toEqual([`${BASE}/folder/456/list?archived=false`]);
    expect(result).toEqual({
      lists: [
        { id: '124', name: 'Backlog', archived: false, spaceId: '789', folderId: '456' },
        { id: '125', name: 'Done', archived: false, spaceId: '789', folderId: '456' },
      ],
    });
  });

  test('without folderId GETs the space folderless lists and omits folderId', async () => {
    const { result, requests } = await run('list_lists', { spaceId: '789' }, () =>
      // ClickUp sends an empty folder object for a folderless list.
      jsonResponse({ lists: [{ id: '126', name: 'Inbox', archived: false, space: { id: '789' }, folder: {} }] }),
    );

    expect(requests.map((request) => request.url)).toEqual([`${BASE}/space/789/list?archived=false`]);
    expect(result).toEqual({ lists: [{ id: '126', name: 'Inbox', archived: false, spaceId: '789' }] });
    expect(JSON.stringify(result)).not.toContain('folderId');
  });

  test('returns an empty list unchanged', async () => {
    const { result } = await run('list_lists', { spaceId: '789' }, () => jsonResponse({ lists: [] }));
    expect(result).toEqual({ lists: [] });
  });

  test('401 says the token is invalid or expired', async () => {
    const error = await runError('list_lists', { spaceId: '789' }, errorResponse({ err: 'nope' }, 401));
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(401);
    expect((error as Error).message).toContain('invalid or expired');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test('404 on the folder path names the folder id', async () => {
    const error = await runError(
      'list_lists',
      { spaceId: '789', folderId: '999' },
      errorResponse({ err: 'not found' }, 404),
    );
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(404);
    expect((error as Error).message).toContain('folder 999');
    expect((error as Error).message).toContain('wrong or does not exist in that scope');
  });

  test('404 on the space path names the space id', async () => {
    const error = await runError('list_lists', { spaceId: '999' }, errorResponse({ err: 'not found' }, 404));
    expect(error).toBeInstanceOf(ClickUpApiError);
    expect((error as ClickUpApiError).status).toBe(404);
    expect((error as Error).message).toContain('space 999');
  });
});
