/**
 * Condition evaluator for automation rules
 *
 * Evaluates conditions against event payloads using dot notation field access.
 */

import { createLogger } from '../logger';
import type { AutomationCondition, ConditionLogic, ConditionOperator } from './types';

const logger = createLogger('automations:conditions');

/** Maximum length of string to test against regex (ReDoS protection) */
const MAX_REGEX_INPUT_LENGTH = 10000;

/** Maximum length of regex pattern (ReDoS protection) */
const MAX_REGEX_PATTERN_LENGTH = 500;

/** Pattern to detect potentially dangerous regex (nested quantifiers, etc.) */
const DANGEROUS_REGEX_PATTERN = /(\+|\*|\?|\{[0-9,]+\})\)?(\+|\*|\?|\{[0-9,]+\})/;

/**
 * Get a value from an object using dot notation path
 * Supports array indexing: 'items.0.name'
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!path || obj === null || obj === undefined) {
    return undefined;
  }

  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array indexing
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Compare numbers with an operator
 */
function compareNumbers(fieldValue: unknown, value: unknown, op: 'gt' | 'lt' | 'gte' | 'lte'): boolean {
  if (typeof fieldValue !== 'number' || typeof value !== 'number') return false;
  switch (op) {
    case 'gt':
      return fieldValue > value;
    case 'lt':
      return fieldValue < value;
    case 'gte':
      return fieldValue >= value;
    case 'lte':
      return fieldValue <= value;
  }
}

/**
 * Check if fieldValue contains value
 */
function checkContains(fieldValue: unknown, value: unknown): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.includes(value);
  if (typeof fieldValue === 'string' && typeof value === 'string') return fieldValue.includes(value);
  return false;
}

/**
 * Check if a regex pattern is potentially dangerous (ReDoS)
 */
function isDangerousRegex(pattern: string): boolean {
  // Check pattern length
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return true;
  }

  // Check for nested quantifiers (e.g., (a+)+, (a*)*b)
  if (DANGEROUS_REGEX_PATTERN.test(pattern)) {
    return true;
  }

  return false;
}

/**
 * Check regex match with ReDoS protection
 */
function checkRegex(fieldValue: unknown, value: unknown): boolean {
  if (typeof fieldValue !== 'string' || typeof value !== 'string') return false;

  // ReDoS protection: check pattern safety
  if (isDangerousRegex(value)) {
    logger.warn('Regex pattern rejected as potentially dangerous', {
      patternLength: value.length,
      maxLength: MAX_REGEX_PATTERN_LENGTH,
    });
    return false;
  }

  // ReDoS protection: limit input length
  const testValue =
    fieldValue.length > MAX_REGEX_INPUT_LENGTH ? fieldValue.slice(0, MAX_REGEX_INPUT_LENGTH) : fieldValue;

  try {
    return new RegExp(value).test(testValue);
  } catch {
    return false;
  }
}

/**
 * Evaluate a single condition against a value
 */
export function evaluateCondition(condition: AutomationCondition, payload: Record<string, unknown>): boolean {
  const { field, operator, value } = condition;
  const fieldValue = getNestedValue(payload, field);

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'neq':
      return fieldValue !== value;
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte':
      return compareNumbers(fieldValue, value, operator);
    case 'contains':
      return checkContains(fieldValue, value);
    case 'not_contains':
      return !checkContains(fieldValue, value);
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    case 'regex':
      return checkRegex(fieldValue, value);
    default:
      return false;
  }
}

/**
 * Evaluate all conditions against a payload
 *
 * @param conditions - Array of conditions to evaluate
 * @param payload - Event payload to evaluate against
 * @param logic - 'and' (all must match) or 'or' (any must match). Defaults to 'and'.
 * @returns true if conditions match according to the logic
 */
export function evaluateConditions(
  conditions: AutomationCondition[] | null | undefined,
  payload: Record<string, unknown>,
  logic: ConditionLogic = 'and',
): boolean {
  // No conditions = always match
  if (!conditions || conditions.length === 0) {
    return true;
  }

  if (logic === 'or') {
    // ANY condition must match (OR logic)
    return conditions.some((condition) => evaluateCondition(condition, payload));
  }

  // ALL conditions must match (AND logic) - default
  return conditions.every((condition) => evaluateCondition(condition, payload));
}

/**
 * Condition evaluation result with details for logging
 */
export interface ConditionEvaluationResult {
  matched: boolean;
  conditions: Array<{
    field: string;
    operator: ConditionOperator;
    expectedValue: unknown;
    actualValue: unknown;
    matched: boolean;
  }>;
}

/**
 * Evaluate conditions with detailed results for debugging/logging
 *
 * @param conditions - Array of conditions to evaluate
 * @param payload - Event payload to evaluate against
 * @param logic - 'and' (all must match) or 'or' (any must match). Defaults to 'and'.
 */
export function evaluateConditionsWithDetails(
  conditions: AutomationCondition[] | null | undefined,
  payload: Record<string, unknown>,
  logic: ConditionLogic = 'and',
): ConditionEvaluationResult {
  if (!conditions || conditions.length === 0) {
    return { matched: true, conditions: [] };
  }

  const results = conditions.map((condition) => ({
    field: condition.field,
    operator: condition.operator,
    expectedValue: condition.value,
    actualValue: getNestedValue(payload, condition.field),
    matched: evaluateCondition(condition, payload),
  }));

  const matched = logic === 'or' ? results.some((r) => r.matched) : results.every((r) => r.matched);

  return {
    matched,
    conditions: results,
  };
}
