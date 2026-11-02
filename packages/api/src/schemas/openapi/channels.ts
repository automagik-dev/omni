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

export const MetaWebhookSetupSchema = z.object({
  callbackUrl: z
    .string()
    .url()
    .nullable()
    .describe('Configured public HTTPS callback, never inferred from request headers'),
  verifyToken: z.string().nullable().describe('Active server META_VERIFY_TOKEN; not a Graph API access token'),
  appSecretConfigured: z.boolean().describe('Whether META_APP_SECRET is set; its value is never returned'),
  state: z
    .enum(['ready', 'public_url_missing', 'public_url_invalid', 'verify_token_missing'])
    .describe(
      'public_url_missing means no configured URL; public_url_invalid means the configured URL is malformed or unusable as a public HTTPS callback. URL problems take precedence over a missing token. Ready means URL/token configured, not successful Meta verification.',
    ),
});

export function registerChannelSchemas(registry: OpenAPIRegistry): void {
  registry.register('ChannelCapabilities', ChannelCapabilitiesSchema);
  registry.register('MetaWebhookSetup', MetaWebhookSetupSchema);
  registry.registerPath({
    method: 'get',
    path: '/channels/whatsapp-business/webhook-setup',
    operationId: 'getMetaWebhookSetup',
    tags: ['Instances'],
    summary: 'Read Meta webhook setup for this deployment',
    description:
      'Requires settings:write and an unlocked, non-tenant credential. Returns the configured public callback and active verification token (shared across Meta instances). Cache-Control: no-store. Never returns the app secret or Graph API access tokens.',
    responses: {
      200: {
        description: 'Webhook configuration; missing or invalid configuration is explicit',
        content: { 'application/json': { schema: z.object({ data: MetaWebhookSetupSchema }) } },
      },
      401: { description: 'Authentication required' },
      403: { description: 'Global settings administrator required; tenant and locked credentials are refused' },
    },
  });

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
