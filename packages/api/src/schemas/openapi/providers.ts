/**
 * OpenAPI schemas for provider endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Provider schema
export const ProviderSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Provider UUID' }),
  name: z.string().openapi({ description: 'Provider name' }),
  schema: z.enum(['agno', 'openai', 'anthropic', 'custom']).openapi({ description: 'Provider schema type' }),
  baseUrl: z.string().url().openapi({ description: 'Base URL' }),
  apiKey: z.string().nullable().openapi({ description: 'API key (masked)' }),
  schemaConfig: z.record(z.string(), z.unknown()).nullable().openapi({ description: 'Schema config' }),
  defaultStream: z.boolean().openapi({ description: 'Default streaming' }),
  defaultTimeout: z.number().int().openapi({ description: 'Default timeout (seconds)' }),
  supportsStreaming: z.boolean().openapi({ description: 'Supports streaming' }),
  supportsImages: z.boolean().openapi({ description: 'Supports images' }),
  supportsAudio: z.boolean().openapi({ description: 'Supports audio' }),
  supportsDocuments: z.boolean().openapi({ description: 'Supports documents' }),
  description: z.string().nullable().openapi({ description: 'Description' }),
  tags: z.array(z.string()).nullable().openapi({ description: 'Tags' }),
  isActive: z.boolean().openapi({ description: 'Whether active' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create provider request
export const CreateProviderSchema = z.object({
  name: z.string().min(1).max(255).openapi({ description: 'Provider name' }),
  schema: z.enum(['agno', 'openai', 'anthropic', 'custom']).default('agno').openapi({ description: 'Schema type' }),
  baseUrl: z.string().url().openapi({ description: 'Base URL' }),
  apiKey: z.string().optional().openapi({ description: 'API key (encrypted)' }),
  schemaConfig: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Schema config' }),
  defaultStream: z.boolean().default(true).openapi({ description: 'Default streaming' }),
  defaultTimeout: z.number().int().positive().default(60).openapi({ description: 'Default timeout' }),
  supportsStreaming: z.boolean().default(true).openapi({ description: 'Supports streaming' }),
  supportsImages: z.boolean().default(false).openapi({ description: 'Supports images' }),
  supportsAudio: z.boolean().default(false).openapi({ description: 'Supports audio' }),
  supportsDocuments: z.boolean().default(false).openapi({ description: 'Supports documents' }),
  description: z.string().optional().openapi({ description: 'Description' }),
  tags: z.array(z.string()).optional().openapi({ description: 'Tags' }),
});

// Health check response
export const ProviderHealthSchema = z.object({
  healthy: z.boolean().openapi({ description: 'Whether healthy' }),
  latency: z.number().nullable().openapi({ description: 'Latency (ms)' }),
  error: z.string().nullable().openapi({ description: 'Error message' }),
});

export function registerProviderSchemas(registry: OpenAPIRegistry): void {
  registry.register('Provider', ProviderSchema);
  registry.register('CreateProviderRequest', CreateProviderSchema);
  registry.register('ProviderHealth', ProviderHealthSchema);

  registry.registerPath({
    method: 'get',
    path: '/providers',
    tags: ['Providers'],
    summary: 'List providers',
    description: 'Get all agent providers.',
    request: { query: z.object({ active: z.boolean().optional().openapi({ description: 'Filter by active' }) }) },
    responses: {
      200: {
        description: 'List of providers',
        content: { 'application/json': { schema: z.object({ items: z.array(ProviderSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/providers/{id}',
    tags: ['Providers'],
    summary: 'Get provider',
    description: 'Get details of a specific provider.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Provider UUID' }) }) },
    responses: {
      200: {
        description: 'Provider details',
        content: { 'application/json': { schema: z.object({ data: ProviderSchema }) } },
      },
      404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/providers',
    tags: ['Providers'],
    summary: 'Create provider',
    description: 'Create a new agent provider.',
    request: { body: { content: { 'application/json': { schema: CreateProviderSchema } } } },
    responses: {
      201: {
        description: 'Provider created',
        content: { 'application/json': { schema: z.object({ data: ProviderSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/providers/{id}',
    tags: ['Providers'],
    summary: 'Update provider',
    description: 'Update an existing provider.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Provider UUID' }) }),
      body: { content: { 'application/json': { schema: CreateProviderSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Provider updated',
        content: { 'application/json': { schema: z.object({ data: ProviderSchema }) } },
      },
      404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/providers/{id}',
    tags: ['Providers'],
    summary: 'Delete provider',
    description: 'Delete an agent provider.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Provider UUID' }) }) },
    responses: {
      200: { description: 'Provider deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/providers/{id}/health',
    tags: ['Providers'],
    summary: 'Check provider health',
    description: 'Check if provider is reachable and healthy.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Provider UUID' }) }) },
    responses: {
      200: { description: 'Health check result', content: { 'application/json': { schema: ProviderHealthSchema } } },
      404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/providers/{id}/agents',
    tags: ['Providers'],
    summary: 'List provider agents',
    description: 'List available agents from a provider.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Provider UUID' }) }) },
    responses: {
      200: {
        description: 'Agent list',
        content: {
          'application/json': { schema: z.object({ items: z.array(z.unknown()), message: z.string().optional() }) },
        },
      },
      404: { description: 'Provider not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
