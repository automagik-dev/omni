/**
 * The agent-host device key against every route in SCOPE_MAP (#1461). The key reads events
 * and runs its own durable consumers (events:consume): a route answers 200 only when its scope
 * is one the key's scopes grant, and every other route, every other write among them, answers
 * 403. Which consumers it reaches is the service's rule (agent-host-device-key-postgres). The route list is SCOPE_MAP
 * itself, so a route added later is covered without editing this file.
 *
 * Strategy (as scope-enforcer-host-scopes.test.ts): only the scope enforcer in front of a
 * pass-through handler, with the key's scopes taken from deviceKeysFor, not typed here.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { SCOPE_MAP } from '../../constants/scopes';
import { DEFAULT_DEVICE_KEY_SCOPES, deviceKeysFor } from '../../login/config';
import { ApiKeyService } from '../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../types';
import { scopeEnforcerMiddleware } from '../scope-enforcer';

const AGENT_HOST_SCOPES = deviceKeysFor('omni-agent-host', DEFAULT_DEVICE_KEY_SCOPES).scopes;
/** Any authenticated key may validate itself (#1572); no scope is involved. */
const SELF_VALIDATION = 'POST /auth/validate';

function agentHostApp(): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const apiKey: ApiKeyData = {
      id: 'agent-host-key',
      name: 'device: agent host',
      scopes: AGENT_HOST_SCOPES,
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    };
    c.set('apiKey', apiKey);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  // Self-validation is matched by the route Hono serves, so it is registered by name.
  app.post('/api/v2/auth/validate', (c) => c.json({ ok: true }));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

/** A request path for a SCOPE_MAP pattern: each `:param` and a trailing `*` become a value. */
function concretePath(pattern: string): string {
  return `/api/v2${pattern
    .split('/')
    .map((segment) => (segment.startsWith(':') || segment === '*' ? 'p1' : segment))
    .join('/')}`;
}

const entries = Object.entries(SCOPE_MAP).map(([route, scope]) => {
  const [method = '', pattern = ''] = route.split(' ');
  return { route, method, pattern, scope, granted: ApiKeyService.scopeAllows(AGENT_HOST_SCOPES, scope) };
});

describe('the agent-host device key across SCOPE_MAP', () => {
  test('its scopes are read events and consume its own consumers', () => {
    expect(AGENT_HOST_SCOPES).toEqual(['events:read', 'events:consume']);
  });

  test('every route outside its scopes answers 403, and only events:read/consume routes answer 200', async () => {
    const app = agentHostApp();
    const wrong: string[] = [];
    for (const entry of entries) {
      const expected = entry.granted || entry.route === SELF_VALIDATION ? 200 : 403;
      const response = await app.request(concretePath(entry.pattern), {
        method: entry.method,
        ...(entry.method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }),
      });
      if (response.status !== expected) wrong.push(`${entry.route} (${entry.scope}): ${response.status}`);
    }
    expect(wrong).toEqual([]);
  });

  test('no write route is open to it', () => {
    const openWrites = entries.filter(
      (entry) => entry.method !== 'GET' && entry.granted && entry.route !== SELF_VALIDATION,
    );
    // The non-GET events:read routes are read-only by contract (search, a schema dry run); the
    // rest are the consumer routes events:consume opens, limited to its own consumers.
    expect(openWrites.map((entry) => entry.route).sort()).toEqual([
      'DELETE /events/consumers/:name',
      'POST /events/consumers',
      'POST /events/consumers/:name/ack',
      'POST /events/consumers/:name/pull',
      'POST /events/schemas/:eventType/validate',
      'POST /events/search',
    ]);
    const refusedWrites = entries.filter((entry) => entry.method !== 'GET' && !entry.granted);
    expect(refusedWrites.length).toBeGreaterThan(100);
  });

  test('the writes named in the brief are among the refused routes', () => {
    const refused = new Set(entries.filter((entry) => !entry.granted).map((entry) => entry.route));
    refused.delete(SELF_VALIDATION);
    for (const route of [
      'POST /messages/send',
      'POST /automations',
      'POST /instances',
      'PATCH /instances/:id',
      'DELETE /instances/:id',
      'POST /keys',
      'PATCH /keys/:id',
      'POST /keys/children',
      'POST /providers',
      'PUT /settings/:key',
      'POST /events/schemas',
      'POST /events/trigger',
    ]) {
      expect({ route, refused: refused.has(route) }).toEqual({ route, refused: true });
    }
  });

  test('events:consume opens exactly the five consumer routes, and events:write and events:* imply it', () => {
    expect(
      entries
        .filter((entry) => entry.scope === 'events:consume')
        .map((entry) => entry.route)
        .sort(),
    ).toEqual([
      'DELETE /events/consumers/:name',
      'GET /events/consumers/:name/stream',
      'POST /events/consumers',
      'POST /events/consumers/:name/ack',
      'POST /events/consumers/:name/pull',
    ]);
    for (const scopes of [['events:write'], ['events:*'], ['*']]) {
      expect({ scopes, granted: ApiKeyService.scopeAllows(scopes, 'events:consume') }).toEqual({
        scopes,
        granted: true,
      });
    }
    for (const scopes of [['events:read'], ['events:consume']]) {
      for (const route of ['POST /events/trigger', 'POST /events/schemas']) {
        expect({ scopes, route, granted: ApiKeyService.scopeAllows(scopes, SCOPE_MAP[route] ?? '') }).toEqual({
          scopes,
          route,
          granted: false,
        });
      }
    }
  });
});
