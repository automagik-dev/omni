/**
 * ClickUp connector manifest.
 *
 * One code manifest declares the whole provider: the personal-token connect
 * validation (`GET /team`), the four task actions, the three hierarchy
 * discovery actions (`list_spaces` → `list_folders` → `list_lists`), the
 * webhook signature scheme and the event keys. Nothing in the core knows
 * ClickUp exists.
 *
 * ClickUp webhooks are configured in ClickUp itself (token-auth providers do
 * not need OAuth); the operator pastes ClickUp's generated secret into the
 * subscription, and the provider retries on any non-2xx.
 */

import {
  type ConnectorActionContext,
  ConnectorDeliveryParseError,
  type ConnectorManifest,
  redactSecrets,
} from '@omni/connector-sdk';
import { z } from 'zod';
import { ClickUpApiClient } from './client';
import { ClickUpApiError, ClickUpError } from './errors';
import {
  AddCommentInputSchema,
  type ClickUpApiNavItem,
  type ClickUpApiTask,
  ClickUpDeliverySchema,
  type ClickUpNavItem,
  type ClickUpTask,
  CreateTaskInputSchema,
  ListFoldersInputSchema,
  ListListsInputSchema,
  ListSpacesInputSchema,
  ListTasksInputSchema,
  UpdateTaskInputSchema,
} from './types';

const TOKEN_FIELD = 'token';

function tokenOf(context: ConnectorActionContext): string {
  const token = context.credentials[TOKEN_FIELD];
  if (typeof token !== 'string' || token.length === 0) {
    throw new ClickUpError('AUTH_FAILED', 'ClickUp connector has no usable API token.');
  }
  return token;
}

function clientFor(context: ConnectorActionContext): ClickUpApiClient {
  return new ClickUpApiClient({
    token: tokenOf(context),
    fetch: context.fetch,
    timeoutMs: context.timeoutMs,
  });
}

/** Run an action, scrubbing the token from any error text before it leaves. */
async function guarded<T>(context: ConnectorActionContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const redacted = redactSecrets(message, [context.credentials[TOKEN_FIELD]]);
    // Preserve the taxonomy so the API can map a 401/403 to `revoked` and a
    // provider rejection to a readable error instead of a bare Error.
    if (error instanceof ClickUpApiError) throw new ClickUpApiError(error.status, redacted, error.clickupCode);
    if (error instanceof ClickUpError) throw new ClickUpError(error.code, redacted, { cause: error });
    throw new Error(redacted);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A list is required: the action input wins, then the connector's configured default. */
function listIdFor(context: ConnectorActionContext, inputListId: unknown): string {
  const explicit = asString(inputListId);
  const configured = asString(context.config.listId);
  const resolved = explicit ?? configured;
  if (!resolved) {
    throw new ClickUpError(
      'MISSING_LIST',
      'ClickUp needs a list id: pass listId in the action input or set a default List ID on the connector.',
    );
  }
  return resolved;
}

/** ClickUp takes Unix milliseconds; accept a number as-is or parse ISO 8601. */
function toDueDateMs(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new ClickUpError(
    'INVALID_REQUEST',
    'ClickUp dueDate must be an ISO 8601 date string or a Unix millisecond timestamp.',
  );
}

function normalizeTask(task: ClickUpApiTask, fallbackListId: string): ClickUpTask {
  const status = typeof task.status === 'string' ? task.status : task.status?.status;
  return {
    id: task.id,
    name: task.name,
    ...(task.url ? { url: task.url } : {}),
    ...(status ? { status } : {}),
    listId: task.list?.id ?? fallbackListId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

type DiscoveryScope = 'team' | 'space' | 'folder' | 'teams';

/**
 * 401/403/404 become a fixed, payload-free sentence naming the scope that
 * failed: ClickUp's own body is never echoed for discovery, so a caller can act
 * on the message without parsing provider text or leaking the token.
 */
function rejectDiscoveryError(error: unknown, scope: DiscoveryScope, id: string | undefined): never {
  if (error instanceof ClickUpApiError) {
    const label = scope === 'teams' ? "the token's teams" : id ? `${scope} ${id}` : scope;
    if (error.status === 401) {
      throw new ClickUpApiError(
        401,
        'ClickUp rejected the API token (401): the token is invalid or expired. Reconnect the connector with a fresh personal API token.',
      );
    }
    if (error.status === 403) {
      throw new ClickUpApiError(403, `ClickUp denied access (403): the token is missing permission to view ${label}.`);
    }
    if (error.status === 404) {
      throw new ClickUpApiError(
        404,
        `ClickUp found no ${label} (404): the id is wrong or does not exist in that scope.`,
      );
    }
  }
  throw error;
}

async function withDiscoveryScope<T>(scope: DiscoveryScope, id: string | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    rejectDiscoveryError(error, scope, id);
  }
}

/** One stable node shape for all three discovery actions. */
function normalizeNavItem(
  item: ClickUpApiNavItem,
  parent: { teamId?: string; spaceId?: string; folderId?: string },
): ClickUpNavItem {
  const parentFolderId = item.parent_folder == null ? undefined : String(item.parent_folder);
  return {
    id: item.id,
    name: item.name,
    archived: item.archived === true,
    ...(parent.teamId ? { teamId: parent.teamId } : {}),
    ...(parent.spaceId ? { spaceId: parent.spaceId } : {}),
    ...(parent.folderId ? { folderId: parent.folderId } : {}),
    ...(parentFolderId ? { parentFolderId } : {}),
  };
}

/**
 * The team ids `list_spaces` walks: the action input, then the connector's
 * configured default, then — when neither is set — every Workspace
 * `GET /team` returns for this token. That last path is token-derived
 * discovery: it needs no out-of-band id and each returned space still carries
 * its `teamId`, so the caller never has to guess which Workspace it saw.
 */
async function teamIdsFor(
  context: ConnectorActionContext,
  client: ClickUpApiClient,
  inputTeamId: unknown,
): Promise<string[]> {
  const explicit = asString(inputTeamId) ?? asString(context.config.teamId);
  if (explicit) return [explicit];
  const teams = await withDiscoveryScope('teams', undefined, () => client.getTeams());
  if (teams.length === 0) {
    throw new ClickUpError(
      'TEAM_NOT_FOUND',
      'ClickUp returned no teams for this API token. The token must belong to a ClickUp Workspace with access.',
    );
  }
  return teams.map((team) => team.id);
}

export const clickupManifest: ConnectorManifest = {
  id: 'clickup',
  label: 'ClickUp',
  version: '1.0.0',
  credentialFields: [
    {
      key: TOKEN_FIELD,
      label: 'Personal API token',
      secret: true,
      help: 'ClickUp: Settings → Apps → API Token. ClickUp v2 sends this token raw in Authorization (no Bearer prefix).',
    },
  ],
  configSchema: z
    .object({
      teamId: z.string().min(1).max(64).optional(),
      listId: z.string().min(1).max(64).optional(),
    })
    .strict(),

  async validate({ credentials, config, fetch }) {
    const token = credentials[TOKEN_FIELD];
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false as const, code: 'MISSING_CREDENTIAL', message: 'A ClickUp personal API token is required.' };
    }
    const teamId = asString(config.teamId);
    try {
      const teams = await new ClickUpApiClient({ token, fetch }).getTeams();
      const team = teamId ? teams.find((candidate) => candidate.id === teamId) : teams[0];
      if (teamId && !team) {
        return {
          ok: false as const,
          code: 'TEAM_NOT_FOUND',
          message: redactSecrets(
            `ClickUp team ${teamId} is not available for this API token. Check the team id, or leave it empty to use the token's first team.`,
            [token],
          ),
        };
      }
      if (!team) {
        return {
          ok: false as const,
          code: 'TEAM_NOT_FOUND',
          message: redactSecrets(
            'ClickUp returned no teams for this API token. The token must belong to a ClickUp team with access.',
            [token],
          ),
        };
      }
      return { ok: true as const, account: team.name };
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error), [token]);
      const code =
        error instanceof ClickUpApiError && (error.status === 401 || error.status === 403)
          ? 'AUTH_FAILED'
          : error instanceof ClickUpError
            ? error.code
            : 'VALIDATION_FAILED';
      return { ok: false as const, code, message };
    }
  },

  events: [
    {
      key: 'taskStatusUpdated',
      label: 'Task status updated',
      sample: {
        event: 'taskStatusUpdated',
        webhook_id: '7fa3ec74-69a8-4530-a251-8a13730bd204',
        task_id: '86a1b2c3',
        history_items: [
          {
            id: '280076313671714080001',
            date: 1_780_000_000_000,
            field: 'status',
            before: 'in progress',
            after: 'done',
          },
        ],
      },
    },
    { key: 'taskCreated', label: 'Task created' },
    { key: 'taskUpdated', label: 'Task updated' },
    { key: 'taskDeleted', label: 'Task deleted' },
  ],

  actions: [
    {
      key: 'create_task',
      label: 'Create task',
      description: 'POST /list/{listId}/task',
      inputSchema: CreateTaskInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = CreateTaskInputSchema.parse(context.input);
          const listId = listIdFor(context, input.listId);
          const body: Record<string, unknown> = { name: input.name };
          if (input.description !== undefined) body.description = input.description;
          if (input.assignees !== undefined) body.assignees = input.assignees;
          if (input.dueDate !== undefined) body.due_date = toDueDateMs(input.dueDate);
          const task = await clientFor(context).createTask(listId, body);
          return normalizeTask(task, listId);
        }),
    },
    {
      key: 'update_task',
      label: 'Update task',
      description: 'PUT /task/{taskId} — fields and status',
      inputSchema: UpdateTaskInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = UpdateTaskInputSchema.parse(context.input);
          const body: Record<string, unknown> = {};
          if (input.name !== undefined) body.name = input.name;
          if (input.description !== undefined) body.description = input.description;
          if (input.status !== undefined) body.status = input.status;
          if (input.priority !== undefined) body.priority = input.priority;
          if (input.dueDate !== undefined) body.due_date = toDueDateMs(input.dueDate);
          const task = await clientFor(context).updateTask(input.taskId, body);
          return normalizeTask(task, asString(context.config.listId) ?? '');
        }),
    },
    {
      key: 'add_comment',
      label: 'Add comment',
      description: 'POST /task/{taskId}/comment',
      inputSchema: AddCommentInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = AddCommentInputSchema.parse(context.input);
          const created = await clientFor(context).addComment(input.taskId, {
            comment_text: input.comment,
            // ClickUp's contract marks notify_all required: always present.
            notify_all: input.notifyAll === true,
          });
          return {
            id: created.id,
            ...(created.text ? { text: created.text } : {}),
          };
        }),
    },
    {
      key: 'list_tasks',
      label: 'List tasks',
      description: 'GET /list/{listId}/task?archived=false&subtasks=false',
      inputSchema: ListTasksInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = ListTasksInputSchema.parse(context.input);
          const listId = listIdFor(context, input.listId);
          const tasks = await clientFor(context).listTasks(listId);
          return { tasks: tasks.map((task) => normalizeTask(task, listId)) };
        }),
    },
    {
      key: 'list_spaces',
      label: 'List spaces',
      description:
        'GET /team/{teamId}/space?archived=false — uses the configured team by default; without one, every team GET /team returns',
      inputSchema: ListSpacesInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = ListSpacesInputSchema.parse(context.input);
          const client = clientFor(context);
          const teamIds = await teamIdsFor(context, client, input.teamId);
          const spaces: ClickUpNavItem[] = [];
          for (const teamId of teamIds) {
            const items = await withDiscoveryScope('team', teamId, () => client.listSpaces(teamId));
            spaces.push(...items.map((item) => normalizeNavItem(item, { teamId })));
          }
          return { spaces };
        }),
    },
    {
      key: 'list_folders',
      label: 'List folders',
      description: 'GET /space/{spaceId}/folder?archived=false',
      inputSchema: ListFoldersInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = ListFoldersInputSchema.parse(context.input);
          const items = await withDiscoveryScope('space', input.spaceId, () =>
            clientFor(context).listFolders(input.spaceId),
          );
          return { folders: items.map((item) => normalizeNavItem(item, { spaceId: input.spaceId })) };
        }),
    },
    {
      key: 'list_lists',
      label: 'List lists',
      description:
        'GET /space/{spaceId}/list?archived=false, or GET /folder/{folderId}/list?archived=false when folderId is set',
      inputSchema: ListListsInputSchema,
      run: (context) =>
        guarded(context, async () => {
          const input = ListListsInputSchema.parse(context.input);
          const folderId = input.folderId;
          if (folderId) {
            const items = await withDiscoveryScope('folder', folderId, () =>
              clientFor(context).listListsInFolder(folderId),
            );
            return {
              lists: items.map((item) => normalizeNavItem(item, { spaceId: input.spaceId, folderId })),
            };
          }
          const items = await withDiscoveryScope('space', input.spaceId, () =>
            clientFor(context).listListsInSpace(input.spaceId),
          );
          return { lists: items.map((item) => normalizeNavItem(item, { spaceId: input.spaceId })) };
        }),
    },
  ],

  verification: {
    kind: 'hmac-sha256',
    header: 'X-Signature',
    encoding: 'hex',
  },

  parseDelivery(rawBody) {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new ConnectorDeliveryParseError('ClickUp delivery body is not valid JSON.');
    }
    const parsed = ClickUpDeliverySchema.safeParse(json);
    if (!parsed.success) {
      throw new ConnectorDeliveryParseError(
        `ClickUp delivery body is not a webhook payload: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    const body = parsed.data;
    const history = body.history_items?.[0];
    const rawDate = history?.date;
    const occurredAt = (() => {
      if (rawDate === undefined) return undefined;
      const ms = typeof rawDate === 'number' ? rawDate : Number(rawDate);
      if (!Number.isFinite(ms)) return undefined;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    })();

    return {
      eventKey: body.event,
      providerEventId: history?.id === undefined ? undefined : String(history.id),
      ...(occurredAt ? { occurredAt } : {}),
      data: body as Record<string, unknown>,
    };
  },

  guide: {
    connect:
      'Paste a ClickUp personal API token. Omni calls GET /api/v2/team synchronously; nothing is stored as connected until that succeeds.',
    token:
      'ClickUp: Settings → Apps → API Token → generate. The token acts as the person who created it, so use an account that can see the team you intend to automate.',
    team: 'Optional Team ID. When set, it must appear in GET /team for this token; otherwise the token’s first team is used.',
    personalToken:
      'A personal token is bound to a person. If that person leaves or rotates the token, reconnect the connector — Omni does not refresh it.',
    discovery:
      'Discovery actions walk ClickUp without out-of-band ids: list_spaces (optionally scoped to a team), then list_folders(spaceId), then list_lists(spaceId) or list_lists(spaceId, folderId). Their results share one shape — id, name, archived and the known parent ids — so the listId the task actions need is returned by the connector itself.',
    webhook:
      'Create a ClickUp webhook for the task events you need, point it at the subscription inbound URL, and paste ClickUp’s generated secret into the subscription. ClickUp retries failed deliveries; Omni dedupes redeliveries by history id.',
    error401: '401 means ClickUp rejected the token. Check the token and the account’s team access.',
    error403: '403 means the token is valid but lacks access to the team, list or task.',
    error5xx: '5xx is ClickUp-side. A later action or validation retries; nothing is retried automatically in v1.',
  },
};
