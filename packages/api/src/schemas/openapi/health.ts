/**
 * OpenAPI schemas for health endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

/**
 * Health check status
 */
export const HealthCheckSchema = z.object({
  status: z.enum(['ok', 'error']).openapi({ description: 'Check status' }),
  latency: z.number().optional().openapi({ description: 'Latency in milliseconds' }),
  error: z.string().optional().openapi({ description: 'Error message if status is error' }),
  details: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Additional details' }),
});

/**
 * Health response schema
 */
export const HealthResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']).openapi({ description: 'Overall health status' }),
  version: z.string().openapi({ description: 'API version' }),
  uptime: z.number().int().openapi({ description: 'Uptime in seconds' }),
  timestamp: z.string().datetime().openapi({ description: 'Current timestamp' }),
  checks: z.object({
    database: HealthCheckSchema,
    nats: HealthCheckSchema,
  }),
  instances: z
    .object({
      total: z.number().int().openapi({ description: 'Total instance count' }),
      connected: z.number().int().openapi({ description: 'Connected instance count' }),
      byChannel: z.record(z.string(), z.number()).openapi({ description: 'Count by channel type' }),
    })
    .optional(),
});

/**
 * Info response schema
 */
export const InfoResponseSchema = z.object({
  version: z.string().openapi({ description: 'API version' }),
  environment: z.string().openapi({ description: 'Environment' }),
  uptime: z.number().int().openapi({ description: 'Uptime in seconds' }),
  instances: z.object({
    total: z.number().int(),
    connected: z.number().int(),
  }),
  events: z.object({
    today: z.number().int(),
    total: z.number().int(),
  }),
});

/**
 * Internal health response schema
 */
export const InternalHealthResponseSchema = z.object({
  status: z.string().openapi({ description: 'Health status' }),
  service: z.string().openapi({ description: 'Service name' }),
  pid: z.number().int().openapi({ description: 'Process ID' }),
  memory: z.object({
    rss: z.number(),
    heapTotal: z.number(),
    heapUsed: z.number(),
    external: z.number(),
    arrayBuffers: z.number(),
  }),
});

/**
 * Register health schemas and paths with the given registry
 */
export function registerHealthSchemas(registry: OpenAPIRegistry): void {
  registry.register('HealthCheck', HealthCheckSchema);
  registry.register('HealthResponse', HealthResponseSchema);
  registry.register('InfoResponse', InfoResponseSchema);
  registry.register('InternalHealthResponse', InternalHealthResponseSchema);

  // Register paths
  registry.registerPath({
    method: 'get',
    path: '/health',
    operationId: 'getHealth',
    tags: ['System'],
    summary: 'Health check',
    description: 'Check the health status of the API and its dependencies.',
    security: [],
    responses: {
      200: {
        description: 'System is healthy',
        content: {
          'application/json': { schema: HealthResponseSchema },
        },
      },
      503: {
        description: 'System is unhealthy or degraded',
        content: {
          'application/json': { schema: HealthResponseSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/info',
    operationId: 'getInfo',
    tags: ['System'],
    summary: 'System info',
    description: 'Get system information and basic statistics.',
    security: [],
    responses: {
      200: {
        description: 'System information',
        content: {
          'application/json': { schema: InfoResponseSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/_internal/health',
    operationId: 'getInternalHealth',
    tags: ['System'],
    summary: 'Internal health check',
    description: 'Detailed health information for internal monitoring. Only accessible from localhost.',
    security: [],
    responses: {
      200: {
        description: 'Internal health status',
        content: {
          'application/json': { schema: InternalHealthResponseSchema },
        },
      },
    },
  });
}
