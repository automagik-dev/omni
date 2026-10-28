/**
 * OpenAPI schemas for the ClickUp action route (issue #1413).
 *
 * `POST /instances/{id}/clickup/actions` is ClickUp's only runtime surface: the
 * request is the shared `ClickUpActionRequestSchema` (validated by the same
 * zValidator the route uses), and the response is the normalized task/comment
 * shape — never raw ClickUp JSON and never the API token.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { ClickUpActionRequestSchema } from '@omni/channel-clickup/types';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const ClickUpTaskSchema = z.object({
  id: z.string().openapi({ description: 'ClickUp task id' }),
  name: z.string(),
  url: z.string().optional().openapi({ description: 'ClickUp task URL' }),
  status: z.string().optional().openapi({ description: 'Current status label' }),
  listId: z.string().openapi({ description: 'List the task belongs to' }),
});

const ClickUpCommentSchema = z.object({
  id: z.string().openapi({ description: 'ClickUp comment id' }),
  text: z.string().optional(),
});

const ClickUpActionResultSchema = z
  .union([ClickUpTaskSchema, ClickUpCommentSchema, z.object({ tasks: z.array(ClickUpTaskSchema) })])
  .openapi({
    description:
      'Normalized action result: a task for create_task/update_status, a comment for add_comment, ' +
      'and { tasks } for list_tasks',
  });

export function registerClickUpSchemas(registry: OpenAPIRegistry): void {
  registry.register('ClickUpActionRequest', ClickUpActionRequestSchema);
  registry.register('ClickUpActionResult', ClickUpActionResultSchema);

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/clickup/actions',
    operationId: 'runClickUpAction',
    tags: ['Instances'],
    summary: 'Run a ClickUp action',
    description:
      'Runs one task action on a connected ClickUp instance: create_task, update_status, add_comment or ' +
      'list_tasks. ClickUp is not a messaging channel; no chat message is sent or received. The response ' +
      'never includes the instance API token.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Instance UUID' }) }),
      body: { content: { 'application/json': { schema: ClickUpActionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Action result',
        content: { 'application/json': { schema: z.object({ data: ClickUpActionResultSchema }) } },
      },
      400: {
        description: 'Invalid action, or the instance is not a ClickUp instance',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: {
        description: 'ClickUp API error (ClickUp rejected the request or was unreachable)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });
}
