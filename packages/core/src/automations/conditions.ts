/**
 * Condition evaluator for automation rules
 *
 * Evaluates conditions against event payloads using dot notation field access.
 */

import type { AutomationCondition, ConditionOperator } from './types';

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
 * Check regex match
 */
function checkRegex(fieldValue: unknown, value: unknown): boolean {
  if (typeof fieldValue !== 'string' || typeof value !== 'string') return false;
  try {
    return new RegExp(value).test(fieldValue);
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
 * Returns true if ALL conditions match (AND logic)
 */
export function evaluateConditions(
  conditions: AutomationCondition[] | null | undefined,
  payload: Record<string, unknown>,
): boolean {
  // No conditions = always match
  if (!conditions || conditions.length === 0) {
    return true;
  }

  // All conditions must match (AND logic)
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
 */
export function evaluateConditionsWithDetails(
  conditions: AutomationCondition[] | null | undefined,
  payload: Record<string, unknown>,
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

  return {
    matched: results.every((r) => r.matched),
    conditions: results,
  };
}
