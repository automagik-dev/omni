/**
 * Automation types
 *
 * These types are duplicated from @omni/db to avoid circular dependencies.
 * The database schema should match these types.
 */

/**
 * Condition operators for automation rules.
 */
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
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/**
 * Action types for automations.
 */
export const ACTION_TYPES = ['webhook', 'send_message', 'emit_event', 'log'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Debounce modes for message grouping in automations.
 */
export const AUTOMATION_DEBOUNCE_MODES = ['none', 'fixed', 'range', 'presence'] as const;
export type AutomationDebounceMode = (typeof AUTOMATION_DEBOUNCE_MODES)[number];

/**
 * Automation log status.
 */
export const AUTOMATION_LOG_STATUSES = ['success', 'failed', 'skipped'] as const;
export type AutomationLogStatus = (typeof AUTOMATION_LOG_STATUSES)[number];

/**
 * Automation condition
 */
export interface AutomationCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

/**
 * Webhook action configuration.
 */
export interface WebhookActionConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  waitForResponse?: boolean;
  timeoutMs?: number;
  responseAs?: string;
}

/**
 * Send message action configuration.
 */
export interface SendMessageActionConfig {
  instanceId?: string;
  to?: string;
  contentTemplate: string;
}

/**
 * Emit event action configuration.
 */
export interface EmitEventActionConfig {
  eventType: string;
  payloadTemplate?: Record<string, unknown>;
}

/**
 * Log action configuration.
 */
export interface LogActionConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

/**
 * Union type for action configurations.
 */
export type AutomationAction =
  | { type: 'webhook'; config: WebhookActionConfig }
  | { type: 'send_message'; config: SendMessageActionConfig }
  | { type: 'emit_event'; config: EmitEventActionConfig }
  | { type: 'log'; config: LogActionConfig };

/**
 * Debounce configuration for message grouping.
 */
export type DebounceConfig =
  | { mode: 'none' }
  | { mode: 'fixed'; delayMs: number }
  | { mode: 'range'; minMs: number; maxMs: number }
  | { mode: 'presence'; baseDelayMs: number; maxWaitMs?: number; extendOnEvents: string[] };

/**
 * Action execution result.
 */
export interface ActionExecutionResult {
  action: ActionType;
  status: 'success' | 'failed';
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Automation (from database)
 */
export interface Automation {
  id: string;
  name: string;
  description: string | null;
  triggerEventType: string;
  triggerConditions: AutomationCondition[] | null;
  actions: AutomationAction[];
  debounce: DebounceConfig | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Automation log entry
 */
export interface AutomationLog {
  id: string;
  automationId: string;
  eventId: string;
  status: AutomationLogStatus;
  conditionsMatched: boolean;
  actionsExecuted: ActionExecutionResult[] | null;
  error: string | null;
  executionTimeMs: number | null;
  createdAt: Date;
}

/**
 * New automation log (for insert)
 */
export interface NewAutomationLog {
  automationId: string;
  eventId: string;
  status: AutomationLogStatus;
  conditionsMatched: boolean;
  actionsExecuted?: ActionExecutionResult[];
  error?: string;
  executionTimeMs?: number;
}
