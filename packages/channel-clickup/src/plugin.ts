/**
 * ClickUp channel plugin (issue #1413)
 *
 * A transport-less channel whose surface is ClickUp API v2: connect validates
 * a personal API token with `GET /team`, and every subsequent operation goes
 * through `execute()` (task creation, status update, comment, list). It
 * deliberately does NOT send or receive chat messages — `sendMessage()` refuses
 * with a readable error so a misrouted dispatcher learns why instead of
 * silently dropping the turn.
 *
 * Credentials live in an in-memory map only after a successful connect. The
 * persisted copy is the sealed `instances.clickup_api_token` column, which the
 * API re-reads on connect/restart; a process restart therefore reconnects from
 * the row, never from a cached secret.
 */

import { BaseChannelPlugin } from '@omni/channel-sdk';
import type { ChannelCapabilities, InstanceConfig, OutgoingMessage, SendResult } from '@omni/channel-sdk';
import type { ChannelType } from '@omni/core/types';
import { CLICKUP_CHANNEL_CAPABILITIES, CLICKUP_TASK_CAPABILITIES } from './capabilities';
import { ClickUpApiClient } from './client';
import type { ClickUpClientOptions } from './client';
import { ClickUpError } from './errors';
import {
  type ClickUpActionRequest,
  ClickUpActionRequestSchema,
  type ClickUpActionResult,
  type ClickUpApiTask,
  type ClickUpComment,
  ClickUpConnectOptionsSchema,
  type ClickUpCredentials,
  type ClickUpTask,
} from './types';

/** Injectable transport settings shared by every instance of this plugin. */
export type ClickUpPluginOptions = Omit<ClickUpClientOptions, 'token'>;

const NOT_A_MESSAGING_CHANNEL = 'ClickUp is not a messaging channel. Use ClickUp actions to create or update tasks.';

export class ClickUpChannelPlugin extends BaseChannelPlugin {
  readonly id: ChannelType = 'clickup';
  readonly name = 'ClickUp';
  readonly version = '0.1.0';
  readonly capabilities: ChannelCapabilities = CLICKUP_CHANNEL_CAPABILITIES;
  /** The ClickUp capability set — task actions, never messaging. */
  readonly taskCapabilities = CLICKUP_TASK_CAPABILITIES;

  private readonly clientOptions: ClickUpPluginOptions;
  /** instanceId → validated credentials. Populated only after a successful connect. */
  private readonly credentials = new Map<string, ClickUpCredentials>();

  constructor(options: ClickUpPluginOptions = {}) {
    super();
    this.clientOptions = options;
  }

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const parsed = ClickUpConnectOptionsSchema.safeParse(config.options ?? {});
    if (!parsed.success) {
      const message = `Invalid ClickUp connection options: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')}`;
      await this.markDisconnected(instanceId, config, message);
      throw new ClickUpError('INVALID_REQUEST', message);
    }

    const { token, teamId, listId } = resolveConnectValues(parsed.data);
    if (!token) {
      const message = 'ClickUp connection needs an API token: pass token (or clickupApiToken).';
      await this.markDisconnected(instanceId, config, message);
      throw new ClickUpError('INVALID_REQUEST', message);
    }

    const client = new ClickUpApiClient({ ...this.clientOptions, token });
    try {
      const teams = await client.getTeams();
      const team = teamId ? teams.find((candidate) => candidate.id === teamId) : teams[0];
      if (teamId && !team) {
        throw new ClickUpError(
          'TEAM_NOT_FOUND',
          `ClickUp team ${teamId} is not available for this API token. Check the team id, or leave it empty to use the token's first team.`,
        );
      }
      if (!team) {
        throw new ClickUpError(
          'TEAM_NOT_FOUND',
          'ClickUp returned no teams for this API token. The token must belong to a ClickUp team with access.',
        );
      }

      // Store only after success: a failed validation must not leave a cached token.
      this.credentials.set(instanceId, { token, teamId: team.id, ...(listId ? { listId } : {}) });
      await this.updateInstanceStatus(instanceId, config, {
        state: 'connected',
        since: new Date(),
        message: `Connected to ${team.name}`,
      });
      await this.emitInstanceConnected(instanceId, {
        profileName: team.name,
        ownerIdentifier: team.id,
        teamId: team.id,
      });
    } catch (error) {
      this.credentials.delete(instanceId);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.markDisconnected(instanceId, config, message);
      throw error;
    }
  }

  async disconnect(instanceId: string): Promise<void> {
    this.credentials.delete(instanceId);
    const entry = this.instances.get(instanceId);
    if (entry) {
      await this.updateInstanceStatus(instanceId, entry.config, {
        state: 'disconnected',
        since: new Date(),
      });
    }
    await this.emitInstanceDisconnected(instanceId, 'Disconnected');
    this.instances.remove(instanceId);
  }

  // ─────────────────────────────────────────────────────────────
  // Messaging — intentionally unsupported
  // ─────────────────────────────────────────────────────────────

  async sendMessage(_instanceId: string, _message: OutgoingMessage): Promise<SendResult> {
    // Not an error: a caller may probe every channel the same way. The result
    // says exactly why nothing was sent, and no event is emitted.
    return { success: false, error: NOT_A_MESSAGING_CHANNEL, timestamp: Date.now() };
  }

  // ─────────────────────────────────────────────────────────────
  // Actions — the only ClickUp surface
  // ─────────────────────────────────────────────────────────────

  /**
   * Run one ClickUp task action. `request` is re-validated here so a caller
   * that bypasses the API route (an automation callback, a test) gets the same
   * readable boundary error instead of a raw TypeError.
   */
  async execute(instanceId: string, request: ClickUpActionRequest): Promise<ClickUpActionResult> {
    const parsed = ClickUpActionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ClickUpError(
        'INVALID_REQUEST',
        `Invalid ClickUp action: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const action = parsed.data;
    const credentials = this.credentials.get(instanceId);
    if (!credentials) {
      throw new ClickUpError(
        'NOT_CONNECTED',
        'ClickUp channel is not connected. Connect the instance with a ClickUp API token first.',
      );
    }

    const client = new ClickUpApiClient({ ...this.clientOptions, token: credentials.token });

    switch (action.operation) {
      case 'create_task': {
        const name = requireValue(action.name, 'MISSING_TASK', 'ClickUp create task needs a name.');
        const listId = requireListId(action.listId, credentials, 'create task');
        const body: Record<string, unknown> = { name };
        if (action.description !== undefined) body.description = action.description;
        if (action.assignees !== undefined) body.assignees = action.assignees;
        if (action.dueDate !== undefined) body.due_date = toDueDateMs(action.dueDate);
        const task = await client.createTask(listId, body);
        return normalizeTask(task, listId);
      }
      case 'update_status': {
        const taskId = requireValue(action.taskId, 'MISSING_TASK', 'ClickUp update status needs a task id.');
        const status = requireValue(action.status, 'INVALID_REQUEST', 'ClickUp update status needs a status.');
        const task = await client.updateTask(taskId, { status });
        return normalizeTask(task, credentials.listId ?? '');
      }
      case 'add_comment': {
        const taskId = requireValue(action.taskId, 'MISSING_TASK', 'ClickUp add comment needs a task id.');
        const comment = requireValue(action.comment, 'INVALID_REQUEST', 'ClickUp add comment needs a comment.');
        const created = await client.addComment(taskId, {
          comment_text: comment,
          ...(action.notifyAll === true ? { notify_all: true } : {}),
        });
        return normalizeComment(created);
      }
      case 'list_tasks': {
        const listId = requireListId(action.listId, credentials, 'list tasks');
        const tasks = await client.listTasks(listId);
        return { tasks: tasks.map((task) => normalizeTask(task, listId)) };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────

  private async markDisconnected(instanceId: string, config: InstanceConfig, message: string): Promise<void> {
    await this.updateInstanceStatus(instanceId, config, {
      state: 'disconnected',
      since: new Date(),
      message,
    });
  }
}

/** Accept both API-style and persisted-column option spellings. */
function resolveConnectValues(options: {
  token?: string;
  clickupApiToken?: string;
  teamId?: string;
  clickupTeamId?: string;
  listId?: string;
  clickupListId?: string;
}): { token?: string; teamId?: string; listId?: string } {
  return {
    token: options.token ?? options.clickupApiToken,
    teamId: options.teamId ?? options.clickupTeamId,
    listId: options.listId ?? options.clickupListId,
  };
}

function requireValue(value: string | undefined, code: 'MISSING_TASK' | 'INVALID_REQUEST', message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ClickUpError(code, message);
  return value;
}

/**
 * A task action always needs a list: the request's own id wins, then the
 * instance's default. The message names both ways out because that is the
 * operator's actual fix.
 */
function requireListId(listId: string | undefined, credentials: ClickUpCredentials, operation: string): string {
  const resolved = listId ?? credentials.listId;
  if (!resolved) {
    throw new ClickUpError(
      'MISSING_LIST',
      `ClickUp ${operation} needs a list id: pass listId or set a default List ID on the ClickUp channel.`,
    );
  }
  return resolved;
}

/** ClickUp takes Unix milliseconds; accept a number as-is or parse ISO 8601. */
function toDueDateMs(dueDate: number | string): number {
  if (typeof dueDate === 'number') return dueDate;
  const parsed = Date.parse(dueDate);
  if (Number.isNaN(parsed)) {
    throw new ClickUpError(
      'INVALID_REQUEST',
      'ClickUp create task dueDate must be an ISO 8601 date string or a Unix millisecond timestamp.',
    );
  }
  return parsed;
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

function normalizeComment(comment: { id: string; text?: string | null }): ClickUpComment {
  return {
    id: comment.id,
    ...(comment.text ? { text: comment.text } : {}),
  };
}
