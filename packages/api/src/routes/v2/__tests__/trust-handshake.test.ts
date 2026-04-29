/**
 * Route-layer tests for the genie-host fingerprint handshake.
 *
 * Contract (from omni-host-fingerprint-trust wish, Group 1.1):
 *   POST /trust/handshake
 *     - rejects malformed pubkeys with 400 (no service call)
 *     - returns 201 + the host record on first registration
 *     - returns 200 + the EXISTING host record on idempotent replay
 *       (does NOT mutate hostname or capabilities)
 *
 * Strategy: stub the GenieHostsService at the Hono variable layer so the
 * route handler exercises the full validator + branching logic without a
 * real DB. Mirrors `keys-admin-route-guard.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { trustRoutes } from '../trust';

interface FakeHost {
  id: string;
  pubkey: string;
  hostname: string;
  capabilities: Record<string, unknown>;
  scopes: string[];
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeHost(overrides: Partial<FakeHost> = {}): FakeHost {
  const now = new Date();
  return {
    id: 'host-uuid-aaaa',
    pubkey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    hostname: 'genie.local',
    capabilities: {},
    scopes: ['*'],
    lastSeenAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface RegisterInput {
  pubkey: string;
  hostname: string;
  capabilities?: Record<string, unknown>;
}

function mountTrust(opts: {
  findByPubkey?: (pubkey: string) => Promise<FakeHost | null>;
  register?: (input: RegisterInput) => Promise<FakeHost>;
  listActive?: () => Promise<FakeHost[]>;
}): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      genieHosts: {
        findByPubkey: opts.findByPubkey ?? (async () => null),
        register: opts.register ?? (async (input: RegisterInput) => makeHost(input)),
        listActive: opts.listActive ?? (async () => []),
      },
    } as never);
    await next();
  });
  app.route('/trust', trustRoutes);
  return app;
}

async function postJson(app: Hono<{ Variables: AppVariables }>, path: string, body: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

describe('POST /trust/handshake', () => {
  test('rejects pubkey that is not base64url 32-bytes (400)', async () => {
    const app = mountTrust({});
    const { status } = await postJson(app, '/trust/handshake', {
      pubkey: 'not-a-real-key',
      hostname: 'genie.local',
    });
    expect(status).toBe(400);
  });

  test('rejects empty hostname (400)', async () => {
    const app = mountTrust({});
    const { status } = await postJson(app, '/trust/handshake', {
      pubkey: 'A'.repeat(43),
      hostname: '',
    });
    expect(status).toBe(400);
  });

  test('first registration returns 201 + the new host record', async () => {
    const validKey = 'A'.repeat(43);
    let registerCalled = false;
    const app = mountTrust({
      findByPubkey: async () => null,
      register: async (input) => {
        registerCalled = true;
        return makeHost({ pubkey: input.pubkey, hostname: input.hostname });
      },
    });
    const { status, json } = await postJson(app, '/trust/handshake', {
      pubkey: validKey,
      hostname: 'fresh.host',
    });
    expect(status).toBe(201);
    expect(registerCalled).toBe(true);
    expect((json as { data: { hostname: string } }).data.hostname).toBe('fresh.host');
  });

  test('idempotent replay returns 200 + the EXISTING host record (no register call)', async () => {
    const validKey = 'B'.repeat(43);
    let registerCalled = false;
    const app = mountTrust({
      findByPubkey: async (pk) =>
        pk === validKey ? makeHost({ id: 'host-existing', pubkey: validKey, hostname: 'existing.host' }) : null,
      register: async () => {
        registerCalled = true;
        throw new Error('register MUST NOT be called on idempotent replay');
      },
    });
    const { status, json } = await postJson(app, '/trust/handshake', {
      pubkey: validKey,
      hostname: 'someone-tried-to-rename-me',
      capabilities: { tries: 'change me' },
    });
    expect(status).toBe(200);
    expect(registerCalled).toBe(false);
    // The replay returns the existing record — hostname is NOT overwritten
    // by the new request body.
    const data = (json as { data: { id: string; hostname: string } }).data;
    expect(data.id).toBe('host-existing');
    expect(data.hostname).toBe('existing.host');
  });

  test('accepts padded (44-char) base64url pubkey', async () => {
    const padded = `${'C'.repeat(43)}=`;
    const app = mountTrust({});
    const { status } = await postJson(app, '/trust/handshake', {
      pubkey: padded,
      hostname: 'padded-key.host',
    });
    expect(status).toBe(201);
  });
});

describe('GET /trust/hosts', () => {
  test('returns the active host list', async () => {
    const app = mountTrust({
      listActive: async () => [makeHost({ id: 'h1', hostname: 'one' }), makeHost({ id: 'h2', hostname: 'two' })],
    });
    const res = await app.request('/trust/hosts');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { items: { id: string; hostname: string }[] };
    expect(json.items).toHaveLength(2);
    expect(json.items[0]?.hostname).toBe('one');
    expect(json.items[1]?.hostname).toBe('two');
  });
});
