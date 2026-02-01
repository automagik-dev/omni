/**
 * OpenAPI schemas for settings endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Setting schema
export const SettingSchema = z.object({
  key: z.string().openapi({ description: 'Setting key' }),
  value: z.unknown().openapi({ description: 'Setting value (masked if secret)' }),
  category: z.string().nullable().openapi({ description: 'Category' }),
  isSecret: z.boolean().openapi({ description: 'Whether value is secret' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Set setting request
export const SetSettingSchema = z.object({
  value: z.unknown().openapi({ description: 'Setting value' }),
  reason: z.string().optional().openapi({ description: 'Reason for change (audit)' }),
});

// Bulk update request
export const BulkUpdateSettingsSchema = z.object({
  settings: z.record(z.string(), z.unknown()).openapi({ description: 'Key-value pairs' }),
  reason: z.string().optional().openapi({ description: 'Reason for changes (audit)' }),
});

// Setting history entry
export const SettingHistorySchema = z.object({
  oldValue: z.string().nullable().openapi({ description: 'Old value (masked)' }),
  newValue: z.string().nullable().openapi({ description: 'New value (masked)' }),
  changedBy: z.string().openapi({ description: 'Who made the change' }),
  changedAt: z.string().datetime().openapi({ description: 'When changed' }),
  changeReason: z.string().nullable().openapi({ description: 'Reason for change' }),
});

export function registerSettingsSchemas(registry: OpenAPIRegistry): void {
  registry.register('Setting', SettingSchema);
  registry.register('SetSettingRequest', SetSettingSchema);
  registry.register('BulkUpdateSettingsRequest', BulkUpdateSettingsSchema);
  registry.register('SettingHistory', SettingHistorySchema);

  registry.registerPath({
    method: 'get',
    path: '/settings',
    tags: ['Settings'],
    summary: 'List settings',
    description: 'Get all settings. Secret values are masked.',
    request: { query: z.object({ category: z.string().optional().openapi({ description: 'Filter by category' }) }) },
    responses: {
      200: {
        description: 'List of settings',
        content: { 'application/json': { schema: z.object({ items: z.array(SettingSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/{key}',
    tags: ['Settings'],
    summary: 'Get setting',
    description: 'Get a specific setting by key.',
    request: { params: z.object({ key: z.string().openapi({ description: 'Setting key' }) }) },
    responses: {
      200: {
        description: 'Setting details',
        content: { 'application/json': { schema: z.object({ data: SettingSchema }) } },
      },
      404: { description: 'Setting not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/settings/{key}',
    tags: ['Settings'],
    summary: 'Set setting',
    description: 'Set a setting value.',
    request: {
      params: z.object({ key: z.string().openapi({ description: 'Setting key' }) }),
      body: { content: { 'application/json': { schema: SetSettingSchema } } },
    },
    responses: {
      200: {
        description: 'Setting updated',
        content: { 'application/json': { schema: z.object({ data: SettingSchema }) } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/settings',
    tags: ['Settings'],
    summary: 'Bulk update settings',
    description: 'Update multiple settings at once.',
    request: { body: { content: { 'application/json': { schema: BulkUpdateSettingsSchema } } } },
    responses: {
      200: {
        description: 'Settings updated',
        content: { 'application/json': { schema: z.object({ items: z.array(SettingSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/settings/{key}',
    tags: ['Settings'],
    summary: 'Delete setting',
    description: 'Delete a setting.',
    request: { params: z.object({ key: z.string().openapi({ description: 'Setting key' }) }) },
    responses: {
      200: { description: 'Setting deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Setting not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/settings/{key}/history',
    tags: ['Settings'],
    summary: 'Get setting history',
    description: 'Get change history for a setting.',
    request: {
      params: z.object({ key: z.string().openapi({ description: 'Setting key' }) }),
      query: z.object({
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
      }),
    },
    responses: {
      200: {
        description: 'Setting history',
        content: { 'application/json': { schema: z.object({ items: z.array(SettingHistorySchema) }) } },
      },
    },
  });
}
