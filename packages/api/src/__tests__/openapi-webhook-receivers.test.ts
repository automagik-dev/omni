/**
 * Both webhook receivers reject a non-empty body that is not a JSON object
 * with 400 (utils/json-body.ts). The published contract must say so, or
 * generated clients only know the success and auth shapes.
 */
import { describe, expect, it } from 'bun:test';
import { openApiSpec } from '../routes/openapi';

function responses(path: string): Record<string, unknown> {
  const pathItem = openApiSpec.paths?.[path] as { post?: { responses?: Record<string, unknown> } } | undefined;
  const found = pathItem?.post?.responses;
  if (!found) throw new Error(`no POST ${path} in the OpenAPI spec`);
  return found;
}

describe('openapi webhook receiver responses', () => {
  it('authenticated receiver documents the validation 400', () => {
    expect(Object.keys(responses('/webhooks/{source}')).sort()).toEqual(['200', '400']);
  });

  it('public ingress documents the validation 400 alongside the collapsed 401', () => {
    expect(Object.keys(responses('/webhooks/ingress/{source}')).sort()).toEqual(['200', '400', '401']);
  });
});
