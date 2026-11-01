/**
 * Connector OpenAPI contract.
 *
 * The published document is the client contract: every connector route has a
 * path entry, each authenticated operation carries its `x-omni-scope`, the
 * public ingress says `security: []` and documents the collapsed 401 and the
 * duplicate/ignored receipts, and no connector schema exposes credential
 * material.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { openApiSpec } from '../routes/openapi';

type Operation = Record<string, unknown> & {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

function operation(path: string, method: string): Operation {
  const item = (openApiSpec.paths as Record<string, Record<string, Operation>> | undefined)?.[path];
  const found = item?.[method];
  if (!found) throw new Error(`${method.toUpperCase()} ${path} is missing from the OpenAPI document`);
  return found;
}

const AUTHENTICATED: Array<[string, string, string]> = [
  ['/connectors', 'post', 'connectors:write'],
  ['/connectors', 'get', 'connectors:read'],
  ['/connectors/providers', 'get', 'connectors:read'],
  ['/connectors/providers/{provider}', 'get', 'connectors:read'],
  ['/connectors/{id}', 'get', 'connectors:read'],
  ['/connectors/{id}', 'patch', 'connectors:write'],
  ['/connectors/{id}', 'delete', 'connectors:write'],
  ['/connectors/{id}/subscriptions', 'post', 'connectors:write'],
  ['/connectors/{id}/subscriptions', 'get', 'connectors:read'],
  ['/connectors/{id}/subscriptions/{subscriptionId}', 'patch', 'connectors:write'],
  ['/connectors/{id}/subscriptions/{subscriptionId}', 'delete', 'connectors:write'],
  ['/connectors/{id}/subscriptions/{subscriptionId}/test', 'post', 'connectors:write'],
  ['/connectors/{id}/actions/{action}', 'post', 'connectors:invoke'],
];

describe('connector OpenAPI paths', () => {
  test('management schemas publish write-only hook secrets and both subscription ingress contracts', () => {
    const schema = (name: string) =>
      z
        .object({
          properties: z.record(z.string(), z.unknown()).optional(),
          anyOf: z
            .array(
              z.object({
                properties: z.record(z.string(), z.unknown()),
                required: z.array(z.string()),
              }),
            )
            .optional(),
          additionalProperties: z.boolean().optional(),
        })
        .parse(openApiSpec.components?.schemas?.[name]);
    for (const name of ['CreateConnectorBody', 'UpdateConnectorBody']) {
      expect(schema(name).properties?.hookSecret).toMatchObject({ writeOnly: true, minLength: 8 });
    }
    const variants = schema('CreateSubscriptionBody').anyOf;
    expect(variants).toHaveLength(2);
    expect(variants?.[0]?.required).toEqual(['eventKey', 'targetAutomationId', 'verificationSecret']);
    expect(variants?.[1]?.required).toEqual(['ingress', 'eventKey']);
    expect(variants?.[1]?.properties.ingress).toMatchObject({ enum: ['connector'] });
    expect(variants?.[1]?.properties.eventKey).toMatchObject({ maxLength: 100 });
    expect(variants?.[1]?.properties).not.toHaveProperty('verificationSecret');
    expect(schema('UpdateSubscriptionBody').properties).not.toHaveProperty('ingress');
    expect(schema('UpdateSubscriptionBody').additionalProperties).toBe(false);
    expect(schema('EventSubscription').properties?.targetAutomationId).toMatchObject({ nullable: true });
    expect(schema('EventSubscription').properties?.ingress).toMatchObject({ enum: ['subscription', 'connector'] });
    expect(schema('Connector').properties).toMatchObject({
      hasHookSecret: { type: 'boolean' },
      totalUnmatched: { type: 'integer' },
      lastUnmatchedAt: { nullable: true },
      lastUnmatchedEventType: { nullable: true },
    });
    expect(operation('/connectors/{id}/subscriptions/{subscriptionId}/test', 'post').responses).toHaveProperty('409');
  });

  test('every authenticated route is documented with its scope', () => {
    for (const [path, method, scope] of AUTHENTICATED) {
      expect(operation(path, method)['x-omni-scope']).toBe(scope);
    }
  });

  test('the public ingress is unauthenticated and documents every receipt', () => {
    const ingress = operation('/connectors/events/{subscriptionId}', 'post');
    expect(ingress.security).toEqual([]);
    expect(Object.keys(ingress.responses ?? {}).sort()).toEqual(['200', '202', '400', '401', '500']);
  });

  test('per-connector hook is public and documents verification, matching and retry receipts', () => {
    const hook = operation('/connectors/hooks/{connectorId}', 'post');
    expect(hook.security).toEqual([]);
    expect(Object.keys(hook.responses ?? {}).sort()).toEqual(['200', '202', '400', '401', '500']);
    expect(hook.operationId).toBe('receiveConnectorHook');
  });

  test('no connector schema has a credential, secret or token property', () => {
    const schemas = (openApiSpec.components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
    const connectorSchemas = Object.entries(schemas).filter(([name]) =>
      ['Connector', 'EventSubscription', 'ProviderSummary', 'ProviderDetail', 'DeliveryReceipt'].includes(name),
    );
    expect(connectorSchemas.length).toBeGreaterThanOrEqual(5);
    // `hasCredentials` (a boolean) and `credentialFields` (labels + a secret
    // FLAG) are metadata, not material. Anything else matching is a leak.
    const metadata = new Set(['hasCredentials', 'hasHookSecret', 'credentialFields']);
    for (const [name, schema] of connectorSchemas) {
      const suspicious = Object.keys((schema.properties ?? {}) as Record<string, unknown>).filter(
        (property) => !metadata.has(property) && /credential|secret|token/i.test(property),
      );
      expect(`${name}: ${suspicious.join(',')}`).toBe(`${name}: `);
    }
  });
});
