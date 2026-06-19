/**
 * A2A task store backed by PluginStorage when the channel is initialized.
 *
 * The in-memory fallback exists for unit tests and early plugin construction;
 * runtime API initialization replaces it with database-backed storage.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import type { A2AArtifact, A2AMessage, A2APart, A2ATask, A2ATaskState } from './types';

const TASK_KEY_PREFIX = 'a2a-tasks';

interface ListTasksOptions {
  contextId?: string;
  status?: A2ATaskState;
  callerKey?: string;
  historyLength?: number;
  statusTimestampAfter?: string;
  includeArtifacts?: boolean;
  pageSize?: number;
  pageToken?: string;
}

function taskKey(instanceId: string, taskId: string): string {
  return `${TASK_KEY_PREFIX}/${instanceId}/${taskId}`;
}

function isTerminal(state: A2ATaskState): boolean {
  return (
    state === 'TASK_STATE_COMPLETED' ||
    state === 'TASK_STATE_FAILED' ||
    state === 'TASK_STATE_CANCELED' ||
    state === 'TASK_STATE_REJECTED' ||
    state === 'completed' ||
    state === 'failed' ||
    state === 'canceled'
  );
}

export class A2ATaskStore {
  private readonly memory = new Map<string, A2ATask>();
  private storage: PluginStorage | undefined;

  constructor(storage?: PluginStorage) {
    this.storage = storage;
  }

  setStorage(storage: PluginStorage): void {
    this.storage = storage;
  }

  async createTask(params: {
    instanceId: string;
    taskId: string;
    contextId: string;
    message: A2AMessage;
    metadata?: Record<string, unknown>;
  }): Promise<A2ATask> {
    const now = new Date().toISOString();
    const task: A2ATask = {
      id: params.taskId,
      contextId: params.contextId,
      status: {
        state: 'TASK_STATE_WORKING',
        timestamp: now,
      },
      history: [params.message],
      artifacts: [],
      createdAt: now,
      lastModified: now,
      metadata: {
        ...(params.metadata ?? {}),
        instanceId: params.instanceId,
        createdAt: now,
        updatedAt: now,
      },
    };

    await this.set(params.instanceId, params.taskId, task);
    return task;
  }

  async appendMessage(params: {
    instanceId: string;
    taskId: string;
    contextId: string;
    message: A2AMessage;
    metadata?: Record<string, unknown>;
  }): Promise<A2ATask | null> {
    const task = await this.get(params.instanceId, params.taskId);
    if (!task) return null;

    const now = new Date().toISOString();
    const updated: A2ATask = {
      ...task,
      contextId: task.contextId ?? params.contextId,
      status: {
        state: 'TASK_STATE_WORKING',
        timestamp: now,
        message: params.message,
      },
      history: [...(task.history ?? []), params.message],
      lastModified: now,
      metadata: {
        ...(task.metadata ?? {}),
        ...(params.metadata ?? {}),
        instanceId: params.instanceId,
        updatedAt: now,
      },
    };

    await this.set(params.instanceId, params.taskId, updated);
    return updated;
  }

  async getTask(instanceId: string, taskId: string): Promise<A2ATask | null> {
    return this.get(instanceId, taskId);
  }

  async listTasks(
    instanceId: string,
    options: ListTasksOptions = {},
  ): Promise<{ tasks: A2ATask[]; nextPageToken: string; pageSize: number; totalSize: number }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
    const keys = await this.keys(instanceId);
    const tasks: A2ATask[] = [];
    const allTasks = await Promise.all(
      keys.map((key) => {
        const taskId = key.split('/').pop();
        return taskId ? this.get(instanceId, taskId) : Promise.resolve(null);
      }),
    );

    for (const task of allTasks) {
      if (!task) continue;
      if (!taskMatchesListOptions(task, options)) continue;
      tasks.push(task);
    }

    tasks.sort((a, b) => {
      const aTime = String(a.lastModified ?? a.metadata?.updatedAt ?? a.status.timestamp ?? '');
      const bTime = String(b.lastModified ?? b.metadata?.updatedAt ?? b.status.timestamp ?? '');
      return bTime.localeCompare(aTime);
    });

    const offset = Number.parseInt(options.pageToken ?? '0', 10);
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const page = tasks.slice(start, start + pageSize).map((task) => shapeListTask(task, options));
    const nextOffset = start + page.length;

    return {
      tasks: page,
      nextPageToken: nextOffset < tasks.length ? String(nextOffset) : '',
      pageSize,
      totalSize: tasks.length,
    };
  }

  async appendArtifact(instanceId: string, taskId: string, text: string): Promise<A2ATask | null> {
    const task = await this.get(instanceId, taskId);
    if (!task || isTerminal(task.status.state)) return task;

    const now = new Date().toISOString();
    const artifacts = task.artifacts ?? [];
    const artifact: A2AArtifact = {
      artifactId: `artifact-${artifacts.length + 1}`,
      parts: [textPart(text)],
    };

    const updated: A2ATask = {
      ...task,
      status: { state: 'TASK_STATE_WORKING', timestamp: now },
      artifacts: [...artifacts, artifact],
      lastModified: now,
      metadata: { ...(task.metadata ?? {}), updatedAt: now },
    };

    await this.set(instanceId, taskId, updated);
    return updated;
  }

  async updateStatus(
    instanceId: string,
    taskId: string,
    state: A2ATaskState,
    message?: A2AMessage,
  ): Promise<A2ATask | null> {
    const task = await this.get(instanceId, taskId);
    if (!task) return null;

    const now = new Date().toISOString();
    const history = message ? [...(task.history ?? []), message] : task.history;
    const updated: A2ATask = {
      ...task,
      status: { state, timestamp: now, ...(message ? { message } : {}) },
      history,
      lastModified: now,
      metadata: { ...(task.metadata ?? {}), updatedAt: now },
    };

    await this.set(instanceId, taskId, updated);
    return updated;
  }

  async cancelTask(instanceId: string, taskId: string): Promise<A2ATask | null> {
    return this.updateStatus(instanceId, taskId, 'TASK_STATE_CANCELED');
  }

  private async get(instanceId: string, taskId: string): Promise<A2ATask | null> {
    const key = taskKey(instanceId, taskId);
    if (this.storage) {
      return this.storage.get<A2ATask>(key);
    }
    return this.memory.get(key) ?? null;
  }

  private async set(instanceId: string, taskId: string, task: A2ATask): Promise<void> {
    const key = taskKey(instanceId, taskId);
    if (this.storage) {
      await this.storage.set(key, task);
      return;
    }
    this.memory.set(key, task);
  }

  private async keys(instanceId: string): Promise<string[]> {
    const pattern = `${TASK_KEY_PREFIX}/${instanceId}/*`;
    if (this.storage) {
      return this.storage.keys(pattern);
    }
    const prefix = `${TASK_KEY_PREFIX}/${instanceId}/`;
    return Array.from(this.memory.keys()).filter((key) => key.startsWith(prefix));
  }
}

export function textPart(text: string): A2APart {
  return { text, mediaType: 'text/plain' };
}

export function taskIsTerminal(task: A2ATask): boolean {
  return isTerminal(task.status.state);
}

function shapeListTask(task: A2ATask, options: { historyLength?: number; includeArtifacts?: boolean }): A2ATask {
  return {
    ...task,
    artifacts: options.includeArtifacts ? task.artifacts : [],
    history: trimHistory(task.history, options.historyLength),
  };
}

function trimHistory(history: A2AMessage[] | undefined, historyLength?: number): A2AMessage[] | undefined {
  if (historyLength === undefined) return history;
  if (historyLength <= 0) return [];
  return history?.slice(-historyLength) ?? [];
}

function taskMatchesListOptions(task: A2ATask, options: ListTasksOptions): boolean {
  if (options.callerKey && task.metadata?.callerKey !== options.callerKey) return false;
  if (options.contextId && task.contextId !== options.contextId) return false;
  if (options.status && task.status.state !== options.status) return false;
  if (options.statusTimestampAfter && String(task.status.timestamp ?? '') <= options.statusTimestampAfter) return false;
  return true;
}
