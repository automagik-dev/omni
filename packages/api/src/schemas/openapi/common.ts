/**
 * Common OpenAPI schemas for response types
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

/**
 * Error response schema
 */
export const ErrorSchema = z.object({
  error: z.object({
    code: z.string().openapi({ description: 'Error code', example: 'NOT_FOUND' }),
    message: z.string().openapi({ description: 'Human-readable error message' }),
    details: z.unknown().optional().openapi({ description: 'Additional error details' }),
  }),
});

/**
 * Pagination meta schema
 */
export const PaginationMetaSchema = z.object({
  hasMore: z.boolean().openapi({ description: 'Whether there are more items' }),
  cursor: z.string().nullable().openapi({ description: 'Cursor for next page' }),
});

/**
 * Success response schema
 */
export const SuccessSchema = z.object({
  success: z.boolean().openapi({ description: 'Operation succeeded' }),
  message: z.string().optional().openapi({ description: 'Optional success message' }),
});

/**
 * Register common schemas with the given registry
 */
export function registerCommonSchemas(registry: OpenAPIRegistry): void {
  registry.register('Error', ErrorSchema);
  registry.register('PaginationMeta', PaginationMetaSchema);
  registry.register('Success', SuccessSchema);
}
