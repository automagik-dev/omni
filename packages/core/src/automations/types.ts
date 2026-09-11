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
export const ACTION_TYPES = ['webhook', 'send_message', 'emit_event', 'log', 'call_agent'] as const;
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
  /**
   * When no `bodyTemplate` is set, send the FULL OmniEvent envelope
   * (`id`, `type`, `payload`, `metadata`, `timestamp`) as the default body
   * instead of the bare payload (#960 — the khal/brain push-ingress
   * contract). Defaults to true; set false to keep the legacy bare-payload
   * default body. Ignored when `bodyTemplate` is set (the template contract
   * is preserved byte-identical) or when no envelope was threaded
   * (route-side manual execute), where the bare payload is sent as before.
   */
  includeEnvelope?: boolean;
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
 * Re-export types used by CallAgentActionConfig.
 * These are defined in other modules to avoid duplication.
 */
import type { AgentType } from '../types/agent';

/**
 * Session strategy for agent memory (matches @omni/db).
 */
export type AgentSessionStrategy = 'per_user' | 'per_chat';

/**
 * Call agent action configuration.
 * Invokes an AI agent and returns the response for use in subsequent actions.
 * This is a composable building block - use send_message to actually send the response.
 */
export interface CallAgentActionConfig {
  /** Provider ID (template: {{instance.agentProviderId}}) */
  providerId?: string;
  /** Agent ID (required or template) */
  agentId: string;
  /** Agent type: agent, team, or workflow */
  agentType?: AgentType;
  /** Session strategy for agent memory */
  sessionStrategy?: AgentSessionStrategy;
  /** Prefix messages with sender name: [Name]: message */
  prefixSenderName?: boolean;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Store agent response as variable for chaining (e.g., "agentResponse") */
  responseAs?: string;
  /**
   * Per-invocation synthetic prompt template that replaces the default
   * user-input prompt for this `call_agent` call only.
   *
   * When set, the rendered template is passed as the sole message to the
   * agent — the synthetic prompt is NOT written to chat history and should
   * not persist as agent session memory. Supports the same placeholders as
   * `send_message.contentTemplate` plus the follow-up-specific set:
   *   - `{{syntheticPrompt}}` — the raw synthetic prompt from the sweeper
   *   - `{{minutes}}` — minutes since last agent reply
   *   - `{{sequenceIndex}}` — zero-based follow-up index
   *   - `{{chatName}}` — chat display name when known
   *
   * @see packages/core/src/automations/templates.ts `TemplateContext.followUp`
   */
  promptOverride?: string;
}

/**
 * Union type for action configurations.
 */
export type AutomationAction =
  | { type: 'webhook'; config: WebhookActionConfig }
  | { type: 'send_message'; config: SendMessageActionConfig }
  | { type: 'emit_event'; config: EmitEventActionConfig }
  | { type: 'log'; config: LogActionConfig }
  | { type: 'call_agent'; config: CallAgentActionConfig };

/**
 * Debounce configuration for message grouping.
 */
export type DebounceConfig = (
  | { mode: 'none' }
  | { mode: 'fixed'; delayMs: number }
  | { mode: 'range'; minMs: number; maxMs: number }
  | { mode: 'presence'; baseDelayMs: number; maxWaitMs?: number; extendOnEvents: string[] }
) & {
  /**
   * What the window groups by (#1110) — a template over the event payload,
   * rendered with the same engine as conditions and action configs, e.g.
   * `{{payload.pull_request.id}}`.
   *
   * Absent = the conversation `${instanceId}:${personId}`, which is all this
   * primitive could ever group by before, so every existing row is unchanged.
   * Set = the rendered string namespaced by instance, which lets ANY event
   * type coalesce on the fact it describes, not on a chat.
   *
   * Rejected at validation with `mode: 'presence'`: `extendOnEvents` extends a
   * window on a contact's typing/recording, which has no meaning once the
   * window is not a conversation.
   */
  key?: string;
};

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
/**
 * Condition logic for combining multiple conditions
 */
export type ConditionLogic = 'and' | 'or';

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  triggerEventType: string;
  triggerConditions: AutomationCondition[] | null;
  conditionLogic: ConditionLogic | null;
  actions: AutomationAction[];
  debounce: DebounceConfig | null;
  enabled: boolean;
  priority: number;
  /**
   * Transactional publication (G5, #988): buffer the run's emit_event
   * publishes and flush in order only on a fully successful run. Optional so
   * pre-flag callers/tests need no change; absent = false = immediate
   * publishing.
   */
  transactionalEmissions?: boolean;
  /**
   * Per-automation concurrency limit (#1108). Absent/null = today's
   * behaviour: the run is queued per INSTANCE with the engine's default
   * limit. Set = a queue private to this automation with this limit; `1` is
   * strict single-flight, which is what a read-before-write action needs so
   * two events for the same fact cannot both read the pre-write snapshot.
   */
  maxConcurrency?: number | null;
  /**
   * Optional template over the event payload partitioning the per-automation
   * queue (#1108) — e.g. `{{payload.from.id}}` serializes per chat rather
   * than globally. Absent/null = one queue for the whole automation.
   */
  concurrencyKey?: string | null;
  /**
   * Agent whose event manifest governs this automation (RFC #925 G4).
   * Stamped by the G4b compiler (#986) when the row is compiled from a
   * manifest's `accepts` entries; null/absent = hand-authored. Two consumers:
   * the engine threads it into the emit path so the G4c publish-allowlist
   * gate (#987) enforces the agent's `publishes` declarations (hand-authored
   * emissions stay ungoverned), and the API service layer gates manual CRUD
   * on managed rows (edit the manifest instead).
   */
  managedByAgentId?: string | null;
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
