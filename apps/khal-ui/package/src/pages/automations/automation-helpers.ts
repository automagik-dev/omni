/**
 * Mirror schema + helpers for automations.
 *
 * `automationCreateSchema` is a faithful mirror of the API's real create schema
 * (packages/api/src/routes/v2/automations.ts) — including the discriminated
 * unions for actions and debounce. The Validate button parses the assembled body
 * through it (a real Zod parse, client-side, effect read-only). Because
 * {@link SchemaForm} can't render a discriminated union as native controls, the
 * editor renders scalar fields through SchemaForm and the actions/conditions/
 * debounce arrays through {@link JsonEditor} — this schema validates the whole.
 */
import { z } from 'zod';

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'not_contains',
  'exists',
  'not_exists',
  'regex',
] as const;

const conditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.unknown().optional(),
});

const webhookAction = z.object({
  type: z.literal('webhook'),
  config: z.object({
    url: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
    headers: z.record(z.string(), z.string()).optional(),
    bodyTemplate: z.string().optional(),
    waitForResponse: z.boolean().default(false),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    responseAs: z.string().optional(),
  }),
});

const sendMessageAction = z.object({
  type: z.literal('send_message'),
  config: z.object({
    instanceId: z.string().optional(),
    to: z.string().optional(),
    contentTemplate: z.string().min(1),
  }),
});

const emitEventAction = z.object({
  type: z.literal('emit_event'),
  config: z.object({
    eventType: z.string().min(1),
    payloadTemplate: z.record(z.string(), z.unknown()).optional(),
  }),
});

const logAction = z.object({
  type: z.literal('log'),
  config: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1),
  }),
});

const callAgentAction = z.object({
  type: z.literal('call_agent'),
  config: z.object({
    providerId: z.string().optional(),
    agentId: z.string().min(1),
    agentType: z.enum(['agent', 'team', 'workflow']).optional(),
    sessionStrategy: z.enum(['per_user', 'per_chat']).optional(),
    prefixSenderName: z.boolean().optional(),
    timeoutMs: z.number().int().optional(),
    responseAs: z.string().optional(),
    promptOverride: z.string().optional(),
  }),
});

export const actionSchema = z.discriminatedUnion('type', [
  webhookAction,
  sendMessageAction,
  emitEventAction,
  logAction,
  callAgentAction,
]);

const debounceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('fixed'), delayMs: z.number().int().min(100).max(300000) }),
  z.object({ mode: z.literal('range'), minMs: z.number().int().min(100), maxMs: z.number().int().max(300000) }),
  z.object({
    mode: z.literal('presence'),
    baseDelayMs: z.number().int().min(100),
    maxWaitMs: z.number().int().max(300000).optional(),
    extendOnEvents: z.array(z.string()),
  }),
]);

/** Full automation body — mirrors the API create schema. */
export const automationCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  triggerEventType: z.string().min(1),
  triggerConditions: z.array(conditionSchema).optional(),
  conditionLogic: z.enum(['and', 'or']).default('and'),
  actions: z.array(actionSchema).min(1),
  debounce: debounceSchema.optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
});
export type AutomationBody = z.infer<typeof automationCreateSchema>;

/** Scalar-only schema SchemaForm can render as native controls. */
export const automationScalarSchema = z.object({
  name: z.string().min(1).max(255).describe('Automation name'),
  description: z.string().optional().describe('Description'),
  triggerEventType: z.string().min(1).describe('Event type that triggers this'),
  conditionLogic: z.enum(['and', 'or']).default('and').describe('all (and) / any (or)'),
  enabled: z.boolean().default(true).describe('Enabled'),
  priority: z.number().int().default(0).describe('Higher runs first'),
});

export interface AutomationDraft {
  scalars: Record<string, unknown>;
  actions: unknown;
  triggerConditions: unknown;
  debounce: unknown;
}

/** Assemble the full automation body from the editor's parts. */
export function buildAutomationBody(draft: AutomationDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft.scalars)) {
    if (v !== undefined && v !== '') body[k] = v;
  }
  if (draft.actions !== undefined) body.actions = draft.actions;
  if (draft.triggerConditions !== undefined) body.triggerConditions = draft.triggerConditions;
  if (draft.debounce !== undefined) body.debounce = draft.debounce;
  return body;
}

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
}

/** Parse an assembled body through the real mirror schema; return flat errors. */
export function validateAutomationBody(body: unknown): ValidationOutcome {
  const result = automationCreateSchema.safeParse(body);
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** A minimal, valid starter automation (a no-op log action) for the editor. */
export const AUTOMATION_ACTIONS_TEMPLATE = [
  { type: 'log', config: { level: 'info', message: 'Matched: {{event.type}}' } },
];

/** A sample event for the test/execute panels, matched to the trigger type. */
export function sampleEvent(triggerEventType: string): { type: string; payload: Record<string, unknown> } {
  return {
    type: triggerEventType || 'message.received',
    payload: { content: { type: 'text', text: 'hello' }, chatId: 'sample-chat', instanceId: 'sample-instance' },
  };
}

const STATUS_VARIANTS: Record<string, 'green' | 'amber' | 'gray'> = {
  success: 'green',
  failed: 'amber',
  skipped: 'gray',
};

/** @khal-os/ui Badge variant for an automation-log status. */
export function logStatusVariant(status: string | undefined): 'green' | 'amber' | 'gray' {
  return (status && STATUS_VARIANTS[status]) || 'gray';
}
