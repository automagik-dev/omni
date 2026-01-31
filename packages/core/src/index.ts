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
 * - Scheduler for periodic jobs
 * - Prometheus metrics
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

// Scheduler
export {
  Scheduler,
  getScheduler,
  resetScheduler,
  CronExpressions,
  type JobConfig,
  type JobHandler,
  type Job,
} from './scheduler';

// Metrics
export * from './metrics';
