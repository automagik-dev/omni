/**
 * Plugin validator
 *
 * Validates that a loaded module is a valid channel plugin
 */

import { CHANNEL_TYPES, type ChannelType } from '@omni/core/types';

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate that a value is a valid channel type
 */
export function isValidChannelType(value: unknown): value is ChannelType {
  return typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value);
}

/**
 * Required methods that must be functions
 */
const REQUIRED_METHODS = [
  'initialize',
  'destroy',
  'connect',
  'disconnect',
  'getStatus',
  'getConnectedInstances',
  'sendMessage',
  'getHealth',
] as const;

/**
 * Validate required string properties
 */
function validateStringProperty(p: Record<string, unknown>, field: string, errors: ValidationError[]): void {
  if (typeof p[field] !== 'string' || (p[field] as string).length === 0) {
    errors.push({ field, message: `${field} must be a non-empty string` });
  }
}

/**
 * Validate required method properties
 */
function validateMethods(p: Record<string, unknown>, errors: ValidationError[]): void {
  for (const method of REQUIRED_METHODS) {
    if (typeof p[method] !== 'function') {
      errors.push({ field: method, message: `${method} must be a function` });
    }
  }
}

/**
 * Validate a plugin structure
 *
 * Checks that the plugin has all required properties and methods.
 */
export function validatePluginInterface(plugin: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!plugin || typeof plugin !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'plugin', message: 'Plugin must be an object' }],
    };
  }

  const p = plugin as Record<string, unknown>;

  // Validate id specially (needs channel type check)
  if (typeof p.id !== 'string' || p.id.length === 0) {
    errors.push({ field: 'id', message: 'id must be a non-empty string' });
  } else if (!isValidChannelType(p.id)) {
    errors.push({
      field: 'id',
      message: `id must be a valid ChannelType: ${CHANNEL_TYPES.join(', ')}`,
    });
  }

  // Validate other string properties
  validateStringProperty(p, 'name', errors);
  validateStringProperty(p, 'version', errors);

  // Validate capabilities
  if (!p.capabilities || typeof p.capabilities !== 'object') {
    errors.push({ field: 'capabilities', message: 'capabilities must be an object' });
  }

  // Validate methods
  validateMethods(p, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a formatted validation error message
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `- ${e.field}: ${e.message}`).join('\n');
}
