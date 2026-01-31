/**
 * Payload Storage API routes
 *
 * Endpoints for managing event payload storage and configuration.
 *
 * @see events-ops wish
 */

import { zValidator } from '@hono/zod-validator';
import { PAYLOAD_STAGES } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const payloadsRoutes = new Hono<{ Variables: AppVariables }>();

// Stage validation
const stageSchema = z.enum(PAYLOAD_STAGES);

// Delete body schema
const deleteBodySchema = z.object({
  reason: z.string().min(1).max(255),
});

// Config update schema
const configUpdateSchema = z.object({
  storeWebhookRaw: z.boolean().optional(),
  storeAgentRequest: z.boolean().optional(),
  storeAgentResponse: z.boolean().optional(),
  storeChannelSend: z.boolean().optional(),
  storeError: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

/**
 * GET /events/:eventId/payloads - List payloads for an event
 */
payloadsRoutes.get('/events/:eventId/payloads', async (c) => {
  const eventId = c.req.param('eventId');
  const services = c.get('services');

  const payloads = await services.payloadStore.getByEventId(eventId);

  // Return metadata only, not the compressed data
  const items = payloads.map(({ payloadCompressed, ...rest }) => ({
    ...rest,
    hasData: payloadCompressed.length > 0,
  }));

  return c.json({ items });
});

/**
 * GET /events/:eventId/payloads/:stage - Get specific stage payload
 */
payloadsRoutes.get('/events/:eventId/payloads/:stage', async (c) => {
  const eventId = c.req.param('eventId');
  const stage = c.req.param('stage');

  // Validate stage
  const stageResult = stageSchema.safeParse(stage);
  if (!stageResult.success) {
    return c.json({ error: 'Invalid stage' }, 400);
  }

  const services = c.get('services');
  const payload = await services.payloadStore.getByStage(eventId, stageResult.data);

  if (!payload) {
    return c.json({ error: 'Payload not found' }, 404);
  }

  return c.json({ data: payload });
});

/**
 * DELETE /events/:eventId/payloads - Soft-delete all payloads for an event
 */
payloadsRoutes.delete('/events/:eventId/payloads', zValidator('json', deleteBodySchema), async (c) => {
  const eventId = c.req.param('eventId');
  const { reason } = c.req.valid('json');
  const services = c.get('services');

  // TODO: Get current user from auth context
  const deletedBy = 'api-user';

  const count = await services.payloadStore.softDelete(eventId, deletedBy, reason);

  return c.json({ deleted: count });
});

/**
 * GET /payload-config - List storage configs
 */
payloadsRoutes.get('/payload-config', async (c) => {
  const services = c.get('services');
  const configs = await services.payloadStore.listConfigs();

  return c.json({ items: configs });
});

/**
 * PUT /payload-config/:eventType - Update config for event type
 */
payloadsRoutes.put('/payload-config/:eventType', zValidator('json', configUpdateSchema), async (c) => {
  const eventType = c.req.param('eventType');
  const config = c.req.valid('json');
  const services = c.get('services');

  const updated = await services.payloadStore.upsertConfig(eventType, config);

  return c.json({ data: updated });
});

/**
 * GET /payload-stats - Get storage statistics
 */
payloadsRoutes.get('/payload-stats', async (c) => {
  const services = c.get('services');
  const stats = await services.payloadStore.getStats();

  return c.json({ data: stats });
});

export { payloadsRoutes };
