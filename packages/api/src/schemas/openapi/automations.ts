/**
 * OpenAPI schemas for automation endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, PaginationMetaSchema, SuccessSchema } from './common';

// Condition schema
const ConditionSchema = z.object({
  field: z.string().min(1).openapi({ description: 'Dot notation field path' }),
  operator: z
    .enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'not_contains', 'exists', 'not_exists', 'regex'])
    .openapi({ description: 'Operator' }),
  value: z.unknown().optional().openapi({ description: 'Value to compare' }),
});

// Action schemas
const WebhookActionSchema = z.object({
  type: z.literal('webhook'),
  config: z.object({
    url: z.string().min(1).openapi({ description: 'Webhook URL' }),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    waitForResponse: z.boolean().default(false),
    timeoutMs: z.number().int().default(30000),
    responseAs: z.string().optional(),
  }),
});

const SendMessageActionSchema = z.object({
  type: z.literal('send_message'),
  config: z.object({
    instanceId: z.string().optional(),
    to: z.string().optional(),
    contentTemplate: z.string().min(1),
  }),
});

const EmitEventActionSchema = z.object({
  type: z.literal('emit_event'),
  config: z.object({
    eventType: z.string().min(1),
    payloadTemplate: z.record(z.string(), z.unknown()).optional(),
  }),
});

const LogActionSchema = z.object({
  type: z.literal('log'),
  config: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1),
  }),
});

const CallAgentActionSchema = z.object({
  type: z.literal('call_agent'),
  config: z.object({
    providerId: z.string().optional().openapi({ description: 'Provider ID (template: {{instance.agentProviderId}})' }),
    agentId: z.string().min(1).openapi({ description: 'Agent ID (required or template)' }),
    agentType: z.enum(['agent', 'team', 'workflow']).optional().openapi({ description: 'Agent type' }),
    sessionStrategy: z
      .enum(['per_user', 'per_chat', 'per_user_per_chat'])
      .optional()
      .openapi({ description: 'Session strategy for agent memory' }),
    prefixSenderName: z.boolean().optional().openapi({ description: 'Prefix messages with sender name' }),
    timeoutMs: z.number().int().optional().openapi({ description: 'Timeout in milliseconds' }),
    responseAs: z
      .string()
      .optional()
      .openapi({ description: 'Store agent response as variable for chaining (e.g., "agentResponse")' }),
  }),
});

const ActionSchema = z.union([
  WebhookActionSchema,
  SendMessageActionSchema,
  EmitEventActionSchema,
  LogActionSchema,
  CallAgentActionSchema,
]);

// Debounce schema
const DebounceSchema = z.object({
  mode: z.enum(['none', 'fixed', 'range', 'presence']),
  delayMs: z.number().int().optional(),
  minMs: z.number().int().optional(),
  maxMs: z.number().int().optional(),
  baseDelayMs: z.number().int().optional(),
  maxWaitMs: z.number().int().optional(),
  extendOnEvents: z.array(z.string()).optional(),
});

// Automation schema
export const AutomationSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Automation UUID' }),
  name: z.string().openapi({ description: 'Name' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  triggerEventType: z.string().openapi({ description: 'Trigger event type' }),
  triggerConditions: z.array(ConditionSchema).nullable().openapi({ description: 'Conditions' }),
  conditionLogic: z.enum(['and', 'or']).nullable().openapi({ description: 'Condition logic' }),
  actions: z.array(ActionSchema).openapi({ description: 'Actions' }),
  debounce: DebounceSchema.nullable().openapi({ description: 'Debounce config' }),
  enabled: z.boolean().openapi({ description: 'Whether enabled' }),
  priority: z.number().int().openapi({ description: 'Priority' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create automation request
export const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(255).openapi({ description: 'Name' }),
  description: z.string().optional().openapi({ description: 'Description' }),
  triggerEventType: z.string().min(1).openapi({ description: 'Trigger event type' }),
  triggerConditions: z.array(ConditionSchema).optional().openapi({ description: 'Conditions' }),
  conditionLogic: z
    .enum(['and', 'or'])
    .default('and')
    .openapi({ description: 'Condition logic: "and" (all must match) or "or" (any must match)' }),
  actions: z.array(ActionSchema).min(1).openapi({ description: 'Actions' }),
  debounce: DebounceSchema.optional().openapi({ description: 'Debounce config' }),
  enabled: z.boolean().default(true).openapi({ description: 'Whether enabled' }),
  priority: z.number().int().default(0).openapi({ description: 'Priority' }),
});

// Automation log schema
export const AutomationLogSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Log UUID' }),
  automationId: z.string().uuid().openapi({ description: 'Automation UUID' }),
  eventId: z.string().uuid().openapi({ description: 'Event UUID' }),
  eventType: z.string().openapi({ description: 'Event type' }),
  status: z.enum(['success', 'failed', 'skipped']).openapi({ description: 'Execution status' }),
  error: z.string().nullable().openapi({ description: 'Error message' }),
  executedAt: z.string().datetime().openapi({ description: 'Execution timestamp' }),
  durationMs: z.number().int().openapi({ description: 'Duration (ms)' }),
});

// Test automation request
export const TestAutomationSchema = z.object({
  event: z.object({
    type: z.string().min(1).openapi({ description: 'Event type' }),
    payload: z.record(z.string(), z.unknown()).openapi({ description: 'Event payload' }),
  }),
});

// Automation metrics
export const AutomationMetricsSchema = z.object({
  running: z.boolean().openapi({ description: 'Engine running' }),
  totalAutomations: z.number().int().openapi({ description: 'Total automations' }),
  enabledAutomations: z.number().int().openapi({ description: 'Enabled automations' }),
  eventsProcessed: z.number().int().openapi({ description: 'Events processed' }),
  actionsExecuted: z.number().int().openapi({ description: 'Actions executed' }),
  failedActions: z.number().int().openapi({ description: 'Failed actions' }),
});

export function registerAutomationSchemas(registry: OpenAPIRegistry): void {
  registry.register('Automation', AutomationSchema);
  registry.register('CreateAutomationRequest', CreateAutomationSchema);
  registry.register('AutomationLog', AutomationLogSchema);
  registry.register('TestAutomationRequest', TestAutomationSchema);
  registry.register('AutomationMetrics', AutomationMetricsSchema);

  registry.registerPath({
    method: 'get',
    path: '/automations',
    tags: ['Automations'],
    summary: 'List automations',
    description: 'Get all automations.',
    request: { query: z.object({ enabled: z.boolean().optional().openapi({ description: 'Filter by enabled' }) }) },
    responses: {
      200: {
        description: 'List of automations',
        content: { 'application/json': { schema: z.object({ items: z.array(AutomationSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/automations/{id}',
    tags: ['Automations'],
    summary: 'Get automation',
    description: 'Get details of a specific automation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }) },
    responses: {
      200: {
        description: 'Automation details',
        content: { 'application/json': { schema: z.object({ data: AutomationSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations',
    tags: ['Automations'],
    summary: 'Create automation',
    description: 'Create a new automation.',
    request: { body: { content: { 'application/json': { schema: CreateAutomationSchema } } } },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: z.object({ data: AutomationSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/automations/{id}',
    tags: ['Automations'],
    summary: 'Update automation',
    description: 'Update an existing automation.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }),
      body: { content: { 'application/json': { schema: CreateAutomationSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: z.object({ data: AutomationSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/automations/{id}',
    tags: ['Automations'],
    summary: 'Delete automation',
    description: 'Delete an automation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }) },
    responses: {
      200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations/{id}/enable',
    tags: ['Automations'],
    summary: 'Enable automation',
    description: 'Enable an automation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }) },
    responses: {
      200: {
        description: 'Enabled',
        content: { 'application/json': { schema: z.object({ data: AutomationSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations/{id}/disable',
    tags: ['Automations'],
    summary: 'Disable automation',
    description: 'Disable an automation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }) },
    responses: {
      200: {
        description: 'Disabled',
        content: { 'application/json': { schema: z.object({ data: AutomationSchema }) } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations/{id}/test',
    tags: ['Automations'],
    summary: 'Test automation',
    description: 'Test automation against a sample event (dry run).',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }),
      body: { content: { 'application/json': { schema: TestAutomationSchema } } },
    },
    responses: {
      200: {
        description: 'Test result',
        content: {
          'application/json': {
            schema: z.object({
              matched: z.boolean(),
              conditionResults: z.array(z.object({ condition: ConditionSchema, passed: z.boolean() })).optional(),
              wouldExecute: z.array(ActionSchema).optional(),
            }),
          },
        },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations/{id}/execute',
    tags: ['Automations'],
    summary: 'Execute automation',
    description: 'Execute automation with a provided event payload. Actually runs the actions (not a dry run).',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }),
      body: { content: { 'application/json': { schema: TestAutomationSchema } } },
    },
    responses: {
      200: {
        description: 'Execution result',
        content: {
          'application/json': {
            schema: z.object({
              automationId: z.string().uuid(),
              triggered: z
                .boolean()
                .openapi({ description: 'Whether the automation was triggered (event type matched)' }),
              results: z
                .array(
                  z.object({
                    action: z.string(),
                    status: z.enum(['success', 'failed']),
                    result: z.unknown().optional(),
                    error: z.string().optional(),
                    durationMs: z.number().int(),
                  }),
                )
                .openapi({ description: 'Results of each action execution' }),
            }),
          },
        },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/automations/{id}/logs',
    tags: ['Automations'],
    summary: 'Get automation logs',
    description: 'Get execution logs for an automation.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }),
      query: z.object({
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'Logs',
        content: {
          'application/json': { schema: z.object({ items: z.array(AutomationLogSchema), meta: PaginationMetaSchema }) },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/automation-logs',
    tags: ['Automations'],
    summary: 'Search automation logs',
    description: 'Search execution logs across automations.',
    request: {
      query: z.object({
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
        status: z.enum(['success', 'failed', 'skipped']).optional().openapi({ description: 'Filter by status' }),
        eventType: z.string().optional().openapi({ description: 'Filter by event type' }),
        automationId: z.string().uuid().optional().openapi({ description: 'Filter by automation' }),
      }),
    },
    responses: {
      200: {
        description: 'Logs',
        content: {
          'application/json': { schema: z.object({ items: z.array(AutomationLogSchema), meta: PaginationMetaSchema }) },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/automation-metrics',
    tags: ['Automations'],
    summary: 'Get automation metrics',
    description: 'Get automation engine metrics.',
    responses: {
      200: { description: 'Metrics', content: { 'application/json': { schema: AutomationMetricsSchema } } },
    },
  });
}
