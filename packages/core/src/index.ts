/**
 * @omni/core - Shared types, schemas, and utilities
 *
 * This package provides the foundation for all Omni v2 packages:
 * - Event types and bus interface
 * - Zod schemas for validation
 * - TypeScript types for channels and agents
 * - Error classes
 * - ID generation utilities
 * - Unified logging system
 */

// Events
export * from './events';

// Schemas
export * from './schemas';

// Types
export * from './types';

// Errors
export * from './errors';

// IDs
export * from './ids';

// Logger
export {
  createLogger,
  configureLogging,
  getLogConfig,
  rootLogger,
  getLogBuffer,
  type Logger,
  type LogLevel,
  type LogEntry,
  type LogConfig,
  type LogFormat,
} from './logger';
