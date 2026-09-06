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

// Observability sink — redacted tenant fields for audit logs and traces (G5;
// ADR-0008). The bounded/redacted metric-label counterpart travels with ./metrics.
export * from './observability';

// Tenant-bound secret sealing — credential/session-secret encryption with a
// per-tenant key + tenant-as-AAD binding (G5; ADR-0008;
// OWNERSHIP_MANIFEST `filesystem_session_state`).
export * from './secrets';

// Automations
export * from './automations';

// Connector lifecycle contract (#961)
export * from './connectors';

// Sessions
export * from './sessions/reset';

// Providers
export * from './providers';

// Cache
export * from './cache';

// Tracing
export * from './tracing';

// Hooks
export * from './hooks';

// Tenant-egress broker (ADR-0009). The architecture guard beside it is a
// dev/test tool and is intentionally NOT re-exported from the package root.
export * from './egress';

// WhatsApp text formatting — compartilhado pelos DOIS canais WhatsApp
// (baileys e cloud), que precisam converter markdown igual.
export { markdownToWhatsApp } from './markdown-to-whatsapp';
