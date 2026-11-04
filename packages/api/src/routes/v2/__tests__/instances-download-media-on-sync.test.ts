/**
 * #1280: the history WhatsApp pushes after pairing has no sync job, so the
 * Baileys plugin can only honor the instance's `downloadMediaOnSync` if the
 * connect options carry it — on restart/connect and on the boot reconnect.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { buildInstanceConnectOptions } from '../../../plugins/instance-monitor';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

function mountRestart(row: Record<string, unknown>) {
  const connect = mock(async (_id: string, _config: { options: Record<string, unknown> }) => undefined);
  const plugin = { id: row.channel, disconnect: mock(async () => undefined), connect };
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', { instances: { getById: mock(async () => row) } } as never);
    c.set('channelRegistry', { get: () => plugin } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  return { app, connect };
}

const baileysRow = (downloadMediaOnSync: boolean) => ({
  id: INSTANCE_ID,
  name: 'i1280',
  channel: 'whatsapp-baileys',
  agentId: null,
  historyIdentity: 'desktop',
  syncFullHistory: false,
  markOnlineOnConnect: true,
  downloadMediaOnSync,
});

describe('downloadMediaOnSync in connect options (#1280)', () => {
  test('restart passes the instance setting to the Baileys plugin', async () => {
    for (const value of [true, false]) {
      const { app, connect } = mountRestart(baileysRow(value));
      const res = await app.request(`/instances/${INSTANCE_ID}/restart`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(connect.mock.calls[0]?.[1].options.downloadMediaOnSync).toBe(value);
    }
  });

  test('the boot reconnect passes it too, defaulting to false', () => {
    expect(buildInstanceConnectOptions({ channel: 'whatsapp-baileys', downloadMediaOnSync: true })).toMatchObject({
      downloadMediaOnSync: true,
    });
    expect(buildInstanceConnectOptions({ channel: 'whatsapp-baileys', downloadMediaOnSync: null })).toMatchObject({
      downloadMediaOnSync: false,
    });
  });

  test('other channels do not get it', () => {
    expect(buildInstanceConnectOptions({ channel: 'telegram', downloadMediaOnSync: true })).not.toHaveProperty(
      'downloadMediaOnSync',
    );
  });
});
