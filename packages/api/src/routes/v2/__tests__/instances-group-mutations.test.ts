import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_JID = '120000000000000000@g.us';
const ENCODED_GROUP_JID = encodeURIComponent(GROUP_JID);
const PARTICIPANTS = ['5511000000000'];

function mountInstancesRoutes(plugin: Record<string, unknown>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => plugin),
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });

  app.route('/instances', instancesRoutes);
  return app;
}

function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  };
}

describe('instance group mutation routes', () => {
  test('POST /participants adds participants', async () => {
    const updateGroupParticipants = mock(async (_id, groupJid, participants, action) => ({
      groupJid,
      action,
      participants: participants.map((jid: string) => ({ jid, status: '200' })),
    }));
    const app = mountInstancesRoutes({ updateGroupParticipants });

    const res = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/participants`,
      jsonRequest('POST', { participants: PARTICIPANTS }),
    );

    expect(res.status).toBe(200);
    expect(updateGroupParticipants).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, PARTICIPANTS, 'add');
    const body = (await res.json()) as { data: { action: string; changedCount: number } };
    expect(body.data.action).toBe('add');
    expect(body.data.changedCount).toBe(1);
  });

  test('POST /participants/:action uses the action-specific route for remove/promote/demote', async () => {
    const updateGroupParticipants = mock(async (_id, groupJid, participants, action) => ({
      groupJid,
      action,
      participants: participants.map((jid: string) => ({ jid, status: '200' })),
    }));
    const app = mountInstancesRoutes({ updateGroupParticipants });

    const res = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/participants/remove`,
      jsonRequest('POST', { participants: PARTICIPANTS }),
    );

    expect(res.status).toBe(200);
    expect(updateGroupParticipants).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, PARTICIPANTS, 'remove');
  });

  test('PATCH /participants supports body.action fallback', async () => {
    const updateGroupParticipants = mock(async (_id, groupJid, participants, action) => ({
      groupJid,
      action,
      participants: participants.map((jid: string) => ({ jid, status: '200' })),
    }));
    const app = mountInstancesRoutes({ updateGroupParticipants });

    const res = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/participants`,
      jsonRequest('PATCH', { action: 'promote', participants: PARTICIPANTS }),
    );

    expect(res.status).toBe(200);
    expect(updateGroupParticipants).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, PARTICIPANTS, 'promote');
  });

  test('PATCH /groups/:groupJid updates subject, description, and settings', async () => {
    const updateGroupSubject = mock(async () => {});
    const updateGroupDescription = mock(async () => {});
    const updateGroupSettings = mock(async () => {});
    const app = mountInstancesRoutes({ updateGroupSubject, updateGroupDescription, updateGroupSettings });

    const res = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}`,
      jsonRequest('PATCH', {
        subject: 'novo nome',
        description: 'nova descricao',
        setting: 'announcement',
      }),
    );

    expect(res.status).toBe(200);
    expect(updateGroupSubject).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'novo nome');
    expect(updateGroupDescription).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'nova descricao');
    expect(updateGroupSettings).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'announcement');
  });

  test('subject, description, settings, and leave action routes delegate to plugin methods', async () => {
    const updateGroupSubject = mock(async () => {});
    const updateGroupDescription = mock(async () => {});
    const updateGroupSettings = mock(async () => {});
    const leaveGroup = mock(async () => {});
    const app = mountInstancesRoutes({ updateGroupSubject, updateGroupDescription, updateGroupSettings, leaveGroup });

    const subject = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/subject`,
      jsonRequest('POST', { subject: 'renomeado' }),
    );
    const description = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/description`,
      jsonRequest('POST', { description: 'descrita' }),
    );
    const settings = await app.request(
      `/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/settings`,
      jsonRequest('POST', { setting: 'locked' }),
    );
    const leave = await app.request(`/instances/${INSTANCE_ID}/groups/${ENCODED_GROUP_JID}/leave`, jsonRequest('POST'));

    expect(subject.status).toBe(200);
    expect(description.status).toBe(200);
    expect(settings.status).toBe(200);
    expect(leave.status).toBe(200);
    expect(updateGroupSubject).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'renomeado');
    expect(updateGroupDescription).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'descrita');
    expect(updateGroupSettings).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID, 'locked');
    expect(leaveGroup).toHaveBeenCalledWith(INSTANCE_ID, GROUP_JID);
  });
});
