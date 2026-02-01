/**
 * OpenAPI schemas for log endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

// Log entry schema
export const LogEntrySchema = z.object({
  time: z.number().openapi({ description: 'Timestamp (ms)' }),
  level: z.enum(['debug', 'info', 'warn', 'error']).openapi({ description: 'Log level' }),
  module: z.string().openapi({ description: 'Module name' }),
  msg: z.string().openapi({ description: 'Log message' }),
  // Additional fields are dynamic
});

export function registerLogSchemas(registry: OpenAPIRegistry): void {
  registry.register('LogEntry', LogEntrySchema);

  registry.registerPath({
    method: 'get',
    path: '/logs/stream',
    tags: ['Logs'],
    summary: 'Stream logs (SSE)',
    description: 'Stream logs in real-time via Server-Sent Events. Heartbeat sent every 30 seconds.',
    request: {
      query: z.object({
        modules: z.string().optional().openapi({ description: 'Module filters (comma-separated, supports wildcards)' }),
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info').openapi({ description: 'Minimum log level' }),
      }),
    },
    responses: {
      200: {
        description: 'SSE stream of log entries',
        content: { 'text/event-stream': { schema: z.string() } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/logs/recent',
    tags: ['Logs'],
    summary: 'Get recent logs',
    description: 'Get recent log entries from the in-memory buffer.',
    request: {
      query: z.object({
        modules: z.string().optional().openapi({ description: 'Module filters (comma-separated, supports wildcards)' }),
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info').openapi({ description: 'Minimum log level' }),
        limit: z.number().int().min(1).max(1000).default(100).openapi({ description: 'Maximum entries' }),
      }),
    },
    responses: {
      200: {
        description: 'Recent log entries',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(LogEntrySchema),
              meta: z.object({
                total: z.number().int(),
                bufferSize: z.number().int(),
                limit: z.number().int(),
              }),
            }),
          },
        },
      },
    },
  });
}
