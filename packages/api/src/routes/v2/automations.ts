/**
 * Automations routes - automation rule management
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const automationsRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// Schemas
// ============================================================================

// Condition schema
const conditionSchema = z.object({
  field: z.string().min(1).describe('Dot notation field path (e.g., payload.content.type)'),
  operator: z
    .enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'not_contains', 'exists', 'not_exists', 'regex'])
    .describe('Comparison operator'),
  value: z.unknown().optional().describe('Value to compare against'),
});

// Webhook action schema
const webhookActionSchema = z.object({
  type: z.literal('webhook'),
  config: z.object({
    url: z.string().min(1).describe('Webhook URL (supports {{templates}})'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
    bodyTemplate: z.string().optional().describe('Request body template (JSON)'),
    waitForResponse: z.boolean().default(false).describe('Wait for response before continuing'),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000).describe('Request timeout'),
    responseAs: z.string().optional().describe('Store response as variable name'),
  }),
});

// Send message action schema
const sendMessageActionSchema = z.object({
  type: z.literal('send_message'),
  config: z.object({
    instanceId: z.string().optional().describe('Instance ID (template)'),
    to: z.string().optional().describe('Recipient (template)'),
    contentTemplate: z.string().min(1).describe('Message content template'),
  }),
});

// Emit event action schema
const emitEventActionSchema = z.object({
  type: z.literal('emit_event'),
  config: z.object({
    eventType: z.string().min(1).describe('Event type to emit'),
    payloadTemplate: z.record(z.string(), z.unknown()).optional().describe('Event payload template'),
  }),
});

// Log action schema
const logActionSchema = z.object({
  type: z.literal('log'),
  config: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).describe('Log level'),
    message: z.string().min(1).describe('Log message (supports templates)'),
  }),
});

// Combined action schema
const actionSchema = z.discriminatedUnion('type', [
  webhookActionSchema,
  sendMessageActionSchema,
  emitEventActionSchema,
  logActionSchema,
]);

// Debounce config schema
const debounceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({
    mode: z.literal('fixed'),
    delayMs: z.number().int().min(100).max(300000).describe('Fixed delay in milliseconds'),
  }),
  z.object({
    mode: z.literal('range'),
    minMs: z.number().int().min(100).describe('Minimum delay'),
    maxMs: z.number().int().max(300000).describe('Maximum delay'),
  }),
  z.object({
    mode: z.literal('presence'),
    baseDelayMs: z.number().int().min(100).describe('Base delay'),
    maxWaitMs: z.number().int().max(300000).optional().describe('Maximum total wait'),
    extendOnEvents: z.array(z.string()).describe('Events that extend the timer'),
  }),
]);

// Create automation schema
const createAutomationSchema = z.object({
  name: z.string().min(1).max(255).describe('Automation name'),
  description: z.string().optional().describe('Description'),
  triggerEventType: z.string().min(1).describe('Event type that triggers this automation'),
  triggerConditions: z.array(conditionSchema).optional().describe('Conditions that must all match'),
  actions: z.array(actionSchema).min(1).describe('Actions to execute (in sequence)'),
  debounce: debounceSchema.optional().describe('Message debounce configuration'),
  enabled: z.boolean().default(true).describe('Whether automation is enabled'),
  priority: z.number().int().default(0).describe('Priority (higher runs first)'),
});

// Update automation schema
const updateAutomationSchema = createAutomationSchema.partial();

// List query schema
const listQuerySchema = z.object({
  enabled: z.coerce.boolean().optional(),
});

// Test automation schema
const testAutomationSchema = z.object({
  event: z.object({
    type: z.string().min(1).describe('Event type'),
    payload: z.record(z.string(), z.unknown()).describe('Event payload'),
  }),
});

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

  const metrics = services.automations.getMetrics();

  if (!metrics) {
    return c.json({ running: false, message: 'Automation engine not running' });
  }

  return c.json({
    running: true,
    ...metrics,
  });
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
automationsRoutes.post('/', zValidator('json', createAutomationSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  const automation = await services.automations.create(data);

  return c.json({ data: automation }, 201);
});

/**
 * PATCH /automations/:id - Update automation
 */
automationsRoutes.patch('/:id', zValidator('json', updateAutomationSchema), async (c) => {
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
  const { event } = c.req.valid('json');
  const services = c.get('services');

  const result = await services.automations.test(id, event);

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
