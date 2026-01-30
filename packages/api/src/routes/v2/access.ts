/**
 * Access routes - Access rules management
 */

import { zValidator } from '@hono/zod-validator';
import { RuleTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const accessRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  instanceId: z.string().uuid().optional(),
  type: RuleTypeSchema.optional(),
});

// Create rule schema
const createRuleSchema = z.object({
  instanceId: z.string().uuid().optional().nullable().describe('Instance ID (null for global rule)'),
  ruleType: RuleTypeSchema.describe('Rule type: allow or deny'),
  phonePattern: z.string().optional().describe('Phone pattern with optional wildcards'),
  platformUserId: z.string().optional().describe('Exact platform user ID'),
  personId: z.string().uuid().optional().describe('Person ID'),
  priority: z.number().int().default(0).describe('Rule priority (higher = checked first)'),
  enabled: z.boolean().default(true).describe('Whether rule is active'),
  reason: z.string().optional().describe('Human-readable reason'),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .describe('Optional expiration'),
  action: z.enum(['block', 'allow', 'silent_block']).default('block').describe('Action to take'),
  blockMessage: z.string().optional().describe('Custom block message'),
});

// Update rule schema
const updateRuleSchema = createRuleSchema.partial();

// Check access schema
const checkAccessSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  platformUserId: z.string().describe('Platform user ID to check'),
  channel: z.string().describe('Channel type'),
});

/**
 * GET /access/rules - List access rules
 */
accessRoutes.get('/rules', zValidator('query', listQuerySchema), async (c) => {
  const { instanceId, type } = c.req.valid('query');
  const services = c.get('services');

  const rules = await services.access.list({ instanceId, type });

  return c.json({ items: rules });
});

/**
 * GET /access/rules/:id - Get rule by ID
 */
accessRoutes.get('/rules/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const rule = await services.access.getById(id);

  return c.json({ data: rule });
});

/**
 * POST /access/rules - Create access rule
 */
accessRoutes.post('/rules', zValidator('json', createRuleSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Validate that at least one criteria is provided
  if (!data.phonePattern && !data.platformUserId && !data.personId) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one of phonePattern, platformUserId, or personId is required',
        },
      },
      400,
    );
  }

  const rule = await services.access.create(data);

  return c.json({ data: rule }, 201);
});

/**
 * PATCH /access/rules/:id - Update access rule
 */
accessRoutes.patch('/rules/:id', zValidator('json', updateRuleSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');
  const services = c.get('services');

  const rule = await services.access.update(id, data);

  return c.json({ data: rule });
});

/**
 * DELETE /access/rules/:id - Delete access rule
 */
accessRoutes.delete('/rules/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  await services.access.delete(id);

  return c.json({ success: true });
});

/**
 * POST /access/check - Check if access is allowed
 */
accessRoutes.post('/check', zValidator('json', checkAccessSchema), async (c) => {
  const { instanceId, platformUserId, channel } = c.req.valid('json');
  const services = c.get('services');

  const result = await services.access.checkAccess(instanceId, platformUserId, channel);

  return c.json({
    data: {
      allowed: result.allowed,
      rule: result.rule,
      reason: result.reason,
    },
  });
});

export { accessRoutes };
