/**
 * Connectors — request and response schemas.
 *
 * ONE definition serves both the route validator and the OpenAPI document, so
 * the published contract cannot drift from what the route accepts. The two
 * secret values (`credentials`, `verificationSecret`) are WRITE-ONLY: no
 * response schema has them, and `Connector.hasCredentials` is the only derived
 * fact exposed.
 */

import { z } from '../lib/zod-openapi';

/** Provider manifest id; unknown ids are refused by the catalog, not by shape. */
const ProviderIdSchema = z.string().min(1).max(64);

const CredentialsSchema = z
  .record(z.string().min(1).max(128), z.string().min(1).max(4096))
  .openapi({ description: 'Provider credential values; sealed at rest and never returned' });

const VerificationSecretSchema = z
  .string()
  .min(8)
  .max(512)
  .openapi({ description: 'Provider HMAC secret; sealed at rest and never returned' });

const ConnectorStatusSchema = z.enum(['connected', 'error', 'revoked']);
const SubscriptionStatusSchema = z.enum(['active', 'paused', 'error']);

export const CreateConnectorBodySchema = z
  .object({
    provider: ProviderIdSchema.openapi({ description: 'Provider manifest id' }),
    name: z.string().min(1).max(255).openapi({ description: 'Display name, unique per tenant' }),
    credentials: CredentialsSchema,
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Non-secret provider config, validated against the manifest configSchema' }),
  })
  .openapi('CreateConnectorBody');

export const UpdateConnectorBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    credentials: CredentialsSchema.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one of name, credentials or config' })
  .openapi('UpdateConnectorBody');

export const ConnectorSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.string(),
    name: z.string(),
    status: ConnectorStatusSchema,
    config: z.record(z.string(), z.unknown()),
    /** True when a sealed credential exists AND opens under the row's tenant. */
    hasCredentials: z.boolean(),
    lastValidatedAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    lastErrorCode: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Connector');

export const EventSubscriptionSchema = z
  .object({
    id: z.string().uuid(),
    connectorId: z.string().uuid(),
    providerEventKey: z.string(),
    filters: z.record(z.string(), z.unknown()),
    targetAutomationId: z.string().uuid(),
    status: SubscriptionStatusSchema,
    inboundUrl: z.string(),
    lastDeliveryAt: z.string().datetime().nullable(),
    lastFailureAt: z.string().datetime().nullable(),
    consecutiveFailures: z.number().int(),
    totalDeliveries: z.number().int(),
    totalDuplicates: z.number().int(),
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('EventSubscription');

export const CreateSubscriptionBodySchema = z
  .object({
    eventKey: z.string().min(1).max(100).openapi({ description: 'Manifest event key, e.g. "taskStatusUpdated"' }),
    filters: z.record(z.string(), z.unknown()).optional(),
    targetAutomationId: z.string().uuid(),
    verificationSecret: VerificationSecretSchema,
  })
  .openapi('CreateSubscriptionBody');

export const UpdateSubscriptionBodySchema = z
  .object({
    status: z.enum(['active', 'paused']).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    targetAutomationId: z.string().uuid().optional(),
    verificationSecret: VerificationSecretSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one of status, filters, targetAutomationId or verificationSecret',
  })
  .openapi('UpdateSubscriptionBody');

export const InvokeActionBodySchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
  })
  .openapi('InvokeActionBody');

export const TestDeliveryBodySchema = z
  .object({
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('TestDeliveryBody');

export const ConnectorListQuerySchema = z.object({
  provider: z.string().optional(),
  status: ConnectorStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

export const ProviderSummarySchema = z
  .object({
    id: z.string(),
    label: z.string(),
    version: z.string(),
    events: z.array(z.object({ key: z.string(), label: z.string() })),
    actions: z.array(z.object({ key: z.string(), label: z.string() })),
  })
  .openapi('ProviderSummary');

export const ProviderDetailSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    version: z.string(),
    credentialFields: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        secret: z.boolean(),
        optional: z.boolean().optional(),
        help: z.string().optional(),
      }),
    ),
    events: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        sample: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    actions: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    ),
    guide: z.record(z.string(), z.string()),
  })
  .openapi('ProviderDetail');

export const ConnectorListResponseSchema = z.object({
  data: z.array(ConnectorSchema),
  meta: z.object({ hasMore: z.boolean(), cursor: z.string().nullable() }),
});

export const ConnectorResponseSchema = z.object({ data: ConnectorSchema });
export const SubscriptionResponseSchema = z.object({ data: EventSubscriptionSchema });
export const SubscriptionListResponseSchema = z.object({ data: z.array(EventSubscriptionSchema) });
export const ProviderSummaryListResponseSchema = z.object({ data: z.array(ProviderSummarySchema) });
export const ProviderDetailResponseSchema = z.object({ data: ProviderDetailSchema });
export const InvokeActionResponseSchema = z.object({ data: z.unknown() });

export const TestDeliveryResponseSchema = z.object({
  eventId: z.string().uuid().openapi({ description: 'Journal row published by the test delivery' }),
});

export const DeliveryReceiptSchema = z
  .object({
    received: z.boolean(),
    eventId: z.string().uuid().optional(),
    duplicate: z.boolean().optional(),
    ignored: z.boolean().optional(),
  })
  .openapi('DeliveryReceipt');

export type CreateConnectorBody = z.infer<typeof CreateConnectorBodySchema>;
export type UpdateConnectorBody = z.infer<typeof UpdateConnectorBodySchema>;
export type CreateSubscriptionBody = z.infer<typeof CreateSubscriptionBodySchema>;
export type UpdateSubscriptionBody = z.infer<typeof UpdateSubscriptionBodySchema>;
