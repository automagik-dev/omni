/**
 * Agent Tasks routes — persistent task history for agents (omni-m7m)
 *
 * @see docs/architecture/actor-model.md — "Agent Task (persistent)"
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const agentTasksRoutes = new Hono<{ Variables: AppVariables }>();

// ---- Shared schemas ----

const agentTaskStatusValues = ['pending', 'running', 'completed', 'failed', 'cancelled', 'waiting_input'] as const;

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  chatId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  status: z.enum(agentTaskStatusValues).optional(),
  type: z.string().max(100).optional(),
  parentTaskId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50).optional(),
  cursor: z.string().optional(),
});

const createTaskSchema = z.object({
  agentId: z.string().uuid(),
  chatId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),

  type: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().optional(),

  status: z.enum(agentTaskStatusValues).default('pending').optional(),
  progress: z.number().int().min(0).max(100).default(0).optional(),
  priority: z.number().int().default(0).optional(),

  metadata: z.record(z.string(), z.unknown()).default({}).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  parentTaskId: z.string().uuid().optional(),
});

const updateTaskSchema = z.object({
  status: z.enum(agentTaskStatusValues).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
});

// ---- Routes ----

/**
 * GET /agent-tasks — list with filters
 */
agentTasksRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.agentTasks.list(query);

  return c.json(result);
});

/**
 * POST /agent-tasks — create a task
 */
agentTasksRoutes.post('/', zValidator('json', createTaskSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const task = await services.agentTasks.create(data);

  return c.json({ data: task }, 201);
});

/**
 * GET /agent-tasks/:id — get by id
 */
agentTasksRoutes.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  const task = await services.agentTasks.getById(id);

  return c.json({ data: task });
});

/**
 * PATCH /agent-tasks/:id — update status, progress, metadata, result
 *
 * Status transitions that have dedicated lifecycle methods use those methods
 * to emit the correct typed event (e.g. agent.task.cancelled instead of
 * agent.task.updated).
 */
agentTasksRoutes.patch('/:id', zValidator('param', idParamSchema), zValidator('json', updateTaskSchema), async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const services = c.get('services');

  const task =
    data.status === 'cancelled' ? await services.agentTasks.cancelTask(id) : await services.agentTasks.update(id, data);

  return c.json({ data: task });
});

/**
 * DELETE /agent-tasks/:id — delete a task
 */
agentTasksRoutes.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const services = c.get('services');

  await services.agentTasks.delete(id);

  return c.json({ success: true });
});

export { agentTasksRoutes };
