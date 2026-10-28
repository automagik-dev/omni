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

  test('no connector schema has a credential, secret or token property', () => {
    const schemas = (openApiSpec.components?.schemas ?? {}) as Record<string, Record<string, unknown>>;
    const connectorSchemas = Object.entries(schemas).filter(([name]) =>
      ['Connector', 'EventSubscription', 'ProviderSummary', 'ProviderDetail', 'DeliveryReceipt'].includes(name),
    );
    expect(connectorSchemas.length).toBeGreaterThanOrEqual(5);
    // `hasCredentials` (a boolean) and `credentialFields` (labels + a secret
    // FLAG) are metadata, not material. Anything else matching is a leak.
    const metadata = new Set(['hasCredentials', 'credentialFields']);
    for (const [name, schema] of connectorSchemas) {
      const suspicious = Object.keys((schema.properties ?? {}) as Record<string, unknown>).filter(
        (property) => !metadata.has(property) && /credential|secret|token/i.test(property),
      );
      expect(`${name}: ${suspicious.join(',')}`).toBe(`${name}: `);
    }
  });
});
