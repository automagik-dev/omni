/**
 * Console-profile enforcement + endpoint-inventory coverage.
 *
 * Contract (WISH omni-appkit-gap, Group 2):
 *   - `console-viewer` must be DENIED (403) on a destructive route
 *     (`DELETE /instances/:id`), `console-admin` must be ALLOWED (2xx).
 *   - Every route the Omni Admin UI can invoke must be reachable under
 *     `console-admin` — i.e. no missing scope. The route list is NOT
 *     hand-transcribed: it is driven from the machine-readable capability
 *     inventory (`apps/khal-ui/package/src/capabilities/capabilities.json`,
 *     generated from `SCOPE_MAP` by build-capability-inventory.ts), and every
 *     capability is pushed through the REAL `scopeEnforcerMiddleware`.
 *
 * The `/trust/*`, `/handoffs/*`, `/follow-up/*`, and `/voice/*` families are now
 * mapped into SCOPE_MAP (Group 2 HIGH-2), so `console-admin` reaches them. The
 * ONLY capabilities that remain `scope: null` are intentionally-dark platform
 * meta routes and legacy message-send aliases the console never calls
 * (`/health`, `/info`, `/_internal/health`, four `POST /messages/*` aliases).
 * They are enumerated in `INTENTIONALLY_DARK` below; the coverage test now
 * asserts that EVERY other inventory capability is both mapped (non-null scope)
 * and reachable (non-403) under `console-admin`, so a future UI-invoked route
 * that lands unmapped fails this suite instead of being silently skipped.
 */

import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { CONSOLE_ADMIN_SCOPES, CONSOLE_VIEWER_SCOPES } from '../../../constants/profiles';
import { scopeEnforcerMiddleware } from '../../../middleware/scope-enforcer';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Capabilities intentionally left OUT of SCOPE_MAP: platform meta/health
 * endpoints and legacy message-send aliases the Omni Admin console never
 * invokes. These are the only routes allowed to carry `scope: null`; anything
 * else unmapped is a real gap the coverage test must fail on. Keyed by the
 * inventory `key` (`METHOD route`).
 */
const INTENTIONALLY_DARK: ReadonlySet<string> = new Set([
  'GET /health',
  'GET /info',
  'GET /_internal/health',
  'POST /messages/contact',
  'POST /messages/location',
  'POST /messages/reaction',
  'POST /messages/sticker',
]);

const INVENTORY_PATH = join(
  import.meta.dir,
  '../../../../../../apps/khal-ui/package/src/capabilities/capabilities.json',
);

interface Capability {
  key: string;
  method: string;
  route: string;
  scope: string | null;
  destructive: boolean;
}

interface InventoryFile {
  capabilities: Capability[];
}

function loadInventory(): Capability[] {
  // Fail loudly rather than skipping: the inventory is the source of truth for
  // what the console can invoke, so an unreadable file is a real failure.
  const raw = readFileSync(INVENTORY_PATH, 'utf8');
  const parsed = JSON.parse(raw) as InventoryFile;
  if (!Array.isArray(parsed.capabilities) || parsed.capabilities.length === 0) {
    throw new Error(`capability inventory is empty or malformed: ${INVENTORY_PATH}`);
  }
  return parsed.capabilities;
}

/** A console key as the BFF will mint it: profile set, scopes set, no locks. */
function consoleKey(profile: 'console-viewer' | 'console-admin', scopes: string[]): unknown {
  return {
    id: `key-${profile}`,
    name: profile,
    scopes,
    instanceIds: null,
    expiresAt: null,
    profile,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    profileOverrides: {},
  };
}

/** App that runs the real scope enforcer in front of the real instances routes. */
function mountInstancesWithEnforcer(apiKey: unknown): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
        delete: mock(async () => true),
      },
    } as never);
    c.set('channelRegistry', { get: mock(() => undefined) } as never);
    c.set('apiKey', apiKey as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.route('/instances', instancesRoutes);

  return app;
}

/** App that runs the real scope enforcer in front of a permissive catch-all. */
function mountEnforcerProbe(apiKey: unknown): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('apiKey', apiKey as never);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

/** Turn an inventory route pattern into a concrete request path. */
function concretePath(route: string): string {
  return route
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return INSTANCE_ID;
      if (seg === '*') return 'probe';
      return seg;
    })
    .join('/');
}

describe('console profiles — destructive route enforcement', () => {
  test('console-viewer is denied (403) on DELETE /instances/:id', async () => {
    const app = mountInstancesWithEnforcer(consoleKey('console-viewer', CONSOLE_VIEWER_SCOPES));

    const res = await app.request(`/instances/${INSTANCE_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(body.error?.message).toContain('instances:write');
  });

  test('console-admin is allowed (2xx) on DELETE /instances/:id', async () => {
    const app = mountInstancesWithEnforcer(consoleKey('console-admin', CONSOLE_ADMIN_SCOPES));

    const res = await app.request(`/instances/${INSTANCE_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  test('console-viewer is denied on every destructive capability in the inventory', async () => {
    const app = mountEnforcerProbe(consoleKey('console-viewer', CONSOLE_VIEWER_SCOPES));
    const destructive = loadInventory().filter((c) => c.destructive && c.scope !== null);
    expect(destructive.length).toBeGreaterThan(0);

    const allowed: string[] = [];
    for (const cap of destructive) {
      const res = await app.request(concretePath(cap.route), { method: cap.method });
      if (res.status !== 403) allowed.push(cap.key);
    }

    expect(allowed).toEqual([]);
  });
});

describe('console-admin — capability inventory coverage', () => {
  test('every scoped capability the UI can invoke is reachable (no 403) under console-admin', async () => {
    const app = mountEnforcerProbe(consoleKey('console-admin', CONSOLE_ADMIN_SCOPES));
    const scoped = loadInventory().filter((c) => c.scope !== null);
    expect(scoped.length).toBeGreaterThan(0);

    const denied: string[] = [];
    for (const cap of scoped) {
      const res = await app.request(concretePath(cap.route), { method: cap.method });
      if (res.status === 403) denied.push(`${cap.key} (needs ${cap.scope})`);
    }

    expect(denied).toEqual([]);
  });

  test('every console-invokable route is mapped and reachable (non-403) under console-admin, except intentionally-dark meta routes', async () => {
    const app = mountEnforcerProbe(consoleKey('console-admin', CONSOLE_ADMIN_SCOPES));
    const all = loadInventory();

    // No silent skips: any capability outside the allowlist that is still
    // unmapped (scope: null) is a real SCOPE_MAP gap and must fail here.
    const unexpectedlyDark = all.filter((c) => c.scope === null && !INTENTIONALLY_DARK.has(c.key)).map((c) => c.key);
    expect(unexpectedlyDark).toEqual([]);

    // Every mapped, non-dark route must be reachable under console-admin.
    const denied: string[] = [];
    for (const cap of all) {
      if (INTENTIONALLY_DARK.has(cap.key) || cap.scope === null) continue;
      const res = await app.request(concretePath(cap.route), { method: cap.method });
      if (res.status === 403) denied.push(`${cap.key} (needs ${cap.scope})`);
    }
    expect(denied).toEqual([]);
  });

  test('the trust/handoffs/voice/follow-up families are now mapped (no longer scope: null)', () => {
    const byScope = new Map(loadInventory().map((c) => [c.key, c.scope]));
    const expected: Record<string, string> = {
      'GET /trust/hosts': 'trust:read',
      'GET /trust/hosts/:id': 'trust:read',
      'PATCH /trust/hosts/:id': 'trust:write',
      'DELETE /trust/hosts/:id': 'trust:write',
      'POST /trust/handshake': 'trust:write',
      'GET /handoffs': 'handoffs:read',
      'GET /handoffs/:id': 'handoffs:read',
      'GET /voice/sessions': 'voice:read',
      'GET /voice/sessions/:id': 'voice:read',
      'POST /voice/join': 'voice:write',
      'POST /voice/leave': 'voice:write',
      'GET /follow-up/agents/:id': 'follow-up:read',
      'PUT /follow-up/agents/:id': 'follow-up:write',
      'DELETE /follow-up/agents/:id': 'follow-up:write',
      'GET /follow-up/instances/:id': 'follow-up:read',
      'PUT /follow-up/instances/:id': 'follow-up:write',
      'DELETE /follow-up/instances/:id': 'follow-up:write',
      'GET /follow-up/chats/:id': 'follow-up:read',
      'PUT /follow-up/chats/:id': 'follow-up:write',
      'DELETE /follow-up/chats/:id': 'follow-up:write',
    };
    const mismatches = Object.entries(expected)
      .filter(([key, scope]) => byScope.get(key) !== scope)
      .map(([key, scope]) => `${key} expected ${scope} got ${String(byScope.get(key))}`);
    expect(mismatches).toEqual([]);
  });

  test('console-admin scope set is exactly the inventory scope set — no more, no less', () => {
    const inventoryScopes = new Set(
      loadInventory()
        .map((c) => c.scope)
        .filter((s): s is string => s !== null),
    );

    const granted = new Set(CONSOLE_ADMIN_SCOPES);
    const missing = [...inventoryScopes].filter((s) => !granted.has(s)).sort();
    const extra = [...granted].filter((s) => !inventoryScopes.has(s)).sort();

    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });
});
