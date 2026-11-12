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
  description:
    "How the access token is sent: 'bearer' (Meta) or 'x-api-key' (provider key; needs a non-Meta apiBaseUrl). On connect, omitted keeps the stored value and null resets to bearer.",
});

const SignatureModeSchema = z.enum(MetaSignatureModeSchema.options).openapi({
  description:
    "Webhook signature: 'x-hub-signature-256' (the instance's webhookSecret when set, else META_APP_SECRET) or 'x-webhook-signature' (provider; needs webhookSecret). On connect, omitted keeps the stored value and null resets to x-hub-signature-256.",
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
  authMode: AuthModeSchema.nullable().optional(),
  webhookSecret: z.string().min(1).nullable().optional().openapi({
    description:
      "This instance's webhook signing secret: the provider's secret, or with x-hub-signature-256 the instance's own Meta app secret. Omitted keeps the stored value; null clears it.",
  }),
  signatureMode: SignatureModeSchema.nullable().optional(),
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

const kapsoRefusals = {
  409: {
    description:
      'KAPSO_NOT_AVAILABLE (multitenancy is on: the key is install-wide), KAPSO_NOT_CONFIGURED (no Kapso key saved), or PUBLIC_URL_MISSING (connect only: Omni has no public https address; nothing was created)',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  502: {
    description:
      "Kapso refused or could not be reached: KAPSO_KEY_REFUSED (Kapso's 401) or KAPSO_ERROR, with Kapso's words",
    content: { 'application/json': { schema: ErrorSchema } },
  },
};

export const KapsoKeyBodySchema = z.object({
  apiKey: z.string().min(8).max(4096).openapi({ description: 'Kapso project API key. Write-only: never returned.' }),
});

export const KapsoNumberSchema = z.object({
  phoneNumberId: z.string().openapi({ description: 'Meta phone_number_id' }),
  wabaId: z.string().openapi({ description: 'WhatsApp Business Account id' }),
  displayPhoneNumber: z.string().nullable(),
  name: z.string().nullable().openapi({ description: 'Verified or display name' }),
});

export function registerWhatsAppBusinessSchemas(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'put',
    path: '/channels/whatsapp-business/kapso/key',
    operationId: 'saveKapsoKey',
    tags: ['Instances'],
    summary: "Save this Omni's Kapso project key",
    description:
      'Checks the key against Kapso, then stores it as the sealed install-wide setting kapso.api_key. Write-only: no route returns it. Refused while multitenancy is on.',
    request: { body: { content: { 'application/json': { schema: KapsoKeyBodySchema } } } },
    responses: {
      200: {
        description: 'Saved',
        content: { 'application/json': { schema: z.object({ data: z.object({ saved: z.literal(true) }) }) } },
      },
      400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorSchema } } },
      ...kapsoRefusals,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/channels/whatsapp-business/kapso/setup-link',
    operationId: 'createKapsoSetupLink',
    tags: ['Instances'],
    summary: 'Create a Kapso setup link',
    description:
      "A Kapso-hosted page where the person connects their WhatsApp Business number (coexistence: the Business app keeps working; no number is provisioned). Made for this Omni's Kapso customer, created and remembered on first use. Kapso revokes the previous link.",
    responses: {
      200: {
        description: 'The link',
        content: {
          'application/json': {
            schema: z.object({ data: z.object({ url: z.string().url(), expiresAt: z.string().nullable() }) }),
          },
        },
      },
      ...kapsoRefusals,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/channels/whatsapp-business/kapso/numbers',
    operationId: 'listKapsoNumbers',
    tags: ['Instances'],
    summary: "List the Kapso project's WhatsApp numbers",
    description:
      'Numbers with a WhatsApp Business Account, most recent first, and the webhook address Omni would give Kapso (null when Omni has no public https address, so a connect would be refused).',
    responses: {
      200: {
        description: 'Numbers',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({ items: z.array(KapsoNumberSchema), webhookUrl: z.string().url().nullable() }),
            }),
          },
        },
      },
      ...kapsoRefusals,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-business/kapso/connect',
    operationId: 'connectWhatsAppBusinessKapso',
    tags: ['Instances'],
    summary: 'Connect a WhatsApp Business number through Kapso',
    description:
      "Points the number's Kapso Meta-forwarding webhook at this Omni with a secret Omni generates (updating the number's existing one), then connects the instance through Kapso's Meta-compatible API with the project key (authMode x-api-key, signatureMode x-webhook-signature).",
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: z.object({ phoneNumberId: z.string().openapi({ description: 'A phone_number_id from the list' }) }),
          },
        },
      },
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
                webhookUrl: z.string().url(),
              }),
            }),
          },
        },
      },
      400: {
        description: 'Not a whatsapp-business instance, or invalid body',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: {
        description: 'KAPSO_NUMBER_NOT_FOUND: the number is not in the Kapso project',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      ...kapsoRefusals,
      500: { description: 'The channel failed to start', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

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
