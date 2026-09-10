/**
 * OpenAPI schemas for durable event consumers (#989, RFC #925 G7).
 *
 * Like the webhook/event-schema definitions, these are the ONE Zod source:
 * the route validators import them, so the published OpenAPI document and
 * the runtime validation cannot drift.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

/** Consumer names are CLI/URL handles: lowercase tokens, dots/dashes/underscores. */
const CONSUMER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** One payload condition — the automation-trigger shape (`events wait --filter` contract). */
export const ConsumerConditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .max(500)
    .openapi({ description: "Dot-notation path into the event's rawPayload (e.g. user.id)" }),
  operator: z
    .enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'not_contains', 'exists', 'not_exists', 'regex'])
    .openapi({ description: 'Comparison operator (same matcher as automation trigger conditions)' }),
  value: z.unknown().optional().openapi({ description: "Comparison value. Ignored for 'exists'/'not_exists'" }),
});

export const DurableConsumerSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Consumer UUID' }),
  name: z.string().openapi({ description: 'Unique consumer name (the follow/ack handle)' }),
  eventType: z.string().openapi({ description: 'Type filter: exact event type or trailing-* prefix glob' }),
  excludeTypes: z
    .array(z.string())
    .nullable()
    .openapi({ description: 'Type globs dropped from the stream (exclusion wins over eventType), or null' }),
  filters: z.array(ConsumerConditionSchema).nullable().openapi({ description: 'Payload conditions (AND), or null' }),
  cursor: z.number().int().openapi({ description: 'Last acked journal_seq; delivery resumes strictly after it' }),
  head: z.number().int().openapi({ description: 'Highest journal_seq currently in the journal' }),
  lag: z.number().int().openapi({ description: 'head - cursor (all journal rows past the cursor, not only matches)' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last cursor/registry update timestamp' }),
});

export const CreateConsumerSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(CONSUMER_NAME_PATTERN, 'Consumer name must be lowercase tokens: a-z 0-9 . _ - (starting alphanumeric)')
    .openapi({ description: 'Unique consumer name (e.g. deploy-tracker)' }),
  eventType: z
    .string()
    .min(1)
    .max(255)
    .openapi({ description: 'Type filter: exact event type, or trailing-* prefix glob (e.g. custom.github.*)' }),
  excludeTypes: z
    .array(z.string().min(1).max(255))
    .max(20)
    .optional()
    .openapi({ description: 'Type globs to drop (same syntax as eventType); exclusion wins over inclusion' }),
  filters: z
    .array(ConsumerConditionSchema)
    .max(20)
    .optional()
    .openapi({ description: 'Payload conditions (AND) — same matcher as events wait --filter' }),
  startFrom: z
    .enum(['now', 'beginning'])
    .optional()
    .openapi({ description: "Initial cursor: 'now' = journal head (default), 'beginning' = full replay" }),
});

export const PullConsumerQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .openapi({ description: 'Max journal rows to scan (default 100)' }),
  waitMs: z.coerce
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .openapi({ description: 'Long-poll: wait up to this long when no rows are available (default 0)' }),
});

export const AckConsumerSchema = z.object({
  cursor: z.coerce.number().int().min(0).openapi({
    description: 'The journal_seq to advance to (a pull result\'s "cursor"). Monotonic: equal = no-op, lower = 400',
  }),
});

const PullResultSchema = z.object({
  consumer: z.string().openapi({ description: 'Consumer name' }),
  items: z
    .array(z.record(z.string(), z.unknown()))
    .openapi({ description: 'Matching journal rows, ascending journal_seq' }),
  cursor: z.number().int().openapi({
    description: 'Highest journal_seq SCANNED (not merely matched) — ack this value to advance past filtered-out rows',
  }),
  head: z.number().int().openapi({ description: 'Journal head at pull time' }),
  hasMore: z.boolean().openapi({ description: 'True when the scan filled the page — more rows are already waiting' }),
});

export function registerEventConsumerSchemas(registry: OpenAPIRegistry): void {
  registry.register('DurableConsumer', DurableConsumerSchema);
  registry.register('CreateConsumerRequest', CreateConsumerSchema);
  registry.register('ConsumerPullResult', PullResultSchema);

  registry.registerPath({
    method: 'get',
    path: '/events/consumers',
    operationId: 'listEventConsumers',
    tags: ['Events'],
    summary: 'List durable event consumers',
    description: 'Every registered durable consumer with its filter, cursor, and live lag (journal head minus cursor).',
    responses: {
      200: {
        description: 'Registered consumers',
        content: { 'application/json': { schema: z.object({ items: z.array(DurableConsumerSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/consumers',
    operationId: 'createEventConsumer',
    tags: ['Events'],
    summary: 'Register a durable event consumer',
    description:
      'Registers a named consumer over the event journal: a type filter (trailing-* prefix glob, the events-wait ' +
      'contract) plus optional payload conditions (the automation-trigger matcher), and a stored cursor. ' +
      "startFrom 'now' (default) begins at the journal head; 'beginning' replays the full journal (projections).",
    request: { body: { content: { 'application/json': { schema: CreateConsumerSchema } } } },
    responses: {
      201: {
        description: 'Consumer registered',
        content: { 'application/json': { schema: z.object({ data: DurableConsumerSchema }) } },
      },
      409: {
        description: 'A consumer with this name already exists',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/consumers/{name}',
    operationId: 'getEventConsumer',
    tags: ['Events'],
    summary: 'Inspect a durable event consumer',
    description: 'The consumer registration plus its live cursor position and lag.',
    request: { params: z.object({ name: z.string().openapi({ description: 'Consumer name' }) }) },
    responses: {
      200: {
        description: 'Consumer with live lag',
        content: { 'application/json': { schema: z.object({ data: DurableConsumerSchema }) } },
      },
      404: { description: 'No such consumer', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/events/consumers/{name}',
    operationId: 'deleteEventConsumer',
    tags: ['Events'],
    summary: 'Delete a durable event consumer',
    description: 'Removes the registration and its cursor. The journal itself is untouched.',
    request: { params: z.object({ name: z.string().openapi({ description: 'Consumer name' }) }) },
    responses: {
      200: {
        description: 'Deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
      },
      404: { description: 'No such consumer', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/consumers/{name}/pull',
    operationId: 'pullEventConsumer',
    tags: ['Events'],
    summary: 'Pull journal events from the stored cursor',
    description:
      'Pages journal events strictly after the stored cursor, in journal_seq order, pre-filtered by the type glob ' +
      'and payload conditions. Does NOT advance the cursor — ack the returned cursor to commit progress ' +
      '(at-least-once: a client that crashes mid-page re-pulls the same page). waitMs long-polls when no rows are available.',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Consumer name' }) }),
      query: PullConsumerQuerySchema,
    },
    responses: {
      200: { description: 'One page of events', content: { 'application/json': { schema: PullResultSchema } } },
      404: { description: 'No such consumer', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/events/consumers/{name}/ack',
    operationId: 'ackEventConsumer',
    tags: ['Events'],
    summary: 'Advance the consumer cursor (monotonic)',
    description:
      "Commits progress up to a pull result's cursor. Monotonic: an ack equal to the stored cursor is an " +
      'idempotent no-op, an ack behind it is refused with 400 — a durable cursor never moves backwards.',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Consumer name' }) }),
      body: { content: { 'application/json': { schema: AckConsumerSchema } } },
    },
    responses: {
      200: {
        description: 'Cursor advanced (or already there)',
        content: { 'application/json': { schema: z.object({ data: DurableConsumerSchema }) } },
      },
      400: { description: 'Ack behind the stored cursor', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'No such consumer', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
