/**
 * Agent Task Service — persistent task history for agents (omni-m7m)
 *
 * @see docs/architecture/actor-model.md — "Agent Task (persistent)"
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AgentTask, type NewAgentTask, agentTasks } from '@omni/db';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';

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
  constructor(
    private db: Database,
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
      await this.eventBus.publish(
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
      );
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
      const statusList = Array.isArray(status) ? status : [status];
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
      conditions.push(lte(agentTasks.createdAt, cursorTask.createdAt));
    }

    let query = this.db.select().from(agentTasks).$dynamic();

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(desc(agentTasks.createdAt)).limit(limit + 1);

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
      await this.eventBus.publish(
        'agent.task.updated',
        {
          taskId: updated.id,
          agentId: updated.agentId,
          chatId: updated.chatId,
          status: updated.status,
          progress: updated.progress,
        },
        { instanceId: undefined },
      );
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
      await this.eventBus.publish(
        'agent.task.completed',
        {
          taskId: updated.id,
          agentId: updated.agentId,
          chatId: updated.chatId,
          result: (updated.result as Record<string, unknown> | null) ?? null,
        },
        { instanceId: undefined },
      );
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
      await this.eventBus.publish(
        'agent.task.failed',
        {
          taskId: updated.id,
          agentId: updated.agentId,
          chatId: updated.chatId,
          error,
        },
        { instanceId: undefined },
      );
    }

    return updated;
  }
}
