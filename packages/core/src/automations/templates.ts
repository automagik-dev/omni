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
 */

import { getNestedValue } from './conditions';

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
 * Resolve a single template path to its value
 */
function resolveTemplatePath(path: string, context: TemplateContext): unknown {
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  const parts = trimmed.split('.');
  const root = parts[0] ?? '';
  const rest = parts.slice(1).join('.');

  // Handle special debounce variables
  if (context.debounce) {
    const debounceValue = resolveDebounceValue(trimmed, rest, context.debounce);
    if (debounceValue !== undefined) return debounceValue;
  }

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
 * Create a template context from event data
 */
export function createTemplateContext(
  payload: Record<string, unknown>,
  options: {
    variables?: Record<string, unknown>;
    debounce?: TemplateContext['debounce'];
  } = {},
): TemplateContext {
  return {
    payload,
    variables: options.variables ?? {},
    env: process.env as Record<string, string | undefined>,
    debounce: options.debounce,
  };
}
