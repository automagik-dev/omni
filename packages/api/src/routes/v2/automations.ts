/**
 * Automations routes - automation rule management
 */

import { type Hook, zValidator } from '@hono/zod-validator';
import { CONDITION_OPERATORS } from '@omni/core';
import { type Env, Hono } from 'hono';
import { z } from 'zod';
import { strictConfig } from '../../lib/strict-config';
import type { AutomationTestEvent } from '../../services/automations';
import type { AppVariables } from '../../types';

const automationsRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// Schemas
// ============================================================================

/** Surface Zod issue messages (path: message) so clients can print them (#1119). */
const validationHook: Hook<unknown, Env, string> = (result, c) => {
  if (result.success) return;
  const message = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
  return c.json({ error: { code: 'VALIDATION_ERROR', message, issues: result.error.issues } }, 400);
};

// Condition schema
const conditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .describe('Dot notation path into the event payload (e.g., content.type, pull_request.merged)'),
  operator: z
    .enum(CONDITION_OPERATORS, {
      errorMap: () => ({ message: `Invalid operator. Expected one of: ${CONDITION_OPERATORS.join(', ')}` }),
    })
    .describe('Comparison operator'),
  value: z.unknown().optional().describe('Value to compare against'),
});

// Webhook action schema
const webhookActionSchema = z.object({
  type: z.literal('webhook'),
  config: strictConfig({
    url: z.string().min(1).describe('Webhook URL (supports {{templates}})'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
    bodyTemplate: z.string().optional().describe('Request body template (JSON)'),
    waitForResponse: z.boolean().default(false).describe('Wait for response before continuing'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe('Request timeout'),
    responseAs: z.string().optional().describe('Store response as variable name'),
    includeEnvelope: z
      .boolean()
      .optional()
      .describe('Send the full OmniEvent envelope as the default body when no bodyTemplate is set (default true)'),
  }),
});

// Send message action schema
const sendMessageActionSchema = z.object({
  type: z.literal('send_message'),
  config: strictConfig({
    instanceId: z.string().optional().describe('Instance ID (template)'),
    to: z.string().optional().describe('Recipient (template)'),
    contentTemplate: z.string().min(1).describe('Message content template'),
  }),
});

// Emit event action schema
const emitEventActionSchema = z.object({
  type: z.literal('emit_event'),
  config: strictConfig({
    eventType: z.string().min(1).describe('Event type to emit'),
    payloadTemplate: z.record(z.string(), z.unknown()).optional().describe('Event payload template'),
  }),
});

// Log action schema
const logActionSchema = z.object({
  type: z.literal('log'),
  config: strictConfig({
    level: z.enum(['debug', 'info', 'warn', 'error']).describe('Log level'),
    message: z.string().min(1).describe('Log message (supports templates)'),
  }),
});

// Call agent action schema - just calls agent and returns response for chaining
const callAgentActionSchema = z.object({
  type: z.literal('call_agent'),
  config: strictConfig({
    providerId: z.string().optional().describe('Provider ID (template: {{instance.agentProviderId}})'),
    agentId: z.string().min(1).describe('Agent ID (required or template)'),
    agentType: z.enum(['agent', 'team', 'workflow']).optional().describe('Agent type'),
    sessionStrategy: z.enum(['per_user', 'per_chat']).optional().describe('Session strategy for agent memory'),
    prefixSenderName: z.boolean().optional().describe('Prefix messages with sender name'),
    timeoutMs: z.number().int().optional().describe('Timeout in milliseconds'),
    responseAs: z.string().optional().describe('Store agent response as variable for chaining'),
    promptOverride: z
      .string()
      .optional()
      .describe(
        'Synthetic prompt template that replaces the default user-input prompt for this invocation only (not persisted to chat history).',
      ),
  }),
});

// Combined action schema
const actionSchema = z.discriminatedUnion('type', [
  webhookActionSchema,
  sendMessageActionSchema,
  emitEventActionSchema,
  logActionSchema,
  callAgentActionSchema,
]);

// What the debounce window groups by (#1110): a template over the event
// payload. Omitted = the conversation, which is what every pre-#1110 row means.
const debounceKeySchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Template over the event payload naming the debounce window (#1110), e.g. "{{payload.pull_request.id}}"; ' +
      'omit to group by conversation (instance + sender) as before. Not allowed with mode "presence"',
  );

// Debounce config schema
const debounceSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('none'), key: debounceKeySchema }),
    z.object({
      mode: z.literal('fixed'),
      delayMs: z.number().int().min(100).max(300000).describe('Fixed delay in milliseconds'),
      key: debounceKeySchema,
    }),
    z.object({
      mode: z.literal('range'),
      minMs: z.number().int().min(100).describe('Minimum delay'),
      maxMs: z.number().int().max(300000).describe('Maximum delay'),
      key: debounceKeySchema,
    }),
    z.object({
      mode: z.literal('presence'),
      baseDelayMs: z.number().int().min(100).describe('Base delay'),
      maxWaitMs: z.number().int().max(300000).optional().describe('Maximum total wait'),
      extendOnEvents: z.array(z.string()).describe('Events that extend the timer'),
      key: debounceKeySchema,
    }),
  ])
  // Rejected rather than silently ignored (#1110): `extendOnEvents` extends a
  // window on a contact typing or recording, which says nothing about a window
  // keyed on something that is not a conversation.
  .refine((debounce) => !(debounce.mode === 'presence' && debounce.key), {
    message: 'debounce.key cannot be combined with mode "presence": presence extension only applies to conversations',
    path: ['key'],
  });

// Create automation schema
const createAutomationSchema = z.object({
  name: z.string().min(1).max(255).describe('Automation name'),
  description: z.string().optional().describe('Description'),
  triggerEventType: z.string().min(1).describe('Event type that triggers this automation'),
  triggerConditions: z.array(conditionSchema).optional().describe('Conditions to match'),
  conditionLogic: z
    .enum(['and', 'or'])
    .default('and')
    .describe('Condition logic: "and" (all must match) or "or" (any must match)'),
  actions: z.array(actionSchema).min(1).describe('Actions to execute (in sequence)'),
  debounce: debounceSchema.optional().describe('Message debounce configuration'),
  enabled: z.boolean().default(true).describe('Whether automation is enabled'),
  priority: z.number().int().default(0).describe('Priority (higher runs first)'),
  transactionalEmissions: z
    .boolean()
    .default(false)
    .describe(
      "Transactional publication (G5, #988): buffer the run's emit_event publishes and flush them in order " +
        'only when every action succeeded; a failed run publishes zero. Default false = immediate publishing',
    ),
  maxConcurrency: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe(
      'Per-automation concurrency limit (#1108). Omit/null = today’s per-instance queueing with the engine ' +
        'default; 1 = strict single-flight, which is what a read-before-write action needs',
    ),
  concurrencyKey: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      'Template over the event payload partitioning this automation’s queue (#1108), e.g. ' +
        '"{{payload.from.id}}" to serialize per chat; omit/null = one queue for the whole automation',
    ),
});

// Update automation schema
const updateAutomationSchema = createAutomationSchema.partial();

// List query schema
const listQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
});

// Test/execute automation schema: a hand-written event OR a journaled event id (#1073)
const testAutomationSchema = z
  .object({
    event: z
      .object({
        type: z.string().min(1).describe('Event type'),
        payload: z.record(z.string(), z.unknown()).describe('Event payload'),
      })
      .optional(),
    eventId: z.string().uuid().optional().describe('Id of a journaled omni_events row to run against'),
  })
  .refine((b) => (b.event ? 1 : 0) + (b.eventId ? 1 : 0) === 1, {
    message: 'Provide exactly one of "event" or "eventId"',
  });

/**
 * Resolve the test/execute body to an event: the inline mock, or the REAL
 * journaled row (#1073) shaped the way the engine saw it on the bus (#1116).
 * A webhook (`internal`) event's payload IS its rawPayload; a channel event's
 * bus payload is canonical (`chatId`, `from`, `content`, ...) with the
 * platform payload nested under `rawPayload` — rebuilt here from the columns.
 */
async function resolveTestEvent(
  services: AppVariables['services'],
  body: z.infer<typeof testAutomationSchema>,
): Promise<AutomationTestEvent> {
  if (body.event) return body.event;
  const row = await services.events.getById(body.eventId as string);
  return {
    id: row.id,
    type: row.eventType,
    payload:
      row.channel === 'internal'
        ? (row.rawPayload ?? {})
        : Object.fromEntries(
            Object.entries({
              externalId: row.externalId,
              chatId: row.chatId,
              from: row.metadata?.from,
              content: row.contentType ? { type: row.contentType, text: row.textContent ?? undefined } : undefined,
              rawPayload: row.rawPayload,
            }).filter(([, v]) => v != null),
          ),
    metadata: row.metadata ?? undefined,
    timestamp: row.receivedAt.getTime(),
  };
}

// Logs query schema
const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  status: z.enum(['success', 'failed', 'skipped']).optional(),
  eventType: z.string().optional(),
  automationId: z.string().uuid().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /automations - List all automations
 */
automationsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { enabled } = c.req.valid('query');
  const services = c.get('services');

  const items = await services.automations.list({ enabled });

  return c.json({ items });
});

/**
 * GET /automation-logs - Search execution logs
 * NOTE: Must be defined before /:id route to avoid matching as ID
 */
automationsRoutes.get('/automation-logs', zValidator('query', logsQuerySchema), async (c) => {
  const { limit, cursor, status, eventType, automationId } = c.req.valid('query');
  const services = c.get('services');

  const result = await services.automations.searchLogs({
    limit,
    cursor,
    status,
    eventType,
    automationId,
  });

  return c.json({
    items: result.items,
    meta: { hasMore: result.hasMore, cursor: result.cursor },
  });
});

/**
 * GET /automation-metrics - Get engine metrics
 * NOTE: Must be defined before /:id route to avoid matching as ID
 */
automationsRoutes.get('/automation-metrics', async (c) => {
  const services = c.get('services');

  const metrics = await services.automations.getMetrics();

  return c.json(metrics);
});

/**
 * GET /automations/:id - Get automation by ID
 */
automationsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const automation = await services.automations.getById(id);

  return c.json({ data: automation });
});

/**
 * POST /automations - Create automation
 */
automationsRoutes.post('/', zValidator('json', createAutomationSchema, validationHook), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const automation = await services.automations.create(data);

  return c.json({ data: automation }, 201);
});

/**
 * PATCH /automations/:id - Update automation
 */
automationsRoutes.patch('/:id', zValidator('json', updateAutomationSchema, validationHook), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const automation = await services.automations.update(id, data);

  return c.json({ data: automation });
});

/**
 * DELETE /automations/:id - Delete automation
 */
automationsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.automations.delete(id);

  return c.json({ success: true });
});

/**
 * POST /automations/:id/enable - Enable automation
 */
automationsRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const automation = await services.automations.enable(id);

  return c.json({ data: automation });
});

/**
 * POST /automations/:id/disable - Disable automation
 */
automationsRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const automation = await services.automations.disable(id);

  return c.json({ data: automation });
});

/**
 * POST /automations/:id/test - Test automation against sample event (dry run)
 */
automationsRoutes.post('/:id/test', zValidator('json', testAutomationSchema), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const event = await resolveTestEvent(services, c.req.valid('json'));

  const result = await services.automations.test(id, event);

  return c.json(result);
});

/**
 * POST /automations/:id/execute - Execute automation with provided event (actually runs actions)
 */
automationsRoutes.post('/:id/execute', zValidator('json', testAutomationSchema), async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');
  const event = await resolveTestEvent(services, c.req.valid('json'));

  const result = await services.automations.execute(id, event);

  return c.json(result);
});

/**
 * GET /automations/:id/logs - Get execution logs for automation
 */
automationsRoutes.get(
  '/:id/logs',
  zValidator('query', logsQuerySchema.pick({ limit: true, cursor: true })),
  async (c) => {
    const id = c.req.param('id');
    const { limit, cursor } = c.req.valid('query');
    const services = c.get('services');

    const result = await services.automations.getLogs(id, { limit, cursor });

    return c.json({
      items: result.items,
      meta: { hasMore: result.hasMore, cursor: result.cursor },
    });
  },
);

export { automationsRoutes };
