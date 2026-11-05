/**
 * Every route the v2 API serves has an OpenAPI path entry, and every path the spec
 * describes is served (#1218, widened from messages to all of v2). The spec is what
 * clients and agents discover the API from: a route it leaves out cannot be found, and a
 * path it invents fails when called.
 */
import { describe, expect, it } from 'bun:test';
import { openApiSpec } from '../routes/openapi';
import { mountedRoutes } from './openapi-route-inventory';
import { KNOWN_UNDOCUMENTED } from './openapi-undocumented-routes';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const routes = mountedRoutes();
const served = new Set(routes);
const grandfathered = new Set(KNOWN_UNDOCUMENTED);

const documented: string[] = Object.entries(openApiSpec.paths ?? {}).flatMap(([path, item]) =>
  METHODS.filter((method) => (item as Record<string, unknown> | undefined)?.[method]).map(
    (method) => `${method} ${path}`,
  ),
);
const isDocumented = new Set(documented);

describe('openapi route coverage', () => {
  it('reads every kind of mount', () => {
    // A prefixed v2 router, a root-mounted one, app.ts's own router, one a function builds,
    // and app.ts's direct routes.
    for (const route of [
      'get /chats/{id}',
      'get /events/consumers',
      'get /login/status',
      'get /health',
      'post /channels/gupshup/{instanceId}/webhook',
    ]) {
      expect(routes).toContain(route);
    }
    // Root mounts yield catch-alls nobody calls; they are not routes to document.
    expect(routes.filter((route) => /^\w+ \/(\{\w+\})?$/.test(route))).toEqual([]);
  });

  it('documents every route it serves', () => {
    expect(routes.filter((route) => !isDocumented.has(route) && !grandfathered.has(route))).toEqual([]);
  });

  it('serves every path it documents', () => {
    expect(documented.filter((route) => !served.has(route))).toEqual([]);
  });

  it('keeps the grandfather list current', () => {
    expect(KNOWN_UNDOCUMENTED.filter((route) => !served.has(route) || isDocumented.has(route))).toEqual([]);
  });
});

describe('chat-key routes (wish: omni-chat-threads)', () => {
  const CHAT_KEY_ROUTES = [
    ['post', '/keys/children', 'chats:keys'],
    ['post', '/keys/children/self/revoke', 'chats:read'],
    ['post', '/keys/children/{id}/revoke', 'chats:keys'],
  ] as const;

  it('are served, documented with their scope, and not on the grandfather list', () => {
    for (const [method, path, scope] of CHAT_KEY_ROUTES) {
      const route = `${method} ${path}`;
      expect(served.has(route)).toBe(true);
      expect(isDocumented.has(route)).toBe(true);
      expect(grandfathered.has(route)).toBe(false);
      const operation = (openApiSpec.paths?.[path] as Record<string, Record<string, unknown>>)[method];
      expect(operation?.['x-omni-scope']).toBe(scope);
    }
  });

  it('document the mint answers the route gives, and a body that takes nothing else', () => {
    const mint = (openApiSpec.paths?.['/keys/children'] as Record<string, Record<string, unknown>>).post;
    expect(Object.keys(mint?.responses as object).sort()).toEqual(['201', '400', '403', '404', '409']);
    const schema = (openApiSpec.components?.schemas as Record<string, Record<string, unknown>>).MintChildKeyRequest;
    expect(schema).toMatchObject({ additionalProperties: false, required: ['chatId'] });
    expect(Object.keys(schema?.properties as object)).toEqual(['chatId']);
  });
});
