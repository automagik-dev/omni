/**
 * Who may reach /api/v2/system/update: the scope enforcer in front of the real routes and
 * updater, with the registry, self chat, request store and update command faked.
 *
 * A device key (what device sign-in and connect links mint) can see the version and ask for
 * an update, which only asks the owner; a key with neither system scope is refused.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { readLoginConfig } from '../../login/config';
import type { UpdateRequest, UpdateRequestStore } from '../../login/update-requests';
import type { OwnAccount } from '../../login/whatsapp';
import { scopeEnforcerMiddleware } from '../../middleware/scope-enforcer';
import { systemRoutes } from '../../routes/v2/system';
import { ApiKeyService } from '../../services/api-keys';
import type { ApiKeyData, AppVariables } from '../../types';
import { createSystemUpdater } from '../update';

const OWNER: OwnAccount = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  instanceName: 'owner-whatsapp',
  phone: '5511999990000',
  selfJid: '5511999990000@s.whatsapp.net',
};

const DEVICE_SCOPES =
  readLoginConfig({
    OMNI_LOGIN_ENABLED: 'true',
    OMNI_PUBLIC_URL: 'https://omni.example.com',
    OMNI_AUTH_SECRET: 'test-secret-test-secret-test-secret-42',
  })?.deviceKeyScopes ?? [];

let dir: string;
let sent: string[];
let spawned: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omni-update-scopes-'));
  sent = [];
  spawned = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function mount(scopes: string[]) {
  const rows = new Map<string, UpdateRequest>();
  const requests: UpdateRequestStore = {
    pending: async () => {
      const [request] = rows.values();
      return request ? { request, expiresAt: new Date(Date.now() + 600_000) } : null;
    },
    create: async (request) => {
      rows.set('K7QM2X', request);
      return { code: 'K7QM2X', expiresAt: new Date(Date.now() + 600_000) };
    },
    consume: async () => null,
    cancel: async () => rows.clear(),
  };
  const updater = createSystemUpdater({
    version: '2.261023.7',
    login: null,
    eventBus: null,
    owner: { account: async () => OWNER, send: async (_account, _key, text) => void sent.push(text) },
    requests,
    env: { OMNI_UPDATE_COMMAND: 'omni update --yes', OMNI_UPDATE_STATE_DIR: dir },
    fetch: async () => new Response(JSON.stringify({ latest: '2.261023.8' })),
    spawn: () => {
      spawned += 1;
      return { onError: () => {}, onExit: () => {}, unref: () => {} };
    },
  });
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    const apiKey: ApiKeyData = {
      id: 'k-device',
      name: 'device: Laptop',
      scopes,
      instanceIds: null,
      expiresAt: null,
      profile: null,
      chatAllowlist: [],
      instanceAllowlist: [],
      outboundRecipientAllowlist: [],
    };
    c.set('apiKey', apiKey);
    c.set('updater', updater);
    await next();
  });
  app.use('*', scopeEnforcerMiddleware);
  app.route('/api/v2/system', systemRoutes);
  return app;
}

const post = (app: Hono<{ Variables: AppVariables }>) =>
  app.request('/api/v2/system/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '2.261023.8' }),
  });

describe('system update scopes', () => {
  test('device keys see the version and may ask for an update, never system:admin', () => {
    expect(DEVICE_SCOPES).toContain('system:read');
    expect(DEVICE_SCOPES).toContain('system:update');
    expect(DEVICE_SCOPES).not.toContain('system:admin');
  });

  test('system:admin also grants system:update, not the other way round', () => {
    expect(ApiKeyService.scopeAllows(['system:admin'], 'system:update')).toBe(true);
    expect(ApiKeyService.scopeAllows(['system:update'], 'system:admin')).toBe(false);
    expect(ApiKeyService.scopeAllows(['system:read'], 'system:update')).toBe(false);
  });

  test('a device key can GET the status and POST a request, which only asks the owner', async () => {
    const app = mount(DEVICE_SCOPES);
    const status = await app.request('/api/v2/system/update');
    expect(status.status).toBe(200);
    expect(((await status.json()) as { data: { latest: string } }).data.latest).toBe('2.261023.8');

    const asked = await post(app);
    expect(asked.status).toBe(202);
    // Nothing ran: the owner was asked, and that is all until they reply.
    expect(spawned).toBe(0);
    expect(existsSync(join(dir, 'system-update.json'))).toBe(false);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('update K7QM2X');
  });

  test('an admin key may ask too', async () => {
    expect((await post(mount(['system:admin']))).status).toBe(202);
  });

  test('a key with neither system scope is refused both', async () => {
    const app = mount(['instances:read', 'chats:read', 'messages:read', 'events:read']);
    expect((await app.request('/api/v2/system/update')).status).toBe(403);
    expect((await post(app)).status).toBe(403);
    expect((await post(mount(['system:read']))).status).toBe(403);
    expect(sent).toEqual([]);
  });
});
