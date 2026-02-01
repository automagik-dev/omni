/**
 * OpenAPI schemas for metrics endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

export function registerMetricsSchemas(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: '/metrics',
    tags: ['Metrics'],
    summary: 'Get Prometheus metrics',
    description: 'Get metrics in Prometheus text format (default) or JSON format.',
    responses: {
      200: {
        description: 'Metrics in Prometheus or JSON format',
        content: {
          'text/plain': { schema: z.string().openapi({ description: 'Prometheus text format' }) },
          'application/json': {
            schema: z.object({
              gauges: z.record(z.string(), z.number()).optional(),
              counters: z.record(z.string(), z.number()).optional(),
              histograms: z.record(z.string(), z.unknown()).optional(),
            }),
          },
        },
      },
    },
  });
}
