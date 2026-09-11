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
    includeEnvelope: z
      .boolean()
      .optional()
      .openapi({ description: 'Send the full OmniEvent envelope as the default body (default true)' }),
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
      .enum(['per_user', 'per_chat', 'per_thread'])
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
  transactionalEmissions: z.boolean().openapi({
    description:
      "Transactional publication (G5, #988): buffer the run's emit_event publishes and flush them in order " +
      'only when every action succeeded; a failed run publishes zero',
  }),
  maxConcurrency: z
    .number()
    .int()
    .nullable()
    .openapi({
      description:
        'Per-automation concurrency limit (#1108). null = queued per instance with the engine default; ' +
        'set = a queue private to this automation, 1 being strict single-flight',
    }),
  concurrencyKey: z
    .string()
    .nullable()
    .openapi({
      description:
        'Template over the event payload partitioning this automation’s queue (#1108), e.g. ' +
        '"{{payload.from.id}}" to serialize per chat; null = one queue for the whole automation',
    }),
  managedByAgentId: z
    .string()
    .uuid()
    .nullable()
    .openapi({
      description:
        'Set when this automation was compiled from an agent event manifest (RFC #925 G4b, #986); ' +
        'null = hand-made. Managed automations reject manual mutation — edit the owning agent’s manifest instead',
    }),
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
  transactionalEmissions: z
    .boolean()
    .default(false)
    .openapi({
      description:
        "Transactional publication (G5, #988): buffer the run's emit_event publishes and flush them in order " +
        'only when every action succeeded; a failed run publishes zero. Default false = immediate publishing',
    }),
  maxConcurrency: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .openapi({
      description:
        'Per-automation concurrency limit (#1108). Omit/null = today’s per-instance queueing with the engine ' +
        'default; 1 = strict single-flight, which is what a read-before-write action needs',
    }),
  concurrencyKey: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .openapi({
      description:
        'Template over the event payload partitioning this automation’s queue (#1108), e.g. ' +
        '"{{payload.from.id}}" to serialize per chat; omit/null = one queue for the whole automation',
    }),
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
  event: z
    .object({
      type: z.string().min(1).openapi({ description: 'Event type' }),
      payload: z.record(z.string(), z.unknown()).openapi({ description: 'Event payload' }),
    })
    .optional()
    .openapi({ description: 'Hand-written event. Exactly one of event / eventId is required' }),
  eventId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      description:
        'Id of a REAL journaled event (omni_events) to run against (#1073): its rawPayload is the payload, ' +
        'its envelope metadata is merged for conditions. Exactly one of event / eventId is required',
    }),
});

// Dry-run result (#1073)
export const AutomationTestResultSchema = z.object({
  matched: z.boolean().openapi({ description: 'triggerMatched AND conditionsMatched' }),
  triggerMatched: z.boolean().openapi({ description: 'Event type equals the automation trigger' }),
  conditionsMatched: z.boolean().openapi({ description: 'Condition set verdict under conditionLogic' }),
  conditionLogic: z.enum(['and', 'or']),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        expected: z.unknown().optional(),
        actual: z.unknown().optional(),
        resolved: z.boolean().openapi({ description: 'false = the dot path resolved to nothing in the payload' }),
        matched: z.boolean(),
      }),
    )
    .openapi({ description: 'Per-condition verdicts' }),
  actions: z
    .array(
      z.object({
        type: z.string(),
        wouldExecute: z.boolean(),
        config: z.record(z.string(), z.unknown()).openapi({ description: 'Action config with templates rendered' }),
      }),
    )
    .openapi({ description: 'Rendered actions — never executed' }),
  eventId: z.string().uuid().nullable(),
  dryRun: z.literal(true),
});

// Automation metrics
export const AutomationMetricsSchema = z.object({
  running: z.boolean().openapi({ description: 'Engine running' }),
  instanceQueues: z
    .array(
      z.object({
        instanceId: z.string().openapi({
          description:
            'Queue key: the instance ID, or "<instanceId>:<automationId>[:<partition>]" for an automation ' +
            'running on its own queue (#1108)',
        }),
        activeCount: z.number().int().openapi({ description: 'Active jobs' }),
        pendingCount: z.number().int().openapi({ description: 'Pending jobs' }),
      }),
    )
    .optional()
    .openapi({ description: 'Instance queue stats' }),
  totalExecutions: z.number().int().openapi({ description: 'Total executions' }),
  totalActions: z.number().int().openapi({ description: 'Total actions executed' }),
  successRate: z.number().openapi({ description: 'Success rate (%)' }),
  avgExecutionTimeMs: z.number().openapi({ description: 'Average execution time (ms)' }),
  recentFailures: z.number().int().openapi({ description: 'Failures in last 24h' }),
});

export function registerAutomationSchemas(registry: OpenAPIRegistry): void {
  registry.register('Automation', AutomationSchema);
  registry.register('CreateAutomationRequest', CreateAutomationSchema);
  registry.register('AutomationLog', AutomationLogSchema);
  registry.register('TestAutomationRequest', TestAutomationSchema);
  registry.register('AutomationTestResult', AutomationTestResultSchema);
  registry.register('AutomationMetrics', AutomationMetricsSchema);

  registry.registerPath({
    method: 'get',
    path: '/automations',
    operationId: 'listAutomations',
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
    operationId: 'getAutomation',
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
    operationId: 'createAutomation',
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
    operationId: 'updateAutomation',
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
    operationId: 'deleteAutomation',
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
    operationId: 'enableAutomation',
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
    operationId: 'disableAutomation',
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
    operationId: 'testAutomation',
    tags: ['Automations'],
    summary: 'Test automation (dry run)',
    description:
      'Dry-run an automation against a hand-written event or a REAL journaled event (`eventId`, #1073): ' +
      'trigger match, per-condition verdicts and rendered action templates. Executes nothing, writes no execution log.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Automation UUID' }) }),
      body: { content: { 'application/json': { schema: TestAutomationSchema } } },
    },
    responses: {
      200: {
        description: 'Dry-run result',
        content: { 'application/json': { schema: AutomationTestResultSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/automations/{id}/execute',
    operationId: 'executeAutomation',
    tags: ['Automations'],
    summary: 'Execute automation',
    description:
      'Execute automation with a provided event payload or a journaled event (`eventId`). Actually runs the actions (not a dry run).',
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
    operationId: 'getAutomationLogs',
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
    operationId: 'searchAutomationLogs',
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
    operationId: 'getAutomationMetrics',
    tags: ['Automations'],
    summary: 'Get automation metrics',
    description: 'Get automation engine metrics.',
    responses: {
      200: { description: 'Metrics', content: { 'application/json': { schema: AutomationMetricsSchema } } },
    },
  });
}
