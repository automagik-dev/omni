/**
 * OpenAPI schemas for follow-up config endpoints.
 *
 * Exposes GET/PUT/DELETE of `followUpConfig` at three scopes (agent, instance,
 * chat). The body is the `FollowUpSequenceConfig` shape defined in
 * `packages/core/src/schemas/follow-up.ts`.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

const FixedScheduleSchema = z
  .object({
    kind: z.literal('fixed'),
    intervalsMinutes: z
      .array(z.number().positive())
      .min(1)
      .openapi({ description: 'Minutes between successive follow-ups, in order.' }),
  })
  .openapi({ description: 'Fixed-list schedule: each follow-up fires after the corresponding interval.' });

const ExponentialScheduleSchema = z
  .object({
    kind: z.literal('exponential'),
    initialMinutes: z.number().positive().openapi({ description: 'First interval (minutes).' }),
    factor: z.number().gt(1).openapi({ description: 'Multiplier applied each iteration.' }),
    maxMinutes: z.number().positive().openapi({ description: 'Upper bound on any single interval.' }),
  })
  .openapi({ description: 'Exponential schedule with a per-interval cap.' });

export const FollowUpScheduleOpenApiSchema = z.union([FixedScheduleSchema, ExponentialScheduleSchema]);

export const FollowUpSequenceConfigOpenApiSchema = z
  .object({
    enabled: z.boolean().openapi({ description: 'Master switch — false turns off follow-ups at this scope.' }),
    schedule: FollowUpScheduleOpenApiSchema,
    maxFollowUps: z
      .number()
      .int()
      .positive()
      .max(50)
      .openapi({ description: 'Hard cap on follow-ups fired per sequence.' }),
    promptTemplate: z
      .string()
      .min(1)
      .openapi({ description: 'Template rendered into the synthetic prompt sent to the agent.' }),
    stopOutsideMessagingWindow: z
      .boolean()
      .openapi({ description: 'On WhatsApp BSP/Cloud, disarm when last inbound is > 24h old.' }),
    showTypingIndicator: z
      .boolean()
      .openapi({ description: 'Emit a 2–3s typing/presence indicator before firing on supported channels.' }),
  })
  .openapi({ description: 'Follow-up sequence configuration.' });

const idParam = z.object({ id: z.string().uuid().openapi({ description: 'Entity UUID' }) });

const dataSchema = z.object({
  data: FollowUpSequenceConfigOpenApiSchema.nullable().openapi({
    description: 'The stored config at this scope, or null if unset.',
  }),
});

export function registerFollowUpSchemas(registry: OpenAPIRegistry): void {
  registry.register('FollowUpSequenceConfig', FollowUpSequenceConfigOpenApiSchema);

  for (const [scope, tag, subject] of [
    ['agents', 'Follow-up', 'agent'],
    ['instances', 'Follow-up', 'instance'],
    ['chats', 'Follow-up', 'chat'],
  ] as const) {
    registry.registerPath({
      method: 'get',
      path: `/follow-up/${scope}/{id}`,
      operationId: `getFollowUpConfigFor${subject.charAt(0).toUpperCase()}${subject.slice(1)}`,
      tags: [tag],
      summary: `Get follow-up config for an ${subject}`,
      description: `Returns the \`followUpConfig\` stored at the ${subject} scope, or null if unset.`,
      request: { params: idParam },
      responses: {
        200: { description: 'Current config', content: { 'application/json': { schema: dataSchema } } },
        404: { description: `${subject} not found`, content: { 'application/json': { schema: ErrorSchema } } },
      },
    });

    registry.registerPath({
      method: 'put',
      path: `/follow-up/${scope}/{id}`,
      operationId: `setFollowUpConfigFor${subject.charAt(0).toUpperCase()}${subject.slice(1)}`,
      tags: [tag],
      summary: `Set follow-up config for an ${subject}`,
      description: `Replaces the \`followUpConfig\` stored at the ${subject} scope.`,
      request: {
        params: idParam,
        body: { content: { 'application/json': { schema: FollowUpSequenceConfigOpenApiSchema } } },
      },
      responses: {
        200: { description: 'Config updated', content: { 'application/json': { schema: dataSchema } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
        404: { description: `${subject} not found`, content: { 'application/json': { schema: ErrorSchema } } },
      },
    });

    registry.registerPath({
      method: 'delete',
      path: `/follow-up/${scope}/{id}`,
      operationId: `unsetFollowUpConfigFor${subject.charAt(0).toUpperCase()}${subject.slice(1)}`,
      tags: [tag],
      summary: `Clear follow-up config for an ${subject}`,
      description: `Removes the override at the ${subject} scope so broader scopes apply.`,
      request: { params: idParam },
      responses: {
        200: { description: 'Override cleared', content: { 'application/json': { schema: SuccessSchema } } },
        404: { description: `${subject} not found`, content: { 'application/json': { schema: ErrorSchema } } },
      },
    });
  }
}
