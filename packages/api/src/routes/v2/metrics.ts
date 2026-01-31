/**
 * Prometheus Metrics API routes
 *
 * Exposes metrics in Prometheus text format at /metrics.
 *
 * @see events-ops wish (DEC-4)
 */

import { getMetricsJson, getMetricsText } from '@omni/core';
import { Hono } from 'hono';
import type { AppVariables } from '../../types';

const metricsRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * GET /metrics - Prometheus text format (default)
 */
metricsRoutes.get('/', async (c) => {
  const accept = c.req.header('Accept') ?? '';

  // Return JSON if explicitly requested
  if (accept.includes('application/json')) {
    const metrics = await getMetricsJson();
    return c.json(metrics);
  }

  // Default: Prometheus text format
  const text = await getMetricsText();
  return c.text(text, 200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  });
});

export { metricsRoutes };
