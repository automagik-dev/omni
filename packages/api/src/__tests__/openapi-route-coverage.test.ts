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
    // A prefixed v2 router, a root-mounted one, app.ts's own router and its direct routes.
    for (const route of [
      'get /chats/{id}',
      'get /events/consumers',
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
