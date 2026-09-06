/**
 * Template substitution for automation actions
 *
 * Supports:
 * - {{payload.field}} - Access payload fields
 * - {{env.VAR_NAME}} - Access environment variables
 * - {{varName.field}} - Access stored variables (from webhook responses)
 * - {{messages}} - Special: array of grouped messages (debounce)
 * - {{from}} - Special: sender object (debounce)
 * - {{instanceId}} - Special: instance ID (debounce)
 * - {{syntheticPrompt}} - Special: synthetic idle-follow-up prompt (follow-up)
 * - {{minutes}} - Special: minutes since last agent reply (follow-up)
 * - {{sequenceIndex}} - Special: zero-based follow-up index (follow-up)
 * - {{attemptNumber}} - Special: one-based attempt number (follow-up)
 * - {{totalAttempts}} - Special: total attempts configured (follow-up)
 * - {{chatName}} - Special: chat display name (follow-up)
 * - {{event.id}} - Envelope: id of the triggering event (#960)
 * - {{event.type}} - Envelope: type of the triggering event
 * - {{event.timestamp}} - Envelope: publish timestamp (Unix ms)
 * - {{event.metadata.correlationId}} - Envelope: correlation of the flow
 *   (any `event.metadata.*` field resolves; absent for envelope-less
 *   invocations, where `{{event.*}}` renders empty)
 */

import type { EventMetadata } from '../events/types';
import { getNestedValue } from './conditions';

/**
 * Envelope of the event that triggered the automation (issue #956).
 *
 * The engine threads this alongside the payload so actions can propagate the
 * TRIGGERING event's correlation/causality into their own side effects
 * (emit_event re-publish, webhook headers, call_agent context) instead of
 * fishing correlation out of the payload — payloads don't carry correlation,
 * envelopes do. For a debounced (synthetic) trigger, `id` is the id of the
 * last REAL event that entered the window, so causal links always point at a
 * published event.
 *
 * Route-side manual `execute` calls and legacy tests thread nothing and the
 * field stays undefined — actions then behave exactly as before.
 */
export interface TemplateEventContext {
  /** Id of the triggering event (last real event for debounced windows). */
  id: string;
  /** Event type of the trigger. */
  type: string;
  /** Publish timestamp of the trigger (Unix ms). */
  timestamp: number;
  /** The trigger's envelope metadata (correlationId et al.) as stamped by the producer. */
  metadata: EventMetadata;
}

/**
 * Follow-up context surfaced to templates when an automation fires on a
 * `chat.idle_timeout` event (or is invoked via `call_agent.promptOverride`).
 *
 * Auto-derived by `createTemplateContext` from a `chat.idle_timeout`-shaped
 * payload, or provided explicitly by callers.
 *
 * @see issue #404 — Configurable Idle-Chat Follow-Up Sequences
 */
export interface TemplateFollowUpContext {
  /** The rendered synthetic prompt from the sweeper. */
  syntheticPrompt: string;
  /** Minutes since the agent's last reply to this chat. */
  minutes: number;
  /** Zero-based index of the follow-up about to fire. */
  sequenceIndex: number;
  /** One-based attempt number (`sequenceIndex + 1`) — prefer this in LLM prompts. */
  attemptNumber: number;
  /** Total attempts configured (`maxFollowUps`) — prefer this in LLM prompts. */
  totalAttempts: number;
  /** Chat display name when known; null otherwise. */
  chatName: string | null;
}

/**
 * Context for template substitution
 */
export interface TemplateContext {
  /** The event payload */
  payload: Record<string, unknown>;
  /** Stored variables from previous actions (e.g., webhook responses) */
  variables: Record<string, unknown>;
  /** Environment variables (process.env) */
  env: Record<string, string | undefined>;
  /** Special debounce context */
  debounce?: {
    messages: Array<{
      type: string;
      text?: string;
      timestamp: number;
    }>;
    from: {
      id: string;
      name?: string;
    };
    instanceId: string;
  };
  /** Special follow-up context (chat.idle_timeout events / promptOverride) */
  followUp?: TemplateFollowUpContext;
  /** Envelope of the triggering event — threaded by the engine, see TemplateEventContext. */
  event?: TemplateEventContext;
  /** The automation being executed — threaded by the engine (delivery-id derivation, #960). */
  automation?: { id: string };
}

/**
 * Regex to match template expressions: {{path}} or {{path.nested}}
 */
const TEMPLATE_REGEX = /\{\{([^}]+)\}\}/g;

/**
 * Resolve debounce-specific paths
 */
function resolveDebounceValue(
  trimmed: string,
  rest: string,
  debounce: NonNullable<TemplateContext['debounce']>,
): unknown {
  if (trimmed === 'messages') return debounce.messages;
  if (trimmed === 'instanceId') return debounce.instanceId;
  if (trimmed === 'from') return debounce.from;
  if (trimmed.startsWith('from.') && rest) return getNestedValue(debounce.from, rest);
  return undefined;
}

/**
 * Resolve follow-up-specific placeholders. Returns `undefined` when the key
 * isn't a follow-up placeholder so callers can fall through to the next
 * resolver.
 */
function resolveFollowUpValue(trimmed: string, followUp: TemplateFollowUpContext): unknown {
  switch (trimmed) {
    case 'syntheticPrompt':
      return followUp.syntheticPrompt;
    case 'minutes':
      return followUp.minutes;
    case 'sequenceIndex':
      return followUp.sequenceIndex;
    case 'attemptNumber':
      return followUp.attemptNumber;
    case 'totalAttempts':
      return followUp.totalAttempts;
    case 'chatName':
      return followUp.chatName;
    default:
      return undefined;
  }
}

/**
 * Resolve the special context roots: debounce placeholders, follow-up
 * placeholders, and the triggering-envelope root ({{event.id}},
 * {{event.metadata.correlationId}}, ... — #960). The envelope resolves
 * before the variables fallback, so a stored variable named `event` is
 * shadowed only when an envelope was actually threaded. Returns `undefined`
 * when the key belongs to none of them so the caller falls through.
 */
function resolveSpecialValue(trimmed: string, root: string, rest: string, context: TemplateContext): unknown {
  if (context.debounce) {
    const debounceValue = resolveDebounceValue(trimmed, rest, context.debounce);
    if (debounceValue !== undefined) return debounceValue;
  }
  if (context.followUp) {
    const followUpValue = resolveFollowUpValue(trimmed, context.followUp);
    if (followUpValue !== undefined) return followUpValue;
  }
  if (root === 'event' && context.event) {
    return rest ? getNestedValue(context.event, rest) : context.event;
  }
  return undefined;
}

/**
 * Resolve a single template path to its value
 */
function resolveTemplatePath(path: string, context: TemplateContext): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split('.');
  const root = parts[0] ?? '';
  const rest = parts.slice(1).join('.');

  const specialValue = resolveSpecialValue(trimmed, root, rest, context);
  if (specialValue !== undefined) return specialValue;

  // Handle payload access
  if (root === 'payload') return rest ? getNestedValue(context.payload, rest) : context.payload;

  // Handle env access
  if (root === 'env') return rest ? context.env[rest] : undefined;

  // Handle variable access (stored from previous actions)
  if (root && context.variables[root] !== undefined) {
    return rest ? getNestedValue(context.variables[root], rest) : context.variables[root];
  }

  // Fallback: try to find in payload directly
  return getNestedValue(context.payload, trimmed);
}

/**
 * Format a value for string substitution
 */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Substitute template expressions in a string
 *
 * @example
 * substituteTemplate('Hello {{payload.name}}!', context)
 * // Returns: 'Hello John!'
 */
export function substituteTemplate(template: string, context: TemplateContext): string {
  return template.replace(TEMPLATE_REGEX, (_match, path) => {
    const value = resolveTemplatePath(path, context);
    return formatValue(value);
  });
}

/**
 * Substitute templates in an object (recursively)
 * Returns a new object with all string values substituted
 */
export function substituteTemplateObject<T extends Record<string, unknown>>(obj: T, context: TemplateContext): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = substituteTemplate(value, context);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = substituteTemplateObject(value as Record<string, unknown>, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === 'string') {
          return substituteTemplate(item, context);
        }
        if (typeof item === 'object' && item !== null) {
          return substituteTemplateObject(item as Record<string, unknown>, context);
        }
        return item;
      });
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Parse a JSON template string and substitute values
 *
 * @example
 * parseJsonTemplate('{"message": "{{payload.text}}"}', context)
 * // Returns: { message: 'Hello' }
 */
export function parseJsonTemplate(template: string, context: TemplateContext): Record<string, unknown> {
  // First substitute the template
  const substituted = substituteTemplate(template, context);

  // Then parse as JSON
  try {
    return JSON.parse(substituted);
  } catch (error) {
    throw new Error(`Failed to parse JSON template: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Derive a `TemplateFollowUpContext` from a `chat.idle_timeout`-shaped
 * payload. Returns `undefined` when the payload is missing any of the three
 * mandatory fields (`syntheticPrompt`, `sequenceIndex`,
 * `minutesSinceLastAgentReply`).
 *
 * Exported so the automation engine can explicitly invoke it for synthetic
 * events (e.g. debounce-driven rebuilds) without reaching into this module's
 * internals.
 */
export function deriveFollowUpFromPayload(payload: Record<string, unknown>): TemplateFollowUpContext | undefined {
  const syntheticPrompt = payload.syntheticPrompt;
  const sequenceIndex = payload.sequenceIndex;
  const minutes = payload.minutesSinceLastAgentReply;

  if (typeof syntheticPrompt !== 'string' || typeof sequenceIndex !== 'number' || typeof minutes !== 'number') {
    return undefined;
  }

  const chatName = typeof payload.chatName === 'string' ? payload.chatName : null;
  // Prefer payload-provided values when the sweeper emits them; fall back to
  // derivation for older events that predate the attemptNumber/totalAttempts
  // fields (totalAttempts has no sensible default, so 0 signals "unknown").
  const attemptNumber = typeof payload.attemptNumber === 'number' ? payload.attemptNumber : sequenceIndex + 1;
  const totalAttempts = typeof payload.totalAttempts === 'number' ? payload.totalAttempts : 0;

  return {
    syntheticPrompt,
    sequenceIndex,
    attemptNumber,
    totalAttempts,
    minutes,
    chatName,
  };
}

/**
 * Create a template context from event data
 *
 * Auto-derives `followUp` from the payload when it has the follow-up shape
 * (see `deriveFollowUpFromPayload`). Callers can override by passing
 * `options.followUp` explicitly.
 */
export function createTemplateContext(
  payload: Record<string, unknown>,
  options: {
    variables?: Record<string, unknown>;
    debounce?: TemplateContext['debounce'];
    followUp?: TemplateFollowUpContext;
    event?: TemplateEventContext;
    automation?: { id: string };
  } = {},
): TemplateContext {
  const followUp = options.followUp ?? deriveFollowUpFromPayload(payload);

  return {
    payload,
    variables: options.variables ?? {},
    env: process.env as Record<string, string | undefined>,
    debounce: options.debounce,
    followUp,
    event: options.event,
    automation: options.automation,
  };
}
