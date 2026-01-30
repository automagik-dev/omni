/**
 * Settings routes - Global settings management
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const settingsRoutes = new Hono<{ Variables: AppVariables }>();

// List query schema
const listQuerySchema = z.object({
  category: z.string().optional(),
});

// Set setting schema
const setSettingSchema = z.object({
  value: z.unknown().describe('Setting value (type auto-detected)'),
  reason: z.string().optional().describe('Reason for change (audit)'),
});

// Bulk update schema
const bulkUpdateSchema = z.object({
  settings: z.record(z.string(), z.unknown()).describe('Key-value pairs of settings'),
  reason: z.string().optional().describe('Reason for changes (audit)'),
});

// History query schema
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

/**
 * GET /settings - List all settings
 */
settingsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { category } = c.req.valid('query');
  const services = c.get('services');

  const settings = await services.settings.list(category);

  // Mask secret values
  const items = settings.map((s) => ({
    ...s,
    value: s.isSecret ? '********' : s.value,
  }));

  return c.json({ items });
});

/**
 * GET /settings/:key - Get setting by key
 */
settingsRoutes.get('/:key', async (c) => {
  const key = c.req.param('key');
  const services = c.get('services');

  const setting = await services.settings.getByKey(key);

  return c.json({
    data: {
      ...setting,
      value: setting.isSecret ? '********' : setting.value,
    },
  });
});

/**
 * PUT /settings/:key - Set setting value
 */
settingsRoutes.put('/:key', zValidator('json', setSettingSchema), async (c) => {
  const key = c.req.param('key');
  const { value, reason } = c.req.valid('json');
  const services = c.get('services');
  const apiKey = c.get('apiKey');

  const setting = await services.settings.setValue(key, value, {
    reason,
    changedBy: apiKey?.name ?? 'api',
  });

  return c.json({
    data: {
      ...setting,
      value: setting.isSecret ? '********' : setting.value,
    },
  });
});

/**
 * PATCH /settings - Bulk update settings
 */
settingsRoutes.patch('/', zValidator('json', bulkUpdateSchema), async (c) => {
  const { settings, reason } = c.req.valid('json');
  const servicesObj = c.get('services');
  const apiKey = c.get('apiKey');

  const updated = await servicesObj.settings.setMany(settings, {
    reason,
    changedBy: apiKey?.name ?? 'api',
  });

  return c.json({
    items: updated.map((s) => ({
      ...s,
      value: s.isSecret ? '********' : s.value,
    })),
  });
});

/**
 * DELETE /settings/:key - Delete setting
 */
settingsRoutes.delete('/:key', async (c) => {
  const key = c.req.param('key');
  const services = c.get('services');

  await services.settings.delete(key);

  return c.json({ success: true });
});

/**
 * GET /settings/:key/history - Get setting change history
 */
settingsRoutes.get('/:key/history', zValidator('query', historyQuerySchema), async (c) => {
  const key = c.req.param('key');
  const { limit, since } = c.req.valid('query');
  const services = c.get('services');

  const history = await services.settings.getHistory(key, { limit, since });

  return c.json({
    items:
      history?.map((h) => ({
        oldValue: h.oldValue ? '(changed)' : null, // Don't expose values in history
        newValue: h.newValue ? '(changed)' : null,
        changedBy: h.changedBy,
        changedAt: h.changedAt,
        changeReason: h.changeReason,
      })) ?? [],
  });
});

export { settingsRoutes };
