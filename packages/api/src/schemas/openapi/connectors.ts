/**
 * OpenAPI paths for connector endpoints.
 *
 * Every served v2 route must be documented (the route-coverage gate); the
 * public ingress is documented with `security: []` and the collapsed 401, the
 * 400 validation, the accepted 202, the duplicate 200 and the retryable 500.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import {
  ConnectorListQuerySchema,
  ConnectorListResponseSchema,
  ConnectorResponseSchema,
  ConnectorSchema,
  CreateConnectorBodySchema,
  CreateSubscriptionBodySchema,
  DeliveryReceiptSchema,
  EventSubscriptionSchema,
  InvokeActionBodySchema,
  InvokeActionResponseSchema,
  ProviderDetailResponseSchema,
  ProviderDetailSchema,
  ProviderSummaryListResponseSchema,
  ProviderSummarySchema,
  SubscriptionListResponseSchema,
  SubscriptionResponseSchema,
  TestDeliveryBodySchema,
  TestDeliveryResponseSchema,
  UpdateConnectorBodySchema,
  UpdateSubscriptionBodySchema,
} from '../connectors';
import { ErrorSchema, SuccessSchema } from './common';

const IdParams = z.object({ id: z.string().uuid() });
const SubscriptionParams = z.object({ id: z.string().uuid(), subscriptionId: z.string().uuid() });
const ActionParams = z.object({ id: z.string().uuid(), action: z.string().min(1) });

export function registerConnectorSchemas(registry: OpenAPIRegistry): void {
  registry.register('Connector', ConnectorSchema);
  registry.register('EventSubscription', EventSubscriptionSchema);
  registry.register('ProviderSummary', ProviderSummarySchema);
  registry.register('ProviderDetail', ProviderDetailSchema);
  registry.register('DeliveryReceipt', DeliveryReceiptSchema);

  registry.registerPath({
    method: 'post',
    path: '/connectors',
    operationId: 'createConnector',
    tags: ['Connectors'],
    summary: 'Connect an external account',
    description:
      'Validates synchronously through the provider manifest. A provider rejection still persists the row, ' +
      'returned with status "error" and a readable lastError — never a false "connected". Credentials are sealed ' +
      'and never returned.',
    request: { body: { content: { 'application/json': { schema: CreateConnectorBodySchema } } } },
    responses: {
      201: {
        description: 'Connector created (status may be "error")',
        content: { 'application/json': { schema: ConnectorResponseSchema } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      403: {
        description: 'Instance-restricted key (connectors are tenant-wide)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Unknown provider', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/connectors',
    operationId: 'listConnectors',
    tags: ['Connectors'],
    summary: 'List connectors',
    request: { query: ConnectorListQuerySchema },
    responses: {
      200: {
        description: 'Connectors',
        content: {
          'application/json': { schema: ConnectorListResponseSchema },
        },
      },
      403: {
        description: 'Instance-restricted key (connectors are tenant-wide)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/connectors/providers',
    operationId: 'listConnectorProviders',
    tags: ['Connectors'],
    summary: 'List connector providers (catalog)',
    responses: {
      200: {
        description: 'Providers',
        content: { 'application/json': { schema: ProviderSummaryListResponseSchema } },
      },
      403: {
        description: 'Instance-restricted key (connectors are tenant-wide)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/connectors/providers/{provider}',
    operationId: 'getConnectorProvider',
    tags: ['Connectors'],
    summary: 'Provider detail with JSON Schema for every action input',
    request: { params: z.object({ provider: z.string() }) },
    responses: {
      200: {
        description: 'Provider',
        content: { 'application/json': { schema: ProviderDetailResponseSchema } },
      },
      404: { description: 'Unknown provider', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/connectors/{id}',
    operationId: 'getConnector',
    tags: ['Connectors'],
    summary: 'Get a connector',
    request: { params: IdParams },
    responses: {
      200: { description: 'Connector', content: { 'application/json': { schema: ConnectorResponseSchema } } },
      404: {
        description: 'Not found (including cross-tenant)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/connectors/{id}',
    operationId: 'updateConnector',
    tags: ['Connectors'],
    summary: 'Update a connector (revalidates when credentials change)',
    request: {
      params: IdParams,
      body: { content: { 'application/json': { schema: UpdateConnectorBodySchema } } },
    },
    responses: {
      200: { description: 'Connector', content: { 'application/json': { schema: ConnectorResponseSchema } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/connectors/{id}',
    operationId: 'deleteConnector',
    tags: ['Connectors'],
    summary: 'Delete a connector (subscriptions cascade)',
    request: { params: IdParams },
    responses: {
      200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/connectors/{id}/subscriptions',
    operationId: 'createConnectorSubscription',
    tags: ['Connectors'],
    summary: 'Create an event subscription',
    description:
      'The target automation must exist and its triggerEventType must be "connector.event". The verification ' +
      'secret is sealed and never returned.',
    request: {
      params: IdParams,
      body: { content: { 'application/json': { schema: CreateSubscriptionBodySchema } } },
    },
    responses: {
      201: {
        description: 'Subscription created',
        content: { 'application/json': { schema: SubscriptionResponseSchema } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: {
        description: 'Connector or automation not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/connectors/{id}/subscriptions',
    operationId: 'listConnectorSubscriptions',
    tags: ['Connectors'],
    summary: 'List event subscriptions',
    request: { params: IdParams },
    responses: {
      200: {
        description: 'Subscriptions',
        content: { 'application/json': { schema: SubscriptionListResponseSchema } },
      },
      404: { description: 'Connector not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/connectors/{id}/subscriptions/{subscriptionId}',
    operationId: 'updateConnectorSubscription',
    tags: ['Connectors'],
    summary: 'Pause, resume or re-point an event subscription',
    description:
      'Rotating verificationSecret takes effect immediately: the old secret stops verifying and the provider copy ' +
      'must be updated. Paused subscriptions still verify a delivery, then ack 202 ignored and publish nothing.',
    request: {
      params: SubscriptionParams,
      body: { content: { 'application/json': { schema: UpdateSubscriptionBodySchema } } },
    },
    responses: {
      200: { description: 'Subscription', content: { 'application/json': { schema: SubscriptionResponseSchema } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/connectors/{id}/subscriptions/{subscriptionId}',
    operationId: 'deleteConnectorSubscription',
    tags: ['Connectors'],
    summary: 'Delete an event subscription',
    request: { params: SubscriptionParams },
    responses: {
      200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/connectors/{id}/subscriptions/{subscriptionId}/test',
    operationId: 'testConnectorSubscription',
    tags: ['Connectors'],
    summary: 'Send a test delivery through the real pipeline',
    description:
      'Uses the manifest sample or the caller payload, bypasses signature verification, and runs parse → filters → ' +
      'claim → publish → automation. The idempotency key is random, so repeated tests are not deduped.',
    request: {
      params: SubscriptionParams,
      body: { content: { 'application/json': { schema: TestDeliveryBodySchema } } },
    },
    responses: {
      200: {
        description: 'Test delivery published',
        content: { 'application/json': { schema: TestDeliveryResponseSchema } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/connectors/{id}/actions/{action}',
    operationId: 'invokeConnectorAction',
    tags: ['Connectors'],
    summary: 'Invoke a typed provider action',
    description:
      'Requires a connected connector. Input is validated against the manifest before any provider call; provider ' +
      'error text is redacted. A 401/403 from the provider moves the connector to "revoked".',
    request: {
      params: ActionParams,
      body: { content: { 'application/json': { schema: InvokeActionBodySchema } } },
    },
    responses: {
      200: { description: 'Action result', content: { 'application/json': { schema: InvokeActionResponseSchema } } },
      400: {
        description: 'Unknown action or invalid input',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'Connector is not connected', content: { 'application/json': { schema: ErrorSchema } } },
      502: {
        description: 'Provider rejected the call (redacted message)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/connectors/events/{subscriptionId}',
    operationId: 'receiveConnectorEvent',
    tags: ['Connectors'],
    summary: 'Public connector event ingress',
    description:
      'Auth-exempt provider receiver. The raw body is verified against the subscription’s sealed secret before ' +
      'anything is parsed or published. Unknown subscription, unopenable secret and bad signature all collapse into ' +
      'the same 401, so the endpoint is not an existence oracle. A paused subscription acks 202 ignored after a valid ' +
      'signature. A duplicate provider redelivery acks 200 without a second journal row. A failing attempt releases ' +
      'the claim and returns 500, so the provider’s retry can claim again.',
    security: [],
    request: {
      params: z.object({ subscriptionId: z.string().uuid() }),
      body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } } },
    },
    responses: {
      200: {
        description: 'Duplicate delivery already journaled',
        content: { 'application/json': { schema: DeliveryReceiptSchema } },
      },
      202: {
        description: 'Accepted (or ignored: event key/filter mismatch or paused subscription)',
        content: { 'application/json': { schema: DeliveryReceiptSchema } },
      },
      400: { description: 'Body is not a JSON object', content: { 'application/json': { schema: ErrorSchema } } },
      401: {
        description: 'Verification failed (unknown subscription, unopenable secret or bad signature)',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      500: {
        description: 'Processing failed; the claim was released so a retry can claim it',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });
}
