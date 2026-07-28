/**
 * Agent Task Service — persistent task history for agents (omni-m7m)
 *
 * @see docs/architecture/actor-model.md — "Agent Task (persistent)"
 */

import type { EventBus } from '@omni/core';
import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';

const log = createLogger('services:agent-tasks');
import { type AgentTask, type AgentTaskStatus, type NewAgentTask, agentTasks } from '@omni/db';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';

export interface ListAgentTasksOptions {
  agentId?: string;
  chatId?: string;
  conversationId?: string;
  status?: string | string[];
  type?: string;
  parentTaskId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListAgentTasksResult {
  items: AgentTask[];
  hasMore: boolean;
  cursor?: string;
}

/**
 * AgentTaskService — CRUD + lifecycle helpers for agent_tasks rows
 */
export class AgentTaskService {
  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Create a new agent task
   */
  async create(data: NewAgentTask): Promise<AgentTask> {
    const [created] = await this.db.insert(agentTasks).values(data).returning();

    if (!created) {
      throw new Error('Failed to create agent task');
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'agent.task.created',
          {
            taskId: created.id,
            agentId: created.agentId,
            chatId: created.chatId,
            conversationId: created.conversationId ?? null,
            type: created.type,
            title: created.title,
            status: created.status,
          },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish agent.task.created', { error: String(err) }));
    }

    return created;
  }

  /**
   * Get a task by ID — throws NotFoundError if missing
   */
  async getById(id: string): Promise<AgentTask> {
    const [result] = await this.db.select().from(agentTasks).where(eq(agentTasks.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('AgentTask', id);
    }

    return result;
  }

  /** Check that a cursor task belongs to the same filter scope — prevents cross-scope pagination leaks */
  private cursorMatchesFilters(cursorTask: AgentTask, options: ListAgentTasksOptions): boolean {
    const { agentId, chatId, conversationId, status, type, parentTaskId } = options;
    if (agentId && cursorTask.agentId !== agentId) return false;
    if (chatId && cursorTask.chatId !== chatId) return false;
    if (conversationId && cursorTask.conversationId !== conversationId) return false;
    if (type && cursorTask.type !== type) return false;
    if (parentTaskId && cursorTask.parentTaskId !== parentTaskId) return false;
    if (status) {
      const statusList = Array.isArray(status) ? status : [status];
      if (!statusList.includes(cursorTask.status)) return false;
    }
    return true;
  }

  /**
   * List tasks with filtering and cursor-based pagination
   */
  async list(options: ListAgentTasksOptions = {}): Promise<ListAgentTasksResult> {
    const { agentId, chatId, conversationId, status, type, parentTaskId, limit = 50, cursor } = options;

    const conditions = [];

    if (agentId) {
      conditions.push(eq(agentTasks.agentId, agentId));
    }

    if (chatId) {
      conditions.push(eq(agentTasks.chatId, chatId));
    }

    if (conversationId) {
      conditions.push(eq(agentTasks.conversationId, conversationId));
    }

    if (status) {
      const statusList = (Array.isArray(status) ? status : [status]) as AgentTaskStatus[];
      conditions.push(inArray(agentTasks.status, statusList));
    }

    if (type) {
      conditions.push(eq(agentTasks.type, type));
    }

    if (parentTaskId) {
      conditions.push(eq(agentTasks.parentTaskId, parentTaskId));
    }

    if (cursor) {
      const cursorTask = await this.getById(cursor);
      if (this.cursorMatchesFilters(cursorTask, options)) {
        // Composite keyset pagination: avoid duplicates when multiple rows share the same createdAt.
        // Order is (createdAt DESC, id DESC), so the next page starts after rows where either:
        //   - createdAt is strictly older, OR
        //   - createdAt is the same but id is strictly smaller
        conditions.push(
          or(
            lt(agentTasks.createdAt, cursorTask.createdAt),
            and(eq(agentTasks.createdAt, cursorTask.createdAt), lt(agentTasks.id, cursorTask.id)),
          ),
        );
      }
      // If cursor doesn't match filters, silently ignore it and return first page
    }

    let query = this.db.select().from(agentTasks).$dynamic();

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(desc(agentTasks.createdAt), desc(agentTasks.id)).limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];

    return {
      items,
      hasMore,
      cursor: lastItem?.id,
    };
  }

  /**
   * Update a task — generic partial update
   */
  async update(id: string, data: Partial<NewAgentTask>): Promise<AgentTask> {
    const [updated] = await this.db.update(agentTasks).set(data).where(eq(agentTasks.id, id)).returning();

    if (!updated) {
      throw new NotFoundError('AgentTask', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'agent.task.updated',
          {
            taskId: updated.id,
            agentId: updated.agentId,
            chatId: updated.chatId,
            status: updated.status,
            progress: updated.progress,
          },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish agent.task.updated', { error: String(err) }));
    }

    return updated;
  }

  /**
   * Delete a task (hard delete)
   */
  async delete(id: string): Promise<void> {
    const [deleted] = await this.db.delete(agentTasks).where(eq(agentTasks.id, id)).returning({ id: agentTasks.id });

    if (!deleted) {
      throw new NotFoundError('AgentTask', id);
    }
  }

  /**
   * Transition a task to running — sets status=running, startedAt=now
   */
  async startTask(id: string): Promise<AgentTask> {
    return this.update(id, {
      status: 'running',
      startedAt: new Date(),
    });
  }

  /**
   * Transition a task to completed — sets status=completed, completedAt=now, result
   */
  async completeTask(id: string, result?: Record<string, unknown>): Promise<AgentTask> {
    const updateData: Partial<NewAgentTask> = {
      status: 'completed',
      progress: 100,
      completedAt: new Date(),
    };

    if (result !== undefined) {
      updateData.result = result;
    }

    const [updated] = await this.db.update(agentTasks).set(updateData).where(eq(agentTasks.id, id)).returning();

    if (!updated) {
      throw new NotFoundError('AgentTask', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'agent.task.completed',
          {
            taskId: updated.id,
            agentId: updated.agentId,
            chatId: updated.chatId,
            result: (updated.result as Record<string, unknown> | null) ?? null,
          },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish agent.task.completed', { error: String(err) }));
    }

    return updated;
  }

  /**
   * Transition a task to failed — sets status=failed, completedAt=now, error
   */
  async failTask(id: string, error: string): Promise<AgentTask> {
    const [updated] = await this.db
      .update(agentTasks)
      .set({
        status: 'failed',
        completedAt: new Date(),
        error,
      })
      .where(eq(agentTasks.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AgentTask', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'agent.task.failed',
          {
            taskId: updated.id,
            agentId: updated.agentId,
            chatId: updated.chatId,
            error,
          },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish agent.task.failed', { error: String(err) }));
    }

    return updated;
  }

  /**
   * Transition a task to cancelled — sets status=cancelled, completedAt=now
   */
  async cancelTask(id: string): Promise<AgentTask> {
    const [updated] = await this.db
      .update(agentTasks)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(agentTasks.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AgentTask', id);
    }

    if (this.eventBus) {
      this.eventBus
        .publish(
          'agent.task.cancelled',
          {
            taskId: updated.id,
            agentId: updated.agentId,
            chatId: updated.chatId,
          },
          { instanceId: undefined },
        )
        .catch((err) => log.warn('Failed to publish agent.task.cancelled', { error: String(err) }));
    }

    return updated;
  }
}
