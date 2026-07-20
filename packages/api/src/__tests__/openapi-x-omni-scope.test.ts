/**
 * Asserts the generated OpenAPI spec carries `x-omni-scope` on operations that
 * have a SCOPE_MAP entry, so capability tooling can read required scopes directly
 * from the spec.
 */
import { describe, expect, it } from 'bun:test';
import { SCOPE_MAP } from '../constants/scopes';
import { openApiSpec } from '../routes/openapi';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

function operationScope(method: string, honoPath: string): string | undefined {
  const pathItem = openApiSpec.paths?.[honoPath.replace(/:([^/]+)/g, '{$1}')];
  const operation = pathItem?.[method as keyof typeof pathItem] as Record<string, unknown> | undefined;
  return operation?.['x-omni-scope'] as string | undefined;
}

describe('openapi x-omni-scope extension', () => {
  it('emits x-omni-scope for known scoped operations', () => {
    expect(operationScope('get', '/agents')).toBe('agents:read');
    expect(operationScope('post', '/messages/send/media')).toBe('messages:send');
    expect(operationScope('get', '/instances/:id')).toBe('instances:read');
    // Anchor: auth/validate must register relative to the server prefix so its
    // documented path matches the SCOPE_MAP key and carries the scope annotation.
    expect(operationScope('post', '/auth/validate')).toBe('auth:validate');
  });

  it('every documented operation with a SCOPE_MAP entry carries x-omni-scope', () => {
    const paths = openApiSpec.paths ?? {};
    let checked = 0;

    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;
      const honoPath = pathKey.replace(/\{([^}]+)\}/g, ':$1');

      for (const method of HTTP_METHODS) {
        const operation = (pathItem as Record<string, unknown>)[method] as Record<string, unknown> | undefined;
        if (!operation) continue;

        const expected = SCOPE_MAP[`${method.toUpperCase()} ${honoPath}`];
        if (expected) {
          expect(operation['x-omni-scope']).toBe(expected);
          checked += 1;
        }
      }
    }

    // Lower bound guards against a regression where the sweep silently annotates
    // nothing (e.g. a path-registration change that stops matching SCOPE_MAP keys).
    expect(checked).toBeGreaterThanOrEqual(110);
  });
});
