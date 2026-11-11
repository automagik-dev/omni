/**
 * OpenAPI schemas for the WhatsApp Business (Meta Cloud API) connection routes
 * (packages/api/src/routes/v2/whatsapp-business.ts): connect, and reading the
 * stored connection. The request body mirrors `WhatsAppBusinessConnectRequestSchema`
 * in @omni/core, which the route validates with.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { MetaAuthModeSchema, MetaSignatureModeSchema } from '@omni/core';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const idParam = z.object({ id: z.string().uuid().openapi({ description: 'Instance UUID' }) });

const AuthModeSchema = z.enum(MetaAuthModeSchema.options).openapi({
  description: "How the access token is sent: 'bearer' (Meta) or 'x-api-key' (provider key; needs apiBaseUrl)",
});

const SignatureModeSchema = z.enum(MetaSignatureModeSchema.options).openapi({
  description:
    "Webhook signature: 'x-hub-signature-256' (META_APP_SECRET) or 'x-webhook-signature' (provider; needs webhookSecret)",
});

export const WhatsAppBusinessConnectBodySchema = z.object({
  accessToken: z.string().min(1).optional().openapi({
    description: 'Meta access token, or the provider key. Exactly one of accessToken or exchangeHandle.',
  }),
  exchangeHandle: z.string().min(1).optional().openapi({ description: 'Single-use handle from oauth/exchange' }),
  phoneNumberId: z.string().min(1).openapi({ description: 'Meta phone_number_id' }),
  wabaId: z.string().min(1).openapi({ description: 'WhatsApp Business Account id' }),
  appId: z.string().optional(),
  businessId: z.string().optional(),
  apiBaseUrl: z.string().url().nullable().optional().openapi({
    description:
      "Meta-compatible provider API base with its version (https), e.g. Kapso's https://api.kapso.ai/meta/whatsapp/v24.0. Omitted keeps the stored value; null returns to Meta's Graph API.",
  }),
  authMode: AuthModeSchema.optional(),
  webhookSecret: z.string().min(1).nullable().optional().openapi({
    description: 'Secret the provider signs forwarded webhooks with. Omitted keeps the stored value; null clears it.',
  }),
  signatureMode: SignatureModeSchema.optional(),
});

export const WhatsAppBusinessConnectionSchema = z.object({
  phoneNumberId: z.string().nullable(),
  wabaId: z.string().nullable(),
  appId: z.string().nullable(),
  businessId: z.string().nullable(),
  apiVersion: z.string().nullable(),
  displayPhoneNumber: z.string().nullable(),
  connectionMethod: z.string().nullable(),
  connectedAt: z.string().nullable(),
  connected: z.boolean(),
  apiBaseUrl: z.string().nullable().openapi({ description: 'Provider API base; null for Meta direct' }),
  authMode: AuthModeSchema,
  signatureMode: SignatureModeSchema,
  hasWebhookSecret: z.boolean().openapi({ description: 'Whether a provider webhook secret is stored; never returned' }),
});

export function registerWhatsAppBusinessSchemas(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-business/connect',
    operationId: 'connectWhatsAppBusiness',
    tags: ['Instances'],
    summary: 'Connect a WhatsApp Business number',
    description:
      "Stores the Meta details on the instance, probes the number and starts the channel. Optional provider fields connect through a Meta-compatible provider such as Kapso instead of Meta's Graph API.",
    request: {
      params: idParam,
      body: { content: { 'application/json': { schema: WhatsAppBusinessConnectBodySchema } } },
    },
    responses: {
      200: {
        description: 'Connected',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({
                instanceId: z.string().uuid(),
                status: z.literal('connected'),
                displayPhoneNumber: z.string().nullable(),
                qualityRating: z.string().nullable(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Not a whatsapp-business instance, invalid body or provider settings, or expired exchange handle',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: 'The channel failed to start',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/whatsapp-business/connection',
    operationId: 'getWhatsAppBusinessConnection',
    tags: ['Instances'],
    summary: 'Read the WhatsApp Business connection',
    description: 'The stored Meta and provider settings. Never returns the access token or the webhook secret.',
    request: { params: idParam },
    responses: {
      200: {
        description: 'Stored connection',
        content: { 'application/json': { schema: z.object({ data: WhatsAppBusinessConnectionSchema }) } },
      },
      400: {
        description: 'Not a whatsapp-business instance',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });
}
