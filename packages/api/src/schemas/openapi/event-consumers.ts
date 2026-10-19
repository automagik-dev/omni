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

/** Access filter values: 'all' = no predicate; 'allowed'/'denied' match omni_events.access_decision. */
const CONSUMER_ACCESS_FILTERS = ['all', 'allowed', 'denied'] as const;

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
  shared: z.boolean().openapi({
    description: 'true = competing consumers (pullers on this name split the stream); false = own cursor (fan-out)',
  }),
  accessFilter: z.enum(CONSUMER_ACCESS_FILTERS).openapi({
    description:
      "Access filter over the ingest access verdict: 'all' (default, every row) or only rows whose " +
      "access_decision is 'allowed' / 'denied'",
  }),
  waitForReady: z.boolean().openapi({
    description:
      'true = opt-in journal readiness gate: claimed-but-unfilled rows are held (not delivered, cursor not moved ' +
      "past them) until filled or older than the settle window; false = today's behaviour",
  }),
  scoped: z.boolean().openapi({
    description:
      'true = instance-scoped consumer (opt-in): pulls only its instanceIds, visible only to its owner key and to ' +
      'instance-unrestricted keys. false (default) = global consumer, unchanged behaviour',
  }),
  instanceIds: z
    .array(z.string().uuid())
    .nullable()
    .openapi({ description: 'Scoped consumers: the instances whose journal rows it pages; null when unscoped' }),
  ownerKeyId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: 'Scoped consumers: id of the API key that registered it; null when unscoped' }),
  head: z.number().int().openapi({ description: 'Highest journal_seq currently in the journal' }),
  lag: z.number().int().openapi({ description: 'head - cursor (all journal rows past the cursor, not only matches)' }),
  caughtUp: z
    .boolean()
    .openapi({ description: 'No type-matching journal row past the cursor (lag may still count other types)' }),
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
  shared: z
    .boolean()
    .optional()
    .openapi({
      description:
        'Competing consumers (#1188). false (default) = fan-out: every consumer name has its own cursor and sees every ' +
        'event. true = N pullers on THIS name split the stream: each pull leases a page to one puller, ack(leaseId) ' +
        'releases it, an unacked lease is redelivered after leaseMs (at-least-once).',
    }),
  access: z
    .enum(CONSUMER_ACCESS_FILTERS)
    .optional()
    .default('all')
    .openapi({
      description:
        "Opt-in access filter. 'all' (default) = every row, unchanged. 'allowed' / 'denied' = only rows whose " +
        'ingest access verdict (omni_events.access_decision) equals it. The verdict is frozen at ingest; call the ' +
        'access check route for the current one. Requires OMNI_JOURNAL_ACCESS_DECISION=true (else 400). ' +
        'Without waitForReady a row whose fill lands late (verdict still unset) can be skipped; set waitForReady ' +
        'to hold the page until it lands.',
    }),
  waitForReady: z
    .boolean()
    .optional()
    .openapi({
      description:
        "Opt-in journal readiness gate. false (default) = today's behaviour: a row claimed at ingress but not yet " +
        'filled is delivered as it is. true = pull and shared claims stop before such a row (journalReady false) ' +
        'until it is filled or older than the settle window (EVENT_CONSUMER_SETTLE_MS, default 5000 ms).',
    }),
  scoped: z
    .boolean()
    .optional()
    .openapi({
      description:
        'Opt-in instance scoping. false (default) = global consumer, exactly the existing behaviour. true = the ' +
        'consumer is owned by the calling API key and pulls only journal rows of its instanceIds; only the owner ' +
        'key or an instance-unrestricted key can inspect, pull, ack, delete or list it (others get 404).',
    }),
  // Typed loosely on purpose: before 0082 an unknown `instanceIds` was stripped, so a legacy client that
  // sends one (any shape) without `scoped: true` must keep being accepted and ignored. The service
  // validates it (array of up to 100 UUIDs) only for scoped consumers.
  instanceIds: z
    .unknown()
    .optional()
    .openapi({
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      maxItems: 100,
      description:
        'Scoped consumers only (ignored without scoped: true, as before). Instance-restricted key: defaults to all ' +
        'of its instances; naming an instance outside the key is 403; an empty result or an unknown instance is 400. ' +
        'Instance-unrestricted key: required and non-empty.',
    }),
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
  leaseMs: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .optional()
    .openapi({ description: 'Shared consumers: lease duration before the page is redelivered (default 60000)' }),
});

export const AckConsumerSchema = z
  .object({
    cursor: z.coerce.number().int().min(0).optional().openapi({
      description: 'The journal_seq to advance to (a pull result\'s "cursor"). Monotonic: equal = no-op, lower = 400',
    }),
    leaseId: z.string().uuid().optional().openapi({
      description: "Shared consumers: the pull result's leaseId (required instead of cursor)",
    }),
  })
  .refine((body) => body.cursor !== undefined || body.leaseId !== undefined, {
    message: 'cursor or leaseId is required',
  });

/** A journal_seq position on the wire: digits only, a non-negative safe integer. */
const JournalSeqStringSchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}$/, 'must be a non-negative integer journal_seq');

export const StreamConsumerQuerySchema = z.object({
  after: JournalSeqStringSchema.optional().openapi({
    description:
      'Start strictly after this journal_seq (default: the stored cursor). Ignored when Last-Event-ID is sent',
  }),
});

export const StreamConsumerHeaderSchema = z.object({
  'last-event-id': JournalSeqStringSchema.optional().openapi({
    description: 'EventSource reconnect position (the last received event id); wins over ?after',
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
  scanExhausted: z.boolean().openapi({
    description: 'A full scan window matched nothing; the stored cursor was advanced past it (#1128)',
  }),
  leaseId: z.string().optional().openapi({
    description: 'Shared consumers only: ack this lease once the items are handled (absent when nothing delivered)',
  }),
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
    description:
      'Every registered durable consumer with its filter, cursor, and live lag (journal head minus cursor). ' +
      'Scoped consumers are listed only to their owner key and to instance-unrestricted keys.',
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
      "startFrom 'now' (default) begins at the journal head; 'beginning' replays the full journal (projections). " +
      'Opt-in scoped: true binds the consumer to the calling key and an instance set (see instanceIds).',
    request: { body: { content: { 'application/json': { schema: CreateConsumerSchema } } } },
    responses: {
      201: {
        description: 'Consumer registered',
        content: { 'application/json': { schema: z.object({ data: DurableConsumerSchema }) } },
      },
      400: {
        description: 'A scoped consumer with invalid or no resolvable instanceIds',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      403: {
        description: 'Scoped consumer names an instance the API key cannot access',
        content: { 'application/json': { schema: ErrorSchema } },
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
      404: {
        description: 'No such consumer (or a scoped consumer this key cannot access)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
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
      404: {
        description: 'No such consumer (or a scoped consumer this key cannot access)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
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
      404: {
        description: 'No such consumer (or a scoped consumer this key cannot access)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/events/consumers/{name}/stream',
    operationId: 'streamEventConsumer',
    tags: ['Events'],
    summary: 'Stream journal events for a consumer (SSE)',
    description:
      'Opt-in Server-Sent Events push over the same journal scan as pull (type glob, excludeTypes, payload ' +
      'conditions, journal_seq order), always behind the journal readiness gate: a claimed-but-unfilled row is ' +
      'held until it is filled or older than EVENT_CONSUMER_SETTLE_MS. Starts strictly after Last-Event-ID, else ' +
      '?after, else the stored cursor; catches up, then follows live. Each matching row is one event ' +
      '(`id: <journal_seq>`, `event: <eventType>`, `data: <the row as pull returns it>`), after an initial ' +
      '`connected` event; a `: heartbeat` comment is sent every EVENT_STREAM_HEARTBEAT_MS (default 15000). ' +
      'READ-ONLY: the stream never moves the stored cursor and never takes a lease — keep acking with ' +
      'POST /events/consumers/{name}/ack. Fan-out consumers only: a shared consumer is refused with 400. A ' +
      'consumer deleted mid-stream ends the stream with an `error` event. Requires events:write (as pull) and ' +
      'resolves the consumer exactly as pull: a scoped consumer the key may not see is 404, a restricted owner ' +
      'streams only its narrowed instances, and an instance-restricted API key only receives rows of its own ' +
      'instances. An access-filtered consumer holds an unfilled row until its verdict lands. A stream lives at most ' +
      'EVENT_STREAM_MAX_LIFETIME_MS (default and maximum 30000, the revocation ceiling), then ends with a ' +
      '`reconnect` event carrying `retry:` and `id:` (the scanned position, past filtered-out rows) — reconnect ' +
      'with Last-Event-ID to resume and re-authenticate. Past ' +
      'EVENT_STREAM_MAX_PER_PROCESS open streams, or EVENT_STREAM_MAX_PER_KEY for the calling key, a new one is ' +
      'refused with 429.',
    request: {
      params: z.object({ name: z.string().openapi({ description: 'Consumer name' }) }),
      query: StreamConsumerQuerySchema,
      headers: StreamConsumerHeaderSchema,
    },
    responses: {
      200: {
        description: 'SSE stream of matching journal rows',
        content: { 'text/event-stream': { schema: z.string() } },
      },
      400: {
        description: 'Invalid start position, or the consumer is shared',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'No such consumer', content: { 'application/json': { schema: ErrorSchema } } },
      429: {
        description: 'Too many open streams on this server or for this key (EVENT_STREAM_MAX_PER_PROCESS / _PER_KEY)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
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
      404: {
        description: 'No such consumer (or a scoped consumer this key cannot access)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });
}
