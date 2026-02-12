/**
 * OpenAPI schemas for journey tracing endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

const JourneyCheckpointSchema = z.object({
  name: z.string().openapi({ description: 'Checkpoint name (e.g., platformReceivedAt)' }),
  stage: z.string().openapi({ description: 'Stage key (e.g., T0, T1)' }),
  timestamp: z.number().openapi({ description: 'Unix millisecond timestamp' }),
});

const JourneyLatenciesSchema = z.object({
  channelProcessing: z.number().optional().openapi({ description: 'T1 - T0 (ms)' }),
  eventPublish: z.number().optional().openapi({ description: 'T2 - T1 (ms)' }),
  natsDelivery: z.number().optional().openapi({ description: 'T3 - T2 (ms)' }),
  dbWrite: z.number().optional().openapi({ description: 'T4 - T3 (ms)' }),
  agentNotification: z.number().optional().openapi({ description: 'T5 - T4 (ms)' }),
  totalInbound: z.number().optional().openapi({ description: 'T5 - T0 (ms)' }),
  agentRoundTrip: z.number().optional().openapi({ description: 'T7 - T5 (ms)' }),
  apiProcessing: z.number().optional().openapi({ description: 'T8 - T7 (ms)' }),
  outboundEventPublish: z.number().optional().openapi({ description: 'T9 - T8 (ms)' }),
  outboundNatsDelivery: z.number().optional().openapi({ description: 'T10 - T9 (ms)' }),
  platformSend: z.number().optional().openapi({ description: 'T11 - T10 (ms)' }),
  totalOutbound: z.number().optional().openapi({ description: 'T11 - T7 (ms)' }),
  totalRoundTrip: z.number().optional().openapi({ description: 'T11 - T0 (ms)' }),
  omniProcessing: z.number().optional().openapi({ description: '(T5-T0) + (T11-T7) (ms)' }),
});

const JourneySchema = z.object({
  correlationId: z.string().openapi({ description: 'Event correlation ID' }),
  checkpoints: z.array(JourneyCheckpointSchema).openapi({ description: 'Ordered list of journey checkpoints' }),
  startedAt: z.number().openapi({ description: 'Journey start timestamp (Unix ms)' }),
  completedAt: z.number().optional().openapi({ description: 'Journey completion timestamp (Unix ms)' }),
  latencies: JourneyLatenciesSchema.openapi({ description: 'Calculated latencies between stages' }),
});

const PercentileStatsSchema = z.object({
  count: z.number().int().openapi({ description: 'Number of samples' }),
  avg: z.number().openapi({ description: 'Average (ms)' }),
  min: z.number().openapi({ description: 'Minimum (ms)' }),
  max: z.number().openapi({ description: 'Maximum (ms)' }),
  p50: z.number().openapi({ description: '50th percentile (ms)' }),
  p95: z.number().openapi({ description: '95th percentile (ms)' }),
  p99: z.number().openapi({ description: '99th percentile (ms)' }),
});

const JourneySummarySchema = z.object({
  totalTracked: z.number().int().openapi({ description: 'Total tracked journeys' }),
  completedJourneys: z.number().int().openapi({ description: 'Completed journeys' }),
  activeJourneys: z.number().int().openapi({ description: 'Currently active journeys' }),
  stages: z.record(z.string(), PercentileStatsSchema).openapi({ description: 'Percentile stats per latency stage' }),
  since: z.number().openapi({ description: 'Filter timestamp (0 = all time)' }),
});

const JourneyNotFoundSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export function registerJourneySchemas(registry: OpenAPIRegistry): void {
  registry.register('JourneyCheckpoint', JourneyCheckpointSchema);
  registry.register('Journey', JourneySchema);
  registry.register('JourneySummary', JourneySummarySchema);
  registry.register('PercentileStats', PercentileStatsSchema);

  registry.registerPath({
    method: 'get',
    path: '/journeys/summary',
    operationId: 'getJourneySummary',
    tags: ['Journeys'],
    summary: 'Aggregated journey metrics',
    description: 'Get aggregated latency metrics across all tracked message journeys.',
    parameters: [
      {
        name: 'since',
        in: 'query',
        required: false,
        description: 'Filter by time: relative duration (1h, 30m, 24h) or ISO datetime',
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: {
        description: 'Journey summary with percentile stats per stage',
        content: {
          'application/json': { schema: JourneySummarySchema },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/journeys/{correlationId}',
    operationId: 'getJourney',
    tags: ['Journeys'],
    summary: 'Get journey by correlation ID',
    description: 'Retrieve a specific message journey timeline with all checkpoints and calculated latencies.',
    parameters: [
      {
        name: 'correlationId',
        in: 'path',
        required: true,
        description: 'Event correlation ID',
        schema: { type: 'string' },
      },
    ],
    responses: {
      200: {
        description: 'Journey timeline with checkpoints and latencies',
        content: {
          'application/json': { schema: JourneySchema },
        },
      },
      404: {
        description: 'Journey not found',
        content: {
          'application/json': { schema: JourneyNotFoundSchema },
        },
      },
    },
  });
}
