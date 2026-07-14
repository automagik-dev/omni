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
 * Known gap (reported, not papered over): 27 inventory capabilities carry
 * `scope: null` — they are mounted and reachable but absent from SCOPE_MAP
 * (`/trust/*`, `/handoffs/*`, `/follow-up/*`, `/voice/*`, four legacy
 * `/messages/*` aliases, `/health`, `/info`). The enforcer denies unmapped
 * routes by default, so NO scoped key — console-admin included — can reach
 * them; only a `*` wildcard key can. Granting the console a wildcard would
 * defeat the whole tiering, so those routes are excluded from the coverage
 * assertion below and tracked as an API-side SCOPE_MAP gap.
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
