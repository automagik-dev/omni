/**
 * OpenAPI schemas for the event schema registry (issue #959, RFC #925 G1).
 *
 * Like the webhook definitions, these are the ONE Zod source: the route
 * validators import them, so the published OpenAPI document and the runtime
 * validation cannot drift.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

/** Event types are dot-separated tokens (`custom.github.push`). */
const EVENT_TYPE_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

export const EventSchemaSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Registration UUID' }),
  eventType: z.string().openapi({ description: 'Event type the schema governs (e.g. custom.github.push)' }),
  version: z.number().int().openapi({ description: 'Revision counter; bumps on each compatible replacement' }),
  schema: z.record(z.string(), z.unknown()).openapi({ description: 'JSON Schema (draft-07) artifact, stored as-is' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  enabled: z.boolean().openapi({ description: 'Whether the validation gate is active for this type' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

export const RegisterEventSchemaSchema = z.object({
  eventType: z
    .string()
    .min(3)
    .max(150)
    .regex(EVENT_TYPE_PATTERN, 'Event type must be dot-separated lowercase tokens (e.g. custom.github.push)')
    .openapi({ description: 'Event type to register the schema for (e.g. custom.github.push)' }),
  schema: z
    .record(z.string(), z.unknown())
    .openapi({ description: 'JSON Schema (draft-07) the payload must satisfy. Stored as-is' }),
  description: z.string().max(1000).optional().openapi({ description: 'Description' }),
  enabled: z.boolean().optional().openapi({ description: 'Whether the validation gate is active (default true)' }),
});

export function registerEventSchemaSchemas(registry: OpenAPIRegistry): void {
  registry.register('EventSchema', EventSchemaSchema);
  registry.register('RegisterEventSchemaRequest', RegisterEventSchemaSchema);

  registry.registerPath({
    method: 'get',
    path: '/events/schemas',
    operationId: 'listEventSchemas',
    tags: ['Events'],
    summary: 'List registered event schemas',
    description: 'Get every event type with a registered payload schema. The registry is opt-in per type.',
    request: { query: z.object({ enabled: z.boolean().optional().openapi({ description: 'Filter by enabled' }) }) },
    responses: {
      200: {
        description: 'List of registered schemas',
        content: { 'application/json': { schema: z.object({ items: z.array(EventSchemaSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/schemas/{eventType}',
    operationId: 'getEventSchema',
    tags: ['Events'],
    summary: 'Get a registered event schema',
    description: 'Get the stored JSON Schema artifact for one event type.',
    request: {
      params: z.object({
        eventType: z.string().openapi({ description: 'Event type (e.g. custom.github.push)' }),
      }),
    },
    responses: {
      200: {
        description: 'Registered schema',
        content: { 'application/json': { schema: z.object({ data: EventSchemaSchema }) } },
      },
      404: {
        description: 'No schema registered for this type',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/schemas',
    operationId: 'registerEventSchema',
    tags: ['Events'],
    summary: 'Register or revise an event schema',
    description:
      'Register a JSON Schema for an event type. Once registered, the webhook ingress and automation ' +
      'emit_event validate payloads of this type before publishing; invalid payloads are dead-lettered with ' +
      'reason schema_validation_failed. Revising an existing registration must be additive-optional ' +
      '(the evolution rule) — an incompatible change is refused with 409 and must ship as a new versioned ' +
      'event type (e.g. custom.github.push.v2).',
    request: { body: { content: { 'application/json': { schema: RegisterEventSchemaSchema } } } },
    responses: {
      201: {
        description: 'Schema registered (or compatibly revised)',
        content: { 'application/json': { schema: z.object({ data: EventSchemaSchema }) } },
      },
      400: { description: 'Not a valid JSON Schema', content: { 'application/json': { schema: ErrorSchema } } },
      409: {
        description: 'Incompatible schema change refused (evolution rule)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });
}
