/**
 * OpenAPI schemas for WhatsApp Flows management routes
 * (packages/api/src/routes/v2/whatsapp-flows.ts).
 *
 * The public Meta-facing data-exchange endpoint
 * (POST /channels/whatsapp-cloud/flows/data/:instanceId) is deliberately NOT
 * registered — like the channel webhooks, it is not a customer-SDK surface.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const FlowCategorySchema = z
  .enum([
    'SIGN_UP',
    'SIGN_IN',
    'APPOINTMENT_BOOKING',
    'LEAD_GENERATION',
    'CONTACT_US',
    'CUSTOMER_SUPPORT',
    'SURVEY',
    'OTHER',
  ])
  .openapi({ description: "Meta's fixed flow category set" });

export const FlowValidationErrorSchema = z.object({
  error: z.string().openapi({ description: 'Error code (e.g. INVALID_PROPERTY_TYPE)' }),
  error_type: z.string().openapi({ description: 'Error class (e.g. FLOW_JSON_ERROR)' }),
  message: z.string().openapi({ description: 'Human-readable explanation' }),
  line_start: z.number().optional(),
  line_end: z.number().optional(),
  column_start: z.number().optional(),
  column_end: z.number().optional(),
  pointers: z
    .array(z.object({ path: z.string().openapi({ description: 'JSON path of the offending node' }) }).passthrough())
    .optional(),
});

export const FlowSummarySchema = z.object({
  id: z.string().openapi({ description: 'Meta flow id' }),
  name: z.string(),
  status: z.string().openapi({ description: 'DRAFT | PUBLISHED | DEPRECATED | BLOCKED | THROTTLED' }),
  categories: z.array(z.string()),
});

export const FlowDetailSchema = FlowSummarySchema.extend({
  validationErrors: z
    .array(FlowValidationErrorSchema)
    .openapi({ description: 'Meta-side Flow JSON validation errors' }),
  endpointUri: z.string().nullable().openapi({ description: 'Registered data-exchange endpoint (dynamic flows)' }),
  preview: z
    .object({ preview_url: z.string(), expires_at: z.string() })
    .nullable()
    .openapi({ description: 'Browser preview (valid ~30 days)' }),
});

export const CreateFlowRequestSchema = z.object({
  name: z.string().min(1).max(200).openapi({ description: 'Flow name (shown in WhatsApp Manager)' }),
  categories: z.array(FlowCategorySchema).min(1),
  flowJson: z.string().optional().openapi({ description: 'Stringified Flow JSON (screens/layout)' }),
  publish: z.boolean().optional().openapi({ description: 'Publish immediately (requires valid flowJson)' }),
  dynamic: z.boolean().optional().openapi({
    description:
      "Endpoint-backed (data_exchange) flow: registers this omni install's flows-data URL as endpoint_uri. Requires META_FLOWS_PUBLIC_BASE_URL and Flow JSON with data_api_version '3.0'.",
  }),
});

export const UpdateFlowRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  categories: z.array(FlowCategorySchema).min(1).optional(),
  flowJson: z.string().optional().openapi({ description: 'Replaces the flow screens (asset upload)' }),
  dynamic: z.boolean().optional().openapi({ description: "Point the flow at this install's data endpoint" }),
});

export const FlowMutationResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    endpointUri: z.string().nullable(),
    validationErrors: z.array(FlowValidationErrorSchema),
  }),
});

export const SendFlowRequestSchema = z.object({
  to: z.string().min(1).openapi({ description: 'Recipient phone (E.164 or digits)' }),
  flowId: z.string().optional().openapi({ description: 'Meta flow id (exactly one of flowId/flowName)' }),
  flowName: z.string().optional(),
  cta: z.string().min(1).max(30).openapi({ description: 'Button label that opens the flow' }),
  bodyText: z.string().min(1).max(1024),
  headerText: z.string().max(60).optional(),
  footerText: z.string().max(60).optional(),
  screen: z.string().optional().openapi({ description: 'Entry screen (navigate flows)' }),
  data: z.record(z.string(), z.unknown()).optional().openapi({ description: 'Prefill data for the first screen' }),
  flowToken: z.string().optional().openapi({ description: 'Correlation token; generated when omitted' }),
  draft: z.boolean().optional().openapi({ description: 'Send an unpublished flow (mode: draft)' }),
  flowAction: z
    .enum(['navigate', 'data_exchange'])
    .optional()
    .openapi({ description: "'data_exchange' opens the flow against the data endpoint (INIT decides screen 1)" }),
});

export const FlowKeysStatusSchema = z.object({
  data: z.object({
    hasLocalKey: z.boolean().openapi({ description: 'Private key stored for this instance' }),
    uploadedAt: z.string().nullable(),
    signatureStatus: z
      .string()
      .nullable()
      .openapi({ description: 'Meta-side status: VALID | MISMATCH (MISMATCH → rotate via POST)' }),
    endpointUri: z.string().nullable(),
  }),
});

export function registerWhatsappFlowsSchemas(registry: OpenAPIRegistry): void {
  registry.register('FlowSummary', FlowSummarySchema);
  registry.register('FlowDetail', FlowDetailSchema);
  registry.register('FlowValidationError', FlowValidationErrorSchema);
  registry.register('CreateFlowRequest', CreateFlowRequestSchema);
  registry.register('UpdateFlowRequest', UpdateFlowRequestSchema);
  registry.register('SendFlowRequest', SendFlowRequestSchema);

  const idParam = z.object({ id: z.string().uuid().openapi({ description: 'Instance UUID' }) });
  const flowIdParams = z.object({
    id: z.string().uuid().openapi({ description: 'Instance UUID' }),
    flowId: z.string().openapi({ description: 'Meta flow id' }),
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/whatsapp-flows',
    operationId: 'listWhatsappFlows',
    tags: ['WhatsApp Flows'],
    summary: 'List flows',
    description: "List the WABA's WhatsApp Flows with status and categories.",
    request: { params: idParam },
    responses: {
      200: {
        description: 'Flows on the WABA',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(FlowSummarySchema), meta: z.object({ count: z.number() }) }),
          },
        },
      },
      400: {
        description: 'Not a whatsapp-cloud instance / not connected',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-flows',
    operationId: 'createWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Create flow',
    description:
      'Create a flow (optionally dynamic/endpoint-backed). Flow JSON is validated locally before contacting Meta; Meta-side validation_errors are always returned.',
    request: { params: idParam, body: { content: { 'application/json': { schema: CreateFlowRequestSchema } } } },
    responses: {
      201: { description: 'Flow created', content: { 'application/json': { schema: FlowMutationResponseSchema } } },
      400: {
        description: 'Bad request / missing META_FLOWS_PUBLIC_BASE_URL',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      422: {
        description: 'Flow JSON failed local validation',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/whatsapp-flows/{flowId}',
    operationId: 'getWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Get flow',
    description: 'Status, categories, Meta validation errors, endpoint_uri and preview URL.',
    request: { params: flowIdParams },
    responses: {
      200: {
        description: 'Flow detail',
        content: { 'application/json': { schema: z.object({ data: FlowDetailSchema }) } },
      },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/instances/{id}/whatsapp-flows/{flowId}',
    operationId: 'updateWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Update flow',
    description:
      'Update screens (flowJson → asset upload) and/or properties (name, categories, dynamic → endpoint_uri).',
    request: { params: flowIdParams, body: { content: { 'application/json': { schema: UpdateFlowRequestSchema } } } },
    responses: {
      200: { description: 'Flow updated', content: { 'application/json': { schema: FlowMutationResponseSchema } } },
      400: { description: 'Bad request', content: { 'application/json': { schema: ErrorSchema } } },
      422: {
        description: 'Flow JSON failed local validation',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/instances/{id}/whatsapp-flows/{flowId}',
    operationId: 'deleteWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Delete flow (draft only)',
    description: 'Deletes a DRAFT flow. Published flows must be deprecated instead.',
    request: { params: flowIdParams },
    responses: {
      200: {
        description: 'Deleted',
        content: { 'application/json': { schema: z.object({ success: z.boolean(), flowId: z.string() }) } },
      },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-flows/{flowId}/publish',
    operationId: 'publishWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Publish flow',
    description: 'Publish a draft flow (requires zero validation errors).',
    request: { params: flowIdParams },
    responses: {
      200: {
        description: 'Published',
        content: { 'application/json': { schema: z.object({ success: z.boolean(), flowId: z.string() }) } },
      },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-flows/{flowId}/deprecate',
    operationId: 'deprecateWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Deprecate flow',
    description: 'Retire a PUBLISHED flow.',
    request: { params: flowIdParams },
    responses: {
      200: {
        description: 'Deprecated',
        content: { 'application/json': { schema: z.object({ success: z.boolean(), flowId: z.string() }) } },
      },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/whatsapp-flows/{flowId}/preview',
    operationId: 'getWhatsappFlowPreview',
    tags: ['WhatsApp Flows'],
    summary: 'Get flow preview URL',
    description: 'Browser preview URL for the flow (valid ~30 days).',
    request: { params: flowIdParams },
    responses: {
      200: {
        description: 'Preview URL',
        content: {
          'application/json': { schema: z.object({ previewUrl: z.string(), expiresAt: z.string() }) },
        },
      },
      404: { description: 'No preview available', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-flows/send',
    operationId: 'sendWhatsappFlow',
    tags: ['WhatsApp Flows'],
    summary: 'Send flow message',
    description:
      "Send an interactive flow message through the channel plugin. Returns the flowToken echoed back on the completion webhook (nfm_reply). Use flowAction 'data_exchange' for endpoint-backed flows.",
    request: { params: idParam, body: { content: { 'application/json': { schema: SendFlowRequestSchema } } } },
    responses: {
      201: {
        description: 'Flow message sent',
        content: {
          'application/json': { schema: z.object({ messageId: z.string().optional(), flowToken: z.string() }) },
        },
      },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'Send failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/instances/{id}/whatsapp-flows/keys',
    operationId: 'registerWhatsappFlowKeys',
    tags: ['WhatsApp Flows'],
    summary: 'Generate + register data-endpoint encryption keys',
    description:
      'Generates a 2048-bit RSA keypair, registers the public key with Meta (whatsapp_business_encryption) and stores the private key sealed. Calling again rotates the key.',
    request: { params: idParam },
    responses: {
      201: { description: 'Key registered', content: { 'application/json': { schema: FlowKeysStatusSchema } } },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/instances/{id}/whatsapp-flows/keys',
    operationId: 'getWhatsappFlowKeysStatus',
    tags: ['WhatsApp Flows'],
    summary: 'Data-endpoint key status',
    description: 'Local key presence + Meta-side signature status (MISMATCH explains 421 loops).',
    request: { params: idParam },
    responses: {
      200: { description: 'Key status', content: { 'application/json': { schema: FlowKeysStatusSchema } } },
      400: { description: 'Channel guard failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
