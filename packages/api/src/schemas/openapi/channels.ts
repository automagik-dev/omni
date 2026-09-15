/**
 * OpenAPI schemas for the channel capability matrix (issue #1187).
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';

const CapabilityFlagSchema = z
  .union([z.boolean(), z.literal('unknown')])
  .openapi({ description: "true/false as established from the channel's code; 'unknown' when undeclared" });

export const ChannelCapabilitiesSchema = z.object({
  id: z.string().openapi({ description: 'Channel type (e.g. whatsapp-baileys)' }),
  name: z.string().openapi({ description: 'Human-readable channel name' }),
  emits: z
    .array(z.string())
    .nullable()
    .openapi({ description: 'Core event types the channel publishes; null when the plugin declares none' }),
  edits: CapabilityFlagSchema,
  deletes: CapabilityFlagSchema,
  idempotency: CapabilityFlagSchema,
});

export const ChannelCapabilitiesMatrixSchema = z.object({ items: z.array(ChannelCapabilitiesSchema) });
export type ChannelCapabilitiesMatrix = z.infer<typeof ChannelCapabilitiesMatrixSchema>;

export function registerChannelSchemas(registry: OpenAPIRegistry): void {
  registry.register('ChannelCapabilities', ChannelCapabilitiesSchema);

  registry.registerPath({
    method: 'get',
    path: '/channels/capabilities',
    operationId: 'listChannelCapabilities',
    tags: ['Instances'],
    summary: 'Channel capability matrix',
    description:
      'Event types and guarantees (edits, deletes, idempotency) each loaded channel plugin declares. Declarations are verified against the channel code by a static test.',
    responses: {
      200: {
        description: 'Capability matrix',
        content: { 'application/json': { schema: ChannelCapabilitiesMatrixSchema } },
      },
    },
  });
}
