/**
 * Metrics Module
 *
 * Prometheus-compatible metrics using prom-client.
 * Provides application, NATS, database, and system metrics.
 *
 * @see events-ops wish (DEC-4, DEC-8)
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Singleton registry for all metrics
 */
const registry = new Registry();

/**
 * Get the metrics registry
 */
export function getRegistry(): Registry {
  return registry;
}

/**
 * Collect default Node.js metrics (CPU, memory, event loop, etc.)
 */
export function enableDefaultMetrics(): void {
  collectDefaultMetrics({ register: registry });
}

/**
 * Get all metrics in Prometheus text format
 */
export async function getMetricsText(): Promise<string> {
  return registry.metrics();
}

/**
 * Get all metrics as JSON
 */
export async function getMetricsJson(): Promise<unknown[]> {
  return registry.getMetricsAsJSON();
}

// ============================================================================
// EVENT METRICS
// ============================================================================

/**
 * Counter for events processed
 */
export const eventsProcessed = new Counter({
  name: 'omni_events_processed_total',
  help: 'Total number of events processed',
  labelNames: ['event_type', 'status'] as const,
  registers: [registry],
});

/**
 * Histogram for event processing duration
 */
export const eventProcessingDuration = new Histogram({
  name: 'omni_event_processing_duration_seconds',
  help: 'Event processing duration in seconds',
  labelNames: ['event_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * Gauge for dead letters pending
 */
export const deadLettersPending = new Gauge({
  name: 'omni_dead_letters_pending',
  help: 'Number of pending dead letter events',
  registers: [registry],
});

/**
 * Counter for dead letter operations
 */
export const deadLetterOperations = new Counter({
  name: 'omni_dead_letter_operations_total',
  help: 'Total dead letter operations',
  labelNames: ['operation', 'result'] as const,
  registers: [registry],
});

/**
 * Gauge for payload storage size
 */
export const payloadStorageSize = new Gauge({
  name: 'omni_payload_storage_bytes',
  help: 'Total payload storage size in bytes',
  registers: [registry],
});

/**
 * Counter for payload operations
 */
export const payloadOperations = new Counter({
  name: 'omni_payload_operations_total',
  help: 'Total payload operations',
  labelNames: ['operation', 'stage'] as const,
  registers: [registry],
});

// ============================================================================
// NATS METRICS
// ============================================================================

/**
 * Gauge for NATS connection status
 */
export const natsConnectionStatus = new Gauge({
  name: 'omni_nats_connection_status',
  help: 'NATS connection status (1=connected, 0=disconnected)',
  registers: [registry],
});

/**
 * Counter for NATS messages published
 */
export const natsMessagesPublished = new Counter({
  name: 'omni_nats_messages_published_total',
  help: 'Total NATS messages published',
  labelNames: ['stream'] as const,
  registers: [registry],
});

/**
 * Counter for NATS messages received
 */
export const natsMessagesReceived = new Counter({
  name: 'omni_nats_messages_received_total',
  help: 'Total NATS messages received',
  labelNames: ['stream', 'consumer'] as const,
  registers: [registry],
});

/**
 * Histogram for NATS publish latency
 */
export const natsPublishLatency = new Histogram({
  name: 'omni_nats_publish_latency_seconds',
  help: 'NATS publish latency in seconds',
  labelNames: ['stream'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/**
 * Gauge for NATS pending messages per consumer
 */
export const natsPendingMessages = new Gauge({
  name: 'omni_nats_pending_messages',
  help: 'Number of pending messages per consumer',
  labelNames: ['stream', 'consumer'] as const,
  registers: [registry],
});

// ============================================================================
// DATABASE METRICS
// ============================================================================

/**
 * Gauge for database pool size
 */
export const dbPoolSize = new Gauge({
  name: 'omni_db_pool_size',
  help: 'Database connection pool size',
  labelNames: ['state'] as const, // idle, active, waiting
  registers: [registry],
});

/**
 * Counter for database queries
 */
export const dbQueries = new Counter({
  name: 'omni_db_queries_total',
  help: 'Total database queries executed',
  labelNames: ['operation'] as const, // select, insert, update, delete
  registers: [registry],
});

/**
 * Histogram for database query duration
 */
export const dbQueryDuration = new Histogram({
  name: 'omni_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/**
 * Counter for database errors
 */
export const dbErrors = new Counter({
  name: 'omni_db_errors_total',
  help: 'Total database errors',
  labelNames: ['error_type'] as const,
  registers: [registry],
});

// ============================================================================
// SYSTEM METRICS
// ============================================================================

/**
 * Gauge for application uptime
 */
export const appUptime = new Gauge({
  name: 'omni_app_uptime_seconds',
  help: 'Application uptime in seconds',
  registers: [registry],
});

/**
 * Gauge for active HTTP connections
 */
export const httpActiveConnections = new Gauge({
  name: 'omni_http_active_connections',
  help: 'Number of active HTTP connections',
  registers: [registry],
});

/**
 * Counter for HTTP requests
 */
export const httpRequests = new Counter({
  name: 'omni_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

/**
 * Histogram for HTTP request duration
 */
export const httpRequestDuration = new Histogram({
  name: 'omni_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ============================================================================
// SCHEDULER METRICS
// ============================================================================

/**
 * Counter for scheduled job runs
 */
export const scheduledJobRuns = new Counter({
  name: 'omni_scheduled_job_runs_total',
  help: 'Total scheduled job runs',
  labelNames: ['job', 'result'] as const, // result: success, failure
  registers: [registry],
});

/**
 * Histogram for scheduled job duration
 */
export const scheduledJobDuration = new Histogram({
  name: 'omni_scheduled_job_duration_seconds',
  help: 'Scheduled job duration in seconds',
  labelNames: ['job'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

/**
 * Gauge for next scheduled job run
 */
export const scheduledJobNextRun = new Gauge({
  name: 'omni_scheduled_job_next_run_timestamp',
  help: 'Unix timestamp of next scheduled job run',
  labelNames: ['job'] as const,
  registers: [registry],
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Record event processing
 */
export function recordEventProcessed(eventType: string, status: 'success' | 'failure', durationSeconds: number): void {
  eventsProcessed.inc({ event_type: eventType, status });
  eventProcessingDuration.observe({ event_type: eventType }, durationSeconds);
}

/**
 * Record dead letter operation
 */
export function recordDeadLetterOp(
  operation: 'create' | 'retry' | 'resolve' | 'abandon',
  result: 'success' | 'failure',
): void {
  deadLetterOperations.inc({ operation, result });
}

/**
 * Record payload operation
 */
export function recordPayloadOp(operation: 'store' | 'retrieve' | 'delete', stage: string): void {
  payloadOperations.inc({ operation, stage });
}

/**
 * Record HTTP request
 */
export function recordHttpRequest(method: string, route: string, status: number, durationSeconds: number): void {
  httpRequests.inc({ method, route, status: String(status) });
  httpRequestDuration.observe({ method, route }, durationSeconds);
}

/**
 * Record scheduled job execution
 */
export function recordScheduledJob(job: string, result: 'success' | 'failure', durationSeconds: number): void {
  scheduledJobRuns.inc({ job, result });
  scheduledJobDuration.observe({ job }, durationSeconds);
}

/**
 * Update system metrics
 */
export function updateSystemMetrics(uptimeSeconds: number): void {
  appUptime.set(uptimeSeconds);
}

/**
 * Update NATS connection status
 */
export function updateNatsStatus(connected: boolean): void {
  natsConnectionStatus.set(connected ? 1 : 0);
}

/**
 * Update database pool metrics
 */
export function updateDbPoolMetrics(idle: number, active: number, waiting: number): void {
  dbPoolSize.set({ state: 'idle' }, idle);
  dbPoolSize.set({ state: 'active' }, active);
  dbPoolSize.set({ state: 'waiting' }, waiting);
}

/**
 * Reset all metrics (useful for testing)
 */
export async function resetMetrics(): Promise<void> {
  registry.resetMetrics();
}
