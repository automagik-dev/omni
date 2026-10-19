/**
 * PR #1297: `inboundReplyContext` is an opt-in instance flag. PATCH persists it
 * only when sent, GET returns it, and every connect path forwards
 * `options.inboundReplyContext` to the plugin ONLY when the flag is on, so an
 * instance that has not opted in connects with exactly the options of before.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { applyInboundReplyContextOption } from '../../../lib/inbound-reply-context';
import { buildInstanceConnectOptions } from '../../../plugins/instance-monitor';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

function mount(initial: Record<string, unknown> = {}) {
  const app = new Hono<{ Variables: AppVariables }>();
  let row: Record<string, unknown> = {
    id: INSTANCE_ID,
    name: 'i1297',
    channel: 'whatsapp-baileys',
    agentId: null,
    historyIdentity: 'desktop',
    syncFullHistory: false,
    markOnlineOnConnect: true,
    inboundReplyContext: false,
    ...initial,
  };
  const update = mock(async (_id: string, data: Record<string, unknown>) => {
    row = { ...row, ...data };
    return row;
  });
  const connect = mock(async (_id: string, _config: { options: Record<string, unknown> }) => {});
  const plugin = { connect, disconnect: mock(async () => {}) };
  app.use('*', async (c, next) => {
    c.set('services', { instances: { getById: mock(async () => row), update } } as never);
    c.set('channelRegistry', { get: mock(() => plugin) } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);
  const patch = (body: unknown) =>
    app.request(`/instances/${INSTANCE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const restart = () => app.request(`/instances/${INSTANCE_ID}/restart`, { method: 'POST' });
  const connectOptions = () => connect.mock.calls[0]?.[1]?.options as Record<string, unknown>;
  return { app, update, patch, restart, connectOptions };
}

describe('instance inboundReplyContext flag (#1297)', () => {
  test('PATCH persists inboundReplyContext and GET returns it', async () => {
    const { app, patch, update } = mount();
    expect((await patch({ inboundReplyContext: true })).status).toBe(200);
    expect(update.mock.calls[0]?.[1]).toMatchObject({ inboundReplyContext: true });
    const body = (await (await app.request(`/instances/${INSTANCE_ID}`)).json()) as { data: Record<string, unknown> };
    expect(body.data.inboundReplyContext).toBe(true);
  });

  test('PATCH without the key does not touch it (no default on update)', async () => {
    const { patch, update } = mount({ inboundReplyContext: true });
    expect((await patch({ name: 'renamed' })).status).toBe(200);
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty('inboundReplyContext');
  });

  test('PATCH rejects a non-boolean value', async () => {
    const { patch, update } = mount();
    expect((await patch({ inboundReplyContext: 'yes' })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  test('restart with the flag off connects with no inboundReplyContext key', async () => {
    const { restart, connectOptions } = mount();
    expect((await restart()).status).toBe(200);
    expect(connectOptions()).not.toHaveProperty('inboundReplyContext');
  });

  test('restart with the flag on forwards inboundReplyContext: true', async () => {
    const { restart, connectOptions } = mount({ inboundReplyContext: true });
    expect((await restart()).status).toBe(200);
    expect(connectOptions().inboundReplyContext).toBe(true);
  });
});

describe('applyInboundReplyContextOption', () => {
  test('flag off or absent adds nothing', () => {
    for (const inboundReplyContext of [false, null, undefined]) {
      const options: Record<string, unknown> = { forceNewQr: false };
      applyInboundReplyContextOption(options, { channel: 'whatsapp-baileys', inboundReplyContext });
      expect(options).toEqual({ forceNewQr: false });
    }
  });

  test('flag on adds inboundReplyContext for whatsapp-baileys only', () => {
    const baileys: Record<string, unknown> = {};
    applyInboundReplyContextOption(baileys, { channel: 'whatsapp-baileys', inboundReplyContext: true });
    expect(baileys).toEqual({ inboundReplyContext: true });

    const discord: Record<string, unknown> = {};
    applyInboundReplyContextOption(discord, { channel: 'discord', inboundReplyContext: true });
    expect(discord).toEqual({});
  });

  test('boot reconnect options carry the flag only when it is on', () => {
    expect(buildInstanceConnectOptions({ channel: 'whatsapp-baileys', inboundReplyContext: false })).toEqual({});
    expect(buildInstanceConnectOptions({ channel: 'whatsapp-baileys', inboundReplyContext: true })).toEqual({
      inboundReplyContext: true,
    });
  });
});
